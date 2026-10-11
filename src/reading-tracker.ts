import { diffArrays } from 'diff'

export type Strategy = 'B0' | 'B1' | 'V1'
export const strategies: Strategy[] = ['B0', 'B1', 'V1']
export type Action = 'Hold' | 'Advance' | 'Skip' | 'Repeat' | 'Revise' | 'Restart'
export interface Config {
  lookBack: number; lookAhead: number; maxGap: number; support: number; repeatSupport: number
  minCoverage: number; maxExtra: number
}
export const defaults: Config = { lookBack: 12, lookAhead: 24, maxGap: 1, support: 2, repeatSupport: 3, minCoverage: 0.6, maxExtra: 3 }
export interface Token { text: string; start: number; end: number }
/** Indices are normalized token indices (zero based); offsets are original UTF-16 offsets. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let offset = 0
  for (const character of text) {
    for (const normalized of character.normalize('NFKC').toLowerCase()) {
      if (/[\p{L}\p{N}]/u.test(normalized)) tokens.push({ text: normalized, start: offset, end: offset + character.length })
    }
    offset += character.length
  }
  return tokens
}
export type ReadingEvent =
  | { type: 'stt'; epoch: number; seq: number; segment: string; at: number; text: string; final: boolean }
  | { type: 'pause'; epoch: number; at: number }
  | { type: 'restart'; epoch: number; at: number }
interface Snapshot { cursor: number; furthest: number; matched: number[]; skipped: number[]; uncertain: number[] }
export interface Decision { action: Action; reason: string; from: number; to: number; candidates: number }
export interface TrackerState {
  reference: string; tokens: Token[]; strategy: Strategy; config: Config; epoch: number
  cursor: number; confirmed: number; furthest: number; tentative: boolean; complete: boolean
  matched: number[]; skipped: number[]; uncertain: number[]; tentativeIndices: number[]
  committed: Snapshot; active: string | null; hypothesis: string; sealed: string[]; lastSeq: number
  decision: Decision
}
const empty = (): Snapshot => ({ cursor: -1, furthest: -1, matched: [], skipped: [], uncertain: [] })
export function createTracker(reference: string, strategy: Strategy = 'V1', config: Partial<Config> = {}, epoch = 0): TrackerState {
  const options = { ...defaults, ...config }
  if (!strategies.includes(strategy)) throw new Error('Unknown strategy')
  if (!Number.isInteger(epoch) || epoch < 0) throw new Error('Invalid epoch')
  for (const [key, value] of Object.entries(options)) {
    if (key === 'minCoverage') {
      if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error('minCoverage must be in (0, 1]')
      continue
    }
    if (!Number.isInteger(value) || value < (['support', 'repeatSupport', 'lookAhead'].includes(key) ? 1 : 0) || value > 128)
      throw new Error(`Invalid parameter: ${key} (integer, at most 128)`)
  }
  const tokens = tokenize(reference)
  if (!tokens.length) throw new Error('Reference must contain letters or numbers')
  return { reference, tokens, strategy, config: options, epoch, ...empty(), confirmed: -1,
    tentative: false, complete: false, tentativeIndices: [], committed: empty(), active: null,
    hypothesis: '', sealed: [], lastSeq: -1,
    decision: { action: 'Hold', reason: 'ready', from: -1, to: -1, candidates: 0 } }
}
interface Alignment { cursor: number; matched: number[]; skipped: number[]; uncertain: number[]; repeat: boolean; score: number }
const range = (start: number, end: number) => Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i)
function baseline(state: TrackerState, input: string[]): Alignment {
  let cursor = state.committed.cursor
  const matched: number[] = [], skipped: number[] = []
  for (const token of input) {
    if (token === state.tokens[cursor + 1]?.text) matched.push(++cursor)
    else if (state.strategy === 'B1' && token === state.tokens[cursor + 2]?.text) {
      skipped.push(cursor + 1); cursor += 2; matched.push(cursor)
    }
    // A mismatch is ignored, not evidence that the next reference character was wrong.
  }
  return { cursor, matched, skipped, uncertain: [], repeat: false, score: 0 }
}

/** Library computes edit paths. This layer only limits candidates and interprets evidence. */
function localAlignment(state: TrackerState, input: string[], stableLength: number): { result?: Alignment; reason: string; count: number } {
  const c = state.config, anchor = state.committed.cursor, next = anchor + 1
  const ref = state.tokens.map(t => t.text), candidates: Alignment[] = []
  if (!input.length) return { reason: 'empty-hypothesis', count: 0 }
  if (input.length > c.lookAhead) return { reason: 'hypothesis-exceeds-window', count: 0 }
  let insufficient = false
  for (let start = Math.max(0, next - c.lookBack); start <= next && start < ref.length; start++) {
    const repeat = start < next
    const limit = Math.min(ref.length, start + c.lookAhead, start + input.length + c.maxGap)
    for (let end = start + 1; end <= limit; end++) {
      const parts = diffArrays(ref.slice(start, end), input)
      let r = start, h = 0, edits = 0, valid = true, longestRun = 0
      const matched: number[] = [], skipped: number[] = [], uncertain: number[] = []
      for (let i = 0; i < parts.length;) {
        const part = parts[i]
        if (!part.added && !part.removed) {
          matched.push(...range(r, r + part.count)); longestRun = Math.max(longestRun, part.count)
          r += part.count; h += part.count; i++; continue
        }
        const gapStart = r
        let removed = 0, added = 0
        while (i < parts.length && (parts[i].added || parts[i].removed)) {
          if (parts[i].removed) { removed += parts[i].count; r += parts[i].count }
          else { added += parts[i].count; h += parts[i].count }
          i++
        }
        edits += removed + added
        const following = parts[i]?.count || 0
        if (removed) {
          // Never count unread trailing reference text as a skip. Only bridged gaps qualify.
          if (removed > c.maxGap || added > c.maxGap || following < c.support) { valid = false; break }
          if (h + c.support > stableLength) { insufficient = true; valid = false; break }
          ;(added ? uncertain : skipped).push(...range(gapStart, r))
        } else if (added > c.maxExtra) { valid = false; break }
      }
      if (!valid || !matched.length || matched.length / input.length < c.minCoverage) continue
      const cursor = matched[matched.length - 1]
      if (repeat && (longestRun < c.repeatSupport || parts[0].added || parts[0].removed
        || parts[0].count < c.repeatSupport || stableLength < c.repeatSupport)) {
        insufficient = true; continue
      }
      // Stronger lexical evidence wins, then continuity; never score a free forward jump.
      const score = matched.length * 3 - edits * 2 - (repeat ? 0.5 + (next - start) * 0.05 : 0)
      candidates.push({ cursor, matched, skipped, uncertain, repeat, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best) {
    let prefix = 0
    while (prefix < input.length && ref[next + prefix] === input[prefix]) prefix++
    if (prefix) return { result: { cursor: next + prefix - 1, matched: range(next, next + prefix),
      skipped: [], uncertain: [], repeat: false, score: 0 },
      reason: insufficient ? 'prefix-before-gap' : 'prefix-before-mismatch', count: 0 }
    return { reason: insufficient ? 'awaiting-context' : 'no-local-match', count: 0 }
  }
  if (candidates.some(candidate => candidate.cursor !== best.cursor && Math.abs(candidate.score - best.score) < 0.001))
    return { reason: 'ambiguous-position', count: candidates.length }
  return { result: best, reason: best.repeat ? 'local-repeat' : best.uncertain.length ? 'bridged-mismatch'
    : best.skipped.length ? 'supported-gap' : 'sequential-match', count: candidates.length }
}

/** Pure reducer. A segment is a replaceable snapshot; Final seals it exactly once. */
export function track(previous: TrackerState, event: ReadingEvent): TrackerState {
  if (!Number.isFinite(event.at) || event.at < 0 || !Number.isInteger(event.epoch) || event.epoch < 0) throw new Error('Invalid event clock/epoch')
  if (event.type === 'restart' && event.epoch > previous.epoch) {
    const fresh = createTracker(previous.reference, previous.strategy, previous.config, event.epoch)
    fresh.decision = { action: 'Restart', reason: 'new-epoch', from: previous.cursor, to: -1, candidates: 0 }
    return fresh
  }
  const state = structuredClone(previous)
  const hold = (reason: string) => {
    state.decision = { action: 'Hold', reason, from: previous.cursor, to: state.cursor, candidates: 0 }; return state
  }
  if (event.epoch !== state.epoch) return hold('stale-or-future-epoch')
  if (event.type === 'restart') return hold('restart-requires-new-epoch')
  if (event.type === 'pause') return hold('no-new-evidence')
  if (!Number.isInteger(event.seq) || event.seq < 0 || !event.segment || typeof event.text !== 'string' || typeof event.final !== 'boolean')
    throw new Error('Invalid STT event')
  if (event.seq <= state.lastSeq) return hold('duplicate-or-out-of-order')
  if (state.sealed.includes(event.segment)) return hold('sealed-segment')
  if (state.active && state.active !== event.segment) return hold('unclosed-segment')
  const input = tokenize(event.text).map(t => t.text)
  const oldInput = tokenize(state.hypothesis).map(t => t.text)
  let common = 0
  while (common < Math.min(input.length, oldInput.length) && input[common] === oldInput[common]) common++
  state.lastSeq = event.seq
  if (state.active === event.segment && input.join('') === oldInput.join('') && !event.final) return hold('unchanged-partial')
  state.active = event.segment; state.hypothesis = event.text
  const aligned = state.strategy === 'V1' ? localAlignment(state, input, event.final ? input.length : common)
    : { result: baseline(state, input), reason: '', count: 1 }
  const result = aligned.result
  const base = state.committed
  const matched = new Set(base.matched), skipped = new Set(base.skipped), uncertain = new Set(base.uncertain)
  if (result) {
    for (const index of result.skipped) if (!matched.has(index)) { skipped.add(index); uncertain.delete(index) }
    for (const index of result.uncertain) if (!matched.has(index)) { uncertain.add(index); skipped.delete(index) }
    for (const index of result.matched) { matched.add(index); skipped.delete(index); uncertain.delete(index) }
  }
  state.cursor = result?.cursor ?? base.cursor
  state.matched = [...matched].sort((a, b) => a - b)
  state.skipped = [...skipped].sort((a, b) => a - b)
  state.uncertain = [...uncertain].sort((a, b) => a - b)
  state.tentativeIndices = event.final ? [] : [...new Set([...(result?.matched || []), ...(result?.skipped || []), ...(result?.uncertain || [])])]
  state.tentative = !event.final && state.tentativeIndices.length > 0
  // Historical progress only uses finalized accepted evidence, never a revoked partial.
  state.furthest = event.final ? Math.max(base.furthest, state.cursor) : base.furthest
  state.confirmed = event.final ? state.cursor : base.cursor
  state.complete = state.confirmed === state.tokens.length - 1 && !state.tentative
  let action: Action = result?.repeat ? 'Repeat' : state.cursor < previous.cursor ? 'Revise'
    : result && (result.skipped.length || result.uncertain.length) ? 'Skip'
    : state.cursor > previous.cursor ? 'Advance' : 'Hold'
  const reason = state.strategy === 'V1' ? aligned.reason : !input.length ? 'empty-hypothesis'
    : result!.skipped.length ? 'baseline-skip-one' : result!.matched.length ? 'sequential-match' : 'baseline-blocked'
  if (common < oldInput.length && state.cursor < previous.cursor) action = 'Revise'
  state.decision = { action, reason, from: previous.cursor, to: state.cursor, candidates: aligned.count }
  if (event.final) {
    state.committed = { cursor: state.cursor, furthest: state.furthest, matched: [...state.matched], skipped: [...state.skipped], uncertain: [...state.uncertain] }
    state.sealed.push(event.segment); state.active = null; state.hypothesis = ''
  }
  return state
}

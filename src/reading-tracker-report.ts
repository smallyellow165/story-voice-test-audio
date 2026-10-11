import { diffArrays } from 'diff'
import { defaults, tokenize } from './reading-tracker.ts'
import type { TrackerState } from './reading-tracker.ts'
import { differences } from './reading-tracker-scenarios.ts'
import type { Goal, replay } from './reading-tracker-scenarios.ts'
import { contracts, overrides, reasonCode } from './reading-tracker-expectations.ts'

type Row = ReturnType<typeof replay>[number]
export function characterStates(reference: string, state: Goal) {
  return tokenize(reference).map((token, index) => ({
    text: token.text, index,
    status: state.matched.includes(index) ? 'Match' : state.skipped.includes(index) ? 'Skip' : state.uncertain.includes(index) ? 'Uncertain' : 'Unread',
  }))
}
// Independent display-only diff. Never a tracker candidate, nor evidence of acceptance.
// Whole-reference matching can choose a different occurrence in repeated text.
export function textComparison(reference: string, input: string) {
  const columns: { reference: string; input: string; relation: string }[] = []
  for (const change of diffArrays(tokenize(reference).map(t => t.text), tokenize(input).map(t => t.text))) {
    for (const text of change.value) columns.push({
      reference: change.added ? '—' : text,
      input: change.removed ? '—' : text,
      relation: change.added ? 'STT 多出 / Mismatch' : change.removed ? 'STT 缺口（非 Skip 判定）' : '字面相同（非接受判定）',
    })
  }
  return columns
}
export function eventReport(id: string, row: Row) {
  const state: TrackerState = row.state
  const expected = overrides[id]?.[state.strategy]?.[row.index] ?? row.goal
  const [action, code] = (contracts[id][state.strategy] ?? contracts[id].all)!.split(' ')[row.index].split(':')
  const reason = reasonCode[code]
  const delta = differences(state, expected)
  if (state.decision.action !== action) delta.push(`action: ${state.decision.action} ≠ ${action}`)
  if (state.decision.reason !== reason) delta.push(`reason: ${state.decision.reason} ≠ ${reason}`)
  const applicable = state.strategy !== 'V1' || Object.entries(defaults).every(([key, value]) => state.config[key as keyof typeof defaults] === value)
  return {
    expected, expectedDecision: { action, reason },
    verdict: applicable ? delta.length ? 'Fail' : 'Pass' : 'N/A',
    differences: delta, targetDifferences: row.differences,
    candidateAlignment: null,
    displayComparison: row.event.type === 'stt' ? textComparison(state.reference, row.event.text) : [],
    actualCharacters: characterStates(state.reference, state),
    expectedCharacters: characterStates(state.reference, expected),
  }
}

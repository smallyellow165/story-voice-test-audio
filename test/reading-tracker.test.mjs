import { overrides, contracts, reasonCode } from '../src/reading-tracker-expectations.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createTracker, track, tokenize, strategies } from '../src/reading-tracker.ts'
import { scenarios, replay } from '../src/reading-tracker-scenarios.ts'

const s = id => scenarios.find(s => s.id === id)
const output = (id, strategy = 'V1', config) => replay(s(id), strategy, config)
for (const scenario of scenarios) for (const strategy of strategies) {
  test(`${strategy}/${scenario.id}: every event satisfies explicit state and decision contract`, () => {
    const results = replay(scenario, strategy)
    const decisions = (contracts[scenario.id][strategy] ?? contracts[scenario.id].all).split(' ')
    assert.equal(decisions.length, results.length)
    for (const [i, row] of results.entries()) {
      const target = overrides[scenario.id]?.[strategy]?.[i] ?? row.goal
      for (const key of Object.keys(target)) assert.deepEqual(row.state[key], target[key], `event ${i + 1}: ${key}`)
      const [action, reason] = decisions[i].split(':')
      assert.equal(row.state.decision.action, action, `event ${i + 1}: action`)
      assert.equal(row.state.decision.reason, reasonCode[reason], `event ${i + 1}: reason`)
      assert.equal(row.state.decision.to, row.state.cursor)
      const state = row.state
      for (const key of ['matched', 'skipped', 'uncertain', 'tentativeIndices']) {
        assert.equal(new Set(state[key]).size, state[key].length)
        assert.ok(state[key].every(index => index >= 0 && index < state.tokens.length))
      }
      assert.ok(!state.skipped.some(index => state.matched.includes(index)))
      assert.ok(!state.uncertain.some(index => state.matched.includes(index)))
    }
  })
}

test('known V1 target failures remain visible, rather than redefining success', () => {
  assert.deepEqual(scenarios.filter(s => replay(s, 'V1').some(row => row.differences.length)).map(s => s.id),
    ['skip-multiple', 'ambiguous-short', 'long-input'])
})
test('changing experimental gap/window parameters has measurable bounded effects', () => {
  assert.equal(output('skip-multiple', 'V1', { maxGap: 2 })[0].differences.length, 0)
  assert.equal(output('long-input', 'V1', { lookAhead: 32 })[0].differences.length, 0)
  assert.equal(output('large-jump', 'V1', { maxGap: 2 }).at(-1).state.cursor, 1)
  assert.equal(output('repeat', 'V1', { lookBack: 0 })[2].state.cursor, 4)
})
test('tentative endpoint never completes or changes confirmed history', () => {
  for (const strategy of strategies) {
    const [partial, final] = output('false-end', strategy).map(r => r.state)
    assert.equal(partial.complete, false); assert.equal(partial.furthest, -1)
    assert.deepEqual(partial.tentativeIndices, [0, 1, 2, 3, 4])
    assert.deepEqual(final.tentativeIndices, []); assert.equal(final.furthest, 2)
    assert.equal(final.complete, false)
  }
})
test('actual completed final can be reached; gaps do not become matched', () => {
  const state = track(createTracker('床前明月光'), { type: 'stt', at: 0, epoch: 0, seq: 0, segment: 'x', text: '床明月光', final: true })
  assert.equal(state.complete, true); assert.deepEqual(state.skipped, [1]); assert.ok(!state.matched.includes(1))
})
test('current cursor and confirmed furthest differ after a local repeat', () => {
  const row = output('repeat')[2].state
  assert.equal(row.cursor, 2); assert.equal(row.confirmed, 2); assert.equal(row.furthest, 4)
  assert.deepEqual(row.matched, [0, 1, 2, 3, 4])
})
test('revision rolls back tentative mismatch and skipped marks, including behind finalized anchor', () => {
  let state = createTracker('床前明月光')
  const update = (seq, text, final = false) => state = track(state, { type: 'stt', at: seq, epoch: 0, seq, segment: 'a', text, final })
  update(1, '床明月'); update(2, '床明月光')
  assert.deepEqual(state.skipped, [1])
  update(3, '床钱明月光', true)
  assert.deepEqual(state.skipped, []); assert.deepEqual(state.uncertain, [1])
  const rows = output('partial-repeat')
  const revised = track(rows[2].state, { type: 'stt', at: 1500, epoch: 0, seq: 4, segment: 'b', text: '', final: true })
  assert.equal(revised.cursor, 4); assert.equal(revised.confirmed, 4); assert.deepEqual(revised.matched, [0,1,2,3,4])
})
test('Unicode mapping uses original UTF-16 offsets, not punctuation-stripped offsets', () => {
  assert.deepEqual(tokenize('「床， 前」\n明😀月。'), [
    { text: '床', start: 1, end: 2 }, { text: '前', start: 4, end: 5 },
    { text: '明', start: 7, end: 8 }, { text: '月', start: 10, end: 11 },
  ])
  assert.deepEqual(tokenize('Ａ𝟚!').map(t => t.text), ['a', '2'])
})
test('input state and configuration are immutable; concurrent sessions stay isolated', () => {
  const config = { maxGap: 1 }, a = createTracker('甲乙丙', 'V1', config), saved = structuredClone(a)
  config.maxGap = 9
  const b = track(a, { type: 'stt', at: 0, epoch: 0, seq: 0, segment: 'a', text: '甲乙', final: false })
  assert.deepEqual(a, saved); b.matched.push(88); b.tokens[0].text = '坏'; assert.deepEqual(a, saved)
})
test('does not silently reinterpret overlapping segments, reordered messages, or future epochs', () => {
  const initial = output('normal')[0].state
  const event = { type: 'stt', at: 10, epoch: 0, seq: 2, segment: 'b', text: '月光', final: true }
  assert.equal(track(initial, event).decision.reason, 'unclosed-segment')
  assert.equal(track(initial, { ...event, epoch: 2 }).decision.reason, 'stale-or-future-epoch')
  assert.equal(track(initial, { ...event, seq: 0 }).decision.reason, 'duplicate-or-out-of-order')
  assert.equal(track(initial, { type: 'restart', at: 10, epoch: 0 }).decision.reason, 'restart-requires-new-epoch')
})
test('invalid configuration and invalid events fail visibly', () => {
  for (const config of [{ maxGap: -1 }, { support: 0 }, { lookAhead: 10000 }, { repeatSupport: NaN }]) assert.throws(() => createTracker('甲', 'V1', config))
  assert.throws(() => createTracker('， 。'))
  assert.throws(() => track(createTracker('甲'), { type: 'pause', at: NaN, epoch: 0 }))
  assert.throws(() => track(createTracker('甲'), { type: 'stt', at: 0, epoch: 0, seq: -1, segment: '', text: '', final: true }))
})
test('browser and CLI use the same replay output; CLI strict mode reports target failures', () => {
  const cli = JSON.parse(execFileSync(process.execPath, ['scripts/reading-tracker.mjs', '--scenario', 'repeat', '--json'], { encoding: 'utf8' }))
  assert.deepEqual(cli.report[0].comparison.find(r => r.strategy === 'V1').rows, output('repeat'))
  assert.equal(spawnSync(process.execPath, ['scripts/reading-tracker.mjs', '--scenario', 'normal', '--strict']).status, 0)
  assert.equal(spawnSync(process.execPath, ['scripts/reading-tracker.mjs', '--scenario', 'ambiguous-short', '--strict']).status, 1)
  assert.equal(spawnSync(process.execPath, ['scripts/reading-tracker.mjs', '--scenario', 'not-found']).status, 2)
})

test('presentation reports the original policy contracts separately from reading targets', async () => {
  const { eventReport } = await import('../src/reading-tracker-report.ts')
  for (const scenario of scenarios) for (const strategy of strategies) {
    for (const row of replay(scenario, strategy)) {
      const report = eventReport(scenario.id, row)
      assert.equal(report.verdict, 'Pass')
      assert.equal(report.candidateAlignment, null)
      assert.deepEqual(report.targetDifferences, row.differences)
    }
  }
  const baseline = eventReport('skip-one', output('skip-one', 'B1')[0])
  assert.equal(baseline.verdict, 'Pass')
  assert.ok(baseline.targetDifferences.length)
})
test('display diff never implies acceptance, gap correctness, or internal candidate availability', async () => {
  const { eventReport, textComparison } = await import('../src/reading-tracker-report.ts')
  const [first, second] = output('skip-one').map(row => eventReport('skip-one', row))
  assert.deepEqual(first.actualCharacters.slice(0,5).map(c => c.status), ['Match','Unread','Unread','Unread','Unread'])
  assert.deepEqual(second.actualCharacters.slice(0,5).map(c => c.status), ['Match','Skip','Match','Match','Match'])
  assert.deepEqual(textComparison('床前明月光', '床明月').map(c => c.input), ['床','—','明','月','—'])
  assert.ok(textComparison('床前', '床钱').some(c => c.relation.includes('Mismatch')))
  assert.ok(first.displayComparison.some(c => c.reference === '明' && c.input === '明'))
  assert.equal(eventReport('skip-multiple', output('skip-multiple','V1',{maxGap:2})[0]).verdict, 'N/A')
  const bad = structuredClone(output('skip-one')[0]); bad.state.matched = [0,2]
  assert.equal(eventReport('skip-one',bad).verdict, 'Fail')
})
test('CLI export includes the same per-event presentation as the browser', async () => {
  const { eventReport } = await import('../src/reading-tracker-report.ts')
  const data = JSON.parse(execFileSync(process.execPath, ['scripts/reading-tracker.mjs','--scenario','skip-one','--json'], {encoding:'utf8'}))
  assert.deepEqual(data.report[0].eventReports.find(r => r.strategy === 'V1').rows, output('skip-one').map(row => eventReport('skip-one', row)))
})

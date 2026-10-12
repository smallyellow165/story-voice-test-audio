import test from 'node:test'
import assert from 'node:assert/strict'
import { importSequence } from '../src/reading-tracker-import.ts'
import { compare } from '../src/reading-tracker-scenarios.ts'
import { eventReport } from '../src/reading-tracker-report.ts'
import { events, reference } from './fixtures/reading-jingyesi-observed.mjs'

const raw = events.map(e => [e.final ? 'F' : 'P', e.text])
test('13 screenshot-reconstructed inputs preserve text/order and derive explicit segments', () => {
  const imported = importSequence(JSON.stringify(raw), reference)
  assert.deepEqual(imported.rawSequence, raw)
  assert.deepEqual(imported.scenario.steps.map(s => s.event.segment), [1,1,1,1,2,2,2,3,3,3,4,4,4].map(n => `inferred-${n}`))
  imported.scenario.steps.forEach(({event, goal}, i) => {
    assert.equal(goal, undefined)
    assert.deepEqual(event, {...events[i], segment: event.segment})
  })
  for (const maxGap of [1, 2]) {
    const results = compare(imported.scenario, {maxGap})
    assert.equal(results.length, 3)
    for (const result of results) for (const row of result.rows) {
      const report = eventReport(imported.scenario.id, row)
      assert.equal(report.verdict, 'N/A')
      assert.equal(report.expected, null)
    }
    const v1 = results.find(r => r.strategy === 'V1').rows
    assert.ok(v1.every(row => row.state.skipped.length === 0))
    assert.deepEqual(v1[6].state.uncertain, maxGap === 1 ? [] : [5,6])
    assert.deepEqual(v1[6].state.matched, maxGap === 1 ? [0,1,2,3,4] : [0,1,2,3,4,7,8,9])
    assert.deepEqual(v1.map(r => r.state.cursor), maxGap === 1
      ? [0,1,4,4,4,4,4,4,4,4,4,4,4] : [0,1,4,4,4,4,9,10,12,14,16,18,17])
  }
})
test('replacement, empty text, whitespace, repeated finals and open segment remain intact', () => {
  const raw = [['P','床前'], ['P',''], ['P',' 床，'], ['F','床'], ['F','床'], ['P','前']]
  const imported = importSequence(JSON.stringify(raw), '床前')
  assert.deepEqual(imported.rawSequence, raw)
  assert.deepEqual(imported.scenario.steps.map(s => s.event.segment), ['inferred-1','inferred-1','inferred-1','inferred-1','inferred-2','inferred-3'])
  assert.match(imported.warning, /不补造 Final/)
  const rows = compare(imported.scenario).find(r => r.strategy === 'V1').rows
  assert.equal(rows[1].state.cursor, -1)
  assert.equal(rows[5].state.tentative, true)
})
for (const input of ['oops', '{}', '[]', '[null]', '[["X","床"]]', '[["P",2]]', '[["F","床",1]]', '[["P"]]']) {
  test(`reject invalid input ${input}`, () => assert.throws(() => importSequence(input, reference)))
}
test('reject empty reference without normalizing valid reference', () => {
  assert.throws(() => importSequence(JSON.stringify(raw), ' ，。'))
  assert.equal(importSequence(JSON.stringify(raw), reference).scenario.reference, reference)
})

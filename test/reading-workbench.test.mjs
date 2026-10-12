import test from 'node:test'
import assert from 'node:assert/strict'
import { ReadingWorkbench } from '../src/reading-workbench.ts'
import { scenarios } from '../src/reading-tracker-scenarios.ts'
import { defaults } from '../src/reading-tracker.ts'

test('Load, Apply and Reset never match; snapshots remain independent and stale is explicit', () => {
  const w = new ReadingWorkbench()
  w.draftReference = '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。'
  w.draftSequence = JSON.stringify([['P','春'],['P','春年不绝'],['F','春年不绝小']])
  w.load(); assert.equal(w.last, undefined)
  w.match(); const first = w.last
  assert.deepEqual(first.results.find(r=>r.strategy==='V1').rows.map(r=>r.state.cursor), [0,0,0])
  w.draftParameters.support = 1
  assert.equal(w.parametersPending, true)
  w.apply(); assert.equal(w.last, first); assert.equal(w.stale, true)
  w.draftParameters.minCoverage = .4; w.apply()
  assert.equal(w.last, first)
  w.match(); assert.equal(w.last.results.find(r=>r.strategy==='V1').rows[2].state.cursor, 2)
  assert.equal(first.config.support, 2); assert.equal(w.stale, false)
  const second = w.last
  w.resetParameters(); assert.equal(w.last, second); assert.equal(w.stale, true)
  w.match(); assert.equal(w.last.results.find(r=>r.strategy==='V1').rows[2].state.cursor,0)
  assert.deepEqual(w.applied, defaults)
  w.strategy = 'B0'; assert.equal(w.stale,true)
  w.draftReference += '！'; assert.equal(w.inputPending,true); assert.throws(()=>w.match())
})
test('all 22 built-ins retain original metadata and Expected without implicit computation', () => {
  for(const s of scenarios) {
    const w = new ReadingWorkbench(); w.select(s); w.load()
    assert.deepEqual(w.loaded.scenario,s); assert.equal(w.last,undefined)
    w.match(); assert.equal(w.last.results.length,3)
    w.select(scenarios[0]); assert.equal(w.last.input.scenario.id,s.id)
  }
})
test('invalid loads/applies preserve prior accepted values and result; altered fixture loses Expected', () => {
  const w=new ReadingWorkbench(); w.select(scenarios[0]); w.load(); w.match()
  const loaded=w.loaded, last=w.last
  w.draftSequence='bad'; assert.throws(()=>w.load()); assert.equal(w.loaded,loaded); assert.equal(w.last,last)
  w.draftParameters.support=0; assert.throws(()=>w.apply()); assert.equal(w.applied.support,2)
  w.draftSequence='[["F","春"]]'; w.load()
  assert.equal(w.loaded.scenario.steps[0].goal,undefined); assert.equal(w.last,last)
})

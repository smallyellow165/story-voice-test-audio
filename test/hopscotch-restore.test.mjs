import test from 'node:test'
import assert from 'node:assert/strict'
import { createHopscotch } from '../src/hopscotch-core.ts'
import { HOPSCOTCH_SCRIPTS } from '../src/hopscotch-scripts.ts'

const create = () => createHopscotch({ mode: 'script', script: HOPSCOTCH_SCRIPTS[1], instructionMode: 'mixed', random: () => 0, presentationRandom: () => 0.9 })
test('checkpoint restores fallback target, Mixed wording, counts; continuation and reset use Core', () => {
  const source = create(); source.skip(); source.done(); source.skip()
  const checkpoint = source.checkpoint(), state = source.read()
  const restored = create(); restored.restore(checkpoint)
  assert.deepEqual(restored.checkpoint(), checkpoint)
  const actual = restored.read()
  for (const key of ['currentCell', 'targetCell', 'resolvedTask', 'displayText', 'presentationKind', 'scriptTaskIndex', 'completedCount', 'skippedCount']) assert.deepEqual(actual[key], state[key])
  assert.deepEqual(restored.repeat(), actual)
  restored.done(); source.done()
  assert.deepEqual(restored.checkpoint(), source.checkpoint())
  assert.equal(restored.reset().completedCount, 0)
  assert.equal(restored.read().skippedCount, 0)
})
test('finished restore is terminal and invalid recovery is atomic', () => {
  const source = create()
  for (let i = 0; i < 12; i++) source.done()
  const restored = create(); restored.restore(source.checkpoint())
  const end = restored.read()
  assert.equal(end.status, 'finished'); assert.deepEqual(restored.done(), end)
  for (const change of [{ scriptId: 'other' }, { scriptTaskIndex: -1 }, { completedCount: 0 }, { resolvedTarget: '4' }, { requestedKind: 'mixed' }, { currentCell: 'missing' }]) {
    assert.throws(() => restored.restore({ ...source.checkpoint(), ...change }))
    assert.deepEqual(restored.read(), end)
  }
  const start = create().checkpoint()
  assert.throws(() => restored.restore({ ...start, resolvedTarget: '10' }))
  assert.deepEqual(restored.read(), end)
})

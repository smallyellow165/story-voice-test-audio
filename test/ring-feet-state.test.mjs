import test from 'node:test'
import assert from 'node:assert/strict'
import { locateFeet, locateFoot } from '../src/ring-feet-state.ts'
const rings = [
  { id: 'ring_1', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] },
  { id: 'ring_2', polygon: [[20, 0], [30, 0], [30, 10], [20, 10]] },
]
test('both rings, split feet in both directions, one/both outside', () => {
  for (const [left, right, ids] of [
    [[5,5], [6,6], ['ring_1','ring_1']],
    [[25,5], [26,6], ['ring_2','ring_2']],
    [[5,5], [25,5], ['ring_1','ring_2']],
    [[25,5], [5,5], ['ring_2','ring_1']],
    [[5,5], [15,5], ['ring_1',null]],
    [[15,5], [25,5], [null,'ring_2']],
    [[15,5], [40,5], [null,null]],
  ]) {
    const result = locateFeet(left, right, rings)
    assert.deepEqual([result.leftFootRingId,result.rightFootRingId],ids)
    assert.equal(result.leftFoot.status, ids[0] ? 'IN' : 'OUT')
    assert.equal(result.rightFoot.status, ids[1] ? 'IN' : 'OUT')
  }
})
test('missing pose/detection/polygon is not OUT; empty detection is OUT', () => {
  assert.equal(locateFoot(null,rings).status,'UNKNOWN')
  assert.equal(locateFoot([5,5],null).status,'UNKNOWN')
  assert.equal(locateFoot([5,5],[{id:'unlocalized',polygon:[]}]).status,'UNKNOWN')
  assert.equal(locateFoot([5,5],[]).status,'OUT')
  assert.equal(locateFeet(null,[25,5],rings).rightFootRingId,'ring_2')
  assert.equal(locateFoot([40,5],[...rings,{id:'unlocalized',polygon:[]}]).status,'UNKNOWN')
})
test('boundary is inside and overlap remains explicit without choosing a game target', () => {
  assert.equal(locateFoot([0,5],rings).ringId,'ring_1')
  const result = locateFoot([5,5],[...rings,{...rings[0],id:'overlap'}])
  assert.equal(result.status,'AMBIGUOUS')
  assert.equal(result.ringId,null)
  assert.deepEqual(result.matchingRingIds,['ring_1','overlap'])
})

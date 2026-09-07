import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptGeminiRings, adaptLegacyRing } from '../src/ring-detection-result.ts'

const small = { id: 'small', center: { x: .25, y: .5 }, bbox: { xMin: .1, yMin: .2, xMax: .4, yMax: .8 },
  polygon: [{x:.1,y:.2},{x:.4,y:.2},{x:.4,y:.8},{x:.1,y:.8}], colorGuess: 'blue', confidence: .9, explanation: 'cloth' }
const large = { ...small, id: 'large', polygon: [{x:.4,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.4,y:.9}] }
const response = rings => ({ model:'gemini-3.6-flash', rings, rawJson: JSON.stringify({rings}) })

test('non-square snapshot maps x by width and y by height; all rings displayed, one game polygon', () => {
  const data = response([small, large])
  const result = adaptGeminiRings(data, 600, 300)
  assert.equal(result.rings.length, 2)
  assert.deepEqual(result.rings[0].polygon[0], [60,60])
  assert.deepEqual(result.rings[0].center, {x:150,y:150})
  assert.ok(Math.abs(result.rings[0].bbox.height - 180) < 1e-6)
  assert.equal(result.active.id, 'large')
  assert.equal(result.active, result.rings[1])
  assert.equal(result.source, data)
  assert.equal(result.rawJson, data.rawJson)
  assert.equal(result.rings[0].explanation, 'cloth')
})
test('empty polygon still displays bbox but never becomes a landing target', () => {
  const result = adaptGeminiRings(response([{...small,polygon:[]}]),600,450)
  assert.equal(result.rings.length,1)
  assert.ok(result.rings[0].bbox)
  assert.equal(result.active,null)
  assert.equal(adaptGeminiRings(response([]),600,450).active,null)
})
test('legacy coordinates and its selected polygon pass through without scaling or reselection', () => {
  const data = {detected:true,width:600,height:450,polygon:[[10,20],[80,20],[40,100]],color:'blue',candidate_count:2}
  const result=adaptLegacyRing(data,600,450)
  assert.equal(result.active.polygon,data.polygon)
  assert.equal(result.rings[0],result.active)
  assert.equal(result.candidateCount,2)
  assert.equal(result.rings[0].bbox,undefined)
  assert.equal(adaptLegacyRing({...data,detected:false},600,450).active,null)
  assert.throws(()=>adaptLegacyRing(data,600,300),/尺寸/)
  assert.throws(()=>adaptLegacyRing({...data,polygon:[[NaN,1]]},600,450),/polygon/)
})

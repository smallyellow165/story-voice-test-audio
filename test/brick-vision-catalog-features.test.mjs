import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogFeatureParams, readFeatureEditor, createObservationDraft, validateCatalogFeatures } from '../src/brick-vision/catalog-features.mjs'

const unknown = { color_id: null, size: null, shape: null, print: 'unknown' }
test('only known features become existing strict Catalog API parameters', () => {
  assert.deepEqual(catalogFeatureParams(unknown), {})
  assert.deepEqual(catalogFeatureParams({ ...unknown, color_id: 0, size: '2x4', shape: 'curved_top', print: 'no' }),
    { color: '0', size: '2x4', shape: 'curved_top', printed: 'no' })
  assert.deepEqual(catalogFeatureParams({ ...unknown, shape: 'brick', print: 'yes' }), { shape: 'brick', printed: 'yes' })
})
test('feature edits validate enums, whole dimension syntax and RB color IDs', () => {
  assert.deepEqual(readFeatureEditor({ color: '', size: '', shape: '', print: 'unknown' }), unknown)
  assert.deepEqual(readFeatureEditor({ color: ' 25 ', size: ' 2×4 ', shape: 'arch', print: 'yes' }),
    { color_id: 25, size: '2×4', shape: 'arch', print: 'yes' })
  for (const change of [{color_id: -1}, {color_id: '25'}, {size: '4 studs'}, {shape: 'round'}, {print: false}]) {
    assert.throws(() => validateCatalogFeatures({ ...unknown, ...change }))
  }
})
test('model hypotheses never preselect or populate human-confirmed identity', () => {
  const observation = { ...unknown, id: 'object', quantity: 2, candidates: [{part_num: 'hypothesis', color_id: 25}], evidence: '2x4 brick' }
  const original = JSON.stringify(observation)
  const draft = createObservationDraft(observation)
  assert.equal(draft.selected, false)
  assert.equal(draft.part, '')
  assert.equal(draft.color, '')
  assert.equal(draft.quantity, '2')
  assert.equal(draft.confirmation, null)
  draft.features.size = '2x2'
  assert.equal(JSON.stringify(observation), original)
  assert.deepEqual(createObservationDraft({ id: 'old', quantity: 1, evidence: '2x4 brick' }).features,
    { color: '', size: '', shape: '', print: 'unknown' })
})

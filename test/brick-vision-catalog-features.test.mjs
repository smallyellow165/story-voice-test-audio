import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogFeatureParams, catalogSearchParams, readFeatureEditor, createObservationDraft, validateCatalogFeatures, featureEditor, editDimension, visionFeatureProperties } from '../src/brick-vision/catalog-features.mjs'

test('one Search snapshots all six filters and optional LDraw without empty numeric params', () => {
  assert.deepEqual(catalogSearchParams({}), { require_ldraw: 'false' })
  const draft = { search: ' 4066 ', category: '4', color: '0', size: '1×2×2', shape: 'brick', printed: 'no', requireLdraw: true }
  const submitted = catalogSearchParams(draft)
  assert.deepEqual(submitted, { search: '4066', category: '4', color: '0', size: '1×2×2', shape: 'brick', printed: 'no', require_ldraw: 'true' })
  draft.size = '1×2×1'
  assert.equal(submitted.size, '1×2×2')
  assert.equal(({ ...submitted, page: '2' }).size, '1×2×2')
})

test('partial reviewed dimensions stay explicit; a new Size replaces all old axes', () => {
  const axes = { width: '1', height: '2' }
  const submitted = catalogSearchParams({ axes })
  axes.height = '1'
  assert.deepEqual(submitted, { width: '1', height: '2', require_ldraw: 'false' })
  assert.deepEqual(catalogSearchParams({ axes, size: '2×4×0.5' }), { size: '2×4×0.5', require_ldraw: 'false' })
})

const unknown = { color_id: null, size: null, shape: null, print: 'unknown' }
test('only known features become existing strict Catalog API parameters', () => {
  assert.deepEqual(catalogFeatureParams(unknown), {})
  assert.deepEqual(catalogFeatureParams({ ...unknown, color_id: 0, size: '2x4', shape: 'curved_top', print: 'no' }),
    { color: '0', size: '2x4', shape: 'curved_top', printed: 'no' })
  assert.deepEqual(catalogFeatureParams({ ...unknown, shape: 'brick', print: 'yes' }), { shape: 'brick', printed: 'yes' })
})
test('feature edits validate enums, whole dimension syntax and RB color IDs', () => {
  assert.deepEqual(readFeatureEditor({ color: '', size: '', shape: '', print: 'unknown', width_studs: '', depth_studs: '', height_brick_units: '', partNumber: '' }), unknown)
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
    { color: '', size: '', shape: '', print: 'unknown', width_studs: '', depth_studs: '', height_brick_units: '', partNumber: '' })
})

test('review height becomes the shared strict Catalog height parameter, never a plate conversion', () => {
  let editor = featureEditor({ size: '2x4', color_id: 25, shape: 'brick', print: 'unknown' })
  editor = editDimension(editor, 'height_brick_units', '0.5')
  assert.deepEqual(catalogFeatureParams(readFeatureEditor(editor)), { color: '25', shape: 'brick', width: '2', depth: '4', height: '0.5' })
  editor = editDimension(editor, 'height_brick_units', '2')
  assert.equal(catalogFeatureParams(readFeatureEditor(editor)).height, '2')
  editor = editDimension(editor, 'height_brick_units', '')
  assert.deepEqual(catalogFeatureParams(readFeatureEditor(editor)), { color: '25', shape: 'brick', size: '2x4' })
  assert.equal('height_brick_units' in visionFeatureProperties, false)
})
test('partial dimensions stay explicit and unknown axes are omitted', () => {
  let editor = featureEditor({})
  editor = editDimension(editor, 'height_brick_units', '0.5')
  assert.deepEqual(catalogFeatureParams(readFeatureEditor(editor)), { height: '0.5' })
  editor = editDimension(editor, 'width_studs', '1')
  assert.deepEqual(catalogFeatureParams(readFeatureEditor(editor)), { width: '1', height: '0.5' })
  assert.throws(() => catalogFeatureParams({ ...unknown, height_brick_units: NaN }))
  assert.throws(() => catalogFeatureParams({ ...unknown, size: '2x4', height_brick_units: .5 }))
})
test('persisted search features preserve all three dimensions when made editable', () => {
  const query = { ...unknown, width_studs: 1, depth_studs: 2, height_brick_units: 2 }
  assert.deepEqual(readFeatureEditor(featureEditor(query)), query)
})

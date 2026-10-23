import test from 'node:test'
import assert from 'node:assert/strict'
import { observationCatalogFields, catalogSearchParams, readFeatureEditor } from '../src/brick-vision/catalog-features.mjs'

const unknown = { color_id: null, size: null, shape: null, print: 'unknown' }
const reviewed = (width, depth, height, overrides = {}) => readFeatureEditor({
  width_studs: width, depth_studs: depth, height_brick_units: height,
  size: '', color: '', shape: '', print: 'unknown', partNumber: 'OLD-PART', ...overrides,
})

test('neck submits one complete snapshot with no old Part Number, category or LDraw requirement', () => {
  const fields = observationCatalogFields(reviewed('1', '2', '2'))
  assert.deepEqual(fields, { search: '', category: '', color: '', size: '1×2×2', shape: '', printed: 'unknown', requireLdraw: false, axes: {} })
  assert.deepEqual(catalogSearchParams(fields), { size: '1×2×2', require_ldraw: 'false' })
})

test('head replaces neck and every manually edited filter rather than merging', () => {
  const neck = observationCatalogFields(reviewed('1', '2', '2', { color: '4', shape: 'brick', print: 'yes' }))
  Object.assign(neck, { search: '4066', category: '42', requireLdraw: true })
  const head = observationCatalogFields(reviewed('2', '2', '1'))
  assert.deepEqual(catalogSearchParams(head), { size: '2×2×1', require_ldraw: 'false' })
  assert.equal(head.color, '')
  assert.equal(head.shape, '')
  assert.equal(head.printed, 'unknown')
})

test('black color ID 0, shape and explicit no-print evidence are retained', () => {
  const fields = observationCatalogFields(reviewed('2', '4', '0.5', { color: '0', shape: 'brick', print: 'no' }))
  assert.deepEqual(catalogSearchParams(fields), { color: '0', size: '2×4×0.5', shape: 'brick', printed: 'no', require_ldraw: 'false' })
})

test('unknown axes are not filled and known partial axes still participate', () => {
  const fields = observationCatalogFields(reviewed('1', '', '2'))
  assert.equal(fields.size, '')
  assert.deepEqual(fields.axes, { width: '1', height: '2' })
  assert.deepEqual(catalogSearchParams(fields), { width: '1', height: '2', require_ldraw: 'false' })
  assert.deepEqual(catalogSearchParams(observationCatalogFields(unknown)), { require_ldraw: 'false' })
})

test('two-dimensional loose observations do not gain an invented height', () => {
  const fields = observationCatalogFields(reviewed('2', '4', ''))
  const query = catalogSearchParams(fields)
  assert.equal(query.size, '2x4')
  assert.equal(query.height, undefined)
})

test('manual editing uses the same query builder and submitted snapshots stay stable', () => {
  const fields = observationCatalogFields(reviewed('1', '2', '2'))
  const firstPageQuery = catalogSearchParams(fields)
  fields.size = '2×2×1'; fields.color = '14'
  const nextSearchQuery = catalogSearchParams(fields)
  assert.equal(firstPageQuery.size, '1×2×2')
  assert.equal(firstPageQuery.color, undefined)
  assert.equal(nextSearchQuery.size, '2×2×1')
  assert.equal(nextSearchQuery.color, '14')
  assert.equal(nextSearchQuery.search, undefined)
})

test('conversion does not mutate the reviewed features or use reference Part Numbers', () => {
  const features = Object.freeze({ ...unknown, width_studs: 1, depth_studs: 2, height_brick_units: 2 })
  observationCatalogFields(features)
  assert.deepEqual(features, { ...unknown, width_studs: 1, depth_studs: 2, height_brick_units: 2 })
})

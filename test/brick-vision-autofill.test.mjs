import test from 'node:test'
import assert from 'node:assert/strict'
import { uniqueCatalogIdentity, hasConfirmedIdentity, completeCatalogIdentity } from '../src/brick-vision/catalog-autofill.mjs'

const result = (colors = [25]) => ({ total: 1, items: [{ part_num: 'catalog-part', eligible: true,
  colors: colors.map(id => ({ id })), checks: [{ status: 'matched' }] }] })

test('unique part and color are both required, independent of model guesses', () => {
  assert.deepEqual(uniqueCatalogIdentity(result(), 25), { status: 'filled', part: 'catalog-part', color: '25' })
  assert.equal(uniqueCatalogIdentity(result([25, 4]), null).status, 'multiple')
  assert.equal(uniqueCatalogIdentity(result([25, 4]), 25).status, 'filled')
  assert.equal(uniqueCatalogIdentity(result([4]), 25).status, 'none')
  assert.equal(uniqueCatalogIdentity(result([0]), null).color, '0')
  assert.equal(uniqueCatalogIdentity(result([25, 25]), null).status, 'filled')
})

test('zero and paginated multiple parts never select the first result', () => {
  assert.equal(uniqueCatalogIdentity({ total: 0, items: [] }, 25).status, 'none')
  assert.equal(uniqueCatalogIdentity({ ...result(), total: 30 }, 25).status, 'multiple')
  assert.throws(() => uniqueCatalogIdentity({ total: 1, items: [] }, 25))
  const invalid = result(); invalid.items[0].checks[0].status = 'unknown'
  assert.throws(() => uniqueCatalogIdentity(invalid, 25))
  invalid.items[0].eligible = false
  assert.throws(() => uniqueCatalogIdentity(invalid, 25))
})

test('only two currently nonempty fields skip, regardless of editing history', () => {
  const blank = { part: '', color: '', confirmation: null }
  assert.equal(hasConfirmedIdentity(blank), false)
  for (const change of [{ part: 'manual' }, { color: '0' }, { confirmation: { method: 'manual' } }]) {
    assert.equal(hasConfirmedIdentity({ ...blank, ...change }), false)
  }
  assert.equal(hasConfirmedIdentity({ part: 'catalog-part', color: '0' }), true)
  assert.equal(hasConfirmedIdentity({ part: ' ', color: '25', confirmation: { method: 'catalog_unique' } }), false)
})

test('four field combinations preserve existing values and only complete blanks', () => {
  const identity = uniqueCatalogIdentity(result(), 25)
  for (const row of [
    { part: '', color: '' }, { part: '', color: '25' },
    { part: 'catalog-part', color: '' }, { part: 'catalog-part', color: '25' },
  ]) {
    const original = { ...row }
    assert.deepEqual(completeCatalogIdentity(row, identity), { part: 'catalog-part', color: '25' })
    assert.deepEqual(row, original)
  }
  assert.deepEqual(completeCatalogIdentity({ part: '', color: ' 025 ' }, identity),
    { part: 'catalog-part', color: ' 025 ' })
  assert.deepEqual(completeCatalogIdentity({ part: ' catalog-part ', color: ' ' }, identity),
    { part: ' catalog-part ', color: '25' })
})

test('unique candidate cannot overwrite conflicting or invalid existing fields', () => {
  const identity = uniqueCatalogIdentity(result(), 25)
  for (const row of [{ part: 'different', color: '' }, { part: '', color: '4' },
    { part: '', color: 'not-a-color' }, { part: '', color: '25.0' }]) {
    const original = { ...row }
    assert.throws(() => completeCatalogIdentity(row, identity), /不一致/)
    assert.deepEqual(row, original)
  }
  const black = uniqueCatalogIdentity(result([0]), null)
  assert.deepEqual(completeCatalogIdentity({ part: '', color: '0' }, black),
    { part: 'catalog-part', color: '0' })
})

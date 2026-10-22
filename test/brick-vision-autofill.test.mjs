import test from 'node:test'
import assert from 'node:assert/strict'
import { uniqueCatalogIdentity, hasConfirmedIdentity } from '../src/brick-vision/catalog-autofill.mjs'

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

test('existing full and partial identities are protected from autofill', () => {
  const blank = { part: '', color: '', confirmation: null }
  assert.equal(hasConfirmedIdentity(blank), false)
  for (const change of [{ part: 'manual' }, { color: '0' }, { confirmation: { method: 'manual' } }]) {
    assert.equal(hasConfirmedIdentity({ ...blank, ...change }), true)
  }
})

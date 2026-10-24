import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewStatus, matchesReviewFilter } from '../src/brick-vision/review-status.mjs'

test('exclusion wins over confirmation; typed part numbers do not supply confirmation', () => {
  assert.equal(reviewStatus(true, true), 'excluded')
  assert.equal(reviewStatus(false, true), 'confirmed')
  assert.equal(reviewStatus(false, false), 'unconfirmed')
})

test('filters partition rows without changing the full review or its save payload', () => {
  const rows = [{ id: 'head', confirmed: true, excluded: false }, { id: 'neck', confirmed: true, excluded: false },
    { id: 'body', confirmed: false, excluded: false }, { id: 'leg', confirmed: true, excluded: true }]
  const saved = JSON.stringify(rows)
  const visible = filter => rows.filter(row => matchesReviewFilter(filter, reviewStatus(row.excluded, row.confirmed)))
  assert.deepEqual(visible('confirmed').map(r => r.id), ['head', 'neck'])
  assert.deepEqual(visible('unconfirmed').map(r => r.id), ['body'])
  assert.deepEqual(visible('excluded').map(r => r.id), ['leg'])
  assert.equal(visible('all').length, 4)
  assert.equal(JSON.stringify(rows), saved)
  rows[2].confirmed = true
  assert.equal(visible('unconfirmed').length, 0)
  assert.equal(rows.length, 4)
})

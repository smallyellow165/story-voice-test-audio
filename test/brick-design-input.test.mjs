import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareDesignGeneration } from '../server/brick-design-input.mjs'

const session = { schema_version: 1, id: '0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa', name: 'Saved', updated_at: '2026-10-24T00:00:00Z', items: [{ part_num: '3437', color_id: 14, quantity: 2 }] }
const image = { mimeType: 'image/png', imageBase64: 'iVBORw0KGgo=' }
const unavailable = async () => { throw new Error('Unexpected dependency call') }
const reviewInventory = async ({ session }) => ({ id: 'review', session, mapping: { rows: session.items.map(source => ({ source, target: { part: '3437', color: '14' }, errors: [] })) } })

test('saved canonical inventory overrides virtual defaults without modifying the session', async () => {
  const before = structuredClone(session)
  const result = await prepareDesignGeneration({ session, description: 'animal', inventory: [{ part: '3011', color: '4', quantity: 10 }] }, { reviewInventory, restoreAnalysis: unavailable })
  assert.deepEqual(result.input.inventory, [{ part: '3437', color: '14', quantity: 2 }])
  assert.deepEqual(session, before)
  assert.equal(result.reference, undefined)
  assert.equal(result.source.reviewId, 'review')
})

test('unsupported inventory is rejected, never silently dropped', async () => {
  await assert.rejects(prepareDesignGeneration({ session }, { restoreAnalysis: unavailable, reviewInventory: async ({ session }) => ({ session, mapping: { rows: [{ source: session.items[0], target: null, errors: ['No reviewed profile'] }] } }) }), /未丢弃或替换零件/)
})

test('saved reference preserves raw observations and saved confirmations without recognition', async () => {
  const saved = { analysis: { id: session.id, status: 'complete', image, analysis: { observations: [{ id: 'head', color: 'Yellow', unknowns: ['underside'] }] } }, updatedAt: session.updated_at, rows: { head: { quantity: 2, index: 0, features: { height_brick_units: 1 }, search: { rows: [{ sourceAllowed: true, source: session.items[0], target: null }] } } } }
  const before = structuredClone(saved)
  const result = await prepareDesignGeneration({ reference: { analysisId: session.id } }, { reviewInventory: unavailable, restoreAnalysis: async id => { assert.equal(id, session.id); return saved } })
  assert.deepEqual(result.reference.context.observations, saved.analysis.analysis)
  assert.deepEqual(result.reference.context.review.head.confirmedPart, session.items[0])
  assert.equal(result.reference.image.imageBase64, image.imageBase64)
  assert.deepEqual(saved, before)
})

test('custom reference is validated; ambiguous or invalid reference is rejected', async () => {
  const deps = { reviewInventory: unavailable, restoreAnalysis: unavailable }
  const value = await prepareDesignGeneration({ reference: { image } }, deps)
  assert.equal(value.reference.image.imageBase64, image.imageBase64)
  await assert.rejects(prepareDesignGeneration({ reference: { image, analysisId: session.id } }, deps), /请选择/)
  await assert.rejects(prepareDesignGeneration({ reference: { image: { ...image, imageBase64: 'invalid' } } }, deps))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readAcceptedArtifact } from './brick-artifact-input.mjs'
import { resolveInventoryMapping } from '../server/brick-mapping.mjs'
import { createBrickGames } from '../server/brick-games.mjs'
import { loadBrickRules } from '../server/brick-rules.mjs'
import { validateBrickDesign } from '../src/brick-design-validation.mjs'
import { postBrickGame } from '../src/brick-inventory/api.mjs'

// All inventory, mappings and generated design inputs come from the actual user
// run specified by BRICK_GAME_ARTIFACT. No expected stock is encoded in tests.
const accepted = readAcceptedArtifact()
function evidence() {
  const metadata = { parts: {}, colors: {} }
  for (const row of accepted.review.mapping.rows) {
    metadata.parts[row.source.part_num] = structuredClone(row.evidence.part)
    metadata.colors[row.source.color_id] = structuredClone(row.evidence.color)
  }
  return metadata
}
test('actual inventory maps from official evidence to the actual Generator input', async () => {
  const mapping = await resolveInventoryMapping(accepted.review.session, evidence(), await loadBrickRules())
  assert.equal(mapping.valid, true)
  assert.deepEqual(mapping.inventory, accepted.generatorInput.inventory)
  assert.deepEqual(mapping.rows.map(row => row.source), accepted.review.session.items)
})
test('missing, ambiguous or unsupported mappings fail the whole inventory without substitution', async () => {
  const rules = await loadBrickRules(), first = accepted.review.session.items[0]
  for (const damage of [
    data => { delete data.parts[first.part_num].external_ids.LDraw },
    data => { data.parts[first.part_num].external_ids.LDraw = ['not-a-supported-part'] },
    data => { data.colors[first.color_id].external_ids.LDraw.ext_ids = [99999999] },
    data => { data.parts[first.part_num].known_colors = [] },
  ]) {
    const data = evidence(); damage(data)
    const result = await resolveInventoryMapping(accepted.review.session, data, rules)
    assert.equal(result.valid, false)
    assert.deepEqual(result.inventory, [])
    assert.equal(result.rows.length, accepted.review.session.items.length)
    assert.ok(result.rows.some(row => row.errors.length))
  }
})
test('shared Validator rejects consumption beyond the actual inventory', async () => {
  const used = accepted.generation.design.bricks[0]
  const inventory = accepted.generatorInput.inventory.map(row => row.part === used.part && row.color === used.color ? { ...row, quantity: 0 } : row)
  const result = validateBrickDesign(accepted.generation.design, inventory, await loadBrickRules())
  assert.equal(result.valid, false)
  assert.ok(result.issues.some(issue => issue.code === 'INVENTORY_EXCEEDED'))
})
test('review freezes the saved inventory; generation is single-attempt and V4 reads the same artifact', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-game-contract-'))
  const metadata = evidence(), calls = []
  const service = createBrickGames(directory, {
    getMetadata: async (route, params) => route === 'mapping-part' ? metadata.parts[params.part_num] : metadata.colors[params.color_id],
    generate: async input => { calls.push(structuredClone(input)); return { status: 200, body: structuredClone(accepted.generation) } },
  })
  try {
    const body = { session: structuredClone(accepted.review.session) }
    const review = await service.review(body)
    assert.equal(review.mapping.valid, true)
    // The UI response reader must retain the complete real inventory and evidence.
    const received = await postBrickGame('review', body, async () => Response.json(review))
    assert.deepEqual(received, review)
    body.session.items[0].quantity++ // Unsaved UI edits cannot alter server review.
    const request = { reviewId: review.id, description: accepted.generatorInput.description, model: accepted.generatorInput.model }
    const first = await service.generate(request)
    const repeated = await service.generate(request)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].inventory, accepted.generatorInput.inventory)
    assert.deepEqual(repeated, first)
    const loaded = await service.artifact(first.artifact.id)
    assert.deepEqual(loaded.generation.design, accepted.generation.design)
    assert.deepEqual(loaded.review.session, accepted.review.session)
    assert.equal(loaded.designHash, first.artifact.designHash)
    await assert.rejects(service.generate({ ...request, description: request.description + ' changed' }), /已有另一生成请求/)
    assert.equal(calls.length, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('failed generation keeps its actual diagnostic output and publishes no playable artifact', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-game-failure-'))
  const metadata = evidence()
  let calls = 0
  const failure = { ok: false, rawOutput: 'diagnostic-only', finishReason: 'MAX_TOKENS', validation: null,
    error: { code: 'MODEL_INCOMPLETE', message: 'incomplete' } }
  const service = createBrickGames(directory, {
    getMetadata: async (route, params) => route === 'mapping-part' ? metadata.parts[params.part_num] : metadata.colors[params.color_id],
    generate: async () => { calls++; return { status: 502, body: failure } },
  })
  try {
    const review = await service.review({ session: accepted.review.session })
    const request = { reviewId: review.id, description: accepted.generatorInput.description, model: accepted.generatorInput.model }
    const result = await service.generate(request)
    assert.equal(result.artifact, null)
    assert.deepEqual(result.generation, failure)
    assert.deepEqual(await service.list(), [])
    assert.deepEqual(await service.generate(request), result)
    assert.equal(calls, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('mapping backend failure returns complete invalid review with HTTP evidence and never generates', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-mapping-http-'))
  let calls = 0
  const service = createBrickGames(directory, {
    getMetadata: async route => { throw Object.assign(new Error(`My-Good-GYM /${route} · HTTP 503：rebrickable_catalog_disabled`), {
      statusCode: 503, httpStatus: 503, stage: `My-Good-GYM /${route}`,
    }) },
    generate: async () => { calls++; throw new Error('must not call Gemini') },
  })
  try {
    const review = await service.review({ session: accepted.review.session })
    const received = await postBrickGame('review', { session: accepted.review.session }, async () => Response.json(review))
    assert.deepEqual(received.session, accepted.review.session)
    assert.equal(received.mapping.valid, false)
    assert.deepEqual(received.mapping.inventory, [])
    assert.equal(received.mapping.rows.length, accepted.review.session.items.length)
    for (const row of received.mapping.rows) {
      assert.equal(row.evidence.part.httpStatus, 503)
      assert.match(row.errors.join(';'), /HTTP 503.*rebrickable_catalog_disabled/)
    }
    await assert.rejects(service.generate({ reviewId: review.id }), /库存映射未通过/)
    assert.equal(calls, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

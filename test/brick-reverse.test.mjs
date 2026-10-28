import { sourceImageFixture, originalFixture } from './source-image-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateReverseAnalysis, enforceSource, createBrickReverse } from '../server/brick-reverse.mjs'
import { buildDesignRequest, buildDesignPrompt, designSchema } from '../server/brick-generator.mjs'
import { loadBrickRules } from '../server/brick-rules.mjs'

const observation = id => ({ id, color_id: null, size: null, shape: null, print: 'unknown', quantity: 1,
  bbox: null, confidence: 0.6, visible_studs: null, evidence: 'partly visible', occlusion: 'unknown rear' })
test('Reverse keeps unknowns separate and rejects invalid boxes and invented relation references', () => {
  const value = { appearance: 'visible construction', observations: [observation('a'), observation('b')],
    unknowns: ['hidden rear cannot be recovered'], relations: [{ from: 'a', to: 'b', relation: 'above', confidence: 0.5, evidence: 'image' }] }
  assert.deepEqual(validateReverseAnalysis(value), value)
  const invalid = structuredClone(value)
  invalid.relations[0].to = 'hidden-brick'
  assert.throws(() => validateReverseAnalysis(invalid))
  invalid.relations = []
  invalid.observations[0].bbox = [0.5, 0, 0.1, 1]
  assert.throws(() => validateReverseAnalysis(invalid))
  invalid.observations[0].bbox = null
  invalid.observations[0].size = 'guess'
  assert.throws(() => validateReverseAnalysis(invalid))
})
test('Inventory sources check different namespaces and cumulative quantities without numeric identity assumptions', () => {
  const rb = [{ part_num: 'rb-id', color_id: 25, quantity: 2 }]
  const ld = [{ part: 'ld-id', color: '14', quantity: 2 }]
  assert.doesNotThrow(() => enforceSource({ kind: 'today', session: { items: rb } }, rb, ld))
  assert.doesNotThrow(() => enforceSource({ kind: 'virtual', inventory: ld }, rb, ld))
  assert.throws(() => enforceSource({ kind: 'today', session: { items: rb } }, [{ ...rb[0], quantity: 3 }], ld))
  assert.throws(() => enforceSource({ kind: 'virtual', inventory: ld }, rb, [{ ...ld[0], quantity: 3 }]))
  assert.throws(() => enforceSource({ kind: 'virtual', inventory: ld }, rb, [{ ...ld[0], color: '25' }]))
})
test('reference extension retains Creative request contract and shares design schema', async () => {
  const rules = await loadBrickRules()
  const input = { description: 'test', inventory: [{ part: '3437', color: '4', quantity: 2 }] }
  const reference = { context: { approximation: true, unknowns: ['rear'] }, image: { mimeType: 'image/jpeg', imageBase64: 'fixture' } }
  for (const model of ['gemini-3.6-flash', 'gpt-4.1']) {
    const creative = buildDesignRequest(model, input, rules)
    const reverse = buildDesignRequest(model, input, rules, reference)
    if (model.startsWith('gemini')) {
      assert.equal(creative.contents[0].parts.length, 1)
      assert.deepEqual(JSON.parse(creative.contents[0].parts[0].text), input)
      assert.equal(reverse.contents[0].parts[1].inlineData.data, 'fixture')
      assert.equal(reverse.config.systemInstruction, buildDesignPrompt(rules, input.inventory))
      assert.deepEqual(reverse.config.responseSchema, designSchema(rules, input.inventory))
      assert.deepEqual(reverse.config, creative.config)
    } else {
      assert.equal(creative.input[0].content.length, 1)
      assert.equal(reverse.input[0].content[1].image_url, 'data:image/jpeg;base64,fixture')
      assert.equal(reverse.instructions, creative.instructions)
      assert.equal(reverse.text.format.type, 'json_object')
    }
  }
})
test('confirmed choices are scoped to analysis, re-mapped, bounded and generated only once', async () => {
  // Injected fixtures are test-only; production always uses existing Catalog and Mapping.
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-reverse-test-'))
  try {
    const analysisId = randomUUID(), searchId = randomUUID()
    const source = { kind: 'virtual', inventory: [{ part: '3437', color: '4', quantity: 2 }] }
    await writeFile(path.join(directory, analysisId + '.json'), JSON.stringify({ id: analysisId, kind: 'reverse-analysis', ...await sourceImageFixture(directory), status: 'complete',
      source, image: { mimeType: 'image/jpeg', imageBase64: 'fixture' },
      analysis: { appearance: 'two bricks', unknowns: [], observations: [observation('a')], relations: [] } }))
    await writeFile(path.join(directory, searchId + '.json'), JSON.stringify({ id: searchId, kind: 'reverse-search', analysisId, observationId: 'a',
      features: { color_id: 4, size: '2x2', shape: 'brick', print: 'unknown' },
      rows: [{ eligible: true, source: { part_num: 'rb-test', color_id: 4, quantity: 1 }, target: { part: '3437', color: '4' } }] }))
    let calls = 0
    const service = createBrickReverse(directory, {
      games: { review: async ({ session }) => ({ mapping: { rows: session.items.map(source => ({ source, target: { part: '3437', color: '4' }, errors: [] })) } }) },
      generate: async (input, options) => {
        calls++
        assert.deepEqual(input.inventory, source.inventory)
        assert.equal(options.reference.context.approximation, true)
        return { status: 422, body: { ok: false, error: { code: 'INVALID_DESIGN', message: 'test invalid output' } } }
      },
    })
    const body = { analysisId, model: 'gpt-4.1', confirmApproximation: true,
      choices: [{ observationId: 'a', searchId, index: 0, quantity: 2 }], excluded: [] }
    await assert.rejects(() => service.generate({ ...body, choices: [{ ...body.choices[0], quantity: 3 }] }), /超出虚拟库存/)
    assert.equal(calls, 0)
    await assert.rejects(() => service.generate({ ...body, choices: [{ ...body.choices[0], observationId: 'hidden' }] }))
    const result = await service.generate(body)
    assert.equal(result.status, 'failed')
    assert.equal(result.designHash, null)
    assert.equal(calls, 1)
    await assert.rejects(() => service.generate(body), /已有生成提交/)
    assert.equal(calls, 1)
    assert.equal((await service.attempt(analysisId)).id, result.id)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('analysis request IDs prevent duplicate billing; search uses strict feature parameters without a model call', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-reverse-analysis-test-'))
  try {
    let calls = 0
    const queries = []
    const service = createBrickReverse(directory, {
      games: { review: async () => { throw new Error('No candidates must not request Mapping') } },
      getCatalog: async (route, params) => {
        queries.push({ route, params })
        return route === 'filters' ? { colors: [{ id: 25, name: 'Orange' }] } : { items: [], total: 0 }
      },
      callModel: async ({ record, request }) => {
        calls++
        assert.equal(request.model, 'gpt-4.1')
        assert.equal(request.input[0].content[1].type, 'input_image')
        Object.assign(record, { finishReason: 'completed', rawOutput: JSON.stringify({
          appearance: 'fixture', unknowns: ['hidden rear'], observations: [observation('a')], relations: [],
        }) })
      },
    })
    const body = { originalImage: originalFixture, requestId: randomUUID(), model: 'gpt-4.1', source: { kind: 'full' }, mimeType: 'image/jpeg', imageBase64: Buffer.from([255,216,255]).toString('base64') }
    const first = await service.analyze(body)
    assert.equal(first.status, 'complete')
    assert.equal((await service.analyze(body)).id, first.id)
    assert.equal(calls, 1)
    await assert.rejects(() => service.analyze({ ...body, model: 'gpt-6-luna' }), /另一份输入/)
    const result = await service.search({ analysisId: first.id, observationId: 'a',
      features: { color_id: 25, size: null, shape: 'curved_top', print: 'unknown' } })
    assert.equal(result.rows.length, 0)
    assert.equal(calls, 1)
    assert.deepEqual(queries.at(-1), { route: 'candidates', params: { color: '25', shape: 'curved_top', page: '1', page_size: '6' } })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('history discovers existing analysis files, sorts newest first, and never calls providers', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'reverse-history-'))
  try {
    const older = randomUUID(), newer = randomUUID()
    for (const [id, createdAt] of [[older, '2026-10-20T00:00:00Z'], [newer, '2026-10-22T00:00:00Z']]) {
      await writeFile(path.join(directory, id + '.json'), JSON.stringify({
        id, kind: 'reverse-analysis', ...await sourceImageFixture(directory), createdAt, status: 'complete', provider: 'openai', model: 'gpt-4.1',
        source: { kind: 'full' }, analysis: { appearance: 'yellow animal', observations: [observation('a')], relations: [], unknowns: [] },
      }))
    }
    await writeFile(path.join(directory, newer + '.request.json'), '{"model":"gpt-4.1"}')
    const service = createBrickReverse(directory, { callModel: () => assert.fail('History must not call a model'), generate: () => assert.fail('No generation') })
    const history = await service.history()
    assert.deepEqual(history.items.map(r => r.id), [newer, older])
    assert.equal(history.items[0].count, 1)
    const restored = await service.restore(newer)
    assert.equal(restored.analysis.id, newer)
    assert.equal(restored.generationStatus, 'none')
    assert.ok(restored.warnings.some(w => w.includes('缺少参考图片')))
    assert.equal(restored.rows.a.index, undefined)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('saved review restores edits, exclusions and candidates without rewriting raw analysis or trace', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'reverse-review-'))
  try {
    const id = randomUUID(), searchId = randomUUID()
    const original = JSON.stringify({ id, kind: 'reverse-analysis', ...await sourceImageFixture(directory), status: 'complete', source: { kind: 'full' },
      image: { mimeType: 'image/jpeg', imageBase64: 'fixture' },
      analysis: { appearance: 'animal', observations: [observation('a'), observation('b')], relations: [], unknowns: ['rear'] } })
    await writeFile(path.join(directory, id + '.json'), original)
    await writeFile(path.join(directory, id + '.response.txt'), 'original provider response')
    const features = { color_id: 25, size: '2x4', shape: 'brick', print: 'no' }
    await writeFile(path.join(directory, searchId + '.json'), JSON.stringify({
      id: searchId, kind: 'reverse-search', analysisId: id, observationId: 'a', features,
      rows: [{ eligible: true, source: { part_num: 'catalog-part', color_id: 25 }, target: { part: 'geometry-part', color: 'orange' } }],
    }))
    const service = createBrickReverse(directory, { callModel: () => assert.fail('No model'), getCatalog: () => assert.fail('No Catalog request') })
    const rows = {
      a: { features: { color: '25', size: '2x4', shape: 'brick', print: 'no' }, quantity: '2', excluded: false, reason: '', searchId, index: 0 },
      b: { features: { color: '', size: '', shape: '', print: 'unknown' }, quantity: '1', excluded: true, reason: 'occluded' },
    }
    await service.saveReview({ analysisId: id, rows })
    const restored = await service.restore(id)
    assert.equal(restored.rows.a.search.id, searchId)
    assert.equal(restored.rows.a.index, 0)
    assert.equal(restored.rows.a.quantity, '2')
    assert.equal(restored.rows.b.reason, 'occluded')
    assert.equal(restored.rows.b.excluded, true)
    assert.equal(await readFile(path.join(directory, id + '.json'), 'utf8'), original)
    assert.equal(await readFile(path.join(directory, id + '.response.txt'), 'utf8'), 'original provider response')
    await assert.rejects(() => service.saveReview({ analysisId: id, rows: { ...rows, a: { ...rows.a, features: { ...rows.a.features, size: '2x2' } } } }), /不一致/)
    assert.equal((await service.restore(id)).rows.a.features.size, '2x4')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('restore does not apply a corrupt complete artifact or repeat a submitted generation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'reverse-artifact-'))
  try {
    const id = randomUUID(), artifactId = randomUUID()
    await writeFile(path.join(directory, id + '.json'), JSON.stringify({ id, kind: 'reverse-analysis', ...await sourceImageFixture(directory), status: 'complete',
      source: { kind: 'full' }, analysis: { appearance: '', observations: [observation('a')], relations: [], unknowns: [] } }))
    await writeFile(path.join(directory, id + '.generation.json'), JSON.stringify({ artifactId }))
    await writeFile(path.join(directory, artifactId + '.json'), JSON.stringify({
      id: artifactId, kind: 'reverse-design', status: 'complete', generation: { ok: false },
    }))
    const service = createBrickReverse(directory, { loadRules: async () => ({}), generate: () => assert.fail('No generation') })
    const restored = await service.restore(id)
    assert.equal(restored.artifact, null)
    assert.equal(restored.generationStatus, 'unavailable')
    assert.ok(restored.warnings.some(w => w.includes('Artifact 无法恢复')))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('Reverse forwards reviewed height and restores it without changing original observations', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-reverse-3d-test-'))
  try {
    const id = randomUUID(), queries = []
    const original = { id, kind: 'reverse-analysis', ...await sourceImageFixture(directory), status: 'complete', source: { kind: 'full' },
      analysis: { appearance: 'isolated fixture', unknowns: [], observations: [observation('a')], relations: [] } }
    const originalText = JSON.stringify(original)
    await writeFile(path.join(directory, id + '.json'), originalText)
    const service = createBrickReverse(directory, {
      games: { review: async () => { throw new Error('No candidates') } },
      callModel: async () => { throw new Error('No model in search/restore') },
      getCatalog: async (route, params) => { queries.push({ route, params }); return { items: [], total: 0,
        geometry_report: { unknown_total: 1, mismatched_total: 0 } } },
    })
    const features = { color_id: null, size: null, shape: null, print: 'unknown', width_studs: 2, depth_studs: 4, height_brick_units: .5 }
    const search = await service.search({ analysisId: id, observationId: 'a', features })
    assert.deepEqual(queries[0], { route: 'candidates', params: { width: '2', depth: '4', height: '0.5', page: '1', page_size: '6' } })
    assert.equal(search.geometry_report.unknown_total, 1)
    await service.saveReview({ analysisId: id, rows: { a: { features: { color: '', size: '2x4', shape: '', print: 'unknown',
      width_studs: '2', depth_studs: '4', height_brick_units: '0.5' }, quantity: '1', excluded: false, reason: '', searchId: search.id } } })
    const restored = await service.restore(id)
    assert.equal(restored.rows.a.features.height_brick_units, '0.5')
    assert.equal(restored.rows.a.search.features.height_brick_units, .5)
    assert.equal(restored.rows.a.index, undefined)
    assert.equal(await readFile(path.join(directory, id + '.json'), 'utf8'), originalText)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

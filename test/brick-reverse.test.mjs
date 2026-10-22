import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
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
    await writeFile(path.join(directory, analysisId + '.json'), JSON.stringify({ id: analysisId, kind: 'reverse-analysis', status: 'complete',
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
    const body = { requestId: randomUUID(), model: 'gpt-4.1', source: { kind: 'full' }, mimeType: 'image/jpeg', imageBase64: Buffer.from([255,216,255]).toString('base64') }
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

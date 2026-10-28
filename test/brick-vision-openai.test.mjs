import { originalFixture } from './source-image-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createBrickVision, visionPrompt, visionSchema, visionStatus } from '../server/brick-vision.mjs'
import { buildOpenaiVisionRequest, requestOpenaiVision, openaiVisionModel, openaiVisionModelOptions, resolveOpenaiVisionModel, openaiVisionEndpoint } from '../server/brick-vision-openai.mjs'

test('UI receives all confirmed OpenAI IDs and existing Gemini options', () => {
  assert.deepEqual(openaiVisionModelOptions().map(m => m.id), ['gpt-4.1', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra'])
  assert.deepEqual(visionStatus().models.filter(m => m.provider === 'openai'), openaiVisionModelOptions())
  assert.ok(visionStatus().models.some(m => m.provider === 'gemini' && m.id === 'gemini-3.6-flash'))
  assert.ok(visionStatus().models.some(m => m.provider === 'gemini' && m.id === 'gemini-3.1-pro-preview'))
  assert.throws(() => resolveOpenaiVisionModel('unconfirmed-alias'), /不支持/)
})

test('each selected model is present in final HTTP body with compatible reasoning settings', async t => {
  const old = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-only'
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old })
  for (const { id } of openaiVisionModelOptions()) {
    const request = buildOpenaiVisionRequest({ model: id, image: { mimeType: 'image/jpeg', imageBase64: 'unchanged-image' }, colors: [], prompt: visionPrompt, schema: visionSchema })
    let calls = 0
    const stop = new Error('Captured before network, no fabricated response')
    await assert.rejects(requestOpenaiVision(request, {}, async (url, options) => {
      calls++
      const body = JSON.parse(options.body)
      assert.equal(url, openaiVisionEndpoint)
      assert.equal(body.model, id)
      assert.equal(body.text.format.type, 'json_object')
      assert.equal(body.input[0].content[1].image_url, 'data:image/jpeg;base64,unchanged-image')
      assert.deepEqual(body.reasoning, id === 'gpt-4.1' ? undefined : { effort: 'medium' })
      assert.equal(body.temperature, undefined)
      assert.equal(body.top_p, undefined)
      throw stop
    }), error => error === stop)
    assert.equal(calls, 1)
  }
})

test('new model selection reaches inventory route and failed diagnostics without fallback', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-openai-models-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const selected = []
  const service = createBrickVision(directory, {
    createClient: () => { throw new Error('Gemini must not be called') },
    loadRules: async () => ({}), getMetadata: async () => ({ colors: [] }),
    requestOpenai: async request => {
      selected.push(request.model)
      throw Object.assign(new Error('Test-only permission denial'), { providerDiagnostic: {
        httpStatus: 403, rawErrorBody: '{"error":{"code":"permission_denied"}}', errorBody: { error: { code: 'permission_denied' } },
      } })
    },
  })
  for (const { id } of openaiVisionModelOptions().filter(m => m.id !== 'gpt-4.1')) {
    const body = { originalImage: originalFixture, requestId: randomUUID(), provider: 'openai', model: id, mode: 'inventory', mimeType: 'image/png',
      imageBase64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }
    const result = await service.recognize(body)
    assert.equal(result.status, 'failed')
    assert.equal(result.provider, 'openai')
    assert.equal(result.request.model, id)
    assert.equal(result.model, id)
    assert.equal(result.httpStatus, 403)
    const saved = JSON.parse(await readFile(path.join(directory, `${body.requestId}.json`), 'utf8'))
    assert.deepEqual(await service.recognize(body), saved)
    assert.match(saved.error.rawErrorBody, /permission_denied/)
  }
  assert.deepEqual(selected, ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra'])
})

test('OpenAI uses native image input and JSON mode, not Gemini configuration', () => {
  const r = buildOpenaiVisionRequest({ model: openaiVisionModel, image: { mimeType: 'image/jpeg', imageBase64: 'original' }, colors: [], prompt: visionPrompt, schema: visionSchema })
  assert.equal(r.model, openaiVisionModel)
  assert.equal(r.input[0].content[1].image_url, 'data:image/jpeg;base64,original')
  assert.equal(r.text.format.type, 'json_object')
  assert.equal(r.config, undefined)
  assert.equal(r.responseSchema, undefined)
  assert.equal(r.store, false)
})

test('final HTTP body includes JSON output instruction in input text and preserves context/image', async t => {
  const old = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-only'
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old })
  const colors = [{ id: 123, name: 'catalog test color' }]
  const request = buildOpenaiVisionRequest({ model: openaiVisionModel,
    image: { mimeType: 'image/jpeg', imageBase64: 'original-image-bytes' },
    colors, prompt: visionPrompt, schema: visionSchema })
  let sent, calls = 0
  const stop = new Error('Captured request before network; no response fabricated')
  await assert.rejects(requestOpenaiVision(request, {}, async (url, options) => {
    calls++
    sent = { url, method: options.method, body: JSON.parse(options.body) }
    throw stop
  }), error => error === stop)
  assert.equal(calls, 1)
  assert.equal(sent.url, openaiVisionEndpoint)
  assert.equal(sent.method, 'POST')
  assert.equal(sent.body.model, openaiVisionModel)
  assert.equal(sent.body.text.format.type, 'json_object')
  assert.equal(sent.body.input[0].role, 'user')
  const inputText = sent.body.input[0].content[0]
  assert.equal(inputText.type, 'input_text')
  assert.match(inputText.text, /^Return a JSON object only,/)
  assert.deepEqual(JSON.parse(inputText.text.slice(inputText.text.indexOf('\n') + 1)),
    { mode: 'inventory', colors, context: null })
  assert.deepEqual(sent.body.input[0].content[1],
    { type: 'input_image', image_url: 'data:image/jpeg;base64,original-image-bytes' })
  assert.equal(sent.body.instructions, request.instructions)
})

test('OpenAI HTTP errors retain original body and never retry', async t => {
  // Transport doubles are test-only; production always uses native fetch.
  const old = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-only'
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old })
  let calls = 0
  const raw = '{"error":{"message":"rate limited","code":"rate_limit_exceeded"}}'
  const record = {}
  await assert.rejects(requestOpenaiVision({ model: openaiVisionModel }, record, async (url, options) => {
    calls++
    assert.equal(url, openaiVisionEndpoint)
    assert.equal(options.redirect, 'error')
    return new Response(raw, { status: 429 })
  }), e => e.providerDiagnostic.httpStatus === 429 && e.providerDiagnostic.rawErrorBody === raw)
  assert.equal(calls, 1)
  assert.equal(record.rawResponseBody, raw)
  assert.equal(record.httpStatus, 429)
  delete process.env.OPENAI_API_KEY
  await assert.rejects(requestOpenaiVision({}, {}, async () => { throw new Error('must not call') }), /OPENAI_API_KEY/)
})

test('OpenAI routes through shared validation, persists provider and never calls Gemini', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-openai-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let calls = 0
  const output = { observations: [], evaluation: { verdict: 'uncertain', confidence: 0, reason: '未确定',
    targetObservationId: '', placementMatches: false, groundVisible: false, uncertainties: [], observed: [], relations: [] } }
  const service = createBrickVision(directory, {
    createClient: () => { throw new Error('Gemini must not be constructed') },
    loadRules: async () => ({}), getMetadata: async () => ({ colors: [] }),
    requestOpenai: async (request, record) => {
      calls++; assert.equal(request.model, openaiVisionModel)
      Object.assign(record, { httpStatus: 200, rawOutput: JSON.stringify(output), finishReason: 'completed', usageMetadata: { input_tokens: 5 }, modelVersion: openaiVisionModel })
    },
  })
  const body = { originalImage: originalFixture, requestId: randomUUID(), provider: 'openai', model: openaiVisionModel, mode: 'inventory',
    mimeType: 'image/png', imageBase64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }
  const result = await service.recognize(body)
  assert.equal(result.status, 'complete')
  assert.equal(result.provider, 'openai')
  assert.deepEqual(result.draft, [])
  assert.equal(result.request.input[0].content[1].type, 'input_image')
  const saved = JSON.parse(await readFile(path.join(directory, `${body.requestId}.json`), 'utf8'))
  assert.deepEqual(await service.recognize(body), saved)
  assert.equal(calls, 1)
  await assert.rejects(service.recognize({ ...body, mode: 'step' }), /仅支持 Inventory/)
  await assert.rejects(service.recognize({ ...body, model: 'unconfigured' }), /不支持/)
  output.observations = [{ id: 'invalid' }]
  const invalid = await service.recognize({ ...body, requestId: randomUUID() })
  assert.equal(invalid.status, 'failed')
  assert.equal(invalid.error.stage, 'Vision 输出')
  assert.equal(invalid.draft, undefined)
  assert.equal(calls, 2)
})

test('native Responses output and usage are retained; incomplete responses fail', async t => {
  const old = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-only'
  t.after(() => { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old })
  const response = { status: 'completed', model: openaiVisionModel, usage: { input_tokens: 100, output_tokens: 20 },
    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"observations":[]}' }] }] }
  const record = {}
  await requestOpenaiVision({}, record, async () => new Response(JSON.stringify(response), { status: 200 }))
  assert.equal(record.httpStatus, 200)
  assert.equal(record.rawOutput, '{"observations":[]}')
  assert.deepEqual(record.response, response)
  assert.deepEqual(record.usageMetadata, response.usage)
  response.status = 'incomplete'
  const incomplete = {}
  await assert.rejects(requestOpenaiVision({}, incomplete, async () => new Response(JSON.stringify(response), { status: 200 })), /未完成/)
  assert.equal(incomplete.httpStatus, 200)
  assert.ok(incomplete.rawResponseBody)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ApiError } from '@google/genai'
import { createBrickVision, validateRecognition, matchObservations, evaluateStep, stepContext, validateImage, visionSchema, visionErrorDiagnostic, visionStatus, visionModel } from '../server/brick-vision.mjs'
import { brickModelOptions } from '../server/brick-generator.mjs'
import { canApplyVision } from '../src/brick-vision/step-fence.mjs'

// Test doubles only. Production always calls the shared Gemini client and Resolver.
const evaluation = () => ({ verdict: 'uncertain', confidence: 0, reason: '未确认', targetObservationId: '',
  placementMatches: false, groundVisible: false, uncertainties: [], observed: [], relations: [] })
const observation = () => ({ color_id: null, size: null, shape: null, print: 'unknown', id: 'o', status: 'certain', confidence: 0.99, quantity: 1, evidence: '可见形状和颜色', occlusion: '',
  candidates: [{ part_num: 'catalog-part', color_id: 123 }], bbox: [0, 0, 0.5, 0.5] })
const reference = () => ({ artifactId: 'design', designHash: 'hash', instanceId: 'activity', runId: 'run', taskAttemptId: 'attempt', revision: 2, index: 1, taskId: 'place-target' })

test('Vision uses shared model options and passes selection to SDK and persisted diagnostics', async t => {
  assert.deepEqual(visionStatus().models, brickModelOptions())
  assert.equal(visionStatus().model, visionModel())
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-vision-model-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls = []
  const service = createBrickVision(directory, { loadRules: async () => ({}), getMetadata: async () => ({ colors: [] }),
    createClient: () => ({ models: { generateContent: async request => {
      calls.push(request.model)
      throw new ApiError({ status: 400, message: '{"error":{"message":"test rejection","status":"INVALID_ARGUMENT"}}' })
    } } }) })
  const body = { requestId: randomUUID(), mode: 'inventory', mimeType: 'image/png', imageBase64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }
  const initial = await service.recognize(body)
  assert.equal(initial.model, visionModel())
  const selected = brickModelOptions(visionModel()).find(m => m.id !== visionModel()).id
  await assert.rejects(service.recognize({ ...body, model: selected }), /不同模型/)
  const nextBody = { ...body, requestId: randomUUID(), model: selected }
  const next = await service.recognize(nextBody)
  assert.equal(next.model, selected)
  assert.equal(next.request.model, selected)
  assert.equal(next.error.httpStatus, 400)
  assert.match(next.error.rawErrorBody, /INVALID_ARGUMENT/)
  const saved = JSON.parse(await readFile(path.join(directory, `${nextBody.requestId}.json`), 'utf8'))
  assert.equal(saved.request.model, selected)
  assert.deepEqual(await service.recognize(nextBody), saved)
  await assert.rejects(service.recognize({ ...body, requestId: randomUUID(), model: 'unconfigured-model' }), error => error.statusCode === 400)
  assert.deepEqual(calls, [visionModel(), selected])
})

test('responseSchema array bounds follow installed Gemini Schema string contract', () => {
  const bounds = []
  function visit(schema) {
    if (schema.type === 'ARRAY') {
      assert.equal(typeof schema.maxItems, 'string')
      assert.match(schema.maxItems, /^[1-9][0-9]*$/)
      bounds.push(Number(schema.maxItems))
      visit(schema.items)
    }
    for (const child of Object.values(schema.properties || {})) visit(child)
  }
  visit(visionSchema)
  assert.deepEqual(bounds, [100, 5, 4, 20, 12, 66])
})

test('SDK errors retain exact body, HTTP status and structured details', () => {
  const body = { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Request rejected',
    details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'generationConfig', description: 'Invalid argument' }] }] } }
  const raw = JSON.stringify(body)
  const diagnostic = visionErrorDiagnostic(new ApiError({ status: 400, message: raw }), 'Vision API')
  assert.equal(diagnostic.httpStatus, 400)
  assert.equal(diagnostic.rawErrorBody, raw)
  assert.deepEqual(diagnostic.errorBody, body)
  assert.equal(diagnostic.message, body.error.message)
  assert.equal(diagnostic.sdkErrorName, 'ApiError')
  const nonJson = visionErrorDiagnostic(new ApiError({ status: 502, message: '<html>Bad gateway</html>' }), 'Vision API')
  assert.equal(nonJson.rawErrorBody, '<html>Bad gateway</html>')
  assert.equal(nonJson.errorBody, null)
  assert.equal(nonJson.httpStatus, 502)
  assert.equal(visionErrorDiagnostic(Object.assign(new Error('Invalid output'), { statusCode: 422 }), 'Vision 输出').message, 'Invalid output')
})

test('failed API body is persisted and repeat request does not call Gemini again', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-vision-api-error-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const raw = JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Rejected request' } })
  let calls = 0
  const service = createBrickVision(directory, { loadRules: async () => ({}), getMetadata: async () => ({ colors: [] }),
    createClient: () => ({ models: { generateContent: async () => {
      calls++
      throw new ApiError({ status: 400, message: raw })
    } } }) })
  const body = { requestId: randomUUID(), mode: 'inventory', mimeType: 'image/png', imageBase64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }
  const result = await service.recognize(body)
  assert.equal(result.status, 'failed')
  assert.equal(result.error.stage, 'Vision API')
  assert.equal(result.error.httpStatus, 400)
  assert.equal(result.error.rawErrorBody, raw)
  assert.equal(result.draft, undefined)
  assert.equal(result.matches, undefined)
  const saved = JSON.parse(await readFile(path.join(directory, `${body.requestId}.json`), 'utf8'))
  assert.deepEqual(saved.error, result.error)
  assert.deepEqual(await service.recognize(body), saved)
  assert.equal(calls, 1)
})

test('invalid model structure is rejected; uncertainty is preserved', () => {
  assert.throws(() => validateRecognition({ observations: null }))
  const value = { observations: [{ ...observation(), candidates: [], status: 'uncertain' }], evaluation: evaluation() }
  assert.equal(validateRecognition(value).observations[0].status, 'uncertain')
  assert.throws(() => validateRecognition({ ...value, observations: [observation(), observation()] }))
  assert.throws(() => validateRecognition({ ...value, observations: [{ ...observation(), confidence: 2 }] }))
  assert.throws(() => validateImage({ mimeType: 'image/jpeg', imageBase64: 'bm90LWltYWdl' }))
})

test('catalog and mapping gate all hypotheses; no invented fallback identity', async () => {
  const o = observation()
  const getMetadata = async () => ({ status: 'available' })
  const resolver = async () => ({ valid: false, rows: [{ target: null, errors: ['unknown part'] }] })
  const result = await matchObservations([o], { getMetadata, rules: {}, resolver })
  assert.equal(result[0].status, 'uncertain')
  assert.equal(result[0].item, null)
  assert.equal(result[0].target, null)
  assert.deepEqual(result[0].observation, o)
})

test('low confidence, multiple hypotheses and overlapping observations stay uncertain', async () => {
  const deps = { getMetadata: async () => ({ status: 'available' }), rules: {},
    resolver: async () => ({ valid: true, rows: [{ target: { part: 'runtime-part', color: '4' } }] }) }
  assert.equal((await matchObservations([observation()], deps))[0].status, 'matched')
  for (const rows of [[{ ...observation(), confidence: 0.4 }],
    [{ ...observation(), candidates: [...observation().candidates, { part_num: 'another', color_id: 123 }] }],
    [observation(), { ...observation(), id: 'duplicate-region' }]]) {
    assert.ok((await matchObservations(rows, deps)).every(m => m.status === 'uncertain'))
  }
})

test('find and place have different requirements; hidden or incorrect connections never confirm', () => {
  const target = { id: 'target', part: 'p', color: 'c', layer: 1 }, base = { id: 'base', part: 'q', color: 'd', layer: 0 }
  const match = (id, b) => ({ status: 'matched', observation: { ...observation(), id }, target: b })
  const matches = [match('o', target), match('base-o', base)]
  const recognition = { evaluation: { ...evaluation(), verdict: 'confirm', confidence: 0.99, targetObservationId: 'o', reason: '目标可见' } }
  const context = { phase: 'find', target, prefix: [base, target], requiredConnections: [{ lowerId: 'base', upperId: 'target' }] }
  assert.equal(evaluateStep(context, recognition, matches).verdict, 'confirm')
  context.phase = 'place'
  assert.equal(evaluateStep(context, recognition, matches).verdict, 'uncertain')
  Object.assign(recognition.evaluation, { placementMatches: true, observed: [{ brickId: 'base', observationId: 'base-o' }, { brickId: 'target', observationId: 'o' }] })
  assert.equal(evaluateStep(context, recognition, matches).verdict, 'uncertain')
  recognition.evaluation.relations = [{ lowerId: 'base', upperId: 'target', connected: true, evidence: '可见接合处' }]
  assert.equal(evaluateStep(context, recognition, matches).verdict, 'confirm')
  recognition.evaluation.uncertainties = ['底部被遮挡']
  assert.equal(evaluateStep(context, recognition, matches).verdict, 'uncertain')
  recognition.evaluation.verdict = 'retry'
  assert.equal(evaluateStep(context, recognition, matches).verdict, 'retry')
})

test('step context is derived from stored Design, not a client-supplied instruction', () => {
  const ref = reference(), brick = { id: 'target', part: 'p', color: 'c', layer: 0 }
  const artifact = { id: ref.artifactId, designHash: ref.designHash, generation: { design: { bricks: [brick], steps: [{ brickId: brick.id, instruction: '真实步骤' }] } }, review: { session: { items: [] }, mapping: { rows: [] } } }
  const rules = { validateAssembly: () => ({ valid: true, connections: [] }) }
  assert.equal(stepContext(artifact, ref, rules).instruction, '真实步骤')
  assert.throws(() => stepContext(artifact, { ...ref, designHash: 'different' }, rules))
  assert.throws(() => stepContext(artifact, { ...ref, taskId: 'other-step' }, rules))
})

test('late, reset, switched, disconnected and exited results cannot advance a new step', () => {
  const ref = reference(), result = { status: 'complete', evaluation: { verdict: 'confirm' }, reference: ref }
  assert.equal(canApplyVision(result, ref, ref, true), true)
  for (const field of Object.keys(ref)) {
    const changed = { ...ref, [field]: typeof ref[field] === 'number' ? ref[field] + 1 : ref[field] + '-new' }
    assert.equal(canApplyVision(result, ref, changed, true), false)
  }
  assert.equal(canApplyVision(result, ref, null, true), false)
  assert.equal(canApplyVision(result, ref, ref, false), false)
  assert.equal(canApplyVision({ ...result, evaluation: { verdict: 'uncertain' } }, ref, ref, true), false)
})

test('one persistent request produces one model call; full actual input/output retained', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-vision-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let calls = 0
  const response = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ observations: [], evaluation: evaluation() }) }] } }], modelVersion: 'test-only' }
  const service = createBrickVision(directory, { loadRules: async () => ({}), getMetadata: async () => ({ colors: [] }),
    createClient: () => ({ models: { generateContent: async () => { calls++; return response } } }) })
  const body = { requestId: randomUUID(), mode: 'inventory', mimeType: 'image/png', imageBase64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }
  const first = await service.recognize(body)
  assert.equal(first.status, 'complete')
  assert.deepEqual(await service.recognize(body), first)
  assert.equal(calls, 1)
  assert.equal(first.request.contents[0].parts[1].inlineData.data, body.imageBase64)
  assert.equal(JSON.parse(await readFile(path.join(directory, `${body.requestId}.json`), 'utf8')).rawOutput, first.rawOutput)
  response.candidates[0].finishReason = 'MAX_TOKENS'
  const failedBody = { ...body, requestId: randomUUID() }
  const failed = await service.recognize(failedBody)
  assert.equal(failed.status, 'failed')
  assert.ok(failed.rawOutput)
  await service.recognize(failedBody)
  assert.equal(calls, 2)
})

test('concurrent duplicate upload and changed payload cannot trigger a second call', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-vision-concurrent-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let release, entered
  const wait = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  let calls = 0
  const service = createBrickVision(directory, { loadRules: async () => ({}), getMetadata: async () => ({ colors: [] }),
    createClient: () => ({ models: { generateContent: async () => {
      calls++; entered(); await wait
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'invalid json' }] } }] }
    } } }) })
  const body = { requestId: randomUUID(), mode: 'inventory', mimeType: 'image/png', imageBase64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }
  const first = service.recognize(body)
  await started
  try { await assert.rejects(service.recognize(body), /仍在处理或结果未知/) }
  finally { release() }
  const result = await first
  assert.equal(result.status, 'failed')
  assert.equal(result.rawOutput, 'invalid json')
  await assert.rejects(service.recognize({ ...body, mode: 'step', reference: { artifactId: 'different' } }), /不能用于另一张图片或步骤/)
  assert.equal(calls, 1)
})


test('inventory features work without guessed IDs and do not invoke automatic Mapping', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brick-vision-features-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const observed = { ...observation(), color_id: 123, size: '2x4', shape: 'curved_top', candidates: [] }
  const output = JSON.stringify({ observations: [observed], evaluation: evaluation() })
  let calls = 0
  const service = createBrickVision(directory, {
    loadRules: async () => { throw new Error('Inventory recognition must not load runtime rules') },
    getMetadata: async route => { assert.equal(route, 'filters'); return { colors: [{ id: 123, name: 'Test palette color' }] } },
    createClient: () => ({ models: { generateContent: async () => {
      calls++; return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: output }] } }] }
    } } }),
  })
  const body = { requestId: randomUUID(), mode: 'inventory', mimeType: 'image/png', imageBase64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }
  const result = await service.recognize(body)
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.matches[0].observation, observed)
  assert.equal(result.matches[0].item, null)
  assert.deepEqual(result.draft, [])
  assert.equal(result.rawOutput, output)
  const persisted = JSON.parse(await readFile(path.join(directory, body.requestId + '.json'), 'utf8'))
  assert.deepEqual(persisted.matches, result.matches)
  assert.deepEqual(await service.recognize(body), persisted)
  assert.equal(calls, 1)
})


test('structured features are required and invalid feature values cannot become guesses', () => {
  const value = { observations: [{ ...observation(), candidates: [] }], evaluation: evaluation() }
  assert.deepEqual(validateRecognition(value).observations[0].candidates, [])
  for (const field of ['color_id', 'size', 'shape', 'print']) {
    const invalid = { ...observation() }; delete invalid[field]
    assert.throws(() => validateRecognition({ ...value, observations: [invalid] }))
    assert.ok(visionSchema.properties.observations.items.required.includes(field))
  }
  assert.throws(() => validateRecognition({ ...value, observations: [{ ...observation(), shape: 'unsupported' }] }))
})


test('manual inventory validates Catalog identity independently of game support', async () => {
  const calls = []
  const service = createBrickVision('unused-no-record-write', {
    loadRules: async () => { throw new Error('Inventory must not load game rules') },
    getMetadata: async (route, params) => {
      calls.push({ route, params })
      return { items: [{ part_num: '98223', name: 'Duplo Brick 2 x 4 Curved Top', colors: [{ id: 25 }] }] }
    },
  })
  const item = { part_num: '98223', color_id: 25, quantity: 2 }
  const result = await service.validateDraft({ items: [item] })
  assert.equal(result.valid, true)
  assert.deepEqual(result.items, [item])
  assert.equal(result.gameSupport, 'not_checked')
  assert.deepEqual(calls, [{ route: 'parts', params: { search: '98223,', color: '25', page: '1', page_size: '1' } }])
  assert.equal((await service.validateDraft({ items: [{ ...item, color_id: 4 }] })).valid, false)
  assert.equal((await service.validateDraft({ items: [{ ...item, part_num: 'absent' }] })).valid, false)
  const count = calls.length
  await assert.rejects(service.validateDraft({ items: [{ ...item, quantity: 0 }] }))
  await assert.rejects(service.validateDraft({ items: [] }))
  assert.equal(calls.length, count)
})

test('manual inventory cannot pass a malformed or unavailable Catalog', async () => {
  const item = { part_num: 'catalog-part', color_id: 25, quantity: 1 }
  const invalid = createBrickVision('unused', { getMetadata: async () => ({}) })
  await assert.rejects(invalid.validateDraft({ items: [item] }), /Catalog/)
  const unavailable = createBrickVision('unused', { getMetadata: async () => { throw new Error('Catalog unavailable') } })
  await assert.rejects(unavailable.validateDraft({ items: [item] }), /Catalog unavailable/)
})

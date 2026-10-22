import test, { after } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const traceDirectory = await mkdtemp(path.join(tmpdir(), 'brick-design-test-'))
after(() => rm(traceDirectory, { recursive: true, force: true }))
import assert from 'node:assert/strict'
import { loadBrickRules, loadTranspiledBrickRules } from '../server/brick-rules.mjs'
import { generateBrickDesign, validateBrickDesign, validateGeneratorInput, brickModelOptions, resolveBrickModel } from '../server/brick-generator.mjs'

// Fixtures only; production generation has no template or fallback design.
function fixture() {
  const bricks = [
    { id: 'base', part: '2300', color: '1', x: 0, z: 0, layer: 0, rotation: 0 },
    { id: 'left', part: '3437', color: '4', x: -2, z: 0, layer: 1, rotation: 0 },
    { id: 'middle', part: '3437', color: '2', x: 0, z: 0, layer: 1, rotation: 90 },
    { id: 'right', part: '3437', color: '14', x: 2, z: 0, layer: 1, rotation: 180 },
    { id: 'top', part: '3437', color: '4', x: 0, z: 0, layer: 2, rotation: 270 },
  ]
  const design = { name: '测试组合', bricks, steps: bricks.map((b) => ({ brickId: b.id, instruction: '将这块积木按图按上。' })) }
  const input = { description: '自由设计一个简单动物', inventory: [
    { part: '2300', color: '1', quantity: 1 },
    { part: '3437', color: '4', quantity: 2 },
    { part: '3437', color: '2', quantity: 1 },
    { part: '3437', color: '14', quantity: 1 },
  ] }
  return { design, input }
}
const reply = (text, finishReason = 'STOP') => ({ modelVersion: 'mock-version', candidates: [{ finishReason, content: { parts: [{ thought: true, text: 'private reasoning' }, { text }] } }] })
test('two-brick minimum applies to every supported part without weakening validation', async () => {
  const rules = await loadBrickRules()
  for (const part of rules.PARTS) {
    const color = rules.COLORS[0].code
    const inventory = [{ part: part.id, color, quantity: 2 }]
    assert.deepEqual(validateGeneratorInput({ description: '数量边界检查', inventory }, rules).inventory, inventory)
    const bricks = [0, 1].map(layer => ({ id: `b${layer}`, part: part.id, color, x: 0, z: 0, layer, rotation: 0 }))
    const design = { name: '数量边界检查', bricks, steps: bricks.map(b => ({ brickId: b.id, instruction: '按图放好积木。' })) }
    assert.equal(validateBrickDesign(design, inventory, rules).valid, true)
    const collision = structuredClone(design)
    collision.bricks[1].layer = 0
    assert.equal(validateBrickDesign(collision, inventory, rules).valid, false)
    const disconnected = structuredClone(design)
    disconnected.bricks[1].layer = 2
    assert.equal(validateBrickDesign(disconnected, inventory, rules).valid, false)
    assert.equal(validateBrickDesign(design, [{ ...inventory[0], quantity: 1 }], rules).valid, false)
    assert.equal(validateBrickDesign({ ...design, steps: [...design.steps].reverse() }, inventory, rules).valid, false)
  }
})
async function invoke(input, response) {
  const calls = []
  const result = await generateBrickDesign(input, {
    model: 'gemini-3.6-flash', traceDirectory,
    createClient: () => ({ models: { generateContent: async (request) => {
      calls.push(request)
      if (response instanceof Error) throw response
      return response
    } } }),
  })
  return { ...result, calls }
}

test('same V2 rules work through automatic and in-memory TypeScript loaders', async () => {
  const direct = await loadBrickRules()
  const fallback = await loadTranspiledBrickRules()
  const { design } = fixture()
  assert.equal(direct.validateAssembly(design.bricks).valid, true)
  assert.deepEqual(fallback.validateAssembly(design.bricks), direct.validateAssembly(design.bricks))
  const draft = { ...design.bricks[1], id: 'new' }
  assert.deepEqual(fallback.connectionCandidates([design.bricks[0]], draft), direct.connectionCandidates([design.bricks[0]], draft))
  assert.deepEqual(fallback.PARTS, direct.PARTS)
})

test('valid output is preserved; one request uses configured model and structured schema', async () => {
  const { design, input } = fixture()
  const before = structuredClone({ design, input })
  const raw = JSON.stringify(design, null, 2)
  const { status, body, calls } = await invoke(input, reply(raw))
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.validation.valid, true)
  assert.equal(body.validation.steps.length, 5)
  assert.equal(body.validation.usage.reduce((sum, r) => sum + r.used, 0), 5)
  assert.equal(body.rawOutput, raw)
  assert.equal(body.model, 'gemini-3.6-flash')
  assert.equal(body.modelVersion, 'mock-version')
  assert.deepEqual(body.design, design)
  assert.deepEqual({ design, input }, before)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].model, 'gemini-3.6-flash')
  assert.equal(calls[0].config.responseMimeType, 'application/json')
  assert.equal(calls[0].config.responseSchema.properties.bricks.minItems, '2')
  assert.deepEqual(JSON.parse(calls[0].contents[0].parts[0].text), input)
})

test('invalid inputs do not call model', async () => {
  const rules = await loadBrickRules()
  const { input } = fixture()
  for (const invalid of [null, { ...input, description: '' }, { ...input, inventory: [] },
    { ...input, inventory: [...input.inventory, input.inventory[0]] },
    { ...input, inventory: [{ part: 'fake', color: '4', quantity: 5 }] },
    { ...input, inventory: [{ part: '3437', color: '4', quantity: 1 }] },
    { ...input, inventory: [{ part: '3437', color: '4', quantity: 5.5 }] },
    { ...input, inventory: [{ part: '3437', color: 'unknown', quantity: 5 }] },
  ]) {
    assert.throws(() => validateGeneratorInput(invalid, rules))
    const result = await invoke(invalid, reply('{}'))
    assert.equal(result.status, 400)
    assert.equal(result.calls.length, 0)
  }
})

test('reject invalid designs without repairs and preserve original output', async () => {
  const cases = [
    ['INVENTORY_EXCEEDED', (d) => { d.bricks[1].color = '0' }],
    ['BRICK_SCHEMA', (d) => { d.bricks[1].part = 'fake' }],
    ['BRICK_SCHEMA', (d) => { d.bricks[1].color = 'unknown' }],
    ['BRICK_SCHEMA', (d) => { d.bricks[1].x = 0.25 }],
    ['BRICK_SCHEMA', (d) => { d.bricks[1].rotation = 45 }],
    ['DUPLICATE_ID', (d) => { d.bricks[1].id = 'base' }],
    ['CHILD_LIMIT', (d) => { d.bricks[1].layer = 4 }],
    ['CHILD_LIMIT', (d) => { d.bricks[1].x = 7 }],
    ['GEOMETRY', (d) => { d.bricks[1].x = 0 }],
    ['GEOMETRY', (d) => { d.bricks[1].x = -6 }],
    ['BUILD_ORDER', (d) => { d.steps.reverse() }],
    ['STEP_SCHEMA', (d) => { d.steps[1].brickId = 'base' }],
    ['STEP_SCHEMA', (d) => { d.steps[1].instruction = '' }],
    ['MISSING_STEPS', (d) => { d.steps.pop() }],
    ['BRICK_COUNT', (d) => { d.bricks = d.bricks.slice(0, 1); d.steps = d.steps.slice(0, 1) }],
    ['BRICK_COUNT', (d) => { d.bricks = Array.from({ length: 13 }, () => d.bricks[0]) }],
  ]
  for (const [code, mutate] of cases) {
    const { design, input } = fixture()
    mutate(design)
    const raw = JSON.stringify(design)
    const result = await invoke(input, reply(raw))
    assert.equal(result.status, 422, code)
    assert.equal(result.body.ok, false, code)
    assert.equal(result.body.design, undefined, code)
    assert.equal(result.body.rawOutput, raw, code)
    assert.ok(result.body.validation.issues.some((i) => i.code === code), code)
    assert.equal(result.calls.length, 1, code)
  }
})

test('V3 rejects single-point support even when V2 geometry is valid', async () => {
  const rules = await loadBrickRules()
  const { design, input } = fixture()
  design.bricks[1].x = -3
  design.bricks[1].z = 1
  assert.equal(rules.validateAssembly(design.bricks).valid, true)
  const report = validateBrickDesign(design, input.inventory, rules)
  assert.equal(report.valid, false)
  assert.ok(report.issues.some((i) => i.code === 'CHILD_SUPPORT'))
})

test('brick array order does not replace declared building order', async () => {
  const rules = await loadBrickRules()
  const { design, input } = fixture()
  design.bricks.reverse()
  const report = validateBrickDesign(design, input.inventory, rules)
  assert.equal(report.valid, true)
  assert.deepEqual(report.steps.map((s) => s.brickId), design.steps.map((s) => s.brickId))
})

test('a final connected bridge still fails when an intermediate step is disconnected', async () => {
  const rules = await loadBrickRules()
  const brick = (id, part, x, layer) => ({ id, part, color: '4', x, z: 0, layer, rotation: 0 })
  const bricks = [brick('a', '3437', -2, 0), brick('b', '3437', 2, 0), brick('bridge', '2300', 0, 1), brick('c', '3437', 0, 2), brick('d', '3437', 2, 2)]
  const design = { name: '桥', bricks, steps: bricks.map((b) => ({ brickId: b.id, instruction: '放置积木' })) }
  const inventory = [{ part: '3437', color: '4', quantity: 4 }, { part: '2300', color: '4', quantity: 1 }]
  const report = validateBrickDesign(design, inventory, rules)
  assert.equal(report.assembly.valid, true)
  assert.equal(report.valid, false)
  assert.ok(report.issues.some((i) => i.code === 'BUILD_ORDER' && i.step === 2))
})

test('invalid JSON, truncation and safety blocks retain diagnostics with no retry', async () => {
  const { input } = fixture()
  for (const [response, code] of [
    [reply('```json\n{}\n```'), 'INVALID_JSON'],
    [reply('{"name":', 'MAX_TOKENS'), 'MODEL_INCOMPLETE'],
    [{ promptFeedback: { blockReason: 'SAFETY' } }, 'MODEL_INCOMPLETE'],
  ]) {
    const result = await invoke(input, response)
    assert.equal(result.body.ok, false)
    assert.equal(result.body.error.code, code)
    assert.equal(result.calls.length, 1)
    assert.equal(result.body.design, undefined)
    assert.equal(result.body.rawOutput, response.candidates?.[0].content.parts[1].text || '')
  }
})

test('request failures are sanitized, not retried; configuration failures do not request', async () => {
  const { input } = fixture()
  const result = await invoke(input, Object.assign(new Error('secret API key example'), { status: 429 }))
  assert.equal(result.status, 502)
  assert.equal(result.calls.length, 1)
  assert.equal(result.body.error.code, 'PROVIDER_REQUEST')
  assert.ok(!JSON.stringify(result.body).includes('secret'))
  const missing = await generateBrickDesign(input, { traceDirectory, createClient: () => { throw new Error('missing') } })
  assert.equal(missing.status, 503)
  assert.equal(missing.body.error.code, 'PROVIDER_CONFIG')
  let created = false
  const unavailable = await generateBrickDesign(input, { loadRules: async () => { throw new Error('broken') }, createClient: () => { created = true } })
  assert.equal(unavailable.body.error.code, 'VALIDATOR_UNAVAILABLE')
  assert.equal(created, false)
})

test('Flash and Pro selection reaches the same single request with explicit reasoning/output budget', async () => {
  const { input, design } = fixture()
  for (const model of ['gemini-3.6-flash', 'gemini-3.1-pro-preview']) {
    const response = reply(JSON.stringify(design))
    response.usageMetadata = { promptTokenCount: 1100, thoughtsTokenCount: 9000, candidatesTokenCount: 2100, totalTokenCount: 12200 }
    const result = await invoke({ ...input, model }, response)
    assert.equal(result.status, 200)
    assert.equal(result.body.model, model)
    assert.equal(result.body.modelVersion, 'mock-version')
    assert.equal(result.calls.length, 1)
    assert.equal(result.calls[0].model, model)
    assert.equal(result.calls[0].config.maxOutputTokens, 32768)
    assert.deepEqual(result.calls[0].config.thinkingConfig, { thinkingLevel: 'MEDIUM' })
    assert.equal(result.calls[0].config.httpOptions.retryOptions.attempts, 1)
    assert.equal(result.calls[0].config.httpOptions.timeout, 180000)
    assert.deepEqual(result.body.usageMetadata, response.usageMetadata)
    assert.equal(result.body.validation.valid, true)
    // The selected model is routing data, not part of the design prompt.
    assert.deepEqual(JSON.parse(result.calls[0].contents[0].parts[0].text), input)
  }
})

test('unknown requested models are rejected before a model call; server defaults remain explicit', async () => {
  const { input } = fixture()
  for (const model of ['invented-model', '', null, 123]) {
    const result = await invoke({ ...input, model }, reply('{}'))
    assert.equal(result.status, 400)
    assert.equal(result.calls.length, 0)
  }
  assert.throws(() => resolveBrickModel(undefined, 'server-custom'))
  assert.ok(!brickModelOptions().some((m) => m.id === 'server-custom'))
  assert.ok(brickModelOptions().some((m) => m.id === 'gemini-3.1-pro-preview'))
})

test('MAX_TOKENS retains partial JSON, usage and settings without retries or fallback', async () => {
  const { input } = fixture()
  const response = reply('{"name":"小桥","bricks":[', 'MAX_TOKENS')
  response.responseId = 'mock-response-id'
  response.candidates[0].finishMessage = 'Output limit reached'
  response.usageMetadata = { promptTokenCount: 1000, thoughtsTokenCount: 32000, candidatesTokenCount: 768, totalTokenCount: 33768 }
  const result = await invoke({ ...input, model: 'gemini-3.1-pro-preview' }, response)
  assert.equal(result.status, 502)
  assert.equal(result.calls.length, 1)
  assert.equal(result.body.model, 'gemini-3.1-pro-preview')
  assert.equal(result.body.finishReason, 'MAX_TOKENS')
  assert.equal(result.body.rawOutput, response.candidates[0].content.parts[1].text)
  assert.deepEqual(result.body.usageMetadata, response.usageMetadata)
  assert.equal(result.body.responseId, response.responseId)
  assert.equal(result.body.finishMessage, 'Output limit reached')
  assert.equal(result.body.generationSettings.maxOutputTokens, 32768)
  assert.equal(result.body.validation, null)
  assert.equal(result.body.design, undefined)
})

test('absent usage is retained as null rather than invented zero counts', async () => {
  const { input, design } = fixture()
  const result = await invoke(input, reply(JSON.stringify(design)))
  assert.equal(result.body.usageMetadata, null)
})

// Transport substitution is confined to this test; production uses Responses API.
test('OpenAI design uses the shared adapter and the same inventory/geometry validator', async () => {
  const { input, design } = fixture()
  for (const valid of [true, false]) {
    const value = structuredClone(design)
    if (!valid) value.bricks[0].color = '0'
    let calls = 0
    const result = await generateBrickDesign({ ...input, model: 'gpt-4.1' }, {
      traceDirectory,
      createClient: () => { throw new Error('Gemini must not be constructed') },
      requestOpenai: async (request, record) => {
        calls++
        assert.equal(request.model, 'gpt-4.1')
        assert.equal(request.text.format.type, 'json_object')
        Object.assign(record, { response: { model: 'gpt-4.1-test', status: 'completed' },
          modelVersion: 'gpt-4.1-test', httpStatus: 200, finishReason: 'completed',
          usageMetadata: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }, rawOutput: JSON.stringify(value) })
      },
    })
    assert.equal(calls, 1)
    assert.equal(result.status, valid ? 200 : 422)
    assert.equal(result.body.validation.valid, valid)
    assert.equal(result.body.provider, 'openai')
    assert.equal(result.body.modelVersion, 'gpt-4.1-test')
    assert.equal(result.body.usageMetadata.total_tokens, 30)
    if (!valid) assert.equal(result.body.design, undefined)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { loadBrickRules, loadTranspiledBrickRules } from '../server/brick-rules.mjs'
import { generateBrickDesign, validateBrickDesign, validateGeneratorInput } from '../server/brick-generator.mjs'

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
async function invoke(input, response) {
  const calls = []
  const result = await generateBrickDesign(input, {
    model: 'mock-model',
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
  assert.equal(body.model, 'mock-model')
  assert.equal(body.modelVersion, 'mock-version')
  assert.deepEqual(body.design, design)
  assert.deepEqual({ design, input }, before)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].model, 'mock-model')
  assert.equal(calls[0].config.responseMimeType, 'application/json')
  assert.equal(calls[0].config.responseSchema.properties.bricks.minItems, '5')
  assert.deepEqual(JSON.parse(calls[0].contents[0].parts[0].text), input)
})

test('invalid inputs do not call model', async () => {
  const rules = await loadBrickRules()
  const { input } = fixture()
  for (const invalid of [null, { ...input, description: '' }, { ...input, inventory: [] },
    { ...input, inventory: [...input.inventory, input.inventory[0]] },
    { ...input, inventory: [{ part: 'fake', color: '4', quantity: 5 }] },
    { ...input, inventory: [{ part: '3437', color: '4', quantity: 4 }] },
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
    ['BRICK_SCHEMA', (d) => { d.bricks[1].x = 0.5 }],
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
    ['BRICK_COUNT', (d) => { d.bricks.pop(); d.steps.pop() }],
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
  assert.equal(result.body.error.code, 'GEMINI_REQUEST')
  assert.ok(!JSON.stringify(result.body).includes('secret'))
  const missing = await generateBrickDesign(input, { createClient: () => { throw new Error('missing') } })
  assert.equal(missing.status, 503)
  assert.equal(missing.body.error.code, 'GEMINI_CONFIG')
  let created = false
  const unavailable = await generateBrickDesign(input, { loadRules: async () => { throw new Error('broken') }, createClient: () => { created = true } })
  assert.equal(unavailable.body.error.code, 'VALIDATOR_UNAVAILABLE')
  assert.equal(created, false)
})

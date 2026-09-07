import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { detectRingsWithGemini, geminiRingModelOptions, ringSchema } from '../server/gemini-rings.mjs'

// Synthetic geometry and intercepted HTTP: never evidence of a real two-ring scene.
const fixture = { rings: [0.15, 0.65].map((x, i) => ({
  id: String(i + 1), center: { x: x + 0.1, y: 0.65 },
  bbox: { xMin: x, yMin: 0.5, xMax: x + 0.2, yMax: 0.8 },
  polygon: [{ x: x + 0.1, y: 0.52 }, { x: x + 0.18, y: 0.65 }, { x: x + 0.1, y: 0.78 }, { x: x + 0.02, y: 0.65 }],
  colorGuess: i ? 'BLACK' : 'GRAY_BLUE', confidence: 0.9, explanation: 'Synthetic test fixture',
})) }
const input = { mimeType: 'image/jpeg', imageBase64: 'aW1hZ2U=', width: 1200, height: 800, model: 'gemini-3.6-flash' }
const fakeKey = 'test-placeholder-not-a-real-key'

function env(t, key, value) {
  const previous = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
}
function stubGoogle(t, payload, status = 200) {
  env(t, 'GEMINI_API_KEY', fakeKey)
  env(t, 'GOOGLE_GENAI_USE_VERTEXAI', 'true')
  env(t, 'GOOGLE_GENAI_USE_ENTERPRISE', 'true')
  return t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`)
    const headers = new Headers(init.headers)
    assert.equal(headers.get('x-goog-api-key'), fakeKey)
    assert.equal(headers.get('authorization'), null)
    const body = JSON.parse(init.body)
    assert.deepEqual(body.contents[0].parts[1], { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } })
    assert.match(body.contents[0].parts[0].text, /1200 pixels wide, 800 pixels high/)
    assert.equal(body.generationConfig.responseMimeType, 'application/json')
    assert.deepEqual(body.generationConfig.responseSchema, ringSchema)
    assert.equal(body.generationConfig.maxOutputTokens, 8192)
    assert.equal(body.generationConfig.temperature, undefined)
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  })
}
const candidate = (text, finishReason = 'STOP') => ({
  modelVersion: 'gemini-3.6-flash', candidates: [{ finishReason, content: { parts: [
    { thought: true, text: 'Do not include internal thinking in JSON.' }, { text },
  ] } }],
})

test('prompt, schema and geometry validation are unchanged from Vertex implementation', async () => {
  const old = await readFile(new URL('../server/ring-llm.mjs', import.meta.url), 'utf8')
  const migrated = await readFile(new URL('../server/gemini-rings.mjs', import.meta.url), 'utf8')
  const business = source => source.slice(source.indexOf('const point ='), source.indexOf('\nexport async function detect'))
  assert.equal(business(migrated), business(old))
})

test('model labels map to actual IDs and 3.6 is the independent default', t => {
  env(t, 'GEMINI_RING_MODEL', undefined)
  env(t, 'RING_LLM_MODEL', 'vertex-only-setting')
  const options = geminiRingModelOptions()
  assert.equal(options.defaultModel, 'gemini-3.6-flash')
  for (const version of ['3.5', '3.6', '3.7', '3.8']) {
    assert.equal(options.models.find(m => m.id === `gemini-${version}-flash`).label, `Gemini ${version} Flash`)
  }
})

test('real SDK uses API Key, inline image and original schema; preserves all ring fields', async t => {
  const fetch = stubGoogle(t, candidate(JSON.stringify(fixture)))
  const result = await detectRingsWithGemini(input)
  assert.deepEqual(result.rings, fixture.rings)
  assert.equal(result.rawJson, JSON.stringify(fixture))
  assert.equal(result.model, input.model)
  assert.equal(result.modelVersion, input.model)
  assert.equal(fetch.mock.callCount(), 1)
})

for (const [name, payload, shouldFail] of [
  ['no rings', candidate('{"rings":[]}'), false],
  ['invalid JSON', candidate('not JSON'), true],
  ['invalid normalized geometry', candidate(JSON.stringify({ rings: [{ ...fixture.rings[0], center: { x: 120, y: 250 } }] })), true],
  ['duplicate IDs', candidate(JSON.stringify({ rings: [fixture.rings[0], fixture.rings[0]] })), true],
  ['truncated output', candidate(JSON.stringify(fixture), 'MAX_TOKENS'), true],
  ['blocked output', { promptFeedback: { blockReason: 'SAFETY' } }, true],
]) {
  test(`output handling: ${name}`, async t => {
    stubGoogle(t, payload)
    const result = await detectRingsWithGemini(input)
    assert.equal(Boolean(result.error), shouldFail)
    assert.deepEqual(result.rings, [])
  })
}

test('upstream auth errors are sanitized and never fall back to Vertex', async t => {
  const fetch = stubGoogle(t, { error: { code: 403, message: fakeKey } }, 403)
  await assert.rejects(detectRingsWithGemini(input), error => {
    assert.equal(error.statusCode, 502)
    assert.match(error.message, /HTTP 403/)
    assert.ok(!error.message.includes(fakeKey))
    return true
  })
  assert.equal(fetch.mock.callCount(), 1)
})

test('invalid upload/model and missing Key fail before network access', async t => {
  env(t, 'GEMINI_API_KEY', undefined)
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network') })
  await assert.rejects(detectRingsWithGemini({ ...input, mimeType: 'text/plain' }), { statusCode: 400 })
  await assert.rejects(detectRingsWithGemini({ ...input, model: 'unlisted-model' }), { statusCode: 400 })
  await assert.rejects(detectRingsWithGemini(input), { statusCode: 503 })
  assert.equal(fetch.mock.callCount(), 0)
})

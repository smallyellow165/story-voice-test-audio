import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { baselineStatus, runGeminiBaseline } from '../server/gemini-baseline.mjs'

// These tests intercept HTTP at the real SDK boundary. No Google requests or real keys.
const fakeKey = 'baseline-test-placeholder-not-a-credential'
const file = { name: 'files/baseline-test', uri: 'https://generativelanguage.googleapis.com/v1beta/files/baseline-test', mimeType: 'image/jpeg' }
const reply = (body, headers = {}, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
})

function setEnv(t, key, value) {
  const previous = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  t.after(() => {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  })
}

test('missing Key is explicit and never falls back to Cloud authentication', async t => {
  setEnv(t, 'GEMINI_API_KEY', undefined)
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network request') })
  assert.equal(baselineStatus().apiKeyConfigured, false)
  await assert.rejects(runGeminiBaseline(), { statusCode: 503 })
  assert.equal(fetch.mock.callCount(), 0)
})

for (const outcome of ['success', 'blocked', 'upstream-error']) {
  test(`SDK image baseline: ${outcome}`, async t => {
    setEnv(t, 'GEMINI_API_KEY', fakeKey)
    setEnv(t, 'GOOGLE_GENAI_USE_VERTEXAI', 'true')
    const calls = []
    const sample = await readFile(new URL('../public/gemini-baseline/organ.jpg', import.meta.url))
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      const url = new URL(input)
      calls.push({ path: url.pathname, method: init.method })
      assert.equal(url.hostname, 'generativelanguage.googleapis.com')
      assert.equal(new Headers(init.headers).get('x-goog-api-key'), fakeKey)
      assert.equal(new Headers(init.headers).get('authorization'), null)
      if (url.pathname === '/upload/v1beta/files') {
        return reply({}, { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload-session' })
      }
      if (url.pathname === '/upload-session') {
        assert.deepEqual(Buffer.from(await init.body.arrayBuffer()), sample)
        return reply({ file }, { 'x-goog-upload-status': 'final' })
      }
      if (url.pathname === '/v1beta/models/gemini-3.7-flash:generateContent') {
        const body = JSON.parse(init.body)
        assert.deepEqual(body.contents, [{ role: 'user', parts: [
          { text: 'Tell me about this instrument' },
          { fileData: { fileUri: file.uri, mimeType: 'image/jpeg' } },
        ] }])
        assert.equal(body.generationConfig, undefined)
        if (outcome === 'upstream-error') return reply({ error: { code: 403, message: fakeKey } }, {}, 403)
        if (outcome === 'blocked') return reply({ promptFeedback: { blockReason: 'SAFETY' } })
        return reply({ candidates: [{ content: { parts: [{ text: 'A pipe organ.' }] }, finishReason: 'STOP' }], modelVersion: 'test-model-version' })
      }
      if (url.pathname === '/v1beta/files/baseline-test' && init.method === 'DELETE') return reply({})
      throw new Error('Unexpected SDK endpoint')
    })
    if (outcome === 'upstream-error') {
      await assert.rejects(runGeminiBaseline(), error => {
        assert.equal(error.statusCode, 502)
        assert.match(error.message, /generateContent failed \(HTTP 403\)/)
        assert.ok(!error.message.includes(fakeKey))
        return true
      })
    } else {
      const result = await runGeminiBaseline()
      assert.equal(result.ok, outcome === 'success')
      if (outcome === 'success') assert.equal(result.text, 'A pipe organ.')
      else assert.equal(result.blockReason, 'SAFETY')
    }
    assert.equal(calls.length, 4)
    assert.deepEqual(calls.at(-1), { path: '/v1beta/files/baseline-test', method: 'DELETE' })
  })
}

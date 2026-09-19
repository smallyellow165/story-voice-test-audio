import assert from 'node:assert/strict'
import test from 'node:test'
import { FishAudioError } from 'fish-audio'
import { fishPublicError, generateFishAudio } from '../server/fish-tts.mjs'

const setEnv = (t, key, value) => {
  const previous = process.env[key]
  process.env[key] = value
  t.after(() => {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  })
}

test('Fish missing configuration fails before calling the provider', async (t) => {
  setEnv(t, 'FISH_AUDIO_API_KEY', '')
  setEnv(t, 'FISH_AUDIO_MODEL_ID', '')
  await assert.rejects(generateFishAudio('Hello'), { code: 'FISH_CONFIG_REQUIRED' })
})

test('Fish API errors preserve HTTP status and details but redact credentials and reference', (t) => {
  setEnv(t, 'FISH_AUDIO_API_KEY', 'test-api-key')
  setEnv(t, 'FISH_AUDIO_MODEL_ID', 'test-reference-id')
  const result = fishPublicError(new FishAudioError({
    statusCode: 403,
    body: { detail: 'Access denied for test-reference-id with test-api-key' },
  }))
  assert.equal(result.statusCode, 403)
  assert.match(result.message, /Access denied/)
  assert.ok(!result.message.includes('test-api-key'))
  assert.ok(!result.message.includes('test-reference-id'))
})

test('Fish unexpected errors do not expose raw request or filesystem details', () => {
  const result = fishPublicError(new Error('private request data'))
  assert.equal(result.statusCode, 500)
  assert.ok(!result.message.includes('private request data'))
})

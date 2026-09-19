import { createHash } from 'node:crypto'
import { FishAudioClient, FishAudioError, FishAudioTimeoutError } from 'fish-audio'

export const fishModel = 's2.1-pro-free'

export const generateFishAudio = async (text) => {
  const apiKey = process.env.FISH_AUDIO_API_KEY?.trim()
  const referenceId = process.env.FISH_AUDIO_MODEL_ID?.trim()
  if (!apiKey || !referenceId) {
    const error = new Error('Set FISH_AUDIO_API_KEY and FISH_AUDIO_MODEL_ID on the server.')
    error.code = 'FISH_CONFIG_REQUIRED'
    throw error
  }
  const client = new FishAudioClient({ apiKey })
  // SDK 0.1.0 forwards convert's second argument directly to the HTTP model header.
  // Its older TypeScript backend union does not list the current free API model.
  const audio = await client.textToSpeech.convert(
    { text, reference_id: referenceId, format: 'mp3' },
    fishModel,
    { maxRetries: 0, timeoutInSeconds: 120, abortSignal: AbortSignal.timeout(120_000) },
  )
  // Buffer the complete response for the existing offline file/history flow.
  const audioContent = Buffer.from(await new Response(audio).arrayBuffer())
  if (!audioContent.length) throw new Error('Fish Audio returned empty audio.')
  return {
    audioContent,
    model: fishModel,
    // Stable voice identity even if the configured reference changes, without exposing it.
    voice: `fish-${createHash('sha256').update(referenceId).digest('hex').slice(0, 12)}`,
  }
}

export const fishPublicError = (error) => {
  if (error?.code === 'FISH_CONFIG_REQUIRED') {
    return { statusCode: 503, code: error.code, message: error.message }
  }
  if (error instanceof FishAudioError || error instanceof FishAudioTimeoutError) {
    let message = error.message || 'Fish Audio request failed.'
    for (const value of [process.env.FISH_AUDIO_API_KEY, process.env.FISH_AUDIO_MODEL_ID]) {
      if (value?.trim()) message = message.split(value.trim()).join('[redacted]')
    }
    return {
      statusCode: error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 502,
      code: 'FISH_TTS_REQUEST_FAILED',
      message: `Fish Audio: ${message}`,
    }
  }
  return { statusCode: 500, code: 'FISH_AUDIO_SAVE_FAILED', message: 'Fish audio could not be generated or saved. Check server connectivity, ffprobe, and generated directory write access.' }
}

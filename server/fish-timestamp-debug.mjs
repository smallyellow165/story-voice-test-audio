import { fishModel } from './fish-tts.mjs'

export const timestampEndpoint = 'https://api.fish.audio/v1/tts/stream/with-timestamp'
const fail = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode, debugPublic: true })

// SSE framing is independent of network chunks, including split UTF-8 and CRLF.
export async function* sseMessages(body) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = '', data = [], event = '', total = 0
  for await (const bytes of body) {
    total += bytes.length
    if (total > 32 * 1024 * 1024) throw fail('Debug response exceeds 32 MiB.')
    buffer += decoder.decode(bytes, { stream: true })
    let match
    while ((match = /\r\n|\r|\n/.exec(buffer))) {
      if (match[0] === '\r' && match.index === buffer.length - 1) break
      const line = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      if (line === '') {
        if (data.length) yield { event: event || 'message', data: data.join('\n') }
        data = []; event = ''
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'data') data.push(value)
        if (field === 'event') event = value
      }
    }
  }
  buffer += decoder.decode()
  // A final CR is a valid newline. Complete the final event only if delimited.
  if (buffer === '\r' && data.length) {
    yield { event: event || 'message', data: data.join('\n') }
    data = []; buffer = ''
  }
  if (data.length || buffer.trim()) throw fail('Incomplete SSE event at end of response.')
}

const seconds = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
export async function collectTimestampAudio(body) {
  const audio = [], events = [], byChunk = new Map()
  for await (const message of sseMessages(body)) {
    if (message.event === 'error') throw fail('Fish timestamp stream reported an error.')
    if (message.data === '[DONE]') continue
    let value
    try { value = JSON.parse(message.data) } catch { throw fail('Invalid JSON in Fish SSE event.') }
    if (!value || value.error || typeof value.audio_base64 !== 'string' ||
        !Number.isInteger(value.chunk_seq) || value.chunk_seq < 0 ||
        !seconds(value.chunk_audio_offset_sec) || typeof value.content !== 'string') {
      throw fail('Invalid Fish timestamp event structure.')
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.audio_base64)) {
      throw fail('Invalid audio base64 in Fish SSE event.')
    }
    let alignment = null
    if (value.alignment != null) {
      if (!Array.isArray(value.alignment.segments) || !seconds(value.alignment.audio_duration)) {
        throw fail('Invalid alignment structure.')
      }
      alignment = { audio_duration: value.alignment.audio_duration,
        segments: value.alignment.segments.map(segment => {
          if (typeof segment.text !== 'string' || !seconds(segment.start) ||
              !seconds(segment.end) || segment.end < segment.start) throw fail('Invalid alignment segment.')
          return { text: segment.text, start: segment.start, end: segment.end }
        }) }
    }
    const bytes = Buffer.from(value.audio_base64, 'base64')
    audio.push(bytes) // Includes audio whose alignment is null/repeated; never deduplicate audio.
    const snapshot = { chunk_seq: value.chunk_seq, chunk_audio_offset_sec: value.chunk_audio_offset_sec,
      content: value.content, alignment }
    events.push({ ...snapshot, audio_bytes: bytes.length })
    if (alignment !== null || !byChunk.has(value.chunk_seq)) byChunk.set(value.chunk_seq, snapshot)
  }
  const audioContent = Buffer.concat(audio)
  if (!audioContent.length) throw fail('Fish timestamp response contained no audio.')
  const chunks = [...byChunk.values()].sort((a, b) => a.chunk_seq - b.chunk_seq)
  // Official contract: segment times are chunk-local seconds, not global.
  const timeline = chunks.flatMap(chunk => (chunk.alignment?.segments ?? []).map(segment => ({
    text: segment.text, local_start: segment.start, local_end: segment.end,
    chunk_seq: chunk.chunk_seq, chunk_offset: chunk.chunk_audio_offset_sec,
    global_start: segment.start + chunk.chunk_audio_offset_sec,
    global_end: segment.end + chunk.chunk_audio_offset_sec,
  })))
  return { audioContent, events, chunks, timeline }
}

export async function generateFishTimestamp(text, speed = 1, config = {}) {
  if (typeof text !== 'string' || !text.trim()) throw fail('Text is required.', 400)
  if (Buffer.byteLength(text, 'utf8') > 8000) throw fail('Text exceeds 8000 UTF-8 bytes.', 400)
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw fail('Speed must be a number between 0.5 and 2.0.', 400)
  }
  const apiKey = process.env.FISH_AUDIO_API_KEY?.trim()
  const referenceId = config.referenceId ?? process.env.FISH_AUDIO_MODEL_ID?.trim()
  const model = config.model ?? fishModel
  if (!apiKey || !referenceId) throw fail('Server Fish Audio configuration is missing.', 503)
  const response = await fetch(timestampEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, model,
      'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ text, reference_id: referenceId, format: 'mp3', prosody: { speed } }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw fail(`Fish timestamp API returned HTTP ${response.status}.`, response.status)
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel()
    throw fail('Fish timestamp API did not return text/event-stream.')
  }
  const { audioContent, ...alignment } = await collectTimestampAudio(response.body)
  return { text, speed, model, endpoint: timestampEndpoint, format: 'audio/mpeg',
    timestamp_semantics: 'global seconds = chunk-local seconds + chunk_audio_offset_sec',
    bytes: audioContent.length, audio_base64: audioContent.toString('base64'), ...alignment }
}

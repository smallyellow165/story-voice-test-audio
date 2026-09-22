// Isolated one-request probe; does not update app history or production code.
// Run: node --env-file-if-exists=.env scripts/inspect-fish-timing.mjs
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { FishAudioClient } from 'fish-audio'
import { fishModel } from '../server/fish-tts.mjs'
import { probeAudioDuration } from '../server/audio-duration.mjs'

const apiKey = process.env.FISH_AUDIO_API_KEY?.trim()
const referenceId = process.env.FISH_AUDIO_MODEL_ID?.trim()
if (!apiKey || !referenceId) throw new Error('Missing FISH_AUDIO_API_KEY or FISH_AUDIO_MODEL_ID')
const root = fileURLToPath(new URL('../', import.meta.url))
const parent = path.join(root, 'generated', 'fish-timing-probe')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(path.join(parent, 'run-'))
const text = '到了狸猫叔叔家。狸猫叔叔说：'
const report = {
  sdk: JSON.parse(await readFile(path.join(root, 'node_modules/fish-audio/package.json'), 'utf8')).version,
  text,
  request: { method: 'POST', endpoint: 'https://api.fish.audio/v1/tts',
    contentType: 'application/msgpack', model: fishModel,
    bodyFields: ['text', 'reference_id', 'format'], format: 'mp3', reference_id: '[redacted]' },
}
try {
  const result = await new FishAudioClient({ apiKey }).textToSpeech.convert(
    { text, reference_id: referenceId, format: 'mp3' }, fishModel,
    { maxRetries: 0, timeoutInSeconds: 120, abortSignal: AbortSignal.timeout(120_000) },
  ).withRawResponse()
  const { data, rawResponse } = result
  const allowedHeaders = ['content-type', 'content-length', 'transfer-encoding', 'content-encoding', 'trailer']
  report.response = {
    wrapperKeys: Object.keys(result), status: rawResponse.status,
    headerNames: [...rawResponse.headers.keys()],
    headers: Object.fromEntries(allowedHeaders.map(key => [key, rawResponse.headers.get(key)])),
    streamType: data.constructor.name,
    // Never serialize the raw Response/request: it could contain credentials.
  }
  const chunks = []
  report.chunks = []
  for await (const chunk of data) {
    const nonIndexKeys = Object.keys(chunk).filter(key => !/^\d+$/.test(key))
    report.chunks.push({ index: chunks.length, type: chunk.constructor.name,
      bytes: chunk.byteLength, metadataKeys: nonIndexKeys })
    if (!(chunk instanceof Uint8Array)) throw new Error('Unexpected non-binary chunk')
    chunks.push(Buffer.from(chunk))
  }
  const audio = Buffer.concat(chunks)
  report.bytes = audio.length
  report.first16BytesHex = audio.subarray(0, 16).toString('hex')
  const audioPath = path.join(directory, 'response.mp3')
  await writeFile(audioPath, audio)
  report.durationSecondsFromLocalFfprobe = await probeAudioDuration(audioPath)
  report.timingFieldsInSdkChunks = []
  report.note = 'Local file duration and transport chunk sizes are not text-to-audio alignment.'
} catch (error) {
  // Whitelist error fields, never dump the SDK error or request object.
  report.error = { name: error.name, statusCode: error.statusCode ?? null }
  process.exitCode = 1
}
const serialized = JSON.stringify(report, null, 2)
await writeFile(path.join(directory, 'response-structure.json'), serialized + '\n')
console.log(serialized)
console.log('Artifacts:', directory)

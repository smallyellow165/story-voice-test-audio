import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { generateFishTimestamp, timestampEndpoint } from './fish-timestamp-debug.mjs'
import { fishModel } from './fish-tts.mjs'
import { cleanAlignment } from '../src/fish-clean-alignment.mjs'
import { probeAudioDuration } from './audio-duration.mjs'
const sha = data => createHash('sha256').update(data).digest('hex')
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode, debugPublic: true })
export const historyKey = request => sha(JSON.stringify(request))
const publicMetadata = ({ request, checksums, ...metadata }) => metadata

export function createTimestampHistory(root, { generate = generateFishTimestamp, probe = probeAudioDuration } = {}) {
  const pending = new Map()
  function serial(key, action) {
    const job = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(action)
    pending.set(key, job)
    job.finally(() => { if (pending.get(key) === job) pending.delete(key) }).catch(() => {})
    return job
  }
  async function read(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) return null
    try {
      const dir = path.join(root, key)
      const metadata = JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf8'))
      if (metadata.cache_key !== key || historyKey(metadata.request) !== key || !Number.isFinite(metadata.duration) || metadata.duration <= 0) return null
      if (typeof metadata.created_at !== 'string' || !Number.isFinite(Date.parse(metadata.created_at)) ||
          metadata.text !== metadata.request.text || metadata.speed !== metadata.request.speed || metadata.model !== metadata.request.model ||
          metadata.voice !== `fish-${sha(metadata.request.reference_id).slice(0, 12)}`) return null
      const files = await Promise.all(['audio.mp3', 'alignment.json', 'debug.json'].map(name => readFile(path.join(dir, name))))
      if (!files[0].length || files.some((data, i) => sha(data) !== metadata.checksums[['audio.mp3','alignment.json','debug.json'][i]])) return null
      const alignment = JSON.parse(files[1]), debug = JSON.parse(files[2])
      if (!Array.isArray(debug.events) || !Array.isArray(debug.chunks) ||
          JSON.stringify(cleanAlignment(debug, 'audio.mp3', metadata.duration)) !== JSON.stringify(alignment)) return null
      if (debug.text !== metadata.request.text || debug.speed !== metadata.request.speed || debug.model !== metadata.request.model) return null
      return { metadata, result: { ...debug, audio_base64: files[0].toString('base64'), clean_alignment: alignment } }
    } catch { return null }
  }
  const response = (entry, source) => ({ ...entry.result, history: { ...publicMetadata(entry.metadata), source } })
  async function generateEntry(request, key) {
    console.log(`[fish-timestamp] FISH_REQUEST key=${key}`)
    const generated = await generate(request.text, request.speed, { referenceId: request.reference_id, model: request.model })
    const { audio_base64, ...debug } = generated
    const audio = Buffer.from(audio_base64, 'base64')
    if (!audio.length) throw fail('Fish returned empty audio.', 502)
    await mkdir(root, { recursive: true })
    const stage = path.join(root, `.pending-${randomUUID()}`)
    const destination = path.join(root, key), backup = path.join(root, `.previous-${randomUUID()}`)
    await mkdir(stage)
    let moved = false
    try {
      await writeFile(path.join(stage, 'audio.mp3'), audio)
      const duration = await probe(path.join(stage, 'audio.mp3'))
      const alignment = cleanAlignment(debug, 'audio.mp3', duration)
      const alignmentJson = JSON.stringify(alignment, null, 2), debugJson = JSON.stringify(debug, null, 2)
      const metadata = { cache_key: key, text: request.text, voice: `fish-${sha(request.reference_id).slice(0, 12)}`,
        model: request.model, speed: request.speed, created_at: new Date().toISOString(), duration,
        request, checksums: { 'audio.mp3': sha(audio), 'alignment.json': sha(alignmentJson), 'debug.json': sha(debugJson) } }
      await writeFile(path.join(stage, 'alignment.json'), alignmentJson)
      await writeFile(path.join(stage, 'debug.json'), debugJson)
      await writeFile(path.join(stage, 'metadata.json'), JSON.stringify(metadata, null, 2))
      try { await rename(destination, backup); moved = true } catch (error) { if (error.code !== 'ENOENT') throw error }
      try { await rename(stage, destination) } catch (error) {
        if (moved) await rename(backup, destination)
        throw error
      }
      if (moved) await rm(backup, { recursive: true, force: true })
      console.log(`[fish-timestamp] SAVED key=${key}`)
      return response({ metadata, result: { ...debug, audio_base64, clean_alignment: alignment } }, 'generated')
    } finally { await rm(stage, { recursive: true, force: true }) }
  }
  return {
    async generate(text, speed = 1, force = false) {
      if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 8000) throw fail('Text is required, up to 8000 UTF-8 bytes.', 400)
      if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < .5 || speed > 2) throw fail('Speed must be between 0.5 and 2.0.', 400)
      if (typeof force !== 'boolean') throw fail('regenerate must be boolean.', 400)
      const referenceId = process.env.FISH_AUDIO_MODEL_ID?.trim()
      if (!referenceId) throw fail('Server Fish voice configuration is missing.', 503)
      // Fixed insertion order; extend/version this request when synthesis parameters change.
      const request = { version: 1, text, reference_id: referenceId, model: fishModel, speed, format: 'mp3', endpoint: timestampEndpoint }
      const key = historyKey(request)
      return serial(key, async () => {
        const cached = !force && await read(key)
        if (cached) { console.log(`[fish-timestamp] HIT key=${key}`); return response(cached, 'history') }
        return generateEntry(request, key)
      })
    },
    async load(key) {
      return serial(key, async () => {
        const entry = await read(key)
        if (!entry) throw fail('History entry missing, incomplete or corrupt. Generate again.', 404)
        console.log(`[fish-timestamp] LOAD key=${key}`)
        return response(entry, 'history')
      })
    },
    async regenerate(key) {
      return serial(key, async () => {
        const entry = await read(key)
        if (!entry) throw fail('History entry missing or corrupt. Generate again using the form.', 404)
        return generateEntry(entry.metadata.request, key)
      })
    },
    async list() {
      let names
      try { names = await readdir(root) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
      const entries = await Promise.all(names.filter(name => /^[a-f0-9]{64}$/.test(name)).map(key => serial(key, () => read(key))))
      return entries.filter(Boolean).map(e => publicMetadata(e.metadata)).sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,30)
    },
  }
}

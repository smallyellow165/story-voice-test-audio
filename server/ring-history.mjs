import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { validateRings } from './gemini-rings.mjs'

export function createRingHistory(directory) {
  const summary = run => ({ id: run.id, createdAt: run.createdAt, strategy: run.strategy,
    model: run.model, ringCount: run.rings.length, width: run.width, height: run.height })
  async function load(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error('Invalid history ID'), { statusCode: 400 })
    try { return JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8')) }
    catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('History not found'), { statusCode: 404 })
      throw error
    }
  }
  return {
    load,
    async renameRings(id, names) {
      const run = await load(id)
      if (!names || typeof names !== 'object' || Array.isArray(names)
        || Object.entries(names).some(([key, value]) => !run.rings.some(r => r.id === key)
          || typeof value !== 'string' || value.length > 80)) {
        throw Object.assign(new Error('Invalid ring names (maximum 80 characters).'), { statusCode: 400 })
      }
      run.ringNames = Object.fromEntries(Object.entries(names).map(([key, value]) => [key, value.trim()]))
      const file = path.join(directory, `${id}.json`), temp = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, JSON.stringify(run), { flag: 'wx', mode: 0o600 })
        await rename(temp, file)
      } finally { await rm(temp, { force: true }) }
      return { id: run.id, ringNames: run.ringNames }
    },
    async list() {
      await mkdir(directory, { recursive: true })
      const runs = []
      for (const name of await readdir(directory)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue
        runs.push(summary(await load(name.slice(0, -5))))
      }
      return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async save(result, input) {
      validateRings(result)
      if (result.error || !Number.isInteger(input.width) || !Number.isInteger(input.height)
        || input.width <= 0 || input.height <= 0) throw new Error('Cannot save invalid detection')
      const run = { id: randomUUID(), createdAt: new Date().toISOString(), strategy: 'gemini',
        model: result.model, modelVersion: result.modelVersion, rings: result.rings,
        width: input.width, height: input.height, rawJson: result.rawJson,
        snapshot: { mimeType: input.mimeType, imageBase64: input.imageBase64 },
        mapping: 'Normalized coordinates over the entire snapshot; x * width, y * height.' }
      await mkdir(directory, { recursive: true })
      const file = path.join(directory, `${run.id}.json`), temp = `${file}.tmp`
      try {
        await writeFile(temp, JSON.stringify(run), { flag: 'wx', mode: 0o600 })
        await rename(temp, file)
      } finally { await rm(temp, { force: true }) }
      return summary(run)
    },
  }
}

import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { validateImage } from './brick-image-validation.mjs'

const fail = message => { throw Object.assign(new Error(message), { statusCode: 422 }) }
export function createSourceImageStore(directory) {
  function file(imageId) {
    if (typeof imageId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(imageId)) fail('Source Image V1 imageId 缺失或无效；需独立数据修复，不会自动推断')
    return path.join(directory, imageId.slice(7) + '.json')
  }
  async function read(imageId) {
    let record
    try { record = JSON.parse(await readFile(file(imageId), 'utf8')) }
    catch (error) {
      if (error.code === 'ENOENT') fail('Canonical Source Image 不存在；需独立数据修复')
      throw error
    }
    const original = validateImage(record.original)
    if (record.schemaVersion !== 1 || record.imageId !== imageId || 'sha256:' + original.sha256 !== imageId
      || record.original.byteLength !== original.bytes) fail('Canonical Source Image 完整性校验失败')
    return record
  }
  async function put(input) {
    const original = validateImage(input), imageId = 'sha256:' + original.sha256
    const record = { schemaVersion: 1, imageId, original: {
      mimeType: original.mimeType, byteLength: original.bytes, imageBase64: Buffer.from(original.imageBase64, 'base64').toString('base64'),
    } }
    await mkdir(directory, { recursive: true })
    const target = file(imageId), temp = target + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
      // Publish a complete immutable record atomically, without replacing another writer.
      try { await link(temp, target) } catch (error) { if (error.code !== 'EEXIST') throw error }
    } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    const saved = await read(imageId)
    if (saved.original.mimeType !== original.mimeType) fail('Source Image MIME 不一致')
    return saved
  }
  async function verifyAnalysis(analysis) {
    const source = await read(analysis.sourceImageId)
    const original = validateImage(analysis.originalImage)
    if ('sha256:' + original.sha256 !== source.imageId || original.mimeType !== source.original.mimeType)
      fail('Analysis 原图与 Canonical Source Image 不一致')
    return source
  }
  return { read, put, verifyAnalysis }
}

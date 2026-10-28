import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { validateReverseAnalysis } from './brick-reverse.mjs'
import { validateGeometryAnalysis } from './brick-reverse-geometry.mjs'
import { validateRecognition } from './brick-vision.mjs'

const fail = (message, statusCode = 422) => { throw Object.assign(new Error(message), { statusCode }) }
// A mutable relationship beside immutable Source Images. Missing relationship means
// no explicit choice; an existing invalid relationship is never repaired or ignored.
export function createSelectedAnalysisStore(directory, { sourceImages, reverse, vision }) {
  async function validate(imageId, analysisKind, analysisId) {
    if (!['reverse', 'inventory'].includes(analysisKind) || typeof analysisId !== 'string' || !/^[a-f0-9-]{36}$/.test(analysisId)) fail('无效 Analysis 引用')
    const r = await (analysisKind === 'reverse' ? reverse.read(analysisId) : vision.historyRecord(analysisId))
    if (r.id !== analysisId || r.status !== 'complete' || r.sourceImageId !== imageId) fail('Analysis 必须成功且属于当前 Source Image')
    await sourceImages.verifyAnalysis(r)
    if (analysisKind === 'reverse') {
      if (r.kind !== 'reverse-analysis' || !['geometry_only', 'catalog_match'].includes(r.analysis_mode) || !['full', 'today', 'virtual'].includes(r.source?.kind)) fail('Analysis 正式结构无效')
      ;(r.analysis_mode === 'geometry_only' ? validateGeometryAnalysis : validateReverseAnalysis)(r.analysis)
    } else {
      if (r.mode !== 'inventory') fail('不是库存 Analysis')
      validateRecognition(r.recognition)
    }
  }
  const file = imageId => path.join(directory, imageId.slice(7) + '.json')
  async function read(imageId) {
    await sourceImages.read(imageId)
    let bytes
    try { bytes = await readFile(file(imageId), 'utf8') }
    catch (e) {
      if (e.code === 'ENOENT') return { schemaVersion: 1, imageId, selectedAnalysisId: null, analysisKind: null, revision: 0 }
      throw e
    }
    let r
    try { r = JSON.parse(bytes) } catch { fail('Selected Analysis 记录损坏') }
    if (r.schemaVersion !== 1 || r.imageId !== imageId || !Number.isSafeInteger(r.revision) || r.revision < 1) fail('Selected Analysis 结构无效')
    await validate(imageId, r.analysisKind, r.selectedAnalysisId)
    return r
  }
  async function select(imageId, { analysisId, analysisKind, expectedRevision }) {
    await sourceImages.read(imageId)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('必须提供有效选择版本')
    await mkdir(directory, { recursive: true })
    const target = file(imageId), lock = target + '.lock', temp = target + '.' + randomUUID() + '.tmp'
    try { await writeFile(lock, '', { flag: 'wx', mode: 0o600 }) }
    catch (e) { if (e.code === 'EEXIST') fail('选择正在更新，请刷新选择状态后重试；若持续出现，请检查服务锁文件', 409); throw e }
    try {
      const current = await read(imageId)
      if (current.revision !== expectedRevision) fail('选择已被其他页面更新，请刷新选择状态后再明确选择', 409)
      await validate(imageId, analysisKind, analysisId)
      const r = { schemaVersion: 1, imageId, selectedAnalysisId: analysisId, analysisKind, revision: current.revision + 1 }
      await writeFile(temp, JSON.stringify(r), { flag: 'wx', mode: 0o600 })
      await rename(temp, target)
      return r
    } finally {
      await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e })
      await unlink(lock)
    }
  }
  return { read, select }
}

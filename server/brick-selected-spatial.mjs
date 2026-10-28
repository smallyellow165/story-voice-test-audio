import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { planView } from './brick-spatial-workflow.mjs'
import { validateImage } from './brick-image-validation.mjs'
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const fail = (message, statusCode = 422) => { throw Object.assign(new Error(message), { statusCode }) }
const check = (ok, message) => { if (!ok) fail(message) }
export function createSelectedSpatialStore(directory, { reverse, sourceImages }) {
  const folder = path.join(directory, 'brick-spatial-plan-choices')
  async function inspect(planId) {
    check(uuid.test(planId || ''), 'Spatial Plan ID 无效')
    const r = JSON.parse(await readFile(path.join(directory, 'brick-spatial-traces', planId + '.json'), 'utf8'))
    check(r.id === planId && r.task === 'spatial-planning', 'Spatial 记录身份不一致')
    const p = r.requestInput?.provenance
    check(p && uuid.test(p.analysisId) && uuid.test(p.reviewId) && /^[a-f0-9]{64}$/.test(p.reviewVersion) && typeof p.savedReviewAt === 'string', '历史输入缺少明确 Analysis / Review / Mapping 身份，不能建立选择范围')
    const a = await reverse.read(p.analysisId)
    check(a.id === p.analysisId && a.kind === 'reverse-analysis' && a.status === 'complete', 'Analysis 来源不完整')
    await sourceImages.verifyAnalysis(a)
    check(Array.isArray(r.sources) && r.sources.length === 1, '规划来源必须明确且唯一')
    const source = r.sources[0]
    check(source.analysisId === p.analysisId && source.reviewVersion === p.reviewVersion && source.mappingReviewId === p.reviewId && source.mappingReview?.id === p.reviewId && Array.isArray(source.mappingReview?.mapping?.rows), '历史 Review / Mapping 快照引用冲突或缺失')
    check(Array.isArray(r.requestInput.observations) && r.requestInput.observations.length > 0, '实际规划输入快照缺失')
    const mappingRows = source.mappingReview.mapping.rows
    check(mappingRows.length > 0, 'Mapping 快照为空')
    const counts = new Map()
    for (const o of r.requestInput.observations) {
      const matches = mappingRows.filter(m => m.source?.part_num === o.confirmedPart?.part_num && m.source?.color_id === o.confirmedPart?.color_id)
      check(matches.length === 1 && o.mapping?.reviewId === p.reviewId, '实际输入的 Mapping / 零件来源不一致')
      const m = matches[0]
      check(Array.isArray(m.errors) && m.errors.length === 0 && m.target?.part === o.part && m.target?.color === o.color && o.mapping.target?.part === o.part && o.mapping.target?.color === o.color, 'Mapping 快照与实际规划零件不一致')
      counts.set(m, (counts.get(m) || 0) + 1)
    }
    check(mappingRows.every(m => counts.get(m) === m.source.quantity), 'Mapping 数量与实际输入实例不一致')
    const image = validateImage(r.image)
    check(image.sha256 === r.imagePayloadSha256 && [validateImage(a.originalImage).sha256, validateImage(a.image).sha256].includes(image.sha256), '规划图片来源 hash 不一致')
    // Exact immutable input scope; model/prompt/run/output IDs are NOT input identity.
    // Mapping identity is retained, even when two mappings look similar.
    const identity = { schemaVersion: 1, sourceImageId: a.sourceImageId, analysisId: a.id,
      reviewVersion: p.reviewVersion, mappingReviewId: p.reviewId,
      mappingSnapshotHash: hash(source.mappingReview), inputSnapshotHash: hash(r.requestInput), imagePayloadSha256: image.sha256 }
    return { planId, selectionKey: 'sha256:' + hash(identity), identity, eligible: planView(r).usable, status: r.status }
  }
  const file = key => path.join(folder, key.slice(7) + '.json')
  async function relation(scope) {
    let bytes
    try { bytes = await readFile(file(scope.selectionKey), 'utf8') }
    catch (e) { if (e.code === 'ENOENT') return { schemaVersion: 1, selectionKey: scope.selectionKey, identity: scope.identity, selectedSpatialPlanId: null, revision: 0 }; throw e }
    let saved
    try { saved = JSON.parse(bytes) } catch { fail('Selected Spatial 记录损坏') }
    check(saved.schemaVersion === 1 && saved.selectionKey === scope.selectionKey && hash(saved.identity) === hash(scope.identity) && Number.isSafeInteger(saved.revision) && saved.revision > 0, 'Selected Spatial 选择关系无效')
    const target = await inspect(saved.selectedSpatialPlanId)
    check(target.selectionKey === scope.selectionKey && target.eligible, '已选 Spatial 的来源或正式校验已失效；需人工检查')
    return saved
  }
  async function read(planId) {
    const scope = await inspect(planId)
    return { ...scope, choice: await relation(scope) }
  }
  async function select(planId, body) {
    const scope = await inspect(planId)
    check(scope.eligible, '此 Spatial 未满足现有正式 Plan Validator / 输出状态条件')
    check(body?.selectionKey === scope.selectionKey, '规划输入已变化或选择范围不一致')
    check(Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0, '选择版本无效')
    await mkdir(folder, { recursive: true })
    const target = file(scope.selectionKey), lock = target + '.lock', temp = target + '.' + randomUUID() + '.tmp'
    try { await writeFile(lock, '', { flag: 'wx', mode: 0o600 }) }
    catch (e) { if (e.code === 'EEXIST') fail('选择正在更新；请重新读取后明确选择。持续冲突需检查锁文件', 409); throw e }
    try {
      const current = await relation(scope)
      if (current.revision !== body.expectedRevision) fail('选择已被其他页面更新；请重新读取后明确选择', 409)
      const checked = await inspect(planId)
      check(checked.selectionKey === scope.selectionKey && checked.eligible, '写入前来源或校验已变化')
      const choice = { schemaVersion: 1, selectionKey: scope.selectionKey, identity: scope.identity, selectedSpatialPlanId: planId, revision: current.revision + 1 }
      await writeFile(temp, JSON.stringify(choice), { flag: 'wx', mode: 0o600 }); await rename(temp, target)
      return { ...scope, choice }
    } finally {
      try { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e }) } finally { await unlink(lock) }
    }
  }
  return { read, select, inspect }
}

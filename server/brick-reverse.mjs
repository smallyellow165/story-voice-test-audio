import { reverseFeatureEditor } from '../src/brick-vision/reverse-review.mjs'
import { reviseAnchorReference } from './brick-reverse-revision.mjs'
import { inspectGeometryOutput } from './brick-reverse-output.mjs'
import { reversePrompts, selectReversePrompt } from './brick-reverse-prompts.mjs'
import { geometrySchema, validateGeometryAnalysis } from './brick-reverse-geometry.mjs'
// Reverse orchestration only; Catalog, Mapping, geometry and validation stay shared.
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import {reviewObservations, validateReviewParts} from '../src/brick-vision/review-parts.mjs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parseSession } from '../src/brick-inventory/inventory.ts'
import { catalogFeatureParams, validateCatalogFeatures, validateCatalogQuery, visionFeatureProperties, featureEditor, readFeatureEditor, validateReviewDimensions } from '../src/brick-vision/catalog-features.mjs'
import { catalog } from './brick-games.mjs'
import { loadBrickRules, geometrySnapshot } from './brick-rules.mjs'
import { validateImage, visionErrorDiagnostic } from './brick-vision.mjs'
import { resolveModel, modelSettings } from './brick-model-registry.mjs'
import { callBrickModel } from './brick-model-call.mjs'
import { buildOpenaiRequest } from './openai-responses.mjs'
import { captureVisionWire } from './brick-vision-wire.mjs'
import { generateBrickDesign, validateGeneratorInput, validateBrickDesign } from './brick-generator.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }
const text = { type: 'STRING' }
const obj = properties => ({ type: 'OBJECT', properties, required: Object.keys(properties) })
const list = items => ({ type: 'ARRAY', items })
export const reverseSchema = obj({
  appearance: text, unknowns: list(text),
  observations: list(obj({ id: text, ...visionFeatureProperties, quantity: { type: 'INTEGER' },
    bbox: { type: 'ARRAY', items: { type: 'NUMBER' }, nullable: true }, confidence: { type: 'NUMBER' },
    visible_studs: { type: 'INTEGER', nullable: true }, evidence: text, occlusion: text })),
  relations: list(obj({ from: text, to: text, relation: { type: 'STRING', enum: ['above', 'below', 'left', 'right', 'front', 'behind', 'connected', 'unknown'] },
    confidence: { type: 'NUMBER' }, evidence: text })),
})
export const reversePrompt = reversePrompts.catalog_match.text
export function validateReverseAnalysis(value) {
  if (!value || typeof value.appearance !== 'string' || value.appearance.length > 2000 || !Array.isArray(value.unknowns)
    || value.unknowns.some(s => typeof s !== 'string' || s.length > 2000) || !Array.isArray(value.observations)
    || !value.observations.length || value.observations.length > 20 || !Array.isArray(value.relations) || value.relations.length > 200) fail('Reverse 分析结构无效。', 422)
  const ids = new Set()
  const confidence = n => Number.isFinite(n) && n >= 0 && n <= 1
  for (const o of value.observations) {
    validateCatalogFeatures(o)
    if (typeof o.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(o.id) || ids.has(o.id)
      || !Number.isSafeInteger(o.quantity) || o.quantity < 1 || o.quantity > 100 || !confidence(o.confidence)
      || !(o.visible_studs === null || Number.isSafeInteger(o.visible_studs) && o.visible_studs >= 0)
      || typeof o.evidence !== 'string' || typeof o.occlusion !== 'string'
      || !(o.bbox === null || Array.isArray(o.bbox) && o.bbox.length === 4 && o.bbox.every(confidence) && o.bbox[0] < o.bbox[2] && o.bbox[1] < o.bbox[3])) fail('Reverse Observation 无效。', 422)
    ids.add(o.id)
  }
  for (const r of value.relations) if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to
    || !['above','below','left','right','front','behind','connected','unknown'].includes(r.relation)
    || !confidence(r.confidence) || typeof r.evidence !== 'string') fail('Reverse 相对关系无效。', 422)
  return value
}
export function enforceSource(source, items, mapped) {
  if (source.kind === 'today') for (const item of items) {
    const allowed = source.session.items.find(r => r.part_num === item.part_num && r.color_id === item.color_id)
    if (!allowed || item.quantity > allowed.quantity) fail('确认的 Rebrickable 型号、颜色或总数量超出所选库存。')
  }
  if (source.kind === 'virtual') for (const item of mapped) {
    const allowed = source.inventory.find(r => r.part === item.part && r.color === item.color)
    if (!allowed || item.quantity > allowed.quantity) fail('官方映射后的型号、颜色或总数量超出虚拟库存。')
  }
}
export function createBrickReverse(directory, { games, getCatalog = catalog, loadRules = loadBrickRules, callModel = callBrickModel, generate = generateBrickDesign } = {}) {
  const file = id => {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) fail('Reverse ID 无效。')
    return path.join(directory, id + '.json')
  }
  const read = async id => {
    try {
      const value = JSON.parse(await readFile(file(id), 'utf8'))
      if (value.kind === 'reverse-design' && value.status === 'complete') {
        const rules = await loadRules()
        if (!value.generation?.ok || hash(value.generation.design) !== value.designHash
          || JSON.stringify(value.generation.requestInput?.inventory) !== JSON.stringify(value.generatorInput.inventory)
          || JSON.stringify(value.geometrySnapshot) !== JSON.stringify(geometrySnapshot(rules, value.generatorInput.inventory))
          || !validateBrickDesign(value.generation.design, value.generatorInput.inventory, rules).valid) fail('Reverse Artifact 与当前几何或设计校验不一致，拒绝应用。', 422)
      }
      if (value.kind === 'reverse-analysis' && value.status === 'failed') value.outputValidation = inspectGeometryOutput(value)
      return value
    }
    catch (e) { if (e.code === 'ENOENT') fail('Reverse 记录不存在。', 404); throw e }
  }
  const save = async value => {
    await mkdir(directory, { recursive: true })
    const target = file(value.id), temp = target + '.' + randomUUID() + '.tmp'
    await writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temp, target)
  }
  const lock = async id => {
    await mkdir(directory, { recursive: true })
    try { await writeFile(file(id) + '.lock', new Date().toISOString(), { flag: 'wx', mode: 0o600 }) }
    catch (e) { if (e.code === 'EEXIST') fail('此请求已提交；未重复调用模型。请查看已有诊断，或明确建立新分析。', 409); throw e }
  }
  const analyzed = async id => {
    const record = await read(id)
    if (record.kind !== 'reverse-analysis' || record.status !== 'complete') fail('Reverse 分析未成功。')
    return record
  }
  return {
    read,
    async revalidate(body) {
      const record = await read(body.analysisId)
      const report = inspectGeometryOutput(record)
      if (!report) fail('此记录没有可离线校验的 Geometry Raw Output。', 422)
      return report
    },

    async revise(body) {
      const source = await read(body.analysisId)
      if (source.kind !== 'reverse-analysis' || source.analysis_mode !== 'geometry_only' || source.status !== 'failed') fail('只能修订失败的 Geometry Analysis。', 422)
      const report = inspectGeometryOutput(source)
      if (!report?.parsed || report.valid) fail('此记录没有可修订的输出校验错误。', 422)
      const input = source.revision ? source.revisionOutput : JSON.parse(source.rawOutput)
      const { output, change } = reviseAnchorReference(input, body.operation)
      const fingerprint = hash({ sourceId: source.id, input, change })
      const id = body.requestId
      file(id)
      try { const previous = await read(id); if (previous.revision?.fingerprint !== fingerprint) fail('修订请求 ID 已用于其他操作。', 409); return previous }
      catch (e) { if (e.statusCode !== 404) throw e }
      await lock(id)
      const record = { ...source, id, createdAt: new Date().toISOString(), status: 'failed', analysis: null,
        revisionOutput: output, revision: { parentAnalysisId: source.id,
          originalAnalysisId: source.revision?.originalAnalysisId || source.id,
          parentSha256: createHash('sha256').update(await readFile(file(source.id))).digest('hex'),
          rawOutputSha256: report.rawOutputSha256, fingerprint, change, createdAt: new Date().toISOString() } }
      delete record.error
      try { record.analysis = validateGeometryAnalysis(output); record.status = 'complete' }
      catch (e) { record.error = visionErrorDiagnostic(e, 'Revision Validation') }
      record.outputValidation = inspectGeometryOutput(record)
      await save(record)
      return record
    },

    async history() {
      let names
      try { names = await readdir(directory) } catch (e) { if (e.code === 'ENOENT') return { items: [], warnings: [] }; throw e }
      const items = [], warnings = []
      for (const name of names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
        try {
          const r = JSON.parse(await readFile(path.join(directory, name), 'utf8'))
          if (r.kind !== 'reverse-analysis') continue
          let hasSavedReview = false
          try { await readFile(file(r.id) + '.review', 'utf8'); hasSavedReview = true }
          catch (e) { if (e.code !== 'ENOENT') throw e }
          items.push({ id: r.id, createdAt: r.createdAt, provider: r.provider, model: r.model, hasSavedReview,
            analysis_mode: r.analysis_mode || 'catalog_match', prompt_id: r.prompt_id || 'reverse_catalog_v1', prompt_version: r.prompt_version || 1, image_reference: r.image_reference || { kind: 'upload', name: r.originalImage?.name || null, sha256: r.image?.sha256 },
            status: r.status, isRevision: !!r.revision, isGuided: !!r.guidance, appearance: r.analysis?.appearance || '', count: r.analysis?.observations?.length || 0 })
        } catch { warnings.push(name + ' 无法读取；原文件保留。') }
      }
      items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id))
      return { items, warnings }
    },
    async previousReview(analysisId, sourceId) {
      const {items}=await this.history(), index=items.findIndex(r=>r.id===analysisId)
      const previous=sourceId ? items.find(r=>r.id===sourceId&&r.id!==analysisId) : index<0?null:items[index+1]
      if(!previous)return {rows:{},message:sourceId?'所选历史不存在，或是当前 Run。':'没有上一轮识别记录。'}
      let review
      try { review=JSON.parse(await readFile(file(previous.id)+'.review','utf8')) }
      catch(e){if(e.code==='ENOENT')return {rows:{},message:sourceId?'所选历史没有保存的 Review。':'直接上一轮没有保存的 Review。'};throw e}
      const rows={}
      for(const [id,r] of Object.entries(review.rows)){
        rows[id]={features:r.features,quantity:r.quantity,excluded:r.excluded,reason:r.reason,index:r.index,copiedFromAnalysisId:previous.id}
        if(r.searchId)rows[id].search=await read(r.searchId)
      }
      return {analysisId:previous.id,rows,message:'所选历史没有可复制的审核行。'}
    },
    async saveReview(body) {
      const analysis = await analyzed(body.analysisId)
      const {hiddenParts,manualRelations}=validateReviewParts(analysis.analysis.observations,body.hiddenParts,body.manualRelations)
      const observations=reviewObservations(analysis.analysis.observations,hiddenParts)
      if(Object.keys(body.rows||{}).some(id=>!observations.some(o=>o.id===id)))fail('审核包含未声明的 Observation')
      const rows = {}, copiedSearches = {}
      for (const o of observations) {
        const r = body.rows?.[o.id]
        if (!r || typeof r.quantity !== 'string' || typeof r.excluded !== 'boolean' || typeof r.reason !== 'string'
          || !r.features || ['color', 'size', 'shape', 'print'].some(k => typeof r.features[k] !== 'string')
          || JSON.stringify(r).length > 10000) fail('审核草稿字段无效。')
        validateReviewDimensions(r.features)
        if(o.source==='manual'&&(!Number.isSafeInteger(Number(r.quantity))||Number(r.quantity)<1||Number(r.quantity)>100))fail('人工零件数量须为 1–100')
        const row = { features: r.features, quantity: r.quantity, excluded: r.excluded, reason: r.reason }
        if (r.searchId) {
          let search = await read(r.searchId)
          if(search.analysisId!==analysis.id&&r.copiedFromAnalysisId){
            // Explicit form copy only: retain the saved selection; no Catalog lookup or identity inference.
            const previous=JSON.parse(await readFile(file(r.copiedFromAnalysisId)+'.review','utf8'))
            const original=previous.rows[o.id]
            if(original?.searchId!==search.id||original.index!==r.index)fail('复制的确认记录不在来源 Review 中。')
            search={...search,id:randomUUID(),analysisId:analysis.id,copiedFrom:{analysisId:r.copiedFromAnalysisId,searchId:r.searchId}}
            copiedSearches[o.id]=search
          }
          if (search.kind !== 'reverse-search' || search.analysisId !== analysis.id || search.observationId !== o.id
            || (search.partNumber ? search.partNumber !== r.features.partNumber?.trim() : hash(readFeatureEditor(r.features)) !== hash(search.features))) fail('候选与当前审核特征不一致。')
          row.searchId = search.id
          if (r.index !== undefined) {
            if (!Number.isSafeInteger(r.index) || !search.rows[r.index]?.sourceAllowed) fail('确认候选无效。')
            row.index = r.index
          }
        } else if (r.index !== undefined) fail('确认项缺少候选记录。')
        rows[o.id] = row
      }
      for(const search of Object.values(copiedSearches))await save(search)
      const review = { analysisId: analysis.id, updatedAt: new Date().toISOString(), rows, hiddenParts, manualRelations }
      const target = file(analysis.id) + '.review', temp = target + '.' + randomUUID() + '.tmp'
      await writeFile(temp, JSON.stringify(review), { flag: 'wx', mode: 0o600 })
      await rename(temp, target)
      return { updatedAt: review.updatedAt, copiedSearches }
    },
    async restore(analysisId) {
      const analysis = await read(analysisId)
      if (analysis.kind !== 'reverse-analysis') fail('请选择 Analysis。')
      if (!analysis.source || !['full', 'today', 'virtual'].includes(analysis.source.kind)) fail('记录缺少有效 Part Source，无法安全恢复。', 422)
      if (analysis.analysis) (analysis.analysis_mode === 'geometry_only' ? validateGeometryAnalysis : validateReverseAnalysis)(analysis.analysis)
      const warnings = [], rows = {}
      let savedReview=null
      try { savedReview=JSON.parse(await readFile(file(analysisId)+'.review','utf8')) }
      catch(e){if(e.code!=='ENOENT')throw e}
      const {hiddenParts,manualRelations}=validateReviewParts(analysis.analysis?.observations||[],savedReview?.hiddenParts,savedReview?.manualRelations)
      if (!analysis.image?.imageBase64) warnings.push('记录缺少参考图片，无法恢复图片或 BBox。')
      if (!analysis.analysis) warnings.push('记录没有可恢复的完整分析；请查看原始诊断。')
      let reviewColors = []
      if (analysis.analysis_mode === 'geometry_only') {
        try { reviewColors = (await getCatalog('filters', {})).colors || [] }
        catch { warnings.push('Catalog 颜色列表暂不可用；未自动填写原始颜色，已有审核颜色仍会恢复。') }
      }
      for (const o of reviewObservations(analysis.analysis?.observations || [],hiddenParts)) rows[o.id] = {
        features: reverseFeatureEditor(o, reviewColors), quantity: String(o.quantity ?? 1), excluded: false, reason: '',
      }
      let artifact = null, generationStatus = 'none'
      try {
        const link = JSON.parse(await readFile(path.join(directory, analysisId + '.generation.json'), 'utf8'))
        generationStatus = 'saved'
        artifact = await read(link.artifactId) // Existing hash, geometry and Validator checks.
        generationStatus = artifact.status
      } catch (e) {
        if (e.code !== 'ENOENT') { generationStatus = 'unavailable'; warnings.push('Artifact 无法恢复：' + e.message) }
        else {
          try { await readFile(path.join(directory, analysisId + '.generation.lock')); generationStatus = 'submitted'; warnings.push('生成已提交但 Artifact 尚不可读；不会重复调用模型。') }
          catch (lockError) { if (lockError.code !== 'ENOENT') throw lockError }
        }
      }
      // Artifact confirmations are saved facts, not inferred from model guesses.
      for (const c of artifact?.confirmations || []) {
        const row = rows[c.observationId]
        if (!row) continue
        try {
          const search = await read(c.searchId)
          const index = search.rows.findIndex(r => r.source.part_num === c.item.part_num && r.source.color_id === c.item.color_id)
          if (index < 0) throw new Error('确认组合不在已保存候选中')
          Object.assign(row, { features: { ...featureEditor(c.features), height_brick_units: c.features.height_brick_units != null ? String(c.features.height_brick_units) : row.features.height_brick_units }, quantity: String(c.item.quantity), search, index })
        } catch (e) { warnings.push(c.observationId + ' 确认恢复失败：' + e.message) }
      }
      for (const e of artifact?.excluded || []) if (rows[e.observationId]) Object.assign(rows[e.observationId], { excluded: true, reason: e.reason })
      let updatedAt = null
      try {
        if(!savedReview)throw Object.assign(new Error('No saved Review'),{code:'ENOENT'})
        const review = savedReview
        updatedAt = review.updatedAt
        for (const [id, r] of Object.entries(review.rows)) {
          if (!rows[id]) continue
          rows[id] = { features: { ...featureEditor({ size: r.features.size }), height_brick_units: rows[id].features.height_brick_units, ...r.features }, quantity: r.quantity, excluded: r.excluded, reason: r.reason }
          if (r.searchId) try {
            const search = await read(r.searchId)
            if (search.kind !== 'reverse-search' || search.analysisId !== analysisId || search.observationId !== id
              || (search.partNumber ? search.partNumber !== r.features.partNumber?.trim() : hash(readFeatureEditor(r.features)) !== hash(search.features))) throw new Error('候选与草稿不一致')
            rows[id].search = search
            if (r.index !== undefined && search.rows[r.index]?.sourceAllowed) rows[id].index = r.index
          } catch (e) { warnings.push(id + ' 候选恢复失败：' + e.message) }
        }
      } catch (e) {
        if (e.code === 'ENOENT') warnings.push('没有已保存审核草稿；仅恢复原始分析及已有 Artifact 确认，未保存的编辑无法恢复。')
        else throw e
      }
      return { analysis, rows, artifact, generationStatus, updatedAt, warnings, hiddenParts, manualRelations }
    },
    async analyze(body) {
      const analysisMode = body.analysis_mode ?? 'catalog_match' // Legacy API callers keep their existing contract.
      if (typeof analysisMode !== 'string' || !Object.hasOwn(reversePrompts, analysisMode)) fail('Analysis Mode 无效。')
      const prompt = selectReversePrompt(analysisMode, body.promptVersion), schema = analysisMode === 'geometry_only' ? geometrySchema : reverseSchema
      const validate = analysisMode === 'geometry_only' ? validateGeometryAnalysis : validateReverseAnalysis
      let guidance = null
      if (body.guidance) {
        if (analysisMode !== 'geometry_only') fail('Guided Re-analysis 仅支持 Geometry。')
        const parent = await analyzed(body.guidance.analysisId)
        if (parent.analysis_mode !== 'geometry_only') fail('来源必须是 Geometry Analysis。')
        const ids = body.guidance.observationIds, hint = body.guidance.hint
        if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !parent.analysis.observations.some(o => o.id === id))) fail('请选择来源 Analysis 中的 Observation。')
        if (typeof hint !== 'string' || !hint.trim() || hint.length > 4000) fail('Hint 需为 1–4000 字符。')
        guidance = { sourceAnalysisId: parent.id, sourceAnalysisHash: hash(parent.analysis), observationIds: ids, hint: hint.trim(), sourceAnalysis: parent.analysis,
          instruction: 'Reconsider only the selected observations and affected neighboring relations using the reference image. The user hint is a hypothesis, not validated fact. Merge, split or replace selected pieces only when supported by evidence. Preserve other observations and relations wherever possible. Return a COMPLETE independent analysis in the existing JSON schema, with consistent IDs, anchors and relations. Do not output a patch. Unselected changes also require human review. Do not infer Catalog identity or reuse prior approvals.' }
        body = { ...body, ...parent.image, originalImage: parent.originalImage, compression: parent.compression, imageReference: parent.image_reference }
      }
      const definition = resolveModel(body.model, 'reverse'), image = validateImage(body)
      const rules = analysisMode === 'catalog_match' ? await loadRules() : null
      let source
      if (analysisMode === 'geometry_only') source = { kind: 'full' }
      else if (body.source?.kind === 'full') source = { kind: 'full' }
      else if (body.source?.kind === 'today') source = { kind: 'today', session: parseSession(body.source.session) }
      else if (body.source?.kind === 'virtual') source = { kind: 'virtual', inventory: validateGeneratorInput({ description: 'Reverse source', inventory: body.source.inventory }, rules).inventory }
      else fail('请选择有效的 Part Source。')
      if (source.kind === 'today' && !source.session.items.length) fail('所选真实库存为空，未调用模型。')
      const fingerprint = hash({ model: body.model, source, image: image.sha256, analysisMode, guidance, prompt: prompt.text, schema, settings: modelSettings(body.model, 'reverse') })
      file(body.requestId)
      try { const old = await read(body.requestId); if (old.fingerprint !== fingerprint) fail('请求 ID 对应另一份输入。', 409); return old }
      catch (e) { if (e.statusCode !== 404) throw e }
      await lock(body.requestId)
      const record = { id: body.requestId, kind: 'reverse-analysis', createdAt: new Date().toISOString(), status: 'pending',
        analysis_mode: analysisMode, prompt_id: prompt.id, prompt_version: prompt.version,
        image_reference: { kind: body.imageReference?.kind === 'server_library' ? 'server_library' : 'upload',
          name: typeof body.imageReference?.name === 'string' ? body.imageReference.name.slice(0,255) : body.originalImage?.name || null, sha256: image.sha256 },
        provider: definition.provider, model: body.model, source, fingerprint, image, originalImage: body.originalImage ?? null,
        compression: body.compression ?? null, guidance, request: null, analysis: null }
      await save(record)
      const started = performance.now()
      try {
        const input = guidance ? JSON.stringify(guidance) : analysisMode === 'geometry_only' ? 'Analyze the reference photograph using anchor-based geometry reasoning.'
          : JSON.stringify({ colors: (await getCatalog('filters', {})).colors })
        record.request = definition.provider === 'openai'
          ? buildOpenaiRequest({ model: body.model, task: 'reverse', prompt: prompt.text, schema, content: [
            { type: 'input_text', text: 'Return a JSON object only. ' + (analysisMode === 'catalog_match' ? 'Rebrickable palette: ' : '') + input },
            { type: 'input_image', image_url: 'data:' + image.mimeType + ';base64,' + image.imageBase64 }] })
          : { model: body.model, contents: [{ role: 'user', parts: [{ text: input }, { inlineData: { mimeType: image.mimeType, data: image.imageBase64 } }] }],
            config: { ...modelSettings(body.model, 'reverse'), systemInstruction: prompt.text, responseMimeType: 'application/json', responseSchema: schema } }
        await captureVisionWire(directory, record, () => save(record), () => callModel({ model: body.model, task: 'reverse', request: record.request, record }))
        if (record.finishReason !== (definition.provider === 'openai' ? 'completed' : 'STOP')) fail('Reverse 模型输出未完成。', 422)
        record.analysis = validate(JSON.parse(record.rawOutput))
        if (guidance) {
          const before = new Map(guidance.sourceAnalysis.observations.map(o => [o.id, o])), after = new Map(record.analysis.observations.map(o => [o.id, o]))
          const changedOutsideSelection = [...before.keys()].filter(id => !guidance.observationIds.includes(id) && (!after.has(id) || hash(before.get(id)) !== hash(after.get(id))))
          record.guidedChanges = { changedOutsideSelection, added: [...after.keys()].filter(id => !before.has(id)), removed: [...before.keys()].filter(id => !after.has(id)), changed: [...after.keys()].filter(id => before.has(id) && hash(before.get(id)) !== hash(after.get(id))), unchanged: [...after.keys()].filter(id => before.has(id) && hash(before.get(id)) === hash(after.get(id))), relationsChanged: hash(guidance.sourceAnalysis.relations) !== hash(record.analysis.relations) }
        }
        record.status = 'complete'
      } catch (error) { record.status = 'failed'; record.error = visionErrorDiagnostic(error, 'Reverse Analysis'); record.outputValidation = inspectGeometryOutput(record) }
      record.elapsedMs = Math.round(performance.now() - started)
      await save(record)
      return record
    },
    async search(body) {
      const analysis = await analyzed(body.analysisId)
      const {hiddenParts}=validateReviewParts(analysis.analysis.observations,body.hiddenParts)
      if (!reviewObservations(analysis.analysis.observations,hiddenParts).some(o => o.id === body.observationId)) fail('Observation 不存在。')
      const features = validateCatalogQuery(body.features), params = catalogFeatureParams(features)
      const partNumber = typeof body.partNumber === 'string' ? body.partNumber.trim() : ''
      if (partNumber && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(partNumber)) fail('Part Number 格式无效。')
      if (!partNumber && !Object.keys(params).length) fail('请至少确认一个特征后检索，未知条件不参与匹配。')
      const page = body.page ?? 1
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) fail('页码无效。')
      const selection = partNumber ? await getCatalog('selection', { part_nums: partNumber }) : null
      const exactItems = selection?.items?.filter(p => p.part_num === partNumber)
      const result = partNumber ? { items: page === 1 ? exactItems : [], total: exactItems?.length }
        : await getCatalog('candidates', { ...params, page: String(page), page_size: '6' })
      if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total)) fail('Catalog 候选响应无效。', 502)
      const items = []
      for (const p of result.items) {
        if (!Array.isArray(p.colors) || (!partNumber && (p.eligible !== true || !Array.isArray(p.checks) || !p.checks.length || !p.checks.every(c => c.status === 'matched')))) fail('Catalog 缺少严格匹配证据。', 502)
        for (const c of p.colors || []) {
          if (!partNumber && features.color_id !== null && c.id !== features.color_id) continue
          if (analysis.source.kind === 'today' && !analysis.source.session.items.some(r => r.part_num === p.part_num && r.color_id === c.id)) continue
          items.push({ part_num: p.part_num, color_id: c.id, quantity: 1 })
        }
      }
      if (items.length > 500) fail('本页颜色组合太多，请补充颜色特征。')
      const review = items.length ? await games.review({ session: { schema_version: 1, id: randomUUID(), name: 'Reverse candidate page', updated_at: new Date().toISOString(), items } }) : null
      const rows = (review?.mapping.rows || []).map(row => {
        const p = result.items.find(p => p.part_num === row.source.part_num)
        let sourceAllowed = true
        if (analysis.source.kind === 'virtual') sourceAllowed = !!row.target && analysis.source.inventory.some(r => r.part === row.target.part && r.color === row.target.color && r.quantity > 0)
        return { ...row, name: p.name, checks: p.checks, catalog_geometry: p.catalog_geometry, sourceAllowed, eligible: sourceAllowed && !!row.target && row.errors.length === 0 }
      })
      let images = {}, imageError = null
      if (result.items.length) try { images = (await getCatalog('images', { part_nums: result.items.map(p => p.part_num).join(',') })).images }
      catch { imageError = 'Catalog 图片暂不可用；保留型号和诊断。' }
      const record = { id: randomUUID(), kind: 'reverse-search', analysisId: analysis.id, observationId: body.observationId,
        createdAt: new Date().toISOString(), features, partNumber, page, catalogTotal: result.total, pageSize: 6, rows, images, imageError, review, geometry_report: result.geometry_report }
      await save(record)
      return record
    },
    async generate(body) {
      const analysis = await analyzed(body.analysisId)
      const rules = await loadRules()
      resolveModel(body.model, 'reverse')
      if (body.confirmApproximation !== true || !Array.isArray(body.choices) || !Array.isArray(body.excluded)) fail('请明确确认近似重建与零件选择。')
      const observations = analysis.analysis.observations, seen = new Set(), confirmations = [], merged = new Map()
      for (const choice of body.choices) {
        const observation = observations.find(o => o.id === choice.observationId)
        if (!observation || seen.has(observation.id)) fail('确认项重复或不属于本次分析。')
        seen.add(observation.id)
        const search = await read(choice.searchId)
        if (search.kind !== 'reverse-search' || search.analysisId !== analysis.id || search.observationId !== observation.id
          || !Number.isSafeInteger(choice.index) || !search.rows[choice.index]?.eligible) fail('必须选择本次分析中已通过能力检查的 Catalog 候选。')
        if (!Number.isSafeInteger(choice.quantity) || choice.quantity < 1 || choice.quantity > 100) fail('数量无效。')
        const row = search.rows[choice.index], item = { ...row.source, quantity: choice.quantity }
        const key = item.part_num + ':' + item.color_id
        merged.set(key, { ...item, quantity: (merged.get(key)?.quantity || 0) + item.quantity })
        confirmations.push({ observationId: observation.id, features: search.features, searchId: search.id, item, target: row.target })
      }
      for (const excluded of body.excluded) {
        if (!observations.some(o => o.id === excluded.observationId) || seen.has(excluded.observationId) || typeof excluded.reason !== 'string' || !excluded.reason.trim()) fail('排除项必须明确说明原因，且不可重复。')
        seen.add(excluded.observationId)
      }
      if (seen.size !== observations.length || !confirmations.length) fail('每个 Observation 都需确认候选或明确排除。')
      const items = [...merged.values()]
      enforceSource(analysis.source, items, [])
      const review = await games.review({ session: { schema_version: 1, id: randomUUID(), name: 'Reverse confirmed parts', updated_at: new Date().toISOString(), items } })
      if (review.mapping.rows.some(r => !r.target || r.errors.length)) fail('所选零件的 Mapping 或几何能力已不可用，请重新检索。', 409)
      for (const confirmed of confirmations) {
        const current = review.mapping.rows.find(r => r.source.part_num === confirmed.item.part_num && r.source.color_id === confirmed.item.color_id)
        if (!current?.target || current.target.part !== confirmed.target.part || current.target.color !== confirmed.target.color) fail('候选 Mapping 已改变，请重新检索确认。', 409)
      }
      const quantities = new Map()
      for (const row of review.mapping.rows) {
        const key = row.target.part + ':' + row.target.color
        quantities.set(key, { part: row.target.part, color: row.target.color, quantity: (quantities.get(key)?.quantity || 0) + row.source.quantity })
      }
      const inventory = [...quantities.values()]
      enforceSource(analysis.source, items, inventory)
      const input = { ...validateGeneratorInput({ description: 'Approximation：根据参考照片和人工确认零件重建外观相似的合法搭建方案，不宣称精确复原。', inventory }, rules), model: body.model }
      const context = { mode: 'reverse', approximation: true, analysisId: analysis.id, appearance: analysis.analysis.appearance,
        observations: observations.filter(o => confirmations.some(c => c.observationId === o.id)), relations: analysis.analysis.relations.filter(r => confirmations.some(c => c.observationId === r.from) && confirmations.some(c => c.observationId === r.to)),
        unknowns: analysis.analysis.unknowns, anchors: analysis.analysis.anchors, scale_evidence: analysis.analysis.scale_evidence,
        image_reference: analysis.image_reference, source: analysis.source, confirmations, excluded: body.excluded,
        instruction: 'Human-confirmed features and identities take precedence over initial visual hypotheses. Reconstruct a visually similar APPROXIMATION from this reference evidence and confirmed parts only. Do not invent hidden parts, do not claim exact reconstruction or verified visual connections. Use the shared geometry rules and validate every build prefix. If evidence cannot be satisfied, do not pretend it is exact.' }
      const generationLock = path.join(directory, analysis.id + '.generation.lock')
      try { await writeFile(generationLock, JSON.stringify({ model: body.model, confirmations, excluded: body.excluded }), { flag: 'wx', mode: 0o600 }) }
      catch (e) { if (e.code === 'EEXIST') fail('本次分析已有生成提交；请查看诊断，未再次调用模型。', 409); throw e }
      const artifact = { id: randomUUID(), kind: 'reverse-design', createdAt: new Date().toISOString(), approximation: true,
        analysisId: analysis.id, source: analysis.source, confirmation: { accepted: true, confirmedAt: new Date().toISOString() }, confirmations, excluded: body.excluded, review, generatorInput: input,
        geometrySnapshot: geometrySnapshot(rules, inventory), status: 'pending', generation: null, designHash: null }
      await save(artifact)
      await writeFile(path.join(directory, analysis.id + '.generation.json'), JSON.stringify({ artifactId: artifact.id }), { flag: 'wx', mode: 0o600 })
      try {
        const result = await generate(input, { reference: { context, image: analysis.image } })
        if (result.body.ok && !validateBrickDesign(result.body.design, input.inventory, rules).valid) fail('Reverse 结果复核失败。', 422)
        artifact.generation = result.body
        artifact.status = result.body.ok ? 'complete' : 'failed'
        artifact.designHash = result.body.ok ? hash(result.body.design) : null
      } catch { artifact.status = 'failed'; artifact.error = '生成处理中断；查看已有原始 Trace，未自动重试。' }
      await save(artifact)
      return artifact
    },
    async attempt(analysisId) {
      file(analysisId)
      try { const link = JSON.parse(await readFile(path.join(directory, analysisId + '.generation.json'), 'utf8')); return read(link.artifactId) }
      catch (e) { if (e.code === 'ENOENT') fail('尚无生成记录，或请求尚未完成预检查。', 404); throw e }
    },
  }
}

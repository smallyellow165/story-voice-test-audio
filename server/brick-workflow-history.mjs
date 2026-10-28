import {createPartsInputStore} from './brick-parts-input.mjs'
// Read-only projection of canonical records. No index, writes, repair, or model calls.
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { reviewedSource } from './brick-spatial-workflow.mjs'
import { validateImage } from './brick-image-validation.mjs'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const bytesHash = v => createHash('sha256').update(v).digest('hex')
const requireEvidence = (ok, message) => { if (!ok) throw Error(message) }
const link = (page, params) => page + '?' + new URLSearchParams(params)
export function createWorkflowHistory(directory, { sourceImages, reverse, buildOrder, selectedSpatial, partsInputs=createPartsInputStore(directory,{reverse}) }) {
  return { async read(imageId) {
    await sourceImages.read(imageId)
    const nodes = [], unassociated = [], index = new Map()
    const issue = (stage, id, reason, references = {}) => unassociated.push({ stage, id, reason, references })
    async function records(folder, idField = 'id') {
      const names = await readdir(path.join(directory, folder)).catch(e => { if (e.code === 'ENOENT') return []; throw e })
      const values = []
      for (const name of names.filter(n => n.endsWith('.json') && uuid.test(n.slice(0, -5))).sort()) {
        try {
          const r = JSON.parse(await readFile(path.join(directory, folder, name), 'utf8'))
          requireEvidence(r[idField] === name.slice(0, -5), '记录 ID 与 canonical 地址不一致')
          values.push(r)
        } catch (e) { issue(folder, name, e.message) }
      }
      return values
    }
    const history = await reverse.history()
    history.warnings.forEach(w => issue('Analysis', '', w))
    const analyses = new Map()
    for (const item of history.items) {
      try { analyses.set(item.id, await reverse.read(item.id)) } catch (e) { issue('Analysis', item.id, e.message) }
    }
    function add(stage, id, parent, analysisId, status, evidence, href, keyId = id) {
      const key = stage + ':' + keyId
      requireEvidence(!index.has(key), '同一阶段存在重复身份：' + key)
      const node = { key, stage, id, parent, analysisId, status, evidence, href }
      index.set(key, node)
      if (analyses.get(analysisId)?.sourceImageId === imageId) nodes.push(node)
      return node
    }
    const currentReviews = new Map()
    for (const a of analyses.values()) {
      add('Analysis', a.id, null, a.id, a.status, { sourceImageId: a.sourceImageId, createdAt: a.createdAt }, null)
      if (a.sourceImageId !== imageId) continue
      const file = path.join(directory, 'brick-reverse', a.id + '.json.review')
      try {
        const raw = await readFile(file), review = JSON.parse(raw)
        requireEvidence(review.analysisId === a.id, '当前 Review.analysisId 不一致')
        const restored = await reverse.restore(a.id), current = reviewedSource(restored)
        requireEvidence(raw.equals(await readFile(file)), '读取期间 Review 已变化；请重新读取')
        const version = current.ready ? current.reviewVersion : null
        currentReviews.set(a.id, version)
        add('Current Review', a.id, 'Analysis:' + a.id, a.id, version ? '当前内容（可原地修改）' : '当前审核未完整确认', {
          analysisId: review.analysisId, updatedAt: review.updatedAt, fileSha256: bytesHash(raw), reviewVersion: version,
          errors: current.errors, warnings: restored.warnings,
        }, null)
      } catch (e) {
        if (e.code !== 'ENOENT') issue('Current Review', a.id, e.message, { analysisId: a.id })
      }
    }
    const [plans, geometries, selections, buildPlans, traces, operations, refinements] = await Promise.all([
      records('brick-spatial-traces'), records('brick-spatial-geometry'), records('brick-spatial-selections'),
      records('brick-build-plans', 'build_plan_id'), records('brick-build-traces'), records('brick-spatial-requests'), records('brick-refinements'),
    ])
    const currentInputs=new Map()
    const planMap = new Map(), geometryMap = new Map(), selectionMap = new Map()
    for (const p of plans) {
      const provenance = p.requestInput?.provenance, aid = provenance?.analysisId
      try {
        requireEvidence(p.task === 'spatial-planning' && uuid.test(aid) && analyses.has(aid), 'Analysis 引用缺失、不可验证或尚无正式 sourceImageId')
        if (p.sources) requireEvidence(p.sources.every(s => s.analysisId === aid), 'sources 与 requestInput 的 Analysis 引用冲突')
        if (p.imagePayloadSha256) {
          const image = validateImage(p.image), a = analyses.get(aid)
          requireEvidence(image.sha256 === p.imagePayloadSha256 && [validateImage(a.originalImage).sha256, validateImage(a.image).sha256].includes(image.sha256), 'Spatial 图片 hash 与 Analysis 来源证据不一致')
        }
        await partsInputs.verifyTrace(p)
        let partsInputMatch={status:'Unknown',reason:'历史未记录 Parts Snapshot'}
        if(p.partsSnapshotId){
          if(!currentInputs.has(aid))currentInputs.set(aid,partsInputs.current(aid).then(id=>({id})).catch(e=>({error:e.message})))
          const current=await currentInputs.get(aid)
          partsInputMatch=current.error?{status:'Unknown',reason:current.error}:await partsInputs.match(p,current.id)
        }
        let parent = 'Analysis:' + aid
        const evidence = { partsSnapshotId:p.partsSnapshotId, partsInputMatch, ...provenance, planHash: p.plan ? hash(p.plan) : null, inputHash: hash(p.requestInput), imagePayloadSha256: p.imagePayloadSha256 }
        if (provenance.reviewVersion) {
          const sources = p.sources?.filter(s => s.analysisId === aid && s.reviewVersion === provenance.reviewVersion && s.mappingReviewId === provenance.reviewId) || []
          requireEvidence(sources.length === 1, 'Review 版本 / Mapping 引用缺失或冲突')
          const s = sources[0]
          requireEvidence(s.mappingReview?.id === provenance.reviewId, 'Mapping Review 快照 ID 不一致')
          const matched = currentReviews.get(aid) === provenance.reviewVersion
          parent = add('Review input', provenance.reviewVersion, parent, aid, matched ? '版本与当前 Review 相符' : '历史版本引用；不能替换为当前 Review', {
            analysisId: aid, reviewVersion: provenance.reviewVersion, savedReviewAt: provenance.savedReviewAt,
            matchesCurrentReview: matched, fullHistoricalReviewSnapshot: false, spatialPlanId: p.id,
            note: '保存了版本引用与规划输入；未保存完整的历史 Parts Explorer Review 文件。',
          }, null, p.id).key
          parent = add('Mapping Review', provenance.reviewId, parent, aid, '运行时快照', {
            mappingReviewId: provenance.reviewId, snapshotSha256Computed: hash(s.mappingReview),
            note: '此 ID 属于库存 Mapping Review，不是 Parts Explorer Review 的 ID。',
          }, link('brick-test.html', { workflow: 'spatial', analysisId: aid, spatialPlanId: p.id }), p.id).key
        } else evidence.reviewEvidenceMissing = '未保存 Parts Explorer Review 版本；仅有明确 Analysis 来源引用'
        if (selectedSpatial) {
          try { const selection = await selectedSpatial.read(p.id); evidence.spatialChoice = { selectionKey: selection.selectionKey, selectedSpatialPlanId: selection.choice.selectedSpatialPlanId, revision: selection.choice.revision, eligible: selection.eligible } }
          catch (e) { evidence.spatialChoiceUnavailable = e.message }
        }
        add('Spatial', p.id, parent, aid, p.status, evidence, link('brick-test.html', { workflow: 'spatial', analysisId: aid, spatialPlanId: p.id }))
        planMap.set(p.id, p)
      } catch (e) { issue('Spatial', p.id, e.message, { analysisId: aid }) }
    }
    for (const g of geometries) {
      try {
        const p = planMap.get(g.planId)
        requireEvidence(!g.revisionId, '包含 Revision；本视图尚未验证修订链，不能直接归到原始计划')
        requireEvidence(g.version === 'geometry-execution-v1' && p, 'Spatial 来源不存在或未验证')
        requireEvidence(g.sourcePlanHash === hash(p.plan), 'sourcePlanHash 与 Spatial Plan 不一致')
        if (g.sourcePlan) requireEvidence(hash(g.sourcePlan) === g.sourcePlanHash, 'Geometry 内保存的 Plan 快照 hash 不一致')
        if (g.sourceInput) requireEvidence(hash(g.sourceInput) === hash(p.requestInput), 'Geometry sourceInput 与 Spatial 输入不一致')
        for (const list of [g.candidates, g.diagnosticCandidates]) {
          if (list !== undefined) requireEvidence(Array.isArray(list) && list.every(c => typeof c.id === 'string' && c.id.length > 0) && new Set(list.map(c => c.id)).size === list.length, '候选身份缺失或重复')
        }
        const candidateIds = [...(g.candidates || []), ...(g.diagnosticCandidates || [])].map(c => c.id)
        requireEvidence(new Set(candidateIds).size === candidateIds.length, '有效与诊断候选的 ID 重复')
        const aid = p.requestInput.provenance.analysisId
        const params = { workflow: 'spatial', analysisId: aid, spatialPlanId: p.id, geometryId: g.id }
        add('Geometry', g.id, 'Spatial:' + p.id, aid, `${g.state} / ${g.status}`, { planId: p.id, sourcePlanHash: g.sourcePlanHash, error: g.error }, link('brick-test.html', params))
        geometryMap.set(g.id, g)
        for (const [kind, candidates] of [['Candidate', g.candidates], ['Diagnostic Candidate', g.diagnosticCandidates]]) {
          for (const c of candidates || []) {
            requireEvidence(typeof c.id === 'string' && c.id.length > 0, '候选缺少 ID')
            add(kind, g.id + '/' + c.id, 'Geometry:' + g.id, aid, c.kind, { geometryId: g.id, candidateId: c.id, candidateHash: hash(c), geometryValid: c.geometry?.valid }, link('brick-test.html', { ...params, candidateId: c.id }))
          }
        }
      } catch (e) { issue('Geometry', g.id, e.message, { planId: g.planId, revisionId: g.revisionId }) }
    }
    for (const s of selections) {
      try {
        const g = geometryMap.get(s.geometryId), p = g && planMap.get(g.planId), c = g?.candidates?.find(c => c.id === s.candidateId)
        requireEvidence(g && p && c && s.kind === 'selected-valid-layout', 'Geometry / Candidate 来源缺失或未验证')
        requireEvidence(s.analysisId === p.requestInput.provenance.analysisId && s.planId === p.id && s.sourcePlanHash === g.sourcePlanHash, 'Layout Selection 上游 ID / Plan hash 冲突')
        requireEvidence(s.candidateHash === hash(c) && hash(s.assembly) === hash(c.assembly), 'Layout Selection candidateHash / assembly 冲突')
        // Reuse existing strict canonical source reader; never relax geometry checks.
        await buildOrder.dispatch('GET', 'sources/' + s.id)
        add('Layout Selection', s.id, 'Candidate:' + g.id + '/' + c.id, s.analysisId, '已保存的布局记录', {
          analysisId: s.analysisId, planId: p.id, geometryId: g.id, candidateId: c.id, candidateHash: s.candidateHash,
        }, link('brick-test.html', { workflow: 'build', selectionId: s.id }))
        selectionMap.set(s.id, s)
      } catch (e) { issue('Layout Selection', s.id, e.message, { geometryId: s.geometryId, candidateId: s.candidateId }) }
    }
    for (const b of buildPlans) {
      try {
        const s = selectionMap.get(b.source_selection_id)
        requireEvidence(s, 'Layout Selection 来源缺失或未验证')
        const loaded = await buildOrder.dispatch('GET', 'plans/' + b.build_plan_id)
        requireEvidence(hash(loaded.plan) === hash(b), '读取期间 Build Plan 已变化')
        add('Build Plan', b.build_plan_id, 'Layout Selection:' + s.id, s.analysisId, `${b.status} · ${b.steps.length} 步`, {
          source_selection_id: b.source_selection_id, source_geometry_result_id: b.source_geometry_result_id,
          source_candidate_id: b.source_candidate_id, source_candidate_hash: b.source_candidate_hash,
          validation: { valid: loaded.validation.valid, complete: loaded.validation.complete, errors: loaded.validation.errors }, buildOrderTraceAssociation: '未保存生成 Trace 引用；不推断生成来源',
        }, link('brick-test.html', { workflow: 'build', selectionId: s.id, buildPlanId: b.build_plan_id }))
      } catch (e) { issue('Build Plan', b.build_plan_id, e.message, { selectionId: b.source_selection_id }) }
    }
    for (const t of traces) {
      try {
        const s = selectionMap.get(t.source?.selectionId)
        requireEvidence(t.task === 'build-order' && s, 'Trace 的 Layout Selection 来源缺失或未验证')
        requireEvidence(t.source.analysisId === s.analysisId && t.source.geometryId === s.geometryId && t.source.candidateId === s.candidateId && t.source.candidateHash === s.candidateHash, 'Trace 来源 ID / candidateHash 不一致')
        const outputId = t.plan?.build_plan_id
        const saved = outputId && index.get('Build Plan:' + outputId)
        let savedPlanId = null
        if (saved) {
          requireEvidence(saved.parent === 'Layout Selection:' + s.id && t.plan.source_selection_id === s.id && t.plan.source_geometry_result_id === s.geometryId && t.plan.source_candidate_id === s.candidateId && t.plan.source_candidate_hash === s.candidateHash, 'Trace 输出 Build Plan 引用与已保存记录冲突')
          savedPlanId = outputId
          saved.evidence.buildOrderTraceAssociation = 'Trace.plan.build_plan_id 明确引用此 ID；不证明保存后的内容与生成输出相同'
          saved.evidence.generationTraceIds = [...(saved.evidence.generationTraceIds || []), t.id]
        }
        add('Build Order Trace', t.id, 'Layout Selection:' + s.id, s.analysisId, t.status, {
          ...t.source, error: t.error, outputBuildPlanId: outputId ?? null, savedPlanId,
          savedPlanAssociation: savedPlanId ? '输出 ID 与已保存 Plan 明确关联；当前内容可能经过编辑' : '未发现明确的已保存 Plan 引用；Trace 成功也不代表已保存',
        }, link('llm-traces.html', { source: 'build', id: t.id }))
      } catch (e) { issue('Build Order Trace', t.id, e.message, { selectionId: t.source?.selectionId }) }
    }
    for (const r of refinements) {
      try {
        const g = geometryMap.get(r.geometryId), p = g && planMap.get(g.planId)
        requireEvidence(g && p && r.planId === p.id && r.sourceGeometryHash === hash(g) && r.sourcePlanHash === hash(p.plan) && r.sourceInputHash === hash(p.requestInput), 'Refinement 的上游引用 / hash 缺失或不一致')
        add('Refinement', r.id, 'Geometry:' + g.id, p.requestInput.provenance.analysisId, r.status, { geometryId: g.id, planId: p.id, sourceGeometryHash: r.sourceGeometryHash }, '/api/brick-spatial/refinements/' + r.id)
      } catch (e) { issue('Refinement', r.id, e.message, { geometryId: r.geometryId }) }
    }
    for (const o of operations) {
      try {
        const p = o.planId ? planMap.get(o.planId) : null
        requireEvidence(!o.planId || p, '请求的 Spatial 引用无法验证')
        const aid = p ? p.requestInput.provenance.analysisId : o.analysisId
        requireEvidence(analyses.has(aid) && (!o.analysisId || o.analysisId === aid), '请求 Analysis 引用缺失或与 Plan 冲突')
        if (o.geometryId) requireEvidence(geometryMap.get(o.geometryId)?.planId === o.planId, '请求 Geometry 引用冲突或未验证')
        if (o.selectionId) requireEvidence(selectionMap.get(o.selectionId)?.geometryId === o.geometryId, '请求 Selection 引用冲突或未验证')
        add('Request', o.id, p ? 'Spatial:' + p.id : 'Analysis:' + aid, aid, `${o.kind} / ${o.state}`, {
          analysisId: o.analysisId, planId: o.planId, geometryId: o.geometryId, selectionId: o.selectionId, error: o.error,
        }, null)
      } catch (e) { issue('Request', o.id, e.message, { analysisId: o.analysisId, planId: o.planId }) }
    }
    return { imageId, nodes, unassociated, unassociatedScope: '全局无法归属的记录；不表示属于当前图片。关联只读且独立于 Selected。' }
  } }
}

// Review additions only. Never insert these records into the saved Vision Analysis.
export function reviewObservations(observations, hiddenParts = []) {
  return [...observations, ...hiddenParts.map(p => ({...p, bbox:null, confidence:null,
    quantity:1, visible_studs:null, evidence:'Human-supplied hidden part', occlusion:'hidden'}))]
}
export function validateReviewParts(observations, hiddenParts = [], manualRelations = []) {
  const fail = message => { throw Object.assign(new Error(message), {statusCode:422}) }
  if (!Array.isArray(hiddenParts) || hiddenParts.length > 30 || !Array.isArray(manualRelations) || manualRelations.length > 100) fail('人工零件或关系列表无效')
  const ids = new Set(observations.map(o=>o.id))
  for (const p of hiddenParts) {
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(p.id) || ['__proto__','constructor','prototype'].includes(p.id) || ids.has(p.id)
      || p.source !== 'manual' || p.visibility !== 'hidden' || Object.keys(p).some(k=>!['id','source','visibility'].includes(k))) fail('人工 Observation ID 必须唯一，使用 1–40 位字母、数字、下划线或横线')
    ids.add(p.id)
  }
  for (const r of manualRelations) {
    if (!r || r.relation !== 'symmetric' || r.source !== 'manual' || !ids.has(r.from) || !ids.has(r.to) || r.from === r.to
      || typeof r.note !== 'string' || r.note.length > 2000 || Object.keys(r).some(k=>!['from','to','relation','source','note'].includes(k))) fail('对称关系须引用两个存在且不同的零件；说明最多 2000 字符')
  }
  return {hiddenParts, manualRelations}
}

// Single merge for Planning readiness, mapping quantities and the actual LLM input.
export function planningReview(saved) {
  const original = saved.analysis.analysis?.observations || []
  const additions = validateReviewParts(original, saved.hiddenParts, saved.manualRelations)
  const observations = [], rows = [], errors = [], instances = new Map()
  for (const o of reviewObservations(original, additions.hiddenParts)) {
    const r = saved.rows[o.id], selected = r?.index === undefined ? null : r.search?.rows[r.index]
    const quantity = Number(r?.quantity), manual = o.source === 'manual'
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100 || (!manual && quantity !== 1)) {
      if (!r?.excluded) errors.push(o.id+'：数量无效；模型 Observation 仍须为单个实例')
      continue
    }
    const group = []
    for (let i=0; i<quantity; i++) {
      const id = i === 0 ? o.id : o.id+'__'+(i+1)
      if (observations.some(p=>p.id===id)) errors.push('展开实例 ID 重复：'+id)
      group.push(id)
      const provenance = {source:manual?'manual':'part_explorer', reviewObservationId:o.id,
        ...(manual?{visibility:'hidden',instanceNumber:i+1}:{analysisId:saved.analysis.id})}
      observations.push({...o,id,quantity:1,provenance})
      rows.push({id,quantity:1,excluded:!!r?.excluded,confirmedPart:selected?.sourceAllowed?selected.source:null,provenance})
    }
    instances.set(o.id,group)
  }
  if (observations.length > 100) errors.push('实例总数不能超过 100')
  const manualRelations = additions.manualRelations.map(r=>{
    if (saved.rows[r.from]?.excluded || saved.rows[r.to]?.excluded) errors.push('对称关系引用了排除项：'+r.from+' / '+r.to)
    return {...r,fromInstanceIds:instances.get(r.from)||[],toInstanceIds:instances.get(r.to)||[]}
  })
  return {...additions,observations,rows,manualRelations,errors}
}

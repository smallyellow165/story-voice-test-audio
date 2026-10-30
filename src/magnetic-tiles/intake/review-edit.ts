import type { Evidence } from './contracts.ts'

// Review-only edits. Analysis records and historical snapshots stay immutable.
export function removeManualPart(evidence: Evidence, id: string): Evidence {
  const part = evidence.observations.find(o=>o.id===id)
  if (!part || part.origin !== 'manual') throw Error('只能删除手工新增零件；原始识别零件请使用排除。')
  return {...evidence,observations:evidence.observations.filter(o=>o.id!==id),relations:evidence.relations.filter(r=>r.from!==id&&r.to!==id)}
}

export function setPartExcluded(evidence: Evidence, id: string, excluded: boolean): Evidence {
  if (!evidence.observations.some(o=>o.id===id)) throw Error('零件不存在')
  // Relations remain evidence and become active again on restore. Reconstruction
  // already filters excluded endpoints; removing them here would lose evidence.
  return {...evidence,observations:evidence.observations.map(o=>o.id===id?{...o,excluded}:o)}
}

export function compactReviewSummary(evidence: Evidence): string {
  const active=evidence.observations.filter(o=>!o.excluded),unknown=active.filter(o=>o.profileId==='unknown').length
  const partial=evidence.sourceKind==='unsupported'||unknown>0||active.length<evidence.observations.length||active.some(o=>o.confidence<.7||o.uncertainty.trim())||evidence.relations.some(r=>r.intent==='uncertain')
  return `${!active.length?'无可用零件':partial?'部分识别':'已识别'} · Known ${active.length-unknown} · Unknown ${unknown} · Excluded ${evidence.observations.length-active.length}`
}

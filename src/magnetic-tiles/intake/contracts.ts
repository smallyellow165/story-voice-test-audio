import type { Assembly, Vec } from '../geometry.ts'
export type Observation = {
  id: string; profileId: 'square' | 'right-triangle' | 'equilateral-triangle' | 'unknown'; profileVersion: 1
  color: string; outline: Vec[]; confidence: number; evidence: string; uncertainty: string
  origin: 'observed' | 'manual'; excluded: boolean
}
export type Relation = { from: string; to: string; intent: 'connect' | 'separate' | 'uncertain'; evidence: string }
export type Evidence = { sourceKind: 'flat_photo' | 'diagram' | 'unsupported'; reason: string; observations: Observation[]; relations: Relation[] }
export type Source = { schemaVersion: 1; id: string; hash: string; name: string; createdAt: string; originalHash: string; view: { hash: string; width: number; height: number; mimeType: string; orientation: 'display'; transform: 'oriented-resize' } }
export type Analysis = { schemaVersion: 1; id: string; hash: string; sourceId: string; sourceHash: string; status: 'processing' | 'complete' | 'failed'; model: string; provider: string; modelVersion?: string; usageMetadata?: unknown; rawOutput?: string; evidence?: Evidence; error?: string; createdAt: string }
export type Review = { schemaVersion: 1; id: string; hash: string; analysisId: string; analysisHash: string; evidence: Evidence; createdAt: string }
export type Candidate = { id: string; assembly: Assembly; imageError: number; fidelity: 'close' | 'needs_review'; connections: number }
export type Reconstruction = { schemaVersion: 1; id: string; hash: string; reviewId: string; reviewHash: string; sourceId: string; sourceHash: string; profileHash: string; algorithm: 'planar-outline-v1'; candidates: Candidate[]; diagnostics: string[]; explored: number; truncated: boolean; createdAt: string }
export type Origin = { schemaVersion: 1; id: string; hash: string; reconstructionId: string; reconstructionHash: string; candidateId: string; sourceId: string; assembly: Assembly; assemblyHash: string; instanceMap: { observationId: string; instanceId: string }[]; createdAt: string }
export type IntakeHistory = { sources: Source[]; analyses: Analysis[]; reviews: Review[]; reconstructions: Reconstruction[]; origins: Origin[]; warnings: string[] }
const fail = (s: string): never => { throw Error(s) }
const boundedText = (v: unknown, limit: number) => typeof v === 'string' && v.length <= limit
const idPattern = /^[a-zA-Z0-9_-]{1,60}$/
export function parseEvidence(input: unknown): Evidence {
  const e = structuredClone(input) as Evidence
  if (!e || !['flat_photo','diagram','unsupported'].includes(e.sourceKind) || !boundedText(e.reason,2000) || !Array.isArray(e.observations) || e.observations.length > 24 || !Array.isArray(e.relations) || e.relations.length > 144) fail('识别/审核结构无效')
  const ids = new Set<string>()
  for (const o of e.observations) {
    if (!o || !idPattern.test(o.id) || ids.has(o.id) || !['square','right-triangle','equilateral-triangle','unknown'].includes(o.profileId) || o.profileVersion !== 1 || !/^#[0-9a-fA-F]{6}$/.test(o.color) || !Array.isArray(o.outline) || o.outline.length < 3 || o.outline.length > 8 || o.outline.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1)) || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1 || !boundedText(o.evidence,2000) || !boundedText(o.uncertainty,2000) || !['observed','manual'].includes(o.origin) || typeof o.excluded !== 'boolean') fail('零件证据无效：'+String(o?.id))
    ids.add(o.id)
  }
  const pairs = new Set<string>()
  for (const r of e.relations) {
    const key = [r.from,r.to].sort().join(':')
    if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to || pairs.has(key) || !['connect','separate','uncertain'].includes(r.intent) || !boundedText(r.evidence,2000)) fail('连接意图引用无效或重复')
    pairs.add(key)
  }
  return e
}

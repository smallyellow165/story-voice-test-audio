import type { DiagnosticCandidate, ExecutionTrace } from './execution-trace.ts'
import { profiles } from '../profiles.ts'
import type { Assembly, Vec, WorkMode, Profile } from '../geometry.ts'
export type Observation = {
  id: string; profileId: string; profileVersion: number
  color: string; outline: Vec[]; confidence: number; evidence: string; uncertainty: string
  origin: 'observed' | 'manual'; excluded: boolean
}
export type Relation = { from: string; to: string; intent: 'connect' | 'separate' | 'uncertain'; evidence: string }
export type Evidence = { sourceKind: 'flat_photo' | 'diagram' | 'unsupported'; reason: string; observations: Observation[]; relations: Relation[] }
export type Source = { schemaVersion: 1; id: string; hash: string; name: string; createdAt: string; originalHash: string; view: { hash: string; width: number; height: number; mimeType: string; orientation: 'display'; transform: 'oriented-resize' } }
export type Analysis = { schemaVersion: 1; id: string; hash: string; sourceId: string; sourceHash: string; status: 'processing' | 'complete' | 'failed'; model: string; provider: string; modelVersion?: string; usageMetadata?: unknown; rawOutput?: string; evidence?: Evidence; error?: string; createdAt: string }
export type Review = { schemaVersion: 1; id: string; hash: string; analysisId: string; analysisHash: string; evidence: Evidence; createdAt: string }
export type Candidate = { id: string; assembly: Assembly; imageError: number; fidelity: 'close' | 'needs_review'; connections: number; components?: string[][] }
export type Reconstruction = { diagnosticCandidates?: DiagnosticCandidate[]; trace?: ExecutionTrace; traceAvailable?: boolean; diagnosticCount?: number; schemaVersion: 1 | 2; mode?: WorkMode; outcome?: 'success' | 'failed' | 'budget_exhausted'; trials?: number; id: string; hash: string; reviewId: string; reviewHash: string; sourceId: string; sourceHash: string; profileHash: string; algorithm: 'planar-outline-v1' | 'planar-outline-v2' | 'planar-outline-v3' | 'planar-outline-v4' | 'planar-outline-v5'; candidates: Candidate[]; diagnostics: string[]; explored: number; truncated: boolean; createdAt: string }
export type Origin = { schemaVersion: 1; id: string; hash: string; reconstructionId: string; reconstructionHash: string; candidateId: string; sourceId: string; assembly: Assembly; assemblyHash: string; instanceMap: { observationId: string; instanceId: string }[]; createdAt: string }
export type SelectedStage = 'analysis' | 'review'
export type SelectedSnapshot = {schemaVersion:1;sourceId:string;stage:SelectedStage;snapshotId:string|null;revision:number|null;updatedAt:string|null;valid:boolean;error?:string;analysisId?:string}
export type IntakeHistory = { selectedSnapshots: SelectedSnapshot[]; sources: Source[]; analyses: Analysis[]; reviews: Review[]; reconstructions: Reconstruction[]; origins: Origin[]; warnings: string[] }
const fail = (s: string): never => { throw Error(s) }
const boundedText = (v: unknown, limit: number) => typeof v === 'string' && v.length <= limit
const idPattern = /^[a-zA-Z0-9_-]{1,60}$/
export function parseEvidence(input: unknown, catalog: readonly Profile[] = profiles): Evidence {
  const e = structuredClone(input) as Evidence
  if (!e || !['flat_photo','diagram','unsupported'].includes(e.sourceKind) || !boundedText(e.reason,2000) || !Array.isArray(e.observations) || e.observations.length > 25 || !Array.isArray(e.relations) || e.relations.length > 300) fail('识别/审核结构无效')
  const ids = new Set<string>()
  for (const o of e.observations) {
    if (!o || !idPattern.test(o.id) || ids.has(o.id) || !(o.profileId === 'unknown' ? o.profileVersion === 1 : catalog.some(p => p.id === o.profileId && p.version === o.profileVersion)) || !/^#[0-9a-fA-F]{6}$/.test(o.color) || !Array.isArray(o.outline) || o.outline.length < 3 || o.outline.length > 8 || o.outline.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1)) || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1 || !boundedText(o.evidence,2000) || !boundedText(o.uncertainty,2000) || !['observed','manual'].includes(o.origin) || typeof o.excluded !== 'boolean') fail('零件证据无效：'+String(o?.id))
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

export function reconstructionSummary(r: Pick<Reconstruction, 'truncated' | 'candidates'>, evidence?: Evidence): string {
  return r.truncated ? '搜索未完成：预算已用尽，请查看诊断。' : r.candidates.length ? `${evidence?.observations.some(o=>o.excluded)?'部分作品（已明确排除零件）· ':''}成功：生成 ${r.candidates.length} 个合法候选，可以查看和选择。` : evidence&&(evidence.sourceKind==='unsupported'||evidence.observations.some(o=>!o.excluded&&o.profileId==='unknown')) ? '输入审核未完成，尚未进入几何搜索。' : '没有找到合法候选，请查看下方主要原因。'
}

// Presentation only: API completion is not evidence completeness or geometric validity.
export function recognitionSummary(e?: Evidence): string {
  if (!e?.observations.length) return '无可用识别结果：此记录没有可恢复的 Observation。可人工补片或由你决定重新识别；不会从旧空结果自动恢复零件。'
  const active=e.observations.filter(o=>!o.excluded), unknown=active.filter(o=>o.profileId==='unknown').length
  const excluded=e.observations.length-active.length
  const partial=e.sourceKind==='unsupported'||unknown>0||excluded>0||active.some(o=>o.uncertainty.trim()||o.confidence<.7)||e.relations.some(r=>r.intent==='uncertain'&&active.some(o=>o.id===r.from)&&active.some(o=>o.id===r.to))
  if (!active.length) return `无可用识别结果：全部 ${excluded} 块已排除，原始证据仍保留。`
  return `${partial?'部分识别：存在 Unknown、不确定结构或已排除零件。':'完整识别（按当前证据，可尝试重建）。'}采用 ${active.length} 块 · Known ${active.length-unknown} · Unknown ${unknown} · 已排除 ${excluded}。识别状态不代表几何合法或与原图完全吻合。`
}

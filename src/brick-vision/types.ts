import type { InventoryItem } from '../brick-inventory/inventory'
import type { MappingRow } from '../brick-game-contract'
import type { CatalogFeatures } from './catalog-features.mjs'

export type StepReference = {
  artifactId: string; designHash: string; instanceId: string; runId: string; taskAttemptId: string
  revision: number; index: number; taskId: string
}
export type Observation = CatalogFeatures & {
  id: string; status: 'certain' | 'uncertain'; candidates: { part_num: string; color_id: number }[]
  quantity: number; confidence: number; evidence: string; occlusion: string; bbox: number[]
}

export type ObservationCatalogSearch = {
  key: string; observationId: string; features: CatalogFeatures; quantity: string
  onChoose(item: InventoryItem, evidence: unknown): void
}
export type VisionMatch = {
  observation: Observation; status: 'matched' | 'uncertain'; reason: string; item: InventoryItem | null
  target: MappingRow['target']; candidates: { part_num: string; color_id: number; valid: boolean; mapping: MappingRow }[]
}
export type VisionResult = {
  prompt_id?: string; prompt_version?: number
  id: string; status: 'processing' | 'complete' | 'failed'; mode: 'inventory' | 'step'
  reference: StepReference | null; model: string; modelVersion?: string; elapsedMs?: number
  provider: 'gemini' | 'openai'; httpStatus?: number | null
  finishReason?: string; rawOutput?: string; usageMetadata?: unknown; request: unknown
  image: { mimeType: string; sha256: string; bytes: number }
  originalImage?: { mimeType: string; imageBase64: string; name: string; width: number; height: number } | null
  compression?: { original: { width: number; height: number; bytes: number }; sent: { width: number; height: number; bytes: number }; maxEdge: number; quality: number } | null
  matches?: VisionMatch[]; draft?: InventoryItem[]
  evaluation?: { verdict: 'confirm' | 'retry' | 'uncertain'; reason: string } | null
  error?: { stage: string; message: string; httpStatus?: number | null }
}

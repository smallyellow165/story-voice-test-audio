import type { CatalogBodyMetadata } from '../brick-vision/CatalogGeometryEvidence'
import type { PreparedSourceImage } from '../brick-vision/ServerImagePicker'
import type { GeometryFields } from './GeometryObservationTable'
import type { CatalogFeatures, CatalogQuery, FeatureEditor } from '../brick-vision/catalog-features.mjs'
import type { Media } from '../catalog-photo'
import type { SessionInventory } from '../brick-inventory/inventory'
import type { GenerationResult, InventoryRow } from './design-types'
export type Observation = Partial<CatalogFeatures> & GeometryFields & { id: string; quantity?: number; confidence: number; bbox: number[] | null; evidence: string; occlusion: string; visible_studs: number | null }
export type AnalysisMode = 'geometry_only' | 'catalog_match'
export type OutputValidation = { sourceAnalysisId: string; validatorVersion: string; rawOutputSha256: string; valid: boolean; parsed: boolean; observationCount: number; relationCount: number; issues: { path: string; expected: unknown; actual: unknown; message: string }[] }
export type Analysis = { analysis_mode?: AnalysisMode; prompt_id?: string; prompt_version?: number; image_reference?: { kind: string; name: string; sha256: string }; originalImage?: PreparedSourceImage['originalImage']; compression?: PreparedSourceImage['compression']; id: string; kind: string; status: string; model: string; provider: string; modelVersion?: string; source: { kind: string; inventory?: InventoryRow[]; session?: SessionInventory }; image: { mimeType: string; imageBase64: string };
  outputValidation?: OutputValidation | null; error?: { message: string }; analysis: { appearance: string; scale_evidence?: string; anchors?: { observation_id: string; evidence: string; confidence: number }[]; unknowns: string[]; observations: Observation[]; relations: unknown[] } | null }
export type Candidate = { partCandidates: string[]; colorCandidates: string[]; partCandidateChecks: { part: string; supported: boolean; local: { available: boolean } }[]; source: { part_num: string; color_id: number }; name: string; eligible: boolean; sourceAllowed: boolean; target: { part: string; color: string } | null; errors: string[]; catalog_geometry?: CatalogBodyMetadata; checks?: unknown[] }
export type Search = { id: string; partNumber?: string; features: CatalogQuery; page: number; pageSize: number; catalogTotal: number; rows: Candidate[]; images: Record<string, Media>; imageError: string | null; geometry_report?: unknown }
export type Draft = { features: FeatureEditor; quantity: string; excluded: boolean; reason: string; search?: Search; index?: number }
export type Artifact = { id: string; status: string; generation: GenerationResult | null; error?: string; designHash: string | null }

export type HistoryItem = { analysis_mode?: AnalysisMode; prompt_id?: string; prompt_version?: number; image_reference?: { name: string }; id: string; createdAt: string; provider: string; model: string; status: string; appearance: string; count: number }
export type History = { items: HistoryItem[]; warnings: string[] }
export type Restored = { analysis: Analysis; rows: Record<string, Draft>; artifact: Artifact | null; generationStatus: string; updatedAt: string | null; warnings: string[] }

export type Model = { id: string; label: string; provider: 'gemini' | 'openai' }

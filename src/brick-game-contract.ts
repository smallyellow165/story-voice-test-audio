import type { SessionInventory } from './brick-inventory/inventory.ts'
import type { BrickDesign, GenerationResult, InventoryRow } from './brick-test/design-types.ts'

export type MappingRow = {
  source: { part_num: string; color_id: number; quantity: number }
  sourcePartName: string | null; sourceColorName: string | null
  partCandidates: string[]; colorCandidates: string[]
  partCandidateChecks: {
    part: string; supported: boolean; eligible: boolean; reasons: string[]
    local: { available: boolean; entryAvailable: boolean; checkedFiles: number; errors: string[] }
  }[]
  target: { part: string; color: string; colorName: string } | null
  errors: string[]
}
export type GameSelectionItem = { part_num: string; color_id: number; quantity: number }
export type GameSelectionConfirmation = {
  accepted: true; reviewId: string; confirmedAt: string; items: GameSelectionItem[]
  excluded: (GameSelectionItem & { reasons: string[] })[]
}
export type InventoryReview = {
  schemaVersion: 1; id: string; session: SessionInventory
  confirmation?: GameSelectionConfirmation
  mapping: { valid: boolean; rows: MappingRow[]; inventory: InventoryRow[]; issues: string[] }
}
export type BrickGameArtifact = {
  schemaVersion: 1; id: string; createdAt: string; designHash: string
  review: InventoryReview
  generatorInput: { description: string; inventory: InventoryRow[]; model: string }
  generation: GenerationResult & { ok: true; design: BrickDesign }
}

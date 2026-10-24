import type { PartDefinition } from './brick-test/part-geometry.ts'
import type { validPosition } from './brick-test/catalog.ts'
import type { validateAssembly, footprint } from './brick-test/assembly.ts'
import type { DesignReport, InventoryRow } from './brick-test/design-types.ts'

/** Type surface for the shared .mjs implementation; no runtime validator here. */
export const designLimits: Readonly<{
  minBricks: number
  maxBricks: number
  maxLayer: number
  maxConfiguredLayer: number
  maxCoordinate: number
  minSupportFraction: number
}>

export type BrickValidationRules = {
  PARTS: readonly PartDefinition[]
  validPosition: typeof validPosition
  COLORS: readonly { readonly code: string }[]
  validateAssembly: typeof validateAssembly
  footprint: typeof footprint
}

/** The design is untrusted until the returned report confirms validity. */
export function validateBrickDesign(
  design: unknown,
  inventory: readonly InventoryRow[],
  rules: BrickValidationRules,
): DesignReport

/** Bounded generation budget derived from the selected reviewed part heights. */
export function designHeightLimits(
  inventory: readonly InventoryRow[] | undefined,
  rules: Pick<BrickValidationRules, "PARTS">,
): { maxLayer: number; maxTop: number }

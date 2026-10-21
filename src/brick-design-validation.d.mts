import type { validateAssembly, footprint } from './brick-test/assembly.ts'
import type { DesignReport, InventoryRow } from './brick-test/design-types.ts'

/** Type surface for the shared .mjs implementation; no runtime validator here. */
export const designLimits: Readonly<{
  minBricks: number
  maxBricks: number
  maxLayer: number
  maxCoordinate: number
  minSupportFraction: number
}>

export type BrickValidationRules = {
  PARTS: readonly { readonly id: string }[]
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

import type { PartDefinition } from './brick-test/part-geometry.ts'
import type { validPosition } from './brick-test/part-geometry.ts'
import type { GenerationResult } from './brick-test/design-types.ts'
export function assessDesignDisplay(design: unknown, rules: { PARTS: readonly PartDefinition[]; COLORS: readonly { code: string }[]; validPosition: typeof validPosition }): { renderable: boolean; issues: string[] }
export function selectDisplayCandidate(result: GenerationResult | null | undefined): GenerationResult | null

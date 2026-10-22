import type { StepReference, VisionResult } from './types.ts'
export function sameStep(a: StepReference | null | undefined, b: StepReference | null | undefined): boolean
export function canApplyVision(result: VisionResult, captured: StepReference | null, current: StepReference | null, permitted: boolean): boolean

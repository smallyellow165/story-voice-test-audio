import type { Brick } from './catalog'
import type { Validation } from './assembly'

export type InventoryRow = { part: string; color: string; quantity: number }
export type BrickDesign = { name: string; bricks: Brick[]; steps: { brickId: string; instruction: string }[] }
export type DesignReport = {
  valid: boolean
  issues: { code: string; message: string; brickId?: string; step?: number }[]
  assembly: Validation | null
  steps: { step: number; brickId: string; validation: Validation }[]
  usage: { part: string; color: string; available: number; used: number; remaining: number }[]
}
export type GenerationResult = {
  ok: boolean
  model?: string
  modelVersion?: string | null
  rawOutput?: string | null
  finishReason?: string | null
  blockReason?: string | null
  promptVersion?: string
  elapsedMs?: number
  error?: { code: string; message: string }
  validation?: DesignReport | null
  design?: BrickDesign
}

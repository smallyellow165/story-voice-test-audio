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
  approximation?: boolean
  requestInput?: { description: string; inventory: InventoryRow[] }
  provider?: 'gemini' | 'openai'
  httpStatus?: number | null
  tracePath?: string
  rawRequestPath?: string
  rawResponsePath?: string
  model?: string
  modelVersion?: string | null
  rawOutput?: string | null
  finishReason?: string | null
  blockReason?: string | null
  promptVersion?: string
  elapsedMs?: number
  usageMetadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; output_tokens_details?: { reasoning_tokens?: number }; promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number; [key: string]: unknown } | null
  generationSettings?: { maxOutputTokens?: number; reasoning?: { effort: string }; thinkingConfig?: { thinkingLevel: string }; httpOptions?: { timeout: number; retryOptions: { attempts: number } } }
  responseId?: string | null
  finishMessage?: string | null
  error?: { code: string; message: string }
  validation?: DesignReport | null
  design?: BrickDesign
}

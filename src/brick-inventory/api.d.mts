import type { BrickGameArtifact, InventoryReview } from '../brick-game-contract.ts'
import type { GenerationResult } from '../brick-test/design-types.ts'
import type { SessionInventory } from './inventory.ts'

export type GenerationAttempt = {
  reviewId: string
  generatorInput: BrickGameArtifact['generatorInput']
  generation: GenerationResult
  artifact: BrickGameArtifact | null
}

/** T describes the endpoint response; the implementation checks HTTP/JSON errors. */
export function requestJson<T = Record<string, unknown>>(
  url: string | URL,
  init: RequestInit,
  stage: string,
  fetchImpl?: typeof fetch,
  safeDetailOnly?: boolean,
): Promise<T>

export function postBrickGame(
  action: 'review',
  body: { session: SessionInventory },
  fetchImpl?: typeof fetch,
): Promise<InventoryReview>

export function postBrickGame(
  action: 'generate',
  body: { reviewId: string; description: string; model: string },
  fetchImpl?: typeof fetch,
): Promise<GenerationAttempt>

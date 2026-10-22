import type { BrickGameArtifact, InventoryReview, GameSelectionItem, GameSelectionConfirmation } from '../brick-game-contract.ts'
import type { GenerationResult } from '../brick-test/design-types.ts'
import type { SessionInventory } from './inventory.ts'

export type GenerationAttempt = {
  reviewId: string
  confirmation: GameSelectionConfirmation
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
  body: { reviewId: string; description: string; model: string; selection: GameSelectionItem[]; confirmSelection: true },
  fetchImpl?: typeof fetch,
): Promise<GenerationAttempt>

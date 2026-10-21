import type { GameAction, GamePermissions } from './game-permissions'
import type { ActivityMessage } from './activity-message'
import type { BrickGameArtifact } from './brick-game-contract'
export type { BrickGameArtifact } from './brick-game-contract'
export const brickArtifactVersion: 1
export function mount(host: HTMLElement, options: {
  artifact: BrickGameArtifact;
  permissions?: () => GamePermissions; onAction?: (name: GameAction, args: Record<string, unknown>) => void;
  libraryUrl?: string; instanceId: string; onMessage(message: ActivityMessage): void; canInteract?: () => boolean;
}): { restore(snapshot: Record<string, unknown>): void; snapshot(): Record<string, unknown>; setEnabled(enabled: boolean): void; receive(message: ActivityMessage): void; unmount(): void }

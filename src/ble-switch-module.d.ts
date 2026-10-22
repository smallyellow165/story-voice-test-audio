import type { GameAction, GamePermissions } from './game-permissions'
import type { ActivityMessage } from './activity-message'
export function mount(host: HTMLElement, options: {
  permissions?: () => GamePermissions; onAction?: (name: GameAction, args: Record<string, unknown>) => void;
  instanceId: string; onMessage(message: ActivityMessage): void; canInteract?: () => boolean;
}): { restore(snapshot: Record<string, unknown>): void; snapshot(): Record<string, unknown>; setEnabled(enabled: boolean): void; receive(message: ActivityMessage): void; unmount(): void }

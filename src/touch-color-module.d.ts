import type { ActivityMessage } from './activity-message'
export function mount(host: HTMLElement, options: {
  instanceId: string; onMessage(message: ActivityMessage): void; canInteract?: () => boolean;
}): { snapshot(): Record<string, unknown>; setEnabled(enabled: boolean): void; receive(message: ActivityMessage): void; unmount(): void }

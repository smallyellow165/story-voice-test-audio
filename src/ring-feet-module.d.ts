import type { ActivityMessage } from "./activity-message"
export type { ActivityMessage } from "./activity-message"
export type CameraLease = { stream: MediaStream; release(): void }
export function mount(host: HTMLElement, options: {
  canInteract?: () => boolean;
  instanceId: string; debug?: boolean; apiBase?: string;
  acquireCamera(): Promise<CameraLease>;
  onMessage(message: ActivityMessage): void;
}): { restore(snapshot: Record<string, unknown>): void; setEnabled(enabled: boolean): void; inspect(): { poseReady: boolean; poseStatus: string | null; inFlight: boolean }; receive(message: ActivityMessage): void; unmount(): void }

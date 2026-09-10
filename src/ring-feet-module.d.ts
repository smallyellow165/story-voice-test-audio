import type { ActivityMessage } from "./activity-message"
export type { ActivityMessage } from "./activity-message"
export type CameraLease = { stream: MediaStream; release(): void }
export function mount(host: HTMLElement, options: {
  instanceId: string; debug?: boolean; apiBase?: string;
  acquireCamera(): Promise<CameraLease>;
  onMessage(message: ActivityMessage): void;
}): { inspect(): { poseReady: boolean; poseStatus: string | null; inFlight: boolean }; receive(message: ActivityMessage): void; unmount(): void }

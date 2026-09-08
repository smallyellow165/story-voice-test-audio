export type ActivityMessage = {
  v: number; id: string; instanceId: string; kind: string; name: string;
  sessionEpoch?: string; payload: Record<string, unknown>;
}
export type CameraLease = { stream: MediaStream; release(): void }
export function mount(host: HTMLElement, options: {
  instanceId: string; apiBase?: string;
  acquireCamera(): Promise<CameraLease>;
  onMessage(message: ActivityMessage): void;
}): { receive(message: ActivityMessage): void; unmount(): void }

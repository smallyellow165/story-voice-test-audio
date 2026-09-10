export type ActivityMessage = {
  v: number; id: string; instanceId: string; kind: string; name: string;
  sessionEpoch?: string; payload: Record<string, unknown>;
}

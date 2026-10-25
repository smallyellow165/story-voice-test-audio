export function recognitionBlockReason(state: {
  busy: string; disabled: boolean; submitted: boolean; record: { id: string; status: string } | null;
  hasImage: boolean; modelAvailable: boolean; modelsReady: boolean; needsSession: boolean;
}): string

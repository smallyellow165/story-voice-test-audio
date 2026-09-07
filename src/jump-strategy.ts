/** Pure streaming contract: no DOM, ring geometry, camera or MediaPipe runtime. */
export type JumpState = 'UNKNOWN' | 'CALIBRATING' | 'GROUND' | 'TAKEOFF' | 'AIRBORNE' | 'LANDING' | 'IDLE' | 'JUMP'
export type JumpLandmark = { x: number; y: number; visibility?: number }
export type JumpInput = { timestampMs: number; landmarks: readonly JumpLandmark[] }
export type JumpEvent = {
  type: 'takeoff' | 'airborne' | 'landing' | 'completed' | 'cancelled' | 'detected'
  timestampMs: number
  durationMs?: number
}
export type JumpSnapshot = {
  state: JumpState
  event: JumpEvent | null // Edge event: only emitted on the update that caused it.
  reason: string
  debug: Record<string, number | string | null>
}
export interface JumpStrategy {
  readonly id: string
  readonly name: string
  update(input: JumpInput): JumpSnapshot
  reset(): JumpSnapshot
}

import type { JumpInput, JumpSnapshot, JumpState, JumpStrategy, JumpEvent } from './jump-strategy.ts'

/** Distances/speeds are in calibrated torso heights and torso heights/second.
 * Fixed camera, one person, upright initial stance, two-foot in-place jumps.
 * Image motion is a contact proxy, not a physical ground-contact measurement.
 */
export const BASELINE_JUMP_DEFAULTS = Object.freeze({
  minVisibility: 0.6,
  minTorsoHeight: 0.08, // Normalized image-y units; reject unusably small poses.
  calibrationMs: 800,
  calibrationRange: 0.035,
  smoothingMs: 60,
  takeoffLift: 0.045,
  takeoffSpeed: 0.15,
  takeoffHoldMs: 40,
  airborneLift: 0.09,
  airborneHoldMs: 60,
  groundBand: 0.035,
  groundSpeed: 0.35,
  landingHoldMs: 100,
  settleMs: 200,
  takeoffTimeoutMs: 600,
  jumpTimeoutMs: 2500,
  maxFrameGapMs: 250,
})
export type BaselineJumpConfig = { [K in keyof typeof BASELINE_JUMP_DEFAULTS]: number }
type Sample = { t: number; left: number; right: number; hip: number; scale: number }

export function createBaselineJumpStrategy(overrides: Partial<BaselineJumpConfig> = {}): JumpStrategy {
  const config = { ...BASELINE_JUMP_DEFAULTS, ...overrides }
  if (Object.values(config).some(v => !Number.isFinite(v) || v <= 0)
    || config.minVisibility > 1
    || !(config.groundBand < config.takeoffLift && config.takeoffLift < config.airborneLift)) {
    throw new Error('Invalid baseline jump parameters; require groundBand < takeoffLift < airborneLift')
  }
  let state: JumpState = 'UNKNOWN'
  let baseline: Sample | null = null
  let smooth: Sample | null = null
  let calibration: Sample[] = []
  let previousTimestamp: number | null = null
  let holdSince: number | null = null
  let startedAt: number | null = null
  let phaseSince = 0

  const snapshot = (reason: string, event: JumpEvent | null = null,
    debug: JumpSnapshot['debug'] = {}): JumpSnapshot => ({ state, event, reason,
    debug: { baselineLeftY: baseline?.left ?? null, baselineRightY: baseline?.right ?? null,
      torsoHeight: baseline?.scale ?? null, ...debug } })
  function clear() {
    state = 'UNKNOWN'
    baseline = smooth = null
    calibration = []
    holdSince = startedAt = previousTimestamp = null
  }
  function enter(next: JumpState, t: number) {
    state = next
    phaseSince = t
    holdSince = null
  }
  function held(condition: boolean, t: number, ms: number) {
    if (!condition) { holdSince = null; return false }
    holdSince ??= t
    return t - holdSince >= ms
  }
  function invalidate(t: number, reason: string) {
    const active = startedAt !== null
    clear()
    return snapshot(reason, active ? { type: 'cancelled', timestampMs: t } : null)
  }

  return {
    id: 'standing-foot-baseline-v1',
    name: 'Standing foot baseline V1',
    reset() { clear(); return snapshot('Stand upright and still to calibrate') },
    update({ timestampMs: t, landmarks }: JumpInput) {
      if (!Number.isFinite(t)) return invalidate(0, 'Invalid timestamp')
      if (previousTimestamp !== null && (t <= previousTimestamp || t - previousTimestamp > config.maxFrameGapMs)) {
        return invalidate(t, 'Sampling gap / timestamp discontinuity; recalibrate')
      }
      const required = [11, 12, 23, 24, 29, 30, 31, 32]
      if (required.some(i => {
        const p = landmarks[i]
        return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)
          || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1
          || !Number.isFinite(p.visibility) || (p.visibility ?? 0) < config.minVisibility
      })) return invalidate(t, 'Missing / low visibility landmarks; recalibrate')
      const hip = (landmarks[23]!.y + landmarks[24]!.y) / 2
      const scale = hip - (landmarks[11]!.y + landmarks[12]!.y) / 2
      if (scale < config.minTorsoHeight) return invalidate(t, 'Stand upright with torso and feet visible')
      const raw: Sample = { t, hip, scale,
        // Lowest foot landmark is a conservative contact proxy: raising only
        // a heel while the toe remains down should not look like takeoff.
        left: Math.max(landmarks[29]!.y, landmarks[31]!.y),
        right: Math.max(landmarks[30]!.y, landmarks[32]!.y) }
      const dt = previousTimestamp === null ? 0 : t - previousTimestamp
      previousTimestamp = t

      if (!baseline) {
        enter('CALIBRATING', t)
        calibration.push(raw)
        const keys = ['left', 'right', 'hip', 'scale'] as const
        if (keys.some(key => {
          const values = calibration.map(s => s[key])
          return Math.max(...values) - Math.min(...values) > config.calibrationRange * scale
        })) calibration = [raw]
        const progress = t - calibration[0]!.t
        if (progress < config.calibrationMs) return snapshot('Stand upright and still', null,
          { calibrationMs: progress, requiredMs: config.calibrationMs })
        const average = (key: typeof keys[number]) => calibration.reduce((sum, s) => sum + s[key], 0) / calibration.length
        baseline = { t, left: average('left'), right: average('right'), hip: average('hip'), scale: average('scale') }
        smooth = raw
        calibration = []
        enter('GROUND', t)
        return snapshot('Baseline ready')
      }

      const previous = smooth!
      const alpha = 1 - Math.exp(-dt / config.smoothingMs)
      smooth = { ...raw, left: previous.left + alpha * (raw.left - previous.left),
        right: previous.right + alpha * (raw.right - previous.right) }
      const leftLift = (baseline.left - smooth.left) / baseline.scale
      const rightLift = (baseline.right - smooth.right) / baseline.scale
      const leftSpeed = (previous.left - smooth.left) / baseline.scale * 1000 / dt
      const rightSpeed = (previous.right - smooth.right) / baseline.scale * 1000 / dt
      const bothLift = Math.min(leftLift, rightLift)
      const upwardSpeed = Math.min(leftSpeed, rightSpeed)
      const nearGround = Math.abs(leftLift) <= config.groundBand && Math.abs(rightLift) <= config.groundBand
      const settled = nearGround && Math.max(Math.abs(leftSpeed), Math.abs(rightSpeed)) <= config.groundSpeed
      const debug = { leftLift, rightLift, upwardSpeed, takeoffLift: config.takeoffLift,
        airborneLift: config.airborneLift, groundBand: config.groundBand,
        phaseMs: t - phaseSince }
      let event: JumpEvent | null = null
      if (startedAt !== null && t - startedAt > config.jumpTimeoutMs) return invalidate(t, 'Jump timed out; recalibrate')
      switch (state) {
        case 'GROUND':
          if (held(bothLift >= config.takeoffLift && upwardSpeed >= config.takeoffSpeed, t, config.takeoffHoldMs)) {
            startedAt = t
            enter('TAKEOFF', t)
            event = { type: 'takeoff', timestampMs: t }
          }
          break
        case 'TAKEOFF':
          if (held(bothLift >= config.airborneLift, t, config.airborneHoldMs)) {
            enter('AIRBORNE', t)
            event = { type: 'airborne', timestampMs: t }
          } else if (nearGround) {
            startedAt = null
            enter('GROUND', t)
            event = { type: 'cancelled', timestampMs: t }
          } else if (t - phaseSince > config.takeoffTimeoutMs) return invalidate(t, 'Takeoff not confirmed; recalibrate')
          break
        case 'AIRBORNE':
          if (held(settled, t, config.landingHoldMs)) {
            enter('LANDING', t)
            event = { type: 'landing', timestampMs: t }
          }
          break
        case 'LANDING':
          if (!nearGround) enter('AIRBORNE', t) // Bounce: same pending event.
          else if (held(settled, t, config.settleMs)) {
            event = { type: 'completed', timestampMs: t, durationMs: t - startedAt! }
            startedAt = null
            enter('GROUND', t)
          }
          break
      }
      return snapshot('Image-space contact estimate', event, debug)
    },
  }
}

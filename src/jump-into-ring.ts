/** Strategy-independent post-event check. Stability is a 2D landing proxy,
 * not a contact measurement. No jump detector or ring geometry lives here. */
export const LANDING_DEFAULTS = { delayMs: 600, stableMs: 300,
  maxRange: 0.008, maxFrameGapMs: 250, timeoutMs: 5000 }
type Point = readonly [number, number]
type Sample = { timestampMs: number; left: Point; right: Point; leftIn: boolean; rightIn: boolean }
export type LandingSnapshot = { state: 'WAITING' | 'YES' | 'NO'; reason: string; stableMs: number }
export type LandingInput = { timestampMs: number; jumpEvent: boolean; ringReady: boolean;
  left: Point | null; right: Point | null; leftIn: boolean | null; rightIn: boolean | null }

export function createJumpIntoRing(config = LANDING_DEFAULTS) {
  let started: number | null = null
  let lastTimestamp: number | null = null
  let samples: Sample[] = []
  let result: LandingSnapshot = { state: 'WAITING', reason: 'Waiting for a jump event', stableMs: 0 }
  function reset() {
    started = lastTimestamp = null; samples = []
    result = { state: 'WAITING', reason: 'Waiting for a jump event', stableMs: 0 }
    return result
  }
  return { reset, update(input: LandingInput): LandingSnapshot {
    const t = input.timestampMs
    if (input.jumpEvent) {
      started = t; lastTimestamp = null; samples = []
      result = { state: 'WAITING', reason: 'Jump event: waiting before checking feet', stableMs: 0 }
    }
    if (started === null) return result // Final YES/NO remains latched.
    if (t - started > config.timeoutMs) {
      started = null; samples = []
      return result = { state: 'WAITING', reason: 'No reliable landing within 5s; wait for a new jump', stableMs: 0 }
    }
    if (lastTimestamp !== null && (t <= lastTimestamp || t - lastTimestamp > config.maxFrameGapMs)) samples = []
    lastTimestamp = t
    if (t - started < config.delayMs) return result
    if (!input.ringReady || !input.left || !input.right || input.leftIn === null || input.rightIn === null) {
      samples = []
      return result = { state: 'WAITING', reason: 'Need a detected ring and both visible feet', stableMs: 0 }
    }
    const sample: Sample = { timestampMs: t, left: [...input.left], right: [...input.right],
      leftIn: input.leftIn, rightIn: input.rightIn }
    samples.push(sample)
    // Whole-window range, not per-frame distance: slow walking must not look stable.
    const moving = (['left', 'right'] as const).some(side => [0, 1].some(axis => {
      const values = samples.map(s => s[side][axis]!)
      return Math.max(...values) - Math.min(...values) > config.maxRange
    }))
    const boundaryFlicker = samples.some(s => s.leftIn !== sample.leftIn || s.rightIn !== sample.rightIn)
    if (moving || boundaryFlicker) samples = [sample]
    const stableMs = t - samples[0]!.timestampMs
    if (stableMs >= config.stableMs) {
      started = null; samples = []
      return result = { state: sample.leftIn && sample.rightIn ? 'YES' : 'NO',
        reason: 'Result latched from stable feet; wait for the next jump', stableMs }
    }
    return result = { state: 'WAITING', reason: 'Waiting for both feet and IN/OUT to stabilize', stableMs }
  } }
}

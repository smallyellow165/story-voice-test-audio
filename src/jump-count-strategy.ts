/** Adapted from work/jumpcount-main/main.js: Detector and onResults.
 * Keep 30-sample means, summed torso residuals, Detector(30, 1.0), zero
 * outlier influence, mean visibility >= .75, and prevsig > 0 && sig < 0.
 * Bounded history replaces ever-growing arrays without changing the recurrence.
 * Missing data/time discontinuities reset history instead of joining two people.
 */
import type { JumpStrategy, JumpSnapshot } from './jump-strategy.ts'

export const JUMP_COUNT_DEFAULTS = { historyLength: 30, lag: 30, threshold: 1.0,
  minMeanVisibility: 0.75, maxFrameGapMs: 250 }
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

export class RollingPeakDetector {
  private filtered: number[]
  private average = 0
  private deviation = 0
  private lag: number
  private threshold: number
  constructor(lag: number, threshold: number) {
    this.lag = lag; this.threshold = threshold
    this.filtered = Array(lag + 1).fill(0)
  }
  update(value: number) {
    const outlier = Math.abs(value - this.average) > this.threshold * this.deviation
    const signal = outlier ? (value > this.average ? 1 : -1) : 0
    const next = outlier ? this.filtered.at(-1)! : value
    // Original slice(i-lag, i) EXCLUDES the just-computed filtered value.
    const window = this.filtered.slice(-this.lag)
    this.average = mean(window)
    this.deviation = Math.sqrt(mean(window.map(v => (v - this.average) ** 2)))
    this.filtered.push(next)
    this.filtered.shift()
    return signal
  }
}

export function createJumpCountStrategy(config = JUMP_COUNT_DEFAULTS): JumpStrategy {
  const indices = [11, 12, 23, 24]
  let histories = indices.map(() => [] as number[])
  let detector = new RollingPeakDetector(config.lag, config.threshold)
  let previousSignal = 0
  let previousTime: number | null = null
  function reset(): JumpSnapshot {
    histories = indices.map(() => [])
    detector = new RollingPeakDetector(config.lag, config.threshold)
    previousSignal = 0; previousTime = null
    return { state: 'UNKNOWN', event: null, reason: 'Waiting for torso; rolling history starts immediately', debug: {} }
  }
  return {
    id: 'jump-count', name: 'Jump Count', reset,
    update({ landmarks, timestampMs: t }) {
      if (!Number.isFinite(t) || indices.some(i => !landmarks[i]
        || !Number.isFinite(landmarks[i]!.y) || !Number.isFinite(landmarks[i]!.visibility))) return reset()
      if (previousTime !== null && (t <= previousTime || t - previousTime > config.maxFrameGapMs)) reset()
      previousTime = t
      let residual = 0
      indices.forEach((index, i) => {
        const y = landmarks[index]!.y
        const history = histories[i]!
        history.push(y)
        if (history.length > config.historyLength) history.shift()
        residual += y - mean(history)
      })
      const visibility = mean(indices.map(i => landmarks[i]!.visibility!))
      const signal = visibility >= config.minMeanVisibility ? 0.3 * detector.update(residual) : 0
      const jump = previousSignal > 0 && signal < 0
      previousSignal = signal
      return { state: visibility < config.minMeanVisibility ? 'UNKNOWN' : signal < 0 ? 'JUMP' : 'IDLE',
        event: jump ? { type: 'detected', timestampMs: t } : null,
        reason: 'Negative torso peak is the signal; only positive → negative emits an event',
        debug: { torsoResidual: residual, peakSignal: signal, meanVisibility: visibility,
          historySamples: histories[0]!.length, historyLength: config.historyLength,
          lag: config.lag, threshold: config.threshold } }
    },
  }
}

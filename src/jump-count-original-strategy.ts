/** Thin TypeScript port of https://github.com/aminnj/jumpcount/main.js
 * Source of truth: work/jumpcount-main/main.js (Detector + onResults).
 * No gap reset, debounce, cooldown, re-arm, finite-value filtering or added
 * smoothing. Detector arrays deliberately grow exactly as in the original.
 * Helpers replace Array.prototype extensions without changing arithmetic.
 * reset() recreates the algorithm for strategy switching (unlike the original
 * UI's clearJumps(), which only cleared its counter/logs).
 */
import type { JumpStrategy, JumpSnapshot } from './jump-strategy.ts'

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
const std = (values: number[]) => {
  const average = mean(values)
  return Math.sqrt(values.map(x => Math.pow(x - average, 2)).reduce((a, b) => a + b, 0) / values.length)
}

export class OriginalJumpCountDetector {
  y: number[]
  lag: number
  threshold: number
  signals: number[]
  filteredY: number[]
  avgFilter: number[]
  stdFilter: number[]

  constructor(lag: number, threshold: number) {
    this.y = Array(lag + 1).fill(0)
    this.lag = lag
    this.threshold = threshold
    this.signals = Array(this.y.length).fill(0)
    this.filteredY = [...this.y]
    this.avgFilter = Array(this.y.length).fill(0)
    this.stdFilter = Array(this.y.length).fill(0)
    this.avgFilter[this.lag - 1] = mean(this.y.slice(0, this.lag))
    this.stdFilter[this.lag - 1] = std(this.y.slice(0, this.lag))
  }

  update(newval: number) {
    this.y.push(newval)
    const i = this.y.length - 1
    this.signals.push(0)
    this.filteredY.push(0)
    this.avgFilter.push(0)
    this.stdFilter.push(0)
    const dy = Math.abs(this.y[i]! - this.avgFilter[i - 1]!)
    const tlow = this.threshold * this.stdFilter[i - 1]!
    if (dy > tlow) {
      if (this.y[i]! > this.avgFilter[i - 1]!) this.signals[i] = 1
      else this.signals[i] = -1
      this.filteredY[i] = this.filteredY[i - 1]!
    } else {
      this.signals[i] = 0
      this.filteredY[i] = this.y[i]!
    }
    this.avgFilter[i] = mean(this.filteredY.slice(i - this.lag, i))
    this.stdFilter[i] = std(this.filteredY.slice(i - this.lag, i))
    return this.signals[i]!
  }
}

export function createJumpCountOriginalStrategy(): JumpStrategy {
  let rollings: Record<number, number[]> = { 11: [], 12: [], 23: [], 24: [] }
  let detector = new OriginalJumpCountDetector(30, 1.0)
  let prevsig = 0
  function reset(): JumpSnapshot {
    rollings = { 11: [], 12: [], 23: [], 24: [] }
    detector = new OriginalJumpCountDetector(30, 1.0)
    prevsig = 0
    return { state: 'UNKNOWN', event: null, reason: 'Original algorithm: waiting for torso', debug: {} }
  }
  return {
    id: 'jump-count-original', name: 'Jump Count Original', reset,
    update({ landmarks, timestampMs }): JumpSnapshot {
      // Original empty-landmark branch does not change histories or prevsig.
      // A malformed partial pose is treated as absent rather than crashing UI.
      if (!landmarks.length || [11, 12, 23, 24].some(i => !landmarks[i])) {
        return { state: 'UNKNOWN', event: null, reason: 'No torso; original history retained',
          debug: { peakSignal: 0, previousSignal: prevsig, historySamples: rollings[11]!.length } }
      }
      ;[11, 12, 23, 24].forEach(i => {
        rollings[i]!.push(landmarks[i]!.y)
        while (rollings[i]!.length > 30) rollings[i]!.shift()
      })
      const yval = (
        (landmarks[11]!.y - mean(rollings[11]!)) +
        (landmarks[12]!.y - mean(rollings[12]!)) +
        (landmarks[23]!.y - mean(rollings[23]!)) +
        (landmarks[24]!.y - mean(rollings[24]!)))
      const meanvis = (landmarks[11]!.visibility! + landmarks[12]!.visibility! +
        landmarks[23]!.visibility! + landmarks[24]!.visibility!) / 4
      let sig = 0
      if (meanvis >= 0.75) sig = 0.3 * detector.update(yval)
      const jump = prevsig > 0 && sig < 0
      prevsig = sig
      return { state: !(meanvis >= 0.75) ? 'UNKNOWN' : sig < 0 ? 'JUMP' : 'IDLE',
        event: jump ? { type: 'detected', timestampMs } : null,
        reason: 'Original: positive → negative signal emits one event; no time gating',
        debug: { torsoResidual: yval, meanVisibility: meanvis, peakSignal: sig,
          historySamples: rollings[11]!.length, detectorSamples: detector.y.length,
          lag: detector.lag, threshold: detector.threshold } }
    },
  }
}

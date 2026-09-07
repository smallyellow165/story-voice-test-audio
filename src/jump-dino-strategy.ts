/**
 * Adapted from work/dino-jump!/components/DinoGame.tsx, predictWebcam.
 * SPDX-License-Identifier: Apache-2.0 (as declared in the reference file).
 * Preserves shoulder-normalized upward velocity, EMA and peak decay.
 * Adaptation: confirmed trigger + quiet re-arm replace the game's grounded gate.
 * No game physics, floor calibration or claim of measured landing.
 */
import type { JumpStrategy, JumpSnapshot } from './jump-strategy.ts'

export const DINO_JUMP_DEFAULTS = { velocityThreshold: 2.5, emaAlpha: 0.5, peakDecay: 0.95,
  maxFrameGapMs: 250, minShoulderDistance: 0.001,
  minVisibility: 0.6, triggerHoldMs: 40, cooldownMs: 350,
  rearmVelocity: 0.6, rearmHoldMs: 100 }

export function createDinoJumpStrategy(config = DINO_JUMP_DEFAULTS): JumpStrategy {
  let previous: { y: number; t: number } | null = null
  let velocity = 0
  let peak = 0
  let armed = true
  let triggerSince: number | null = null
  let quietSince: number | null = null
  let lastEvent = -Infinity
  function reset(): JumpSnapshot {
    previous = null; velocity = peak = 0; armed = true
    triggerSince = quietSince = null; lastEvent = -Infinity
    return { state: 'UNKNOWN', event: null, reason: 'Waiting for shoulders; no calibration', debug: {} }
  }
  function interrupted(): JumpSnapshot {
    // Tracking loss must not unlock an in-progress jump or join distant samples.
    previous = null; velocity = peak = 0; armed = false
    triggerSince = quietSince = null
    return { state: 'UNKNOWN', event: null, reason: 'Shoulder tracking interrupted; wait for quiet re-arm', debug: {} }
  }
  return {
    id: 'dino-jump', name: 'Dino Jump', reset,
    update({ landmarks, timestampMs: t }) {
      const left = landmarks[11], right = landmarks[12]
      if (!Number.isFinite(t) || !left || !right
        || ![left.x, left.y, right.x, right.y].every(Number.isFinite)
        || ![left, right].every(p => Number.isFinite(p.visibility) && p.visibility! >= config.minVisibility)) return interrupted()
      const distance = Math.hypot(left.x - right.x, left.y - right.y)
      if (distance < config.minShoulderDistance) return interrupted()
      if (previous && (t <= previous.t || t - previous.t > config.maxFrameGapMs)) return interrupted()
      const y = (left.y + right.y) / 2
      const raw = previous ? (previous.y - y) / distance / ((t - previous.t) / 1000) : 0
      velocity = velocity * (1 - config.emaAlpha) + raw * config.emaAlpha
      peak = velocity > peak ? velocity : peak * config.peakDecay
      previous = { y, t }
      const detected = velocity > config.velocityThreshold
      let edge = false
      if (!armed) {
        // Quiet means near-zero speed, not merely below the positive trigger.
        // Only start this window after lockout, so the apex cannot pre-arm it.
        if (t - lastEvent >= config.cooldownMs && Math.abs(velocity) <= config.rearmVelocity) {
          quietSince ??= t
          if (t - quietSince >= config.rearmHoldMs) { armed = true; quietSince = null }
        } else quietSince = null
      } else if (detected) {
        triggerSince ??= t
        if (t - triggerSince >= config.triggerHoldMs) {
          edge = true; armed = false; lastEvent = t
          triggerSince = quietSince = null
        }
      } else triggerSince = null
      return { state: detected ? 'JUMP' : 'IDLE',
        event: edge ? { type: 'detected', timestampMs: t } : null,
        reason: armed ? 'Armed: waiting for sustained upward velocity' : 'Locked: waiting for cooldown + quiet shoulders',
        debug: { shoulderY: y, shoulderDistance: distance, rawVelocity: raw,
          smoothedVelocity: velocity, threshold: config.velocityThreshold, peakVelocity: peak,
          armed: armed ? 'YES' : 'NO', cooldownRemainingMs: Math.max(0, config.cooldownMs - (t - lastEvent)),
          quietMs: quietSince === null ? 0 : t - quietSince,
          triggerMs: triggerSince === null ? 0 : t - triggerSince,
          rearmVelocity: config.rearmVelocity, rearmHoldMs: config.rearmHoldMs } }
    },
  }
}

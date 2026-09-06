import assert from 'node:assert/strict'
import test from 'node:test'

import {
  centeredMovingAverage,
  defaultPoseHarvestConfig,
  detectPoseHarvestTurningPoints,
  harvestPoseKeyframes,
  nearestDetectedPoseFrame,
} from '../src/pose-keyframe-harvest.ts'

const poseAt = (openness) => {
  const landmarks = Array.from({ length: 33 }, (_, index) => ({
    x: 0.48 + (index % 3) * 0.02,
    y: 0.3 + Math.floor(index / 3) * 0.025,
    z: 0,
  }))
  const assign = (index, x, y) => { landmarks[index] = { x, y, z: 0 } }
  assign(11, 0.44, 0.38)
  assign(12, 0.56, 0.38)
  assign(13, 0.42 - openness * 0.08, 0.46 - openness * 0.17)
  assign(14, 0.58 + openness * 0.08, 0.46 - openness * 0.17)
  assign(15, 0.47 - openness * 0.25, 0.54 - openness * 0.39)
  assign(16, 0.53 + openness * 0.25, 0.54 - openness * 0.39)
  assign(23, 0.46, 0.60)
  assign(24, 0.54, 0.60)
  assign(25, 0.46 - openness * 0.07, 0.74)
  assign(26, 0.54 + openness * 0.07, 0.74)
  assign(27, 0.47 - openness * 0.20, 0.90)
  assign(28, 0.53 + openness * 0.20, 0.90)
  assign(29, 0.46 - openness * 0.20, 0.91)
  assign(30, 0.54 + openness * 0.20, 0.91)
  assign(31, 0.45 - openness * 0.20, 0.92)
  assign(32, 0.55 + openness * 0.20, 0.92)
  return landmarks
}

const frameAt = (videoTimestampMs, openness, detected = true) => ({
  videoTimestampMs,
  landmarks: detected ? [poseAt(openness)] : [],
  worldLandmarks: [[{ x: 999, y: 999, z: 999 }]],
})

test('maps a requested timestamp to the nearest detected Raw Pose frame with stable tie handling', () => {
  const frames = [frameAt(0, 0), frameAt(100, 0.1, false), frameAt(200, 0.2), frameAt(300, 0.3)]
  assert.deepEqual(nearestDetectedPoseFrame(frames, 120), {
    requestedTimestampMs: 120,
    frameIndex: 2,
    videoTimestampMs: 200,
  })
  assert.equal(nearestDetectedPoseFrame(frames, 250).frameIndex, 2)
  assert.throws(() => nearestDetectedPoseFrame([frameAt(0, 0, false)], 0), /no detected frames/)
})

test('uses a centered five-frame moving average including shorter edge windows', () => {
  assert.deepEqual(centeredMovingAverage([0, 0, 10, 0, 0], 5), [10 / 3, 2.5, 2, 2.5, 10 / 3])
  assert.throws(() => centeredMovingAverage([1, 2], 4), /positive odd/)
})

test('phase distance has the requested sign and repeated trajectory extrema become candidates', () => {
  const frames = Array.from({ length: 61 }, (_, index) =>
    frameAt(index * 100, 0.5 - 0.5 * Math.cos(2 * Math.PI * index / 20)))
  const result = harvestPoseKeyframes({
    frames,
    frameWidth: 640,
    frameHeight: 360,
    stateASeedTimestampsMs: [1000],
    stateBSeedTimestampsMs: [0, 2000],
  })

  assert.equal(result.frames[10].dStateA, 0)
  assert.ok(result.frames[10].rawPhaseScore > 0.99)
  assert.equal(result.frames[0].dStateB, 0)
  assert.ok(result.frames[0].rawPhaseScore < -0.99)
  assert.deepEqual(result.candidates.map(({ state, videoTimestampMs }) => [state, videoTimestampMs]), [
    ['stateA', 1000],
    ['stateB', 2000],
    ['stateA', 3000],
    ['stateB', 4000],
    ['stateA', 5000],
  ])
  assert.ok(result.candidates.every((candidate) => Number.isFinite(candidate.dStateA) && Number.isFinite(candidate.dStateB)))
})

test('same-state extrema inside the temporal debounce window retain the stronger turning point', () => {
  const scores = [0, 0.3, 0.1, 0.6, 0.1, -0.7, -0.1]
  const frames = scores.map((score, index) => ({
    frameIndex: index,
    videoTimestampMs: index * 100,
    dStateA: 1,
    dStateB: 1,
    rawPhaseScore: score,
    smoothedPhaseScore: score,
  }))
  const candidates = detectPoseHarvestTurningPoints(frames, {
    ...defaultPoseHarvestConfig,
    extremaWindowFrames: 1,
    minimumProminence: 0.05,
    minimumTemporalDistanceMs: 450,
  })
  assert.deepEqual(candidates.map(({ state, videoTimestampMs }) => [state, videoTimestampMs]), [
    ['stateA', 300],
    ['stateB', 500],
  ])
})

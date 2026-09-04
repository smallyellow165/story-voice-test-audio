import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertCompletePoseTimeline,
  createPoseTargetTimestamps,
  processTargetsSequentially,
} from '../src/pose-offline-sampling.ts'

test('target timestamps are deterministic for a fixed duration and FPS', () => {
  const first = createPoseTargetTimestamps(9866.667, 30)
  const second = createPoseTargetTimestamps(9866.667, 30)
  assert.deepEqual(first, second)
  assert.equal(first.length, 296)
  assert.deepEqual(first.slice(0, 4), [0, 33.333333, 66.666667, 100])
  assert.equal(first.at(-1), 9833.333333)

  const firstDecodedAtOneFrame = createPoseTargetTimestamps(9866.667, 30, 33.333333)
  assert.equal(firstDecodedAtOneFrame.length, 295)
  assert.equal(firstDecodedAtOneFrame[0], 33.333333)
  assert.equal(firstDecodedAtOneFrame.at(-1), 9833.333333)
})

test('slow first inference does not remove planned targets', async () => {
  const targets = createPoseTargetTimestamps(166.667, 30)
  let simulatedProcessingMs = 0
  const results = await processTargetsSequentially(targets, async (timestamp, index) => {
    simulatedProcessingMs += index === 0 ? 1000 : 10
    await Promise.resolve()
    return timestamp
  })
  assert.deepEqual(results, targets)
  assert.equal(results.length, targets.length)
  assert.equal(results[1] - results[0], 33.333333)
  assert.equal(simulatedProcessingMs, 1000 + (targets.length - 1) * 10)
})

test('consistently slow inference stays serial and complete without a queue', async () => {
  const targets = createPoseTargetTimestamps(133.334, 30)
  let active = 0
  let maximumActive = 0
  let simulatedProcessingMs = 0
  const results = await processTargetsSequentially(targets, async (timestamp) => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    simulatedProcessingMs += 50
    await Promise.resolve()
    active -= 1
    return timestamp
  })
  assert.equal(maximumActive, 1)
  assert.equal(simulatedProcessingMs, targets.length * 50)
  assert.deepEqual(results, targets)
})

test('timeline validation rejects duplicates, backward values, and missing results', () => {
  assert.doesNotThrow(() => assertCompletePoseTimeline([0, 33.333333, 66.666667], [0, 33.333333, 66.666667]))
  assert.throws(() => assertCompletePoseTimeline([0, 33.333333], [0]), /returned 1 of 2/)
  assert.throws(() => assertCompletePoseTimeline([0, 33.333333], [0, 0]), /strictly increasing/)
  assert.throws(() => assertCompletePoseTimeline([0, 33.333333], [0, 20]), /planned timestamp/)
})

test('duration boundary is predictable and never seeks to or beyond duration', () => {
  assert.deepEqual(createPoseTargetTimestamps(10, 30), [0])
  assert.deepEqual(createPoseTargetTimestamps(33.333333, 30), [0])
  assert.deepEqual(createPoseTargetTimestamps(50, 30), [0, 33.333333])
  const targets = createPoseTargetTimestamps(7566.667, 30)
  assert.equal(targets.length, 227)
  assert.equal(targets.at(-1), 7533.333333)
  assert.ok(targets.every((timestamp) => timestamp < 7566.667))
})

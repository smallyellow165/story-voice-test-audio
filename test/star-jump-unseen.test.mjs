import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PoseClassifier } from '../src/pose-classifier.ts'
import {
  classifyUnseenStarJumpFrames,
  summarizeUnseenStarJump,
} from '../src/star-jump-unseen.ts'

const rawPoseUrl = new URL('../public/test-videos/video-007/pose/video-007_clip-001_pose-001.json', import.meta.url)
const trainingRoot = new URL('./fixtures/pose-classifier/star-jump/', import.meta.url)
const rawPose = JSON.parse(await readFile(rawPoseUrl, 'utf8'))
const trainingFiles = await Promise.all(['star_close.csv', 'star_open.csv'].map(async (fileName) => ({
  fileName,
  contents: await readFile(new URL(fileName, trainingRoot), 'utf8'),
})))
const classifier = PoseClassifier.fromCsvFiles(trainingFiles)

test('classifies the unseen video-007 Raw Pose artifact with existing Star Jump CSV training only', () => {
  const frames = classifyUnseenStarJumpFrames({
    frames: rawPose.frames,
    frameWidth: 1920,
    frameHeight: 1080,
    classifier,
  })
  const summary = summarizeUnseenStarJump(frames)

  assert.equal(rawPose.source.videoId, 'video-007')
  assert.equal(rawPose.source.clipId, 'video-007_clip-001')
  assert.equal(rawPose.source.poseRunId, 'video-007_clip-001_pose-001')
  assert.equal(rawPose.frameCount, 420)
  assert.equal(rawPose.detectedPoseFrameCount, 420)
  assert.equal(frames.length, 420)
  assert.ok(frames.every((frame, index) =>
    index === 0 || frames[index - 1].videoTimestampMs < frame.videoTimestampMs))
  assert.ok(frames.every((frame) =>
    Number.isFinite(frame.rawClose)
    && Number.isFinite(frame.rawOpen)
    && Number.isFinite(frame.emaClose)
    && Number.isFinite(frame.emaOpen)))
  assert.deepEqual(summary.rawWinnerCounts, { star_close: 205, star_open: 215 })
  assert.deepEqual(summary.emaWinnerCounts, { star_close: 202, star_open: 218 })
  assert.equal(summary.emaTransitions.length, 18)
  assert.deepEqual(summary.emaWinnerSequence, [
    'star_open', 'star_close', 'star_open', 'star_close', 'star_open',
    'star_close', 'star_open', 'star_close', 'star_open', 'star_close',
    'star_open', 'star_close', 'star_open', 'star_close', 'star_open',
    'star_close', 'star_open', 'star_close', 'star_open',
  ])

  const worldLandmarksAltered = structuredClone(rawPose.frames)
  worldLandmarksAltered.forEach((frame) => {
    frame.worldLandmarks = [[...Array.from({ length: 33 }, () => ({ x: 999, y: -999, z: 123 }))]]
  })
  const withAlteredWorldLandmarks = classifyUnseenStarJumpFrames({
    frames: worldLandmarksAltered,
    frameWidth: 1920,
    frameHeight: 1080,
    classifier,
  })
  assert.deepEqual(withAlteredWorldLandmarks, frames)
})

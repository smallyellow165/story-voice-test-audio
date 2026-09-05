import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  PoseClassifier,
  loadPoseSamplesFromCsvFiles,
  rawPoseFrameToClassifierLandmarks,
} from '../src/pose-classifier.ts'
import {
  exportExtendedPoseDataset,
  starJumpPoseAnchors,
} from '../src/star-jump-dataset-exporter.ts'

const testVideoRoot = new URL('../public/test-videos/', import.meta.url)
const rawPoseUrl = new URL('video-006/pose/video-006_clip-001_pose-001.json', testVideoRoot)
const fixtureRoot = new URL('./fixtures/pose-classifier/star-jump/', import.meta.url)
const frameWidth = 1920
const frameHeight = 1080

const rawPose = JSON.parse(await readFile(rawPoseUrl, 'utf8'))
const dataset = exportExtendedPoseDataset({
  frames: rawPose.frames,
  poseRunId: rawPose.source.poseRunId,
  frameWidth,
  frameHeight,
  anchors: starJumpPoseAnchors,
})

const sampleIndexes = (className) => dataset.samples
  .filter((sample) => sample.className === className)
  .map((sample) => sample.frameIndex)

test('maps the video-006 Star Jump anchors to deterministic nearest Raw Pose frames', () => {
  assert.equal(rawPose.source.videoId, 'video-006')
  assert.equal(rawPose.source.clipId, 'video-006_clip-001')
  assert.equal(rawPose.source.poseRunId, 'video-006_clip-001_pose-001')
  assert.equal(rawPose.frameCount, 180)
  assert.deepEqual(dataset.anchorMatches, [
    { className: 'star_close', timestampMs: 392, frameIndex: 12, videoTimestampMs: 400 },
    { className: 'star_close', timestampMs: 1492, frameIndex: 45, videoTimestampMs: 1500 },
    { className: 'star_close', timestampMs: 2492, frameIndex: 75, videoTimestampMs: 2500 },
    { className: 'star_close', timestampMs: 3492, frameIndex: 105, videoTimestampMs: 3500 },
    { className: 'star_close', timestampMs: 4392, frameIndex: 132, videoTimestampMs: 4400 },
    { className: 'star_close', timestampMs: 5800, frameIndex: 174, videoTimestampMs: 5800 },
    { className: 'star_open', timestampMs: 992, frameIndex: 30, videoTimestampMs: 1000 },
    { className: 'star_open', timestampMs: 1992, frameIndex: 60, videoTimestampMs: 2000 },
    { className: 'star_open', timestampMs: 2992, frameIndex: 90, videoTimestampMs: 3000 },
    { className: 'star_open', timestampMs: 3992, frameIndex: 120, videoTimestampMs: 4000 },
    { className: 'star_open', timestampMs: 4892, frameIndex: 147, videoTimestampMs: 4900 },
  ])
})

test('expands each anchor by two frames, clips boundaries, deduplicates, and keeps timestamp order', () => {
  assert.deepEqual(sampleIndexes('star_close'), [
    10, 11, 12, 13, 14,
    43, 44, 45, 46, 47,
    73, 74, 75, 76, 77,
    103, 104, 105, 106, 107,
    130, 131, 132, 133, 134,
    172, 173, 174, 175, 176,
  ])
  assert.deepEqual(sampleIndexes('star_open'), [
    28, 29, 30, 31, 32,
    58, 59, 60, 61, 62,
    88, 89, 90, 91, 92,
    118, 119, 120, 121, 122,
    145, 146, 147, 148, 149,
  ])
  assert.equal(sampleIndexes('star_close').length, 30)
  assert.equal(sampleIndexes('star_open').length, 25)
  assert.ok(dataset.samples.every((sample, index) =>
    index === 0 || dataset.samples[index - 1].videoTimestampMs < sample.videoTimestampMs))

  const shortFrames = rawPose.frames.slice(0, 3)
  const boundaryDataset = exportExtendedPoseDataset({
    frames: shortFrames,
    poseRunId: 'short',
    frameWidth,
    frameHeight,
    expansionRadius: 2,
    anchors: [
      { className: 'edge', timestampMs: 0 },
      { className: 'edge', timestampMs: 0 },
      { className: 'edge', timestampMs: shortFrames.at(-1).videoTimestampMs },
    ],
  })
  assert.deepEqual(boundaryDataset.samples.map((sample) => sample.frameIndex), [0, 1, 2])
  assert.equal(boundaryDataset.samples.length, 3)
})

test('exports Extended Colab rows from image landmarks only through the shared adapter', async () => {
  const generatedFiles = await Promise.all(['star_close.csv', 'star_open.csv'].map(async (fileName) => ({
    fileName,
    contents: await readFile(new URL(fileName, fixtureRoot), 'utf8'),
  })))

  for (const file of generatedFiles) {
    const expectedCsv = dataset.csvByClass[file.fileName.replace('.csv', '')]
    assert.equal(file.contents, expectedCsv)
    for (const row of file.contents.trim().split('\n')) {
      const columns = row.split(',')
      assert.equal(columns.length, 100)
      assert.ok(columns[0].startsWith('video-006_clip-001_pose-001_frame-'))
      assert.equal(columns.slice(1).length, 33 * 3)
      assert.ok(columns.slice(1).every((value) => Number.isFinite(Number(value))))
    }
  }

  const representative = dataset.samples.find((sample) => sample.frameIndex === 12)
  const sharedAdapterResult = rawPoseFrameToClassifierLandmarks(rawPose.frames[12], frameWidth, frameHeight)
  assert.deepEqual(representative.landmarks, sharedAdapterResult)
  const representativeCsv = dataset.csvByClass.star_close.split('\n')[2].split(',').slice(1).map(Number)
  assert.deepEqual(representativeCsv, representative.landmarks.flat())

  const alteredWorldLandmarks = structuredClone(rawPose.frames)
  alteredWorldLandmarks.forEach((frame) => {
    frame.worldLandmarks = [[...Array.from({ length: 33 }, () => ({ x: 999, y: -999, z: 123 }))]]
  })
  const worldAlteredDataset = exportExtendedPoseDataset({
    frames: alteredWorldLandmarks,
    poseRunId: rawPose.source.poseRunId,
    frameWidth,
    frameHeight,
    anchors: starJumpPoseAnchors,
  })
  assert.deepEqual(worldAlteredDataset.csvByClass, dataset.csvByClass)
})

test('loads the generated class-per-CSV files and classifies their own source samples', async () => {
  const files = await Promise.all(['star_close.csv', 'star_open.csv'].map(async (fileName) => ({
    fileName,
    contents: await readFile(new URL(fileName, fixtureRoot), 'utf8'),
  })))
  const trainingSamples = loadPoseSamplesFromCsvFiles(files)
  assert.equal(trainingSamples.length, 55)
  assert.deepEqual([...new Set(trainingSamples.map((sample) => sample.className))].sort(), ['star_close', 'star_open'])

  const classifier = PoseClassifier.fromCsvFiles(files)
  const selfClassifications = trainingSamples.map((sample) => ({
    className: sample.className,
    result: classifier.classify(sample.landmarks),
  }))
  assert.ok(selfClassifications.every(({ className, result }) => {
    const winner = Object.entries(result).sort(([, leftScore], [, rightScore]) => rightScore - leftScore)[0]?.[0]
    return result[className] > 0 && winner === className
  }))
})

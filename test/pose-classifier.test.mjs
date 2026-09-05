import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  EMADictSmoothing,
  FullBodyPoseEmbedder,
  PoseClassifier,
  RepetitionCounter,
  loadPoseSamplesFromCsvFiles,
  rawPoseFrameToClassifierLandmarks,
} from '../src/pose-classifier.ts'

const fixtureRoot = new URL('./fixtures/pose-classifier/synthetic/', import.meta.url)

const loadFixtures = async () => Promise.all(['pushups_down.csv', 'pushups_up.csv'].map(async (fileName) => ({
  fileName,
  contents: await readFile(new URL(fileName, fixtureRoot), 'utf8'),
})))

const repeatSamples = (samples, count) => samples.flatMap((sample) =>
  Array.from({ length: count }, (_, index) => ({
    ...sample,
    name: `${sample.name}_${index}`,
    landmarks: sample.landmarks.map((point) => [...point]),
    embedding: sample.embedding.map((point) => [...point]),
  })))

const assertClose = (actual, expected, tolerance = 1e-5, path = 'value') => {
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${path}: expected ${expected}, received ${actual}`)
    return
  }
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${path}.length`)
    expected.forEach((value, index) => assertClose(actual[index], value, tolerance, `${path}[${index}]`))
    return
  }
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path} keys`)
  Object.entries(expected).forEach(([key, value]) => assertClose(actual[key], value, tolerance, `${path}.${key}`))
}

test('loads official class-per-CSV samples and uses the filename as class name', async () => {
  const files = await loadFixtures()
  const samples = loadPoseSamplesFromCsvFiles(files)
  assert.deepEqual(samples.map(({ name, className }) => ({ name, className })), [
    { name: 'pushups_down_001', className: 'pushups_down' },
    { name: 'pushups_up_001', className: 'pushups_up' },
  ])
  assert.equal(samples[0].landmarks.length, 33)
  assert.equal(samples[0].embedding.length, 23)

  const classifier = new PoseClassifier(samples, new FullBodyPoseEmbedder(), {
    topNByMaxDistance: 2,
    topNByMeanDistance: 1,
  })
  assert.deepEqual(classifier.classify(samples[0].landmarks), { pushups_down: 1 })
  assert.throws(
    () => loadPoseSamplesFromCsvFiles([{ fileName: 'broken.csv', contents: 'sample,1,2,3\n' }]),
    /expected 100/,
  )
})

test('matches the original Python notebook normalization and 23-vector embedding', async () => {
  const files = await loadFixtures()
  const samples = loadPoseSamplesFromCsvFiles(files)
  const down = samples.find((sample) => sample.className === 'pushups_down')
  const reference = JSON.parse(await readFile(new URL('python-reference.json', fixtureRoot), 'utf8'))
  const embedder = new FullBodyPoseEmbedder()

  assertClose(embedder.normalizePoseLandmarks(down.landmarks), reference.normalizedDown)
  assertClose(embedder.embed(down.landmarks), reference.embeddingDown)
})

test('matches Python two-stage classification, mirrored comparison, EMA, and repetition state', async () => {
  const files = await loadFixtures()
  const baseSamples = loadPoseSamplesFromCsvFiles(files)
  const samples = repeatSamples(baseSamples, 10)
  const classifier = new PoseClassifier(samples)
  const smoother = new EMADictSmoothing()
  const counter = new RepetitionCounter('pushups_down')
  const reference = JSON.parse(await readFile(new URL('python-reference.json', fixtureRoot), 'utf8'))
  const byClass = new Map(baseSamples.map((sample) => [sample.className, sample.landmarks]))

  const mirroredDown = byClass.get('pushups_down').map(([x, y, z]) => [-x, y, z])
  assert.deepEqual(classifier.classify(mirroredDown), reference.mirroredDownClassification)

  reference.frames.forEach((expected, index) => {
    const classification = classifier.classify(byClass.get(expected.input))
    const ema = smoother.smooth(classification)
    const repetitions = counter.count(ema)
    assert.deepEqual(classification, expected.classification, `frame ${index} classification`)
    assertClose(ema, expected.ema, 1e-12, `frame ${index} EMA`)
    assert.equal(counter.poseEntered, expected.poseEntered, `frame ${index} entered state`)
    assert.equal(repetitions, expected.repetitions, `frame ${index} repetitions`)
  })
  assert.equal(counter.nRepeats, 2)
  assert.deepEqual(classifier.findPoseSampleOutliers(), [])
})

test('adapts only Raw Pose normalized image landmarks using x-width, y-height, z-width', () => {
  const imagePose = Array.from({ length: 33 }, (_, index) => ({
    x: 0.1 + index / 100,
    y: 0.2 + index / 100,
    z: -0.3 + index / 100,
    visibility: 0.9,
  }))
  const worldPose = Array.from({ length: 33 }, () => ({ x: 999, y: 999, z: 999 }))
  const frame = { videoTimestampMs: 0, landmarks: [imagePose], worldLandmarks: [worldPose] }
  const adapted = rawPoseFrameToClassifierLandmarks(frame, 640, 360)

  assert.deepEqual(adapted[0], [Math.fround(64), Math.fround(72), Math.fround(-192)])
  assert.deepEqual(adapted[32], [Math.fround(268.8), Math.fround(187.2), Math.fround(12.8)])
  assert.equal(rawPoseFrameToClassifierLandmarks({ ...frame, landmarks: [] }, 640, 360), null)
  assert.throws(() => rawPoseFrameToClassifierLandmarks(frame, 0, 360), /positive finite/)
})

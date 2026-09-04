import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createVideoLibraryRepository } from '../server/video-library-repository.mjs'
import { resolvePoseResultFullPath, savePoseResult } from '../server/pose-result-store.mjs'
import { buildLlmPoseResult, compressPoseForLlm, resolveLlmPoseResultFullPath } from '../server/pose-llm-compressor.mjs'

const landmark = (seed) => ({ x: seed, y: seed + 0.1, z: seed - 0.1, visibility: 0.9, presence: 0.8 })
const pose = (seed) => Array.from({ length: 33 }, (_, index) => landmark(seed + index / 100))
const frame = (videoTimestampMs, detected = true) => ({
  videoTimestampMs,
  landmarks: detected ? [pose(videoTimestampMs / 1000)] : [],
  worldLandmarks: detected ? [pose(videoTimestampMs / 2000)] : [],
})

const poseData = (frames) => ({
  schemaVersion: 1,
  task: 'MediaPipe Pose Landmarker',
  model: {
    packageVersion: '1.0.1',
    modelName: 'Pose Landmarker Lite (float16)',
    modelAssetPath: 'https://example.test/pose.task',
    runningMode: 'VIDEO',
    delegate: 'CPU',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  },
  durationMs: 100,
  processingDurationMs: 25,
  frameCount: frames.length,
  detectedPoseFrameCount: frames.filter((item) => item.landmarks.length > 0).length,
  frames,
})

const setup = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'story-voice-pose-'))
  const testVideos = path.join(root, 'public', 'test-videos')
  const clips = path.join(testVideos, 'clips')
  const poseDirectory = path.join(testVideos, 'pose')
  const storagePath = path.join(root, 'data', 'video-library.json')
  await mkdir(clips, { recursive: true })
  await writeFile(path.join(clips, 'sample-clip.mp4'), 'not-a-real-video')
  const repository = createVideoLibraryRepository(storagePath)
  await repository.replaceVideos([{
    id: 'server:sample.mp4',
    type: 'server',
    file: { name: 'sample.mp4', size: 1, lastModified: 1 },
    server: { relativePath: 'source/sample.mp4', url: '/test-videos/source/sample.mp4' },
    clips: [{
      id: 'clip-1',
      start: 0,
      end: 0.1,
      duration: 0.1,
      createdAt: '2026-01-01T00:00:00.000Z',
      generatedClip: {
        filename: 'sample-clip.mp4',
        relativePath: 'clips/sample-clip.mp4',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nextClipNumber: 2,
  }])
  return { root, clips, poseDirectory, repository }
}

test('saves, resolves, and re-analyzes one pose artifact per generated clip', async (context) => {
  const fixture = await setup()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))

  const first = await savePoseResult({
    clipRangeId: 'clip-1',
    poseData: poseData([frame(0), frame(42, false), frame(83)]),
    repository: fixture.repository,
    clipVideoDirectory: fixture.clips,
    poseDirectory: fixture.poseDirectory,
  })
  assert.equal(first.poseResult.filename, 'sample-clip.pose.json')
  assert.equal(first.poseResult.frameCount, 3)
  assert.equal(first.poseResult.detectedPoseFrameCount, 2)

  const fullPath = await resolvePoseResultFullPath({
    clipRangeId: 'clip-1',
    repository: fixture.repository,
    poseDirectory: fixture.poseDirectory,
  })
  const artifact = JSON.parse(await readFile(fullPath, 'utf8'))
  assert.deepEqual(artifact.frames.map((item) => item.videoTimestampMs), [0, 42, 83])
  assert.equal(artifact.frames[0].landmarks[0].length, 33)
  assert.equal(artifact.frames[0].worldLandmarks[0].length, 33)
  assert.equal(artifact.source.generatedClipRelativePath, 'clips/sample-clip.mp4')

  const second = await savePoseResult({
    clipRangeId: 'clip-1',
    poseData: poseData([frame(1), frame(51)]),
    repository: fixture.repository,
    clipVideoDirectory: fixture.clips,
    poseDirectory: fixture.poseDirectory,
  })
  assert.equal(second.poseResult.filename, first.poseResult.filename)
  assert.equal(second.poseResult.frameCount, 2)
  const replaced = JSON.parse(await readFile(fullPath, 'utf8'))
  assert.deepEqual(replaced.frames.map((item) => item.videoTimestampMs), [1, 51])
})

test('rejects non-increasing timestamps without replacing a successful artifact', async (context) => {
  const fixture = await setup()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  await savePoseResult({
    clipRangeId: 'clip-1',
    poseData: poseData([frame(0), frame(50)]),
    repository: fixture.repository,
    clipVideoDirectory: fixture.clips,
    poseDirectory: fixture.poseDirectory,
  })
  const fullPath = await resolvePoseResultFullPath({
    clipRangeId: 'clip-1',
    repository: fixture.repository,
    poseDirectory: fixture.poseDirectory,
  })
  const before = await readFile(fullPath, 'utf8')
  await assert.rejects(() => savePoseResult({
    clipRangeId: 'clip-1',
    poseData: poseData([frame(50), frame(50)]),
    repository: fixture.repository,
    clipVideoDirectory: fixture.clips,
    poseDirectory: fixture.poseDirectory,
  }), { code: 'INVALID_POSE_RESULT' })
  assert.equal(await readFile(fullPath, 'utf8'), before)
})

test('restores the previous artifact when metadata persistence fails', async (context) => {
  const fixture = await setup()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  await savePoseResult({
    clipRangeId: 'clip-1',
    poseData: poseData([frame(0), frame(40)]),
    repository: fixture.repository,
    clipVideoDirectory: fixture.clips,
    poseDirectory: fixture.poseDirectory,
  })
  const fullPath = await resolvePoseResultFullPath({
    clipRangeId: 'clip-1',
    repository: fixture.repository,
    poseDirectory: fixture.poseDirectory,
  })
  const before = await readFile(fullPath, 'utf8')
  const failingRepository = {
    findClipRange: (...args) => fixture.repository.findClipRange(...args),
    attachPoseResult: async () => { throw new Error('simulated metadata failure') },
  }
  await assert.rejects(() => savePoseResult({
    clipRangeId: 'clip-1',
    poseData: poseData([frame(1), frame(60), frame(90)]),
    repository: failingRepository,
    clipVideoDirectory: fixture.clips,
    poseDirectory: fixture.poseDirectory,
  }), /simulated metadata failure/)
  assert.equal(await readFile(fullPath, 'utf8'), before)
})

test('compresses world landmarks by video time with fixed official joint names and precision', () => {
  const rawPose = {
    schemaVersion: 1,
    task: 'MediaPipe Pose Landmarker',
    source: { clipRangeId: 'clip-1', generatedClipFilename: 'sample-clip.mp4', durationMs: 500 },
    frames: [
      frame(0),
      frame(33),
      frame(100),
      frame(200, false),
      frame(300),
      frame(400),
      frame(500),
    ],
  }
  const compressed = compressPoseForLlm(rawPose)
  assert.deepEqual(compressed.frames.map((item) => item.t), [0, 100, 300, 400, 500])
  assert.equal(compressed.compression.targetFps, 10)
  assert.equal(compressed.compression.maxDistanceMs, 75)
  assert.equal(compressed.compression.coordinateSpace, 'world')
  assert.equal(Object.keys(compressed.frames[0].j).length, 12)
  assert.deepEqual(Object.keys(compressed.frames[0].j), [
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
    'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ])
  assert.deepEqual(compressed.frames[0].j.left_shoulder, [0.11, 0.21, 0.01, 0.9])
  assert.equal('landmarks' in compressed.frames[0], false)
  assert.equal('worldLandmarks' in compressed.frames[0], false)
})

test('persists and resolves one atomic LLM Pose artifact per raw Pose result', async (context) => {
  const fixture = await setup()
  context.after(() => rm(fixture.root, { recursive: true, force: true }))
  await savePoseResult({
    clipRangeId: 'clip-1',
    poseData: poseData([frame(0), frame(50), frame(100)]),
    repository: fixture.repository,
    clipVideoDirectory: fixture.clips,
    poseDirectory: fixture.poseDirectory,
  })
  const first = await buildLlmPoseResult({
    clipRangeId: 'clip-1',
    repository: fixture.repository,
    poseDirectory: fixture.poseDirectory,
  })
  assert.equal(first.llmResult.filename, 'sample-clip.pose.llm.json')
  assert.equal(first.llmResult.frameCount, 2)
  const fullPath = await resolveLlmPoseResultFullPath({
    clipRangeId: 'clip-1',
    repository: fixture.repository,
    poseDirectory: fixture.poseDirectory,
  })
  const before = await readFile(fullPath, 'utf8')
  assert.equal(Buffer.byteLength(before), first.llmResult.sizeBytes)

  const failingRepository = {
    findClipRange: (...args) => fixture.repository.findClipRange(...args),
    attachLlmPoseResult: async () => { throw new Error('simulated LLM metadata failure') },
  }
  await assert.rejects(() => buildLlmPoseResult({
    clipRangeId: 'clip-1',
    repository: failingRepository,
    poseDirectory: fixture.poseDirectory,
  }), /simulated LLM metadata failure/)
  assert.equal(await readFile(fullPath, 'utf8'), before)
})

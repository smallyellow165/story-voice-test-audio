import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildLlmPoseResult, compressPoseForLlm, resolveLlmPoseResultFullPath } from '../server/pose-llm-compressor.mjs'
import { resolvePoseResultFullPath, savePoseResult } from '../server/pose-result-store.mjs'
import { generateClip } from '../server/video-clip-generator.mjs'
import { deleteClipCascade, deletePoseRunCascade, deleteVideoCascade } from '../server/video-library-artifacts.mjs'
import { createVideoLibraryRepository } from '../server/video-library-repository.mjs'

const landmark = (seed) => ({ x: seed, y: seed + 0.1, z: seed - 0.1, visibility: 0.9, presence: 0.8 })
const pose = (seed) => Array.from({ length: 33 }, (_, index) => landmark(seed + index / 100))
const frame = (videoTimestampMs, detected = true) => ({
  videoTimestampMs,
  landmarks: detected ? [pose(videoTimestampMs / 1000)] : [],
  worldLandmarks: detected ? [pose(videoTimestampMs / 2000)] : [],
})

const poseData = (frames, durationMs = 100) => ({
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
  samplingFps: 30,
  durationMs,
  processingDurationMs: 25,
  frameCount: frames.length,
  detectedPoseFrameCount: frames.filter((item) => item.landmarks.length > 0).length,
  frames,
})

const setup = async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'story-voice-pose-v3-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const testVideoDirectory = path.join(root, 'public', 'test-videos')
  const repository = createVideoLibraryRepository(path.join(testVideoDirectory, 'video-library.json'))
  const video = (await repository.createVideo({ filename: 'original-name.mp4', sourceUrl: 'https://example.test/video' })).result
  const sourcePath = path.join(testVideoDirectory, video.relativePath)
  await mkdir(path.dirname(sourcePath), { recursive: true })
  await writeFile(sourcePath, 'not-a-real-video')
  const createGeneratedClip = async (startMs, endMs) => {
    const clip = (await repository.createClip(video.videoId, { startMs, endMs, label: null })).result
    await generateClip({
      videoId: video.videoId,
      clipId: clip.clipId,
      repository,
      testVideoDirectory,
      run: async (args) => writeFile(args.at(-1), 'generated-clip'),
    })
    return (await repository.findClip(video.videoId, clip.clipId)).clip
  }
  return { root, testVideoDirectory, repository, video, createGeneratedClip }
}

test('appends Pose and LLM Pose Runs with canonical paths and ancestry in each artifact', async (context) => {
  const fixture = await setup(context)
  const clip = await fixture.createGeneratedClip(0, 100)
  const firstPose = await savePoseResult({
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseData: poseData([frame(0), frame(50, false), frame(100)]),
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  const secondPose = await savePoseResult({
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseData: poseData([frame(0), frame(40), frame(100)]),
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })

  assert.equal(firstPose.poseRun.poseRunId, 'video-001_clip-001_pose-001')
  assert.equal(secondPose.poseRun.poseRunId, 'video-001_clip-001_pose-002')
  assert.equal(firstPose.poseRun.relativePath, 'video-001/pose/video-001_clip-001_pose-001.json')
  assert.equal(secondPose.poseRun.relativePath, 'video-001/pose/video-001_clip-001_pose-002.json')
  const rawPath = await resolvePoseResultFullPath({
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseRunId: firstPose.poseRun.poseRunId,
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  const rawArtifact = JSON.parse(await readFile(rawPath, 'utf8'))
  assert.deepEqual(
    { videoId: rawArtifact.source.videoId, clipId: rawArtifact.source.clipId, poseRunId: rawArtifact.source.poseRunId },
    { videoId: fixture.video.videoId, clipId: clip.clipId, poseRunId: firstPose.poseRun.poseRunId },
  )
  assert.equal(rawArtifact.source.sourceVideoFilename, 'original-name.mp4')
  assert.deepEqual(rawArtifact.frames.map((item) => item.videoTimestampMs), [0, 50, 100])
  assert.equal(rawArtifact.frames[0].landmarks[0].length, 33)
  assert.equal(rawArtifact.frames[0].worldLandmarks[0].length, 33)

  const firstLlm = await buildLlmPoseResult({
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseRunId: firstPose.poseRun.poseRunId,
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  const secondLlm = await buildLlmPoseResult({
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseRunId: firstPose.poseRun.poseRunId,
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  assert.equal(firstLlm.llmPoseRun.llmPoseRunId, 'video-001_clip-001_pose-001_llm-001')
  assert.equal(secondLlm.llmPoseRun.llmPoseRunId, 'video-001_clip-001_pose-001_llm-002')
  assert.equal(firstLlm.llmPoseRun.relativePath, 'video-001/llm-pose/video-001_clip-001_pose-001_llm-001.json')
  await access(path.join(fixture.testVideoDirectory, secondPose.poseRun.relativePath))

  const llmPath = await resolveLlmPoseResultFullPath({
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseRunId: firstPose.poseRun.poseRunId,
    llmPoseRunId: secondLlm.llmPoseRun.llmPoseRunId,
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  const llmArtifact = JSON.parse(await readFile(llmPath, 'utf8'))
  assert.deepEqual(llmArtifact.source, {
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseRunId: firstPose.poseRun.poseRunId,
    llmPoseRunId: secondLlm.llmPoseRun.llmPoseRunId,
    durationMs: 100,
  })
  const library = await fixture.repository.loadVideoLibrary()
  assert.equal(library.poseRuns.length, 2)
  assert.equal(library.llmPoseRuns.length, 2)
})

test('invalid analysis and metadata failure preserve completed history and clean orphan artifacts', async (context) => {
  const fixture = await setup(context)
  const clip = await fixture.createGeneratedClip(0, 100)
  const first = await savePoseResult({
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseData: poseData([frame(0), frame(50), frame(100)]),
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  await assert.rejects(savePoseResult({
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseData: poseData([frame(50), frame(50)]),
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  }), { code: 'INVALID_POSE_RESULT' })
  assert.equal((await fixture.repository.loadVideoLibrary()).poseRuns.length, 1)
  await access(path.join(fixture.testVideoDirectory, first.poseRun.relativePath))

  const failingRepository = {
    findClip: (...args) => fixture.repository.findClip(...args),
    allocatePoseRunId: (...args) => fixture.repository.allocatePoseRunId(...args),
    createPoseRun: async () => { throw new Error('simulated metadata failure') },
  }
  await assert.rejects(savePoseResult({
    videoId: fixture.video.videoId,
    clipId: clip.clipId,
    poseData: poseData([frame(0), frame(40), frame(100)]),
    repository: failingRepository,
    testVideoDirectory: fixture.testVideoDirectory,
  }), /simulated metadata failure/)
  await assert.rejects(access(path.join(fixture.testVideoDirectory, 'video-001/pose/video-001_clip-001_pose-002.json')), { code: 'ENOENT' })
  assert.equal((await fixture.repository.loadVideoLibrary()).poseRuns.length, 1)
})

test('cascade deletion removes child metadata and artifacts without touching siblings', async (context) => {
  const fixture = await setup(context)
  const firstClip = await fixture.createGeneratedClip(0, 100)
  const secondClip = await fixture.createGeneratedClip(100, 200)
  const firstPose = await savePoseResult({
    videoId: fixture.video.videoId,
    clipId: firstClip.clipId,
    poseData: poseData([frame(0), frame(50), frame(100)]),
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  const secondPose = await savePoseResult({
    videoId: fixture.video.videoId,
    clipId: firstClip.clipId,
    poseData: poseData([frame(0), frame(40), frame(100)]),
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  const llm = await buildLlmPoseResult({
    videoId: fixture.video.videoId,
    clipId: firstClip.clipId,
    poseRunId: firstPose.poseRun.poseRunId,
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })

  await deletePoseRunCascade({
    videoId: fixture.video.videoId,
    clipId: firstClip.clipId,
    poseRunId: firstPose.poseRun.poseRunId,
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  let library = await fixture.repository.loadVideoLibrary()
  assert.deepEqual(library.poseRuns.map((item) => item.poseRunId), [secondPose.poseRun.poseRunId])
  assert.equal(library.llmPoseRuns.length, 0)
  await assert.rejects(access(path.join(fixture.testVideoDirectory, firstPose.poseRun.relativePath)), { code: 'ENOENT' })
  await assert.rejects(access(path.join(fixture.testVideoDirectory, llm.llmPoseRun.relativePath)), { code: 'ENOENT' })
  await access(path.join(fixture.testVideoDirectory, secondPose.poseRun.relativePath))

  await deleteClipCascade({
    videoId: fixture.video.videoId,
    clipId: firstClip.clipId,
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  library = await fixture.repository.loadVideoLibrary()
  assert.deepEqual(library.clips.map((item) => item.clipId), [secondClip.clipId])
  assert.equal(library.poseRuns.length, 0)
  await access(path.join(fixture.testVideoDirectory, secondClip.relativePath))

  await deleteVideoCascade({
    videoId: fixture.video.videoId,
    repository: fixture.repository,
    testVideoDirectory: fixture.testVideoDirectory,
  })
  library = await fixture.repository.loadVideoLibrary()
  assert.equal(library.videos.length, 0)
  assert.equal(library.clips.length, 0)
  await assert.rejects(access(path.join(fixture.testVideoDirectory, fixture.video.videoId)), { code: 'ENOENT' })
})

test('compresses world landmarks by video time with fixed official joint names and precision', () => {
  const rawPose = {
    schemaVersion: 1,
    task: 'MediaPipe Pose Landmarker',
    source: { videoId: 'video-001', clipId: 'video-001_clip-001', poseRunId: 'video-001_clip-001_pose-001', durationMs: 500 },
    frames: [frame(0), frame(33), frame(100), frame(200, false), frame(300), frame(400), frame(500)],
  }
  const compressed = compressPoseForLlm(rawPose)
  assert.deepEqual(compressed.frames.map((item) => item.t), [0, 100, 300, 400, 500])
  assert.equal(compressed.compression.targetFps, 10)
  assert.equal(compressed.compression.maxDistanceMs, 75)
  assert.equal(compressed.compression.coordinateSpace, 'world')
  assert.equal(compressed.compression.globalCoordinateSpace, 'normalized-image')
  assert.equal(compressed.schemaVersion, 2)
  assert.equal(Object.keys(compressed.frames[0].j).length, 12)
  assert.deepEqual(Object.keys(compressed.frames[0].j), [
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
    'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ])
  assert.deepEqual(compressed.frames[0].j.left_shoulder, [0.11, 0.21, 0.01, 0.9])
  assert.deepEqual(Object.keys(compressed.frames[0].g), ['pelvis', 'shoulderCenter', 'bodyCenter', 'bodyBox'])
  assert.equal(typeof compressed.frames[1].f.pelvisVy, 'number')
  assert.equal('landmarks' in compressed.frames[0], false)
  assert.equal('worldLandmarks' in compressed.frames[0], false)
})

test('anchors 10 FPS sampling to the first source timestamp and reports upstream gaps', () => {
  const source = { videoId: 'video-001', clipId: 'video-001_clip-001', poseRunId: 'video-001_clip-001_pose-001' }
  const continuous = compressPoseForLlm({
    schemaVersion: 1,
    task: 'MediaPipe Pose Landmarker',
    source: { ...source, durationMs: 333 },
    frames: [frame(33), frame(66), frame(100), frame(133), frame(166), frame(200), frame(233), frame(266), frame(300), frame(333)],
  })
  assert.deepEqual(continuous.frames.map((item) => item.t), [33, 133, 233, 333])

  const gapped = compressPoseForLlm({
    schemaVersion: 1,
    task: 'MediaPipe Pose Landmarker',
    source: { ...source, durationMs: 1200 },
    frames: [frame(33), frame(1000), frame(1033), frame(1100), frame(1200)],
  })
  assert.equal(gapped.sampling.maxSourceFrameGapMs, 967)
  assert.deepEqual(gapped.frames.slice(0, 2).map((item) => item.t), [33, 1000])
})

test('emits null derived values when required landmarks have low visibility', () => {
  const lowVisibilityFrame = frame(0)
  lowVisibilityFrame.landmarks[0][23].visibility = 0.1
  lowVisibilityFrame.worldLandmarks[0][25].visibility = 0.1
  const compressed = compressPoseForLlm({
    schemaVersion: 1,
    task: 'MediaPipe Pose Landmarker',
    source: { videoId: 'video-001', clipId: 'video-001_clip-001', poseRunId: 'video-001_clip-001_pose-001', durationMs: 0 },
    frames: [lowVisibilityFrame],
  })

  assert.equal(compressed.frames[0].g.pelvis, null)
  assert.equal(compressed.frames[0].f.leftKneeAngleDeg, null)
  assert.equal(compressed.frames[0].f.kneeAngleDiffDeg, null)
  assert.equal(compressed.frames[0].f.pelvisVy, null)
  assert.equal(JSON.stringify(compressed).includes('NaN'), false)
  assert.equal(JSON.stringify(compressed).includes('Infinity'), false)
})

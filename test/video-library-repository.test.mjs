import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  VideoLibraryStorageError,
  createVideoLibraryRepository,
} from '../server/video-library-repository.mjs'

const model = {
  name: 'Pose Landmarker Lite (float16)',
  packageVersion: '1.0.1',
  modelAssetPath: 'https://example.test/pose.task',
  delegate: 'CPU',
  runningMode: 'VIDEO',
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
}

const poseMetadata = (poseRunId) => ({
  poseRunId,
  relativePath: `video-001/pose/${poseRunId}.json`,
  model,
  samplingFps: 30,
  durationMs: 1_000,
  frameCount: 31,
  detectedPoseFrameCount: 30,
  processingDurationMs: 250,
  createdAt: new Date().toISOString(),
})

const llmMetadata = (llmPoseRunId) => ({
  llmPoseRunId,
  relativePath: `video-001/llm-pose/${llmPoseRunId}.json`,
  schemaVersion: 2,
  targetFps: 10,
  frameCount: 11,
  sizeBytes: 1234,
  createdAt: new Date().toISOString(),
})

const fixture = async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-library-v3-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storagePath = path.join(directory, 'video-library.json')
  return { directory, storagePath, repository: createVideoLibraryRepository(storagePath) }
}

test('allocates stable ancestry IDs, supports one-to-many, and round-trips schema v3', async (context) => {
  const { storagePath, repository } = await fixture(context)
  const firstVideo = (await repository.createVideo({ filename: 'first.mp4' })).result
  const secondVideo = (await repository.createVideo({ filename: 'second.webm' })).result
  assert.equal(firstVideo.videoId, 'video-001')
  assert.equal(firstVideo.relativePath, 'video-001/source.mp4')
  assert.equal(secondVideo.videoId, 'video-002')
  assert.equal(secondVideo.relativePath, 'video-002/source.webm')

  const firstClip = (await repository.createClip(firstVideo.videoId, { startMs: 0, endMs: 1_000, label: 'jump' })).result
  const secondClip = (await repository.createClip(firstVideo.videoId, { startMs: 1_000, endMs: 2_000, label: null })).result
  assert.equal(firstClip.clipId, 'video-001_clip-001')
  assert.equal(secondClip.clipId, 'video-001_clip-002')
  const labeledClip = (await repository.updateClipLabel(firstVideo.videoId, firstClip.clipId, ' left_single_leg_hop ')).result
  assert.equal(labeledClip.label, 'left_single_leg_hop')
  await repository.attachClipArtifact(firstVideo.videoId, firstClip.clipId, 'video-001/clips/video-001_clip-001.mp4')

  const firstPoseId = await repository.allocatePoseRunId(firstVideo.videoId, firstClip.clipId)
  const firstPose = (await repository.createPoseRun(firstVideo.videoId, firstClip.clipId, poseMetadata(firstPoseId))).result
  const secondPoseId = await repository.allocatePoseRunId(firstVideo.videoId, firstClip.clipId)
  const secondPose = (await repository.createPoseRun(firstVideo.videoId, firstClip.clipId, poseMetadata(secondPoseId))).result
  assert.equal(firstPose.poseRunId, 'video-001_clip-001_pose-001')
  assert.equal(secondPose.poseRunId, 'video-001_clip-001_pose-002')

  const firstLlmId = await repository.allocateLlmPoseRunId(firstVideo.videoId, firstClip.clipId, firstPose.poseRunId)
  const firstLlm = (await repository.createLlmPoseRun(
    firstVideo.videoId,
    firstClip.clipId,
    firstPose.poseRunId,
    llmMetadata(firstLlmId),
  )).result
  const secondLlmId = await repository.allocateLlmPoseRunId(firstVideo.videoId, firstClip.clipId, firstPose.poseRunId)
  const secondLlm = (await repository.createLlmPoseRun(
    firstVideo.videoId,
    firstClip.clipId,
    firstPose.poseRunId,
    llmMetadata(secondLlmId),
  )).result
  assert.equal(firstLlm.llmPoseRunId, 'video-001_clip-001_pose-001_llm-001')
  assert.equal(secondLlm.llmPoseRunId, 'video-001_clip-001_pose-001_llm-002')

  const reloaded = await createVideoLibraryRepository(storagePath).loadVideoLibrary()
  assert.equal(reloaded.schemaVersion, 3)
  assert.equal(reloaded.videos.length, 2)
  assert.equal(reloaded.clips.length, 2)
  assert.equal(reloaded.clips[0].label, 'left_single_leg_hop')
  assert.equal(reloaded.poseRuns.length, 2)
  assert.equal(reloaded.llmPoseRuns.length, 2)
  assert.equal(reloaded.poseRuns[0].videoId, firstVideo.videoId)
  assert.equal(reloaded.poseRuns[0].clipId, firstClip.clipId)
  assert.equal(reloaded.llmPoseRuns[0].poseRunId, firstPose.poseRunId)
})

test('persistent counters never reuse deleted highest IDs', async (context) => {
  const { repository } = await fixture(context)
  const video = (await repository.createVideo({ filename: 'first.mp4' })).result
  const clip = (await repository.createClip(video.videoId, { startMs: 0, endMs: 1_000, label: null })).result
  await repository.attachClipArtifact(video.videoId, clip.clipId, `${video.videoId}/clips/${clip.clipId}.mp4`)
  const poseRunId = await repository.allocatePoseRunId(video.videoId, clip.clipId)
  const poseRun = (await repository.createPoseRun(video.videoId, clip.clipId, poseMetadata(poseRunId))).result
  const llmPoseRunId = await repository.allocateLlmPoseRunId(video.videoId, clip.clipId, poseRun.poseRunId)
  await repository.createLlmPoseRun(video.videoId, clip.clipId, poseRun.poseRunId, llmMetadata(llmPoseRunId))

  await repository.deleteLlmPoseRun(video.videoId, clip.clipId, poseRun.poseRunId, llmPoseRunId)
  assert.equal(
    await repository.allocateLlmPoseRunId(video.videoId, clip.clipId, poseRun.poseRunId),
    'video-001_clip-001_pose-001_llm-002',
  )
  await repository.deletePoseRun(video.videoId, clip.clipId, poseRun.poseRunId)
  assert.equal(await repository.allocatePoseRunId(video.videoId, clip.clipId), 'video-001_clip-001_pose-002')
  await repository.deleteClip(video.videoId, clip.clipId)
  assert.equal(
    (await repository.createClip(video.videoId, { startMs: 2_000, endMs: 3_000, label: null })).result.clipId,
    'video-001_clip-002',
  )
  await repository.deleteVideo(video.videoId)
  assert.equal((await repository.createVideo({ filename: 'next.mp4' })).result.videoId, 'video-002')
})

test('rejects old schema and noncanonical ancestry paths instead of migrating them', async (context) => {
  const { storagePath, repository } = await fixture(context)
  await writeFile(storagePath, JSON.stringify({ version: 1, videos: [] }))
  await assert.rejects(repository.loadVideoLibrary(), (error) =>
    error instanceof VideoLibraryStorageError && error.code === 'UNSUPPORTED_VIDEO_LIBRARY_SCHEMA')

  await rm(storagePath)
  const cleanRepository = createVideoLibraryRepository(storagePath)
  const video = (await cleanRepository.createVideo({ filename: 'first.mp4' })).result
  const exported = await cleanRepository.loadVideoLibrary()
  exported.videos[0].relativePath = '../source.mp4'
  await assert.rejects(cleanRepository.replaceLibrary(exported), (error) =>
    error instanceof VideoLibraryStorageError && error.code === 'INVALID_VIDEO_LIBRARY_SCHEMA')
  assert.equal(video.videoId, 'video-001')
})

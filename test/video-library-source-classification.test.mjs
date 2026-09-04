import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  VideoLibraryStorageError,
  createVideoLibraryRepository,
} from '../server/video-library-repository.mjs'

const createdAt = '2026-09-04T10:00:00.000Z'
const sourceFilename = 'source-video.mp4'
const clipFilename = 'source-video-clip-01.mp4'

const generatedClip = {
  filename: clipFilename,
  relativePath: `clips/${clipFilename}`,
  createdAt,
  poseResult: {
    filename: 'source-video-clip-01.pose.json',
    relativePath: 'pose/source-video-clip-01.pose.json',
    frameCount: 195,
    detectedPoseFrameCount: 195,
    durationMs: 7544,
    processingDurationMs: 1200,
    createdAt,
    llmResult: {
      filename: 'source-video-clip-01.pose.llm.json',
      relativePath: 'pose/source-video-clip-01.pose.llm.json',
      frameCount: 68,
      sizeBytes: 33280,
      createdAt,
    },
  },
}

const clipRange = {
  id: 'clip-range-1',
  start: 9.581,
  end: 17.125,
  duration: 7.544,
  createdAt,
  outputFilename: clipFilename,
  generatedClip,
}

const sourceRecord = {
  id: `server:${sourceFilename}`,
  type: 'server',
  file: { name: sourceFilename, size: 0, lastModified: 0 },
  server: { relativePath: `source/${sourceFilename}`, url: `/test-videos/source/${sourceFilename}` },
  clips: [clipRange],
  createdAt,
  updatedAt: createdAt,
  nextClipNumber: 2,
}

const legacyTopLevelClipRecord = {
  id: `server:${clipFilename}`,
  type: 'server',
  file: { name: clipFilename, size: 0, lastModified: 0 },
  server: { relativePath: `clips/${clipFilename}`, url: `/test-videos/clips/${clipFilename}` },
  clips: [],
  createdAt,
  updatedAt: createdAt,
  nextClipNumber: 1,
}

const createFixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'video-library-classification-'))
  const storagePath = path.join(directory, 'video-library.json')
  return { directory, storagePath, repository: createVideoLibraryRepository(storagePath) }
}

test('legacy top-level clip wrappers are ignored while nested clip history remains intact', async () => {
  const { directory, storagePath, repository } = await createFixture()
  const clipPath = path.join(directory, clipFilename)
  await writeFile(clipPath, 'existing generated clip')
  await writeFile(storagePath, `${JSON.stringify({
    version: 1,
    videos: [sourceRecord, legacyTopLevelClipRecord],
  }, null, 2)}\n`)

  const loaded = await repository.loadVideoLibrary()

  assert.equal(loaded.videos.length, 1)
  assert.equal(loaded.videos[0].server.relativePath, `source/${sourceFilename}`)
  assert.equal(loaded.videos[0].clips.length, 1)
  assert.deepEqual(loaded.videos[0].clips[0].generatedClip, generatedClip)
  assert.equal(await readFile(clipPath, 'utf8'), 'existing generated clip')
})

test('attaching a generated clip keeps the Video Library source count unchanged', async () => {
  const { repository } = await createFixture()
  const sourceWithoutGeneratedClip = {
    ...sourceRecord,
    clips: [{ ...clipRange, outputFilename: undefined, generatedClip: undefined }],
  }
  await repository.replaceVideos([sourceWithoutGeneratedClip])

  const updated = await repository.attachGeneratedClip(clipRange.id, generatedClip)

  assert.equal(updated.videos.length, 1)
  assert.equal(updated.videos[0].clips.length, 1)
  assert.deepEqual(updated.videos[0].clips[0].generatedClip, generatedClip)
})

test('replace/export-import normalization cannot restore top-level clips', async () => {
  const first = await createFixture()
  const replaced = await first.repository.replaceVideos([sourceRecord, legacyTopLevelClipRecord])
  assert.equal(replaced.videos.length, 1)

  const second = await createFixture()
  const imported = await second.repository.replaceVideos(replaced.videos)
  const reloaded = await second.repository.loadVideoLibrary()

  assert.equal(imported.videos.length, 1)
  assert.equal(reloaded.videos.length, 1)
  assert.equal(reloaded.videos[0].clips.length, 1)
  assert.equal(reloaded.videos[0].clips[0].id, clipRange.id)
  assert.deepEqual(reloaded.videos[0].clips[0].generatedClip, generatedClip)
})

test('a clip cannot be newly registered as a top-level Video Library record', async () => {
  const { repository } = await createFixture()

  await assert.rejects(
    repository.upsertVideo(legacyTopLevelClipRecord),
    (error) => error instanceof VideoLibraryStorageError &&
      error.code === 'INVALID_VIDEO_LIBRARY_SCHEMA',
  )
  assert.equal((await repository.loadVideoLibrary()).videos.length, 0)
})

import { access, lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { VideoLibraryStorageError } from './video-library-repository.mjs'
import { resolvePoseResultFullPath } from './pose-result-store.mjs'

const inFlightCompressions = new Set()
const targetFps = 10
const targetIntervalMs = 100
const maxDistanceMs = 75
const xyzPrecision = 3
const visibilityPrecision = 2

export const poseLlmJoints = [
  ['left_shoulder', 11],
  ['right_shoulder', 12],
  ['left_elbow', 13],
  ['right_elbow', 14],
  ['left_wrist', 15],
  ['right_wrist', 16],
  ['left_hip', 23],
  ['right_hip', 24],
  ['left_knee', 25],
  ['right_knee', 26],
  ['left_ankle', 27],
  ['right_ankle', 28],
]

const requireFiniteNumber = (value, field) => {
  if (!Number.isFinite(value)) {
    throw new VideoLibraryStorageError(`${field} must be a finite number.`, 'INVALID_POSE_RESULT')
  }
  return value
}

const roundTo = (value, precision) => {
  const factor = 10 ** precision
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

const nearestFrame = (frames, targetTimestampMs) => {
  let low = 0
  let high = frames.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (frames[middle].videoTimestampMs < targetTimestampMs) low = middle + 1
    else high = middle - 1
  }
  if (low <= 0) return frames[0]
  if (low >= frames.length) return frames[frames.length - 1]
  const before = frames[low - 1]
  const after = frames[low]
  return targetTimestampMs - before.videoTimestampMs <= after.videoTimestampMs - targetTimestampMs
    ? before
    : after
}

const validateRawPose = (value) => {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 ||
    value.task !== 'MediaPipe Pose Landmarker' || !value.source || typeof value.source !== 'object' ||
    !Array.isArray(value.frames) || value.frames.length === 0) {
    throw new VideoLibraryStorageError('Raw Pose JSON has an invalid schema.', 'INVALID_POSE_RESULT')
  }
  const durationMs = requireFiniteNumber(value.source.durationMs, 'source.durationMs')
  let previousTimestamp = -1
  for (const [frameIndex, frame] of value.frames.entries()) {
    const timestamp = requireFiniteNumber(frame?.videoTimestampMs, `frames[${frameIndex}].videoTimestampMs`)
    if (timestamp < 0 || timestamp <= previousTimestamp || !Array.isArray(frame.worldLandmarks)) {
      throw new VideoLibraryStorageError('Raw Pose timestamps or world landmarks are invalid.', 'INVALID_POSE_RESULT')
    }
    previousTimestamp = timestamp
    if (frame.worldLandmarks.length > 1) {
      throw new VideoLibraryStorageError('LLM Pose compression expects at most one pose per frame.', 'INVALID_POSE_RESULT')
    }
    if (frame.worldLandmarks.length === 1 &&
      (!Array.isArray(frame.worldLandmarks[0]) || frame.worldLandmarks[0].length !== 33)) {
      throw new VideoLibraryStorageError(`frames[${frameIndex}] must contain 33 world landmarks.`, 'INVALID_POSE_RESULT')
    }
  }
  return { durationMs, frames: value.frames }
}

export const compressPoseForLlm = (rawPose) => {
  const { durationMs, frames: rawFrames } = validateRawPose(rawPose)
  const frames = []
  let previousRawTimestamp = null
  let previousCompressedTimestamp = -1

  for (let targetTimestampMs = 0; targetTimestampMs <= durationMs; targetTimestampMs += targetIntervalMs) {
    const rawFrame = nearestFrame(rawFrames, targetTimestampMs)
    if (Math.abs(rawFrame.videoTimestampMs - targetTimestampMs) > maxDistanceMs ||
      rawFrame.videoTimestampMs === previousRawTimestamp || rawFrame.worldLandmarks.length === 0) continue

    const pose = rawFrame.worldLandmarks[0]
    const timestamp = Math.round(rawFrame.videoTimestampMs)
    if (timestamp <= previousCompressedTimestamp) continue
    const joints = {}
    for (const [name, index] of poseLlmJoints) {
      const landmark = pose[index]
      if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y) ||
        !Number.isFinite(landmark.z) || !Number.isFinite(landmark.visibility)) {
        throw new VideoLibraryStorageError(`World landmark ${index} is invalid.`, 'INVALID_POSE_RESULT')
      }
      joints[name] = [
        roundTo(landmark.x, xyzPrecision),
        roundTo(landmark.y, xyzPrecision),
        roundTo(landmark.z, xyzPrecision),
        roundTo(landmark.visibility, visibilityPrecision),
      ]
    }
    frames.push({ t: timestamp, j: joints })
    previousRawTimestamp = rawFrame.videoTimestampMs
    previousCompressedTimestamp = timestamp
  }

  if (!frames.length) {
    throw new VideoLibraryStorageError('Raw Pose JSON did not contain compressible detected frames.', 'INVALID_POSE_RESULT')
  }
  return {
    schemaVersion: 1,
    type: 'pose-llm',
    source: {
      clipRangeId: String(rawPose.source.clipRangeId ?? ''),
      generatedClipFilename: String(rawPose.source.generatedClipFilename ?? ''),
      durationMs: Math.round(durationMs),
    },
    compression: {
      targetFps,
      maxDistanceMs,
      xyzPrecision,
      visibilityPrecision,
      jointCount: poseLlmJoints.length,
      coordinateSpace: 'world',
    },
    frameCount: frames.length,
    frames,
  }
}

const llmFilenameFor = (poseFilename) => poseFilename.endsWith('.pose.json')
  ? `${poseFilename.slice(0, -'.pose.json'.length)}.pose.llm.json`
  : `${path.parse(path.basename(poseFilename)).name}.llm.json`

const resolveOutputPath = (poseDirectory, filename) => {
  const root = path.resolve(poseDirectory)
  const outputPath = path.resolve(root, path.basename(filename))
  if (!outputPath.startsWith(`${root}${path.sep}`)) {
    throw new VideoLibraryStorageError('LLM Pose result path must remain within the pose directory.', 'INVALID_LLM_POSE_RESULT_PATH')
  }
  return outputPath
}

export const buildLlmPoseResult = async ({ clipRangeId, repository, poseDirectory }) => {
  if (typeof clipRangeId !== 'string' || !clipRangeId) {
    throw new VideoLibraryStorageError('clipRangeId is required.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  if (inFlightCompressions.has(clipRangeId)) {
    throw new VideoLibraryStorageError('This LLM Pose result is already being built.', 'LLM_POSE_RESULT_IN_PROGRESS')
  }
  inFlightCompressions.add(clipRangeId)

  let temporaryPath = ''
  let backupPath = ''
  let outputPath = ''
  try {
    const { clip } = await repository.findClipRange(clipRangeId)
    if (!clip.generatedClip?.poseResult) {
      throw new VideoLibraryStorageError('This generated clip does not have a raw Pose result.', 'POSE_RESULT_NOT_FOUND')
    }
    const rawPath = await resolvePoseResultFullPath({ clipRangeId, repository, poseDirectory })
    const rawPose = JSON.parse(await readFile(rawPath, 'utf8'))
    const artifact = compressPoseForLlm(rawPose)
    const filename = llmFilenameFor(clip.generatedClip.poseResult.filename)
    const relativePath = `pose/${filename}`
    await mkdir(poseDirectory, { recursive: true })
    const resolvedPoseDirectory = await realpath(poseDirectory)
    outputPath = resolveOutputPath(resolvedPoseDirectory, filename)
    const serialized = `${JSON.stringify(artifact)}\n`
    const createdAt = new Date().toISOString()
    const llmResult = {
      filename,
      relativePath,
      frameCount: artifact.frameCount,
      sizeBytes: Buffer.byteLength(serialized),
      createdAt,
    }

    temporaryPath = path.join(resolvedPoseDirectory, `.${filename}.${globalThis.crypto.randomUUID()}.tmp`)
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' })
    try {
      const existing = await lstat(outputPath)
      if (existing.isDirectory()) throw new Error('output is a directory')
      backupPath = path.join(resolvedPoseDirectory, `.${filename}.${globalThis.crypto.randomUUID()}.backup`)
      await rename(outputPath, backupPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    await rename(temporaryPath, outputPath)
    temporaryPath = ''
    try {
      const library = await repository.attachLlmPoseResult(clipRangeId, llmResult)
      if (backupPath) {
        await unlink(backupPath).catch(() => undefined)
        backupPath = ''
      }
      return { library, llmResult, artifact, fullPath: outputPath }
    } catch (error) {
      await unlink(outputPath).catch(() => undefined)
      if (backupPath) {
        try {
          await rename(backupPath, outputPath)
          backupPath = ''
        } catch {
          // Keep the backup if restoration itself fails.
        }
      }
      throw error
    }
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
    inFlightCompressions.delete(clipRangeId)
  }
}

export const resolveLlmPoseResultFullPath = async ({ clipRangeId, repository, poseDirectory }) => {
  const { clip } = await repository.findClipRange(clipRangeId)
  const llmResult = clip.generatedClip?.poseResult?.llmResult
  if (!llmResult) {
    throw new VideoLibraryStorageError('This raw Pose result does not have an LLM Pose result.', 'LLM_POSE_RESULT_NOT_FOUND')
  }
  const fullPath = resolveOutputPath(poseDirectory, llmResult.filename)
  try {
    const [root, resolvedPath] = await Promise.all([realpath(poseDirectory), realpath(fullPath)])
    if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
      throw new VideoLibraryStorageError('LLM Pose result path must remain within the pose directory.', 'INVALID_LLM_POSE_RESULT_PATH')
    }
    const resultStat = await stat(resolvedPath)
    if (!resultStat.isFile()) {
      throw new VideoLibraryStorageError('LLM Pose result file does not exist.', 'LLM_POSE_RESULT_FILE_NOT_FOUND')
    }
    await access(resolvedPath, constants.R_OK)
    return resolvedPath
  } catch (error) {
    if (error instanceof VideoLibraryStorageError) throw error
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'EACCES') {
      throw new VideoLibraryStorageError('LLM Pose result file does not exist.', 'LLM_POSE_RESULT_FILE_NOT_FOUND')
    }
    throw error
  }
}

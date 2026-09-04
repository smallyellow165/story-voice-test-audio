import { access, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { VideoLibraryStorageError } from './video-library-repository.mjs'
import { resolveGeneratedClipFullPath } from './video-clip-generator.mjs'

const inFlightPoseRuns = new Set()
const taskName = 'MediaPipe Pose Landmarker'

const requireFiniteNumber = (value, field) => {
  if (!Number.isFinite(value)) throw new VideoLibraryStorageError(`${field} must be finite.`, 'INVALID_POSE_RESULT')
  return value
}

const normalizeLandmark = (value, field) => {
  if (!value || typeof value !== 'object') throw new VideoLibraryStorageError(`${field} must be an object.`, 'INVALID_POSE_RESULT')
  const landmark = {
    x: requireFiniteNumber(value.x, `${field}.x`),
    y: requireFiniteNumber(value.y, `${field}.y`),
    z: requireFiniteNumber(value.z, `${field}.z`),
  }
  if (value.visibility !== undefined) landmark.visibility = requireFiniteNumber(value.visibility, `${field}.visibility`)
  if (value.presence !== undefined) landmark.presence = requireFiniteNumber(value.presence, `${field}.presence`)
  return landmark
}

const normalizePoseList = (value, field) => {
  if (!Array.isArray(value)) throw new VideoLibraryStorageError(`${field} must be an array.`, 'INVALID_POSE_RESULT')
  return value.map((pose, poseIndex) => {
    if (!Array.isArray(pose) || pose.length !== 33) {
      throw new VideoLibraryStorageError(`${field}[${poseIndex}] must contain 33 landmarks.`, 'INVALID_POSE_RESULT')
    }
    return pose.map((landmark, landmarkIndex) => normalizeLandmark(landmark, `${field}[${poseIndex}][${landmarkIndex}]`))
  })
}

const normalizePoseData = (value) => {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || value.task !== taskName) {
    throw new VideoLibraryStorageError('Pose data must use raw Pose schemaVersion 1.', 'INVALID_POSE_RESULT')
  }
  if (!Array.isArray(value.frames) || value.frames.length === 0 || value.frames.length > 10_000) {
    throw new VideoLibraryStorageError('Pose frames must contain between 1 and 10,000 entries.', 'INVALID_POSE_RESULT')
  }
  let previousTimestamp = -1
  let detectedPoseFrameCount = 0
  const frames = value.frames.map((frame, frameIndex) => {
    const videoTimestampMs = requireFiniteNumber(frame?.videoTimestampMs, `frames[${frameIndex}].videoTimestampMs`)
    if (videoTimestampMs < 0 || videoTimestampMs <= previousTimestamp) {
      throw new VideoLibraryStorageError('Pose timestamps must be strictly increasing.', 'INVALID_POSE_RESULT')
    }
    previousTimestamp = videoTimestampMs
    const landmarks = normalizePoseList(frame?.landmarks, `frames[${frameIndex}].landmarks`)
    const worldLandmarks = normalizePoseList(frame?.worldLandmarks, `frames[${frameIndex}].worldLandmarks`)
    if (landmarks.length !== worldLandmarks.length) {
      throw new VideoLibraryStorageError('Pose image/world landmark counts must match.', 'INVALID_POSE_RESULT')
    }
    if (landmarks.length > 0) detectedPoseFrameCount += 1
    return { videoTimestampMs, landmarks, worldLandmarks }
  })
  const durationMs = requireFiniteNumber(value.durationMs, 'durationMs')
  const processingDurationMs = requireFiniteNumber(value.processingDurationMs, 'processingDurationMs')
  const samplingFps = requireFiniteNumber(value.samplingFps, 'samplingFps')
  if (durationMs <= 0 || processingDurationMs < 0 || samplingFps <= 0 || previousTimestamp >= durationMs + 1) {
    throw new VideoLibraryStorageError('Pose duration or sampling metadata is invalid.', 'INVALID_POSE_RESULT')
  }
  if (value.frameCount !== frames.length || value.detectedPoseFrameCount !== detectedPoseFrameCount) {
    throw new VideoLibraryStorageError('Pose frame summary does not match its frames.', 'INVALID_POSE_RESULT')
  }
  const model = value.model
  if (!model || typeof model !== 'object' || typeof model.packageVersion !== 'string' ||
    typeof model.modelAssetPath !== 'string' || model.runningMode !== 'VIDEO' ||
    (model.delegate !== 'GPU' && model.delegate !== 'CPU')) {
    throw new VideoLibraryStorageError('Pose model metadata is invalid.', 'INVALID_POSE_RESULT')
  }
  return {
    model: {
      name: String(model.modelName ?? ''),
      packageVersion: model.packageVersion,
      modelAssetPath: model.modelAssetPath,
      runningMode: 'VIDEO',
      delegate: model.delegate,
      numPoses: requireFiniteNumber(model.numPoses, 'model.numPoses'),
      minPoseDetectionConfidence: requireFiniteNumber(model.minPoseDetectionConfidence, 'model.minPoseDetectionConfidence'),
      minPosePresenceConfidence: requireFiniteNumber(model.minPosePresenceConfidence, 'model.minPosePresenceConfidence'),
      minTrackingConfidence: requireFiniteNumber(model.minTrackingConfidence, 'model.minTrackingConfidence'),
    },
    samplingFps,
    durationMs,
    processingDurationMs,
    frameCount: frames.length,
    detectedPoseFrameCount,
    frames,
  }
}

const resolveRunPath = (testVideoDirectory, videoId, relativePath, subdirectory) => {
  const root = path.resolve(testVideoDirectory, videoId, subdirectory)
  const fullPath = path.resolve(testVideoDirectory, relativePath)
  if (!fullPath.startsWith(`${root}${path.sep}`)) {
    throw new VideoLibraryStorageError('Pose artifact path escaped its directory.', 'INVALID_POSE_RESULT_PATH')
  }
  return { root, fullPath }
}

export const savePoseResult = async ({ videoId, clipId, poseData, repository, testVideoDirectory }) => {
  const actionKey = `${videoId}:${clipId}`
  if (inFlightPoseRuns.has(actionKey)) {
    throw new VideoLibraryStorageError('This clip Pose analysis is already being saved.', 'POSE_RESULT_IN_PROGRESS')
  }
  inFlightPoseRuns.add(actionKey)
  let temporaryPath = ''
  let outputPath = ''
  try {
    const normalized = normalizePoseData(poseData)
    const { video, clip } = await repository.findClip(videoId, clipId)
    await resolveGeneratedClipFullPath({ videoId, clipId, repository, testVideoDirectory })
    const poseRunId = await repository.allocatePoseRunId(videoId, clipId)
    const filename = `${poseRunId}.json`
    const relativePath = `${videoId}/pose/${filename}`
    const poseDirectory = path.join(testVideoDirectory, videoId, 'pose')
    await mkdir(poseDirectory, { recursive: true })
    const resolvedDirectory = await realpath(poseDirectory)
    outputPath = resolveRunPath(testVideoDirectory, videoId, relativePath, 'pose').fullPath
    if (path.dirname(outputPath) !== resolvedDirectory) {
      throw new VideoLibraryStorageError('Pose directory could not be resolved safely.', 'INVALID_POSE_RESULT_PATH')
    }
    const createdAt = new Date().toISOString()
    const artifact = {
      schemaVersion: 1,
      task: taskName,
      source: {
        videoId,
        clipId,
        poseRunId,
        sourceVideoFilename: video.filename,
        clipRelativePath: clip.relativePath,
        durationMs: normalized.durationMs,
      },
      model: normalized.model,
      samplingFps: normalized.samplingFps,
      frameCount: normalized.frameCount,
      detectedPoseFrameCount: normalized.detectedPoseFrameCount,
      processingDurationMs: normalized.processingDurationMs,
      frames: normalized.frames,
      createdAt,
    }
    temporaryPath = path.join(resolvedDirectory, `.${filename}.${globalThis.crypto.randomUUID()}.tmp`)
    await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, outputPath)
    temporaryPath = ''
    try {
      const { library, result: poseRun } = await repository.createPoseRun(videoId, clipId, {
        poseRunId,
        relativePath,
        model: normalized.model,
        samplingFps: normalized.samplingFps,
        durationMs: normalized.durationMs,
        frameCount: normalized.frameCount,
        detectedPoseFrameCount: normalized.detectedPoseFrameCount,
        processingDurationMs: normalized.processingDurationMs,
        createdAt,
      })
      return { library, poseRun, artifact }
    } catch (error) {
      await unlink(outputPath).catch(() => undefined)
      throw error
    }
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
    inFlightPoseRuns.delete(actionKey)
  }
}

export const resolvePoseResultFullPath = async ({ videoId, clipId, poseRunId, repository, testVideoDirectory }) => {
  const { poseRun } = await repository.findPoseRun(videoId, clipId, poseRunId)
  const { root, fullPath } = resolveRunPath(testVideoDirectory, videoId, poseRun.relativePath, 'pose')
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(fullPath)])
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) throw new Error('path escape')
    const fileStat = await stat(realFile)
    if (!fileStat.isFile()) throw new Error('not a file')
    await access(realFile, constants.R_OK)
    return realFile
  } catch {
    throw new VideoLibraryStorageError('Pose Run artifact does not exist.', 'POSE_RESULT_FILE_NOT_FOUND')
  }
}

export const readPoseResult = async (options) => JSON.parse(await readFile(
  await resolvePoseResultFullPath(options),
  'utf8',
))

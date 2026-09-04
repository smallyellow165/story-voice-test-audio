import { access, lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { VideoLibraryStorageError } from './video-library-repository.mjs'
import { resolveGeneratedClipFullPath } from './video-clip-generator.mjs'

const inFlightPoseResults = new Set()
const taskName = 'MediaPipe Pose Landmarker'

const requireFiniteNumber = (value, field) => {
  if (!Number.isFinite(value)) {
    throw new VideoLibraryStorageError(`${field} must be a finite number.`, 'INVALID_POSE_RESULT')
  }
  return value
}

const normalizeLandmark = (value, field) => {
  if (!value || typeof value !== 'object') {
    throw new VideoLibraryStorageError(`${field} must be an object.`, 'INVALID_POSE_RESULT')
  }
  const landmark = {
    x: requireFiniteNumber(value.x, `${field}.x`),
    y: requireFiniteNumber(value.y, `${field}.y`),
    z: requireFiniteNumber(value.z, `${field}.z`),
  }
  if (value.visibility !== undefined) {
    landmark.visibility = requireFiniteNumber(value.visibility, `${field}.visibility`)
  }
  if (value.presence !== undefined) {
    landmark.presence = requireFiniteNumber(value.presence, `${field}.presence`)
  }
  return landmark
}

const normalizePoseList = (value, field) => {
  if (!Array.isArray(value)) {
    throw new VideoLibraryStorageError(`${field} must be an array.`, 'INVALID_POSE_RESULT')
  }
  return value.map((pose, poseIndex) => {
    if (!Array.isArray(pose) || pose.length !== 33) {
      throw new VideoLibraryStorageError(`${field}[${poseIndex}] must contain 33 landmarks.`, 'INVALID_POSE_RESULT')
    }
    return pose.map((landmark, landmarkIndex) => normalizeLandmark(
      landmark,
      `${field}[${poseIndex}][${landmarkIndex}]`,
    ))
  })
}

const normalizePoseData = (value) => {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || value.task !== taskName) {
    throw new VideoLibraryStorageError('Pose data must use schemaVersion 1 and the MediaPipe Pose Landmarker task.', 'INVALID_POSE_RESULT')
  }
  if (!Array.isArray(value.frames) || value.frames.length === 0 || value.frames.length > 10_000) {
    throw new VideoLibraryStorageError('Pose data frames must contain between 1 and 10,000 entries.', 'INVALID_POSE_RESULT')
  }

  let previousTimestamp = -1
  let detectedPoseFrameCount = 0
  const frames = value.frames.map((frame, frameIndex) => {
    if (!frame || typeof frame !== 'object') {
      throw new VideoLibraryStorageError(`frames[${frameIndex}] must be an object.`, 'INVALID_POSE_RESULT')
    }
    const videoTimestampMs = requireFiniteNumber(frame.videoTimestampMs, `frames[${frameIndex}].videoTimestampMs`)
    if (videoTimestampMs < 0 || videoTimestampMs <= previousTimestamp) {
      throw new VideoLibraryStorageError('Pose frame timestamps must be non-negative and strictly increasing.', 'INVALID_POSE_RESULT')
    }
    previousTimestamp = videoTimestampMs
    const landmarks = normalizePoseList(frame.landmarks, `frames[${frameIndex}].landmarks`)
    const worldLandmarks = normalizePoseList(frame.worldLandmarks, `frames[${frameIndex}].worldLandmarks`)
    if (landmarks.length !== worldLandmarks.length) {
      throw new VideoLibraryStorageError(`frames[${frameIndex}] pose arrays must have equal lengths.`, 'INVALID_POSE_RESULT')
    }
    if (landmarks.length > 0) detectedPoseFrameCount += 1
    return { videoTimestampMs, landmarks, worldLandmarks }
  })

  const durationMs = requireFiniteNumber(value.durationMs, 'durationMs')
  const processingDurationMs = requireFiniteNumber(value.processingDurationMs, 'processingDurationMs')
  if (durationMs <= 0 || processingDurationMs < 0) {
    throw new VideoLibraryStorageError('Pose duration values are invalid.', 'INVALID_POSE_RESULT')
  }
  if (previousTimestamp > durationMs + 100) {
    throw new VideoLibraryStorageError('Pose frame timestamps exceed the video duration.', 'INVALID_POSE_RESULT')
  }
  if (value.frameCount !== frames.length || value.detectedPoseFrameCount !== detectedPoseFrameCount) {
    throw new VideoLibraryStorageError('Pose frame summary does not match the frame data.', 'INVALID_POSE_RESULT')
  }

  const model = value.model
  if (!model || typeof model !== 'object' || typeof model.packageVersion !== 'string' ||
    typeof model.modelAssetPath !== 'string' || model.runningMode !== 'VIDEO' ||
    (model.delegate !== 'GPU' && model.delegate !== 'CPU')) {
    throw new VideoLibraryStorageError('Pose model metadata is invalid.', 'INVALID_POSE_RESULT')
  }

  return {
    model: {
      packageVersion: model.packageVersion,
      modelName: String(model.modelName ?? ''),
      modelAssetPath: model.modelAssetPath,
      runningMode: 'VIDEO',
      delegate: model.delegate,
      numPoses: requireFiniteNumber(model.numPoses, 'model.numPoses'),
      minPoseDetectionConfidence: requireFiniteNumber(model.minPoseDetectionConfidence, 'model.minPoseDetectionConfidence'),
      minPosePresenceConfidence: requireFiniteNumber(model.minPosePresenceConfidence, 'model.minPosePresenceConfidence'),
      minTrackingConfidence: requireFiniteNumber(model.minTrackingConfidence, 'model.minTrackingConfidence'),
    },
    durationMs,
    processingDurationMs,
    frameCount: frames.length,
    detectedPoseFrameCount,
    frames,
  }
}

const poseFilenameFor = (generatedClipFilename) => {
  const basename = path.basename(generatedClipFilename)
  const extension = path.extname(basename)
  return `${extension ? basename.slice(0, -extension.length) : basename}.pose.json`
}

const resolvePoseOutputPath = (poseDirectory, filename) => {
  const root = path.resolve(poseDirectory)
  const outputPath = path.resolve(root, path.basename(filename))
  if (!outputPath.startsWith(`${root}${path.sep}`)) {
    throw new VideoLibraryStorageError('Pose result path must remain within the pose directory.', 'INVALID_POSE_RESULT_PATH')
  }
  return outputPath
}

export const savePoseResult = async ({ clipRangeId, poseData, repository, clipVideoDirectory, poseDirectory }) => {
  if (typeof clipRangeId !== 'string' || !clipRangeId) {
    throw new VideoLibraryStorageError('clipRangeId is required.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  if (inFlightPoseResults.has(clipRangeId)) {
    throw new VideoLibraryStorageError('This clip range pose result is already being saved.', 'POSE_RESULT_IN_PROGRESS')
  }
  inFlightPoseResults.add(clipRangeId)

  let temporaryPath = ''
  let backupPath = ''
  let outputPath = ''
  try {
    const normalized = normalizePoseData(poseData)
    const { clip } = await repository.findClipRange(clipRangeId)
    await resolveGeneratedClipFullPath({ clipRangeId, repository, clipVideoDirectory })

    const filename = poseFilenameFor(clip.generatedClip.filename)
    const relativePath = `pose/${filename}`
    outputPath = resolvePoseOutputPath(poseDirectory, filename)
    await mkdir(poseDirectory, { recursive: true })
    const resolvedPoseDirectory = await realpath(poseDirectory)
    if (path.dirname(outputPath) !== resolvedPoseDirectory) {
      throw new VideoLibraryStorageError('Pose directory could not be resolved safely.', 'INVALID_POSE_RESULT_PATH')
    }

    const createdAt = new Date().toISOString()
    const poseResult = {
      filename,
      relativePath,
      frameCount: normalized.frameCount,
      detectedPoseFrameCount: normalized.detectedPoseFrameCount,
      durationMs: normalized.durationMs,
      processingDurationMs: normalized.processingDurationMs,
      createdAt,
    }
    const artifact = {
      schemaVersion: 1,
      task: taskName,
      source: {
        clipRangeId,
        generatedClipFilename: clip.generatedClip.filename,
        generatedClipRelativePath: clip.generatedClip.relativePath,
        durationMs: normalized.durationMs,
      },
      model: normalized.model,
      frameCount: normalized.frameCount,
      detectedPoseFrameCount: normalized.detectedPoseFrameCount,
      processingDurationMs: normalized.processingDurationMs,
      frames: normalized.frames,
      createdAt,
    }

    temporaryPath = path.join(resolvedPoseDirectory, `.${filename}.${globalThis.crypto.randomUUID()}.tmp`)
    await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })

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
      const library = await repository.attachPoseResult(clipRangeId, poseResult)
      if (backupPath) {
        await unlink(backupPath).catch(() => undefined)
        backupPath = ''
      }
      return { library, poseResult, artifact }
    } catch (error) {
      await unlink(outputPath).catch(() => undefined)
      if (backupPath) {
        try {
          await rename(backupPath, outputPath)
          backupPath = ''
        } catch {
          // Preserve the backup if restoration itself fails. Removing it here
          // would turn a metadata failure into loss of the prior pose result.
        }
      }
      throw error
    }
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
    inFlightPoseResults.delete(clipRangeId)
  }
}

export const resolvePoseResultFullPath = async ({ clipRangeId, repository, poseDirectory }) => {
  const { clip } = await repository.findClipRange(clipRangeId)
  if (!clip.generatedClip?.poseResult) {
    throw new VideoLibraryStorageError('This generated clip does not have a pose result.', 'POSE_RESULT_NOT_FOUND')
  }
  const fullPath = resolvePoseOutputPath(poseDirectory, clip.generatedClip.poseResult.filename)
  try {
    const [root, resolvedPath] = await Promise.all([realpath(poseDirectory), realpath(fullPath)])
    if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
      throw new VideoLibraryStorageError('Pose result path must remain within the pose directory.', 'INVALID_POSE_RESULT_PATH')
    }
    const resultStat = await stat(resolvedPath)
    if (!resultStat.isFile()) {
      throw new VideoLibraryStorageError('Pose result file does not exist.', 'POSE_RESULT_FILE_NOT_FOUND')
    }
    await access(resolvedPath, constants.R_OK)
    return resolvedPath
  } catch (error) {
    if (error instanceof VideoLibraryStorageError) throw error
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'EACCES') {
      throw new VideoLibraryStorageError('Pose result file does not exist.', 'POSE_RESULT_FILE_NOT_FOUND')
    }
    throw error
  }
}

export const readPoseResult = async (options) => JSON.parse(await readFile(
  await resolvePoseResultFullPath(options),
  'utf8',
))

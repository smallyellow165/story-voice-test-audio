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
const imagePrecision = 4
const featurePrecision = 3
const featureVisibilityThreshold = 0.5

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

const validLandmark = (landmark, dimensions = ['x', 'y', 'z']) => landmark &&
  dimensions.every((dimension) => Number.isFinite(landmark[dimension])) &&
  Number.isFinite(landmark.visibility)

const reliableLandmark = (landmark, dimensions = ['x', 'y', 'z']) =>
  validLandmark(landmark, dimensions) && landmark.visibility >= featureVisibilityThreshold

const midpoint2d = (left, right) => reliableLandmark(left, ['x', 'y']) && reliableLandmark(right, ['x', 'y'])
  ? [(left.x + right.x) / 2, (left.y + right.y) / 2]
  : null

const angle3dDeg = (first, vertex, third) => {
  if (![first, vertex, third].every((landmark) => reliableLandmark(landmark))) return null
  const a = [first.x - vertex.x, first.y - vertex.y, first.z - vertex.z]
  const b = [third.x - vertex.x, third.y - vertex.y, third.z - vertex.z]
  const magnitudeA = Math.hypot(...a)
  const magnitudeB = Math.hypot(...b)
  if (magnitudeA === 0 || magnitudeB === 0) return null
  const cosine = Math.max(-1, Math.min(1, a.reduce((sum, value, index) => sum + value * b[index], 0) / (magnitudeA * magnitudeB)))
  return Math.acos(cosine) * 180 / Math.PI
}

const tiltDeg = (left, right) => reliableLandmark(left) && reliableLandmark(right)
  ? Math.atan2(right.y - left.y, Math.abs(right.x - left.x)) * 180 / Math.PI
  : null

const roundedOrNull = (value, precision = featurePrecision) => Number.isFinite(value) ? roundTo(value, precision) : null

const buildGlobalFeatures = (imagePose) => {
  const pelvis = midpoint2d(imagePose[23], imagePose[24])
  const shoulderCenter = midpoint2d(imagePose[11], imagePose[12])
  const bodyCenter = pelvis && shoulderCenter
    ? [(pelvis[0] + shoulderCenter[0]) / 2, (pelvis[1] + shoulderCenter[1]) / 2]
    : null
  const reliableBodyLandmarks = imagePose.slice(11).filter((landmark) => reliableLandmark(landmark, ['x', 'y']))
  const bodyBox = reliableBodyLandmarks.length ? (() => {
    const xs = reliableBodyLandmarks.map((landmark) => landmark.x)
    const ys = reliableBodyLandmarks.map((landmark) => landmark.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    return [minX, minY, maxX, maxY, maxX - minX, maxY - minY]
  })() : null
  const roundTuple = (tuple) => tuple?.map((value) => roundTo(value, imagePrecision)) ?? null
  return {
    pelvis: roundTuple(pelvis),
    shoulderCenter: roundTuple(shoulderCenter),
    bodyCenter: roundTuple(bodyCenter),
    bodyBox: roundTuple(bodyBox),
  }
}

const buildStaticFeatures = (worldPose) => {
  const pelvisY = reliableLandmark(worldPose[23]) && reliableLandmark(worldPose[24])
    ? (worldPose[23].y + worldPose[24].y) / 2
    : null
  const leftKneeAngleDeg = angle3dDeg(worldPose[23], worldPose[25], worldPose[27])
  const rightKneeAngleDeg = angle3dDeg(worldPose[24], worldPose[26], worldPose[28])
  // MediaPipe y increases downward. Larger values therefore mean a foot is higher/closer to the pelvis.
  const leftFootRelativeHeight = pelvisY === null || !reliableLandmark(worldPose[27]) ? null : pelvisY - worldPose[27].y
  const rightFootRelativeHeight = pelvisY === null || !reliableLandmark(worldPose[28]) ? null : pelvisY - worldPose[28].y
  return {
    leftKneeAngleDeg: roundedOrNull(leftKneeAngleDeg),
    rightKneeAngleDeg: roundedOrNull(rightKneeAngleDeg),
    kneeAngleDiffDeg: roundedOrNull(leftKneeAngleDeg === null || rightKneeAngleDeg === null ? null : leftKneeAngleDeg - rightKneeAngleDeg),
    leftFootRelativeHeight: roundedOrNull(leftFootRelativeHeight),
    rightFootRelativeHeight: roundedOrNull(rightFootRelativeHeight),
    ankleHeightDiff: roundedOrNull(leftFootRelativeHeight === null || rightFootRelativeHeight === null ? null : leftFootRelativeHeight - rightFootRelativeHeight),
    shoulderTiltDeg: roundedOrNull(tiltDeg(worldPose[11], worldPose[12])),
    hipTiltDeg: roundedOrNull(tiltDeg(worldPose[23], worldPose[24])),
  }
}

const addTemporalFeatures = (frames) => {
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const previous = frames[index - 1]
    const deltaSeconds = previous ? (frame.t - previous.t) / 1000 : null
    const velocity = (key) => {
      const currentY = frame.g[key]?.[1]
      const previousY = previous?.g[key]?.[1]
      return deltaSeconds && Number.isFinite(currentY) && Number.isFinite(previousY)
        ? (currentY - previousY) / deltaSeconds
        : null
    }
    const pelvisVy = velocity('pelvis')
    const shoulderVy = velocity('shoulderCenter')
    const bodyCenterVy = velocity('bodyCenter')
    const previousDeltaSeconds = index >= 2 ? (previous.t - frames[index - 2].t) / 1000 : null
    const acceleration = (currentVelocity, previousVelocity) => deltaSeconds && previousDeltaSeconds &&
      Number.isFinite(currentVelocity) && Number.isFinite(previousVelocity)
      ? (currentVelocity - previousVelocity) / deltaSeconds
      : null
    frame.f.pelvisVy = roundedOrNull(pelvisVy)
    frame.f.shoulderVy = roundedOrNull(shoulderVy)
    frame.f.bodyCenterVy = roundedOrNull(bodyCenterVy)
    frame.f.pelvisAy = roundedOrNull(acceleration(pelvisVy, previous?.f.pelvisVy))
    frame.f.bodyCenterAy = roundedOrNull(acceleration(bodyCenterVy, previous?.f.bodyCenterVy))
  }
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
    if (timestamp < 0 || timestamp <= previousTimestamp || !Array.isArray(frame.worldLandmarks) || !Array.isArray(frame.landmarks)) {
      throw new VideoLibraryStorageError('Raw Pose timestamps or landmarks are invalid.', 'INVALID_POSE_RESULT')
    }
    previousTimestamp = timestamp
    if (frame.worldLandmarks.length > 1 || frame.landmarks.length > 1 || frame.worldLandmarks.length !== frame.landmarks.length) {
      throw new VideoLibraryStorageError('LLM Pose compression expects at most one pose per frame.', 'INVALID_POSE_RESULT')
    }
    if (frame.worldLandmarks.length === 1 &&
      (!Array.isArray(frame.worldLandmarks[0]) || frame.worldLandmarks[0].length !== 33 ||
        !Array.isArray(frame.landmarks[0]) || frame.landmarks[0].length !== 33)) {
      throw new VideoLibraryStorageError(`frames[${frameIndex}] must contain 33 image and world landmarks.`, 'INVALID_POSE_RESULT')
    }
  }
  return { durationMs, frames: value.frames }
}

export const compressPoseForLlm = (rawPose) => {
  const { durationMs, frames: rawFrames } = validateRawPose(rawPose)
  const frames = []
  let previousRawTimestamp = null
  let previousCompressedTimestamp = -1
  const firstSourceTimestampMs = rawFrames[0].videoTimestampMs
  const lastSourceTimestampMs = rawFrames.at(-1).videoTimestampMs

  let targetTimestampMs = firstSourceTimestampMs
  while (targetTimestampMs <= lastSourceTimestampMs) {
    const rawFrame = nearestFrame(rawFrames, targetTimestampMs)
    if (Math.abs(rawFrame.videoTimestampMs - targetTimestampMs) > maxDistanceMs ||
      rawFrame.videoTimestampMs === previousRawTimestamp || rawFrame.worldLandmarks.length === 0) {
      targetTimestampMs += targetIntervalMs
      continue
    }

    const pose = rawFrame.worldLandmarks[0]
    const timestamp = Math.round(rawFrame.videoTimestampMs)
    if (timestamp <= previousCompressedTimestamp) {
      targetTimestampMs += targetIntervalMs
      continue
    }
    const joints = {}
    for (const [name, index] of poseLlmJoints) {
      const landmark = pose[index]
      if (!validLandmark(landmark)) {
        throw new VideoLibraryStorageError(`World landmark ${index} is invalid.`, 'INVALID_POSE_RESULT')
      }
      joints[name] = [
        roundTo(landmark.x, xyzPrecision),
        roundTo(landmark.y, xyzPrecision),
        roundTo(landmark.z, xyzPrecision),
        roundTo(landmark.visibility, visibilityPrecision),
      ]
    }
    frames.push({
      t: timestamp,
      j: joints,
      g: buildGlobalFeatures(rawFrame.landmarks[0]),
      f: buildStaticFeatures(pose),
    })
    previousRawTimestamp = rawFrame.videoTimestampMs
    previousCompressedTimestamp = timestamp
    // Re-anchor after each selected source frame so a late frame following a source gap
    // cannot be followed immediately by another frame from the old target grid.
    targetTimestampMs = rawFrame.videoTimestampMs + targetIntervalMs
  }

  if (!frames.length) {
    throw new VideoLibraryStorageError('Raw Pose JSON did not contain compressible detected frames.', 'INVALID_POSE_RESULT')
  }
  addTemporalFeatures(frames)
  const sourceFrameDeltas = rawFrames.slice(1).map((frame, index) => frame.videoTimestampMs - rawFrames[index].videoTimestampMs)
  return {
    schemaVersion: 2,
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
      imagePrecision,
      featurePrecision,
      featureVisibilityThreshold,
      jointCount: poseLlmJoints.length,
      coordinateSpace: 'world',
      globalCoordinateSpace: 'normalized-image',
      imageYAxis: 'down',
      footRelativeHeight: 'pelvisY - ankleY; larger values mean the foot is higher',
      tiltDegrees: 'positive values mean the right-side landmark is lower than the left-side landmark',
      velocityUnits: 'normalized-image-units-per-second; positive y velocity is downward',
      accelerationUnits: 'normalized-image-units-per-second-squared; positive y acceleration is downward',
      globalTupleFormats: {
        pelvis: '[x,y]',
        shoulderCenter: '[x,y]',
        bodyCenter: '[x,y]',
        bodyBox: '[minX,minY,maxX,maxY,width,height]',
      },
    },
    sampling: {
      firstSourceTimestampMs: roundTo(firstSourceTimestampMs, 3),
      lastSourceTimestampMs: roundTo(lastSourceTimestampMs, 3),
      maxSourceFrameGapMs: roundTo(sourceFrameDeltas.length ? Math.max(...sourceFrameDeltas) : 0, 3),
      expectedFrameCountAtTargetFps: Math.floor((lastSourceTimestampMs - firstSourceTimestampMs) / targetIntervalMs) + 1,
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

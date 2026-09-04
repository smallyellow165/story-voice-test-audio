import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const VIDEO_LIBRARY_SCHEMA_VERSION = 3

export class VideoLibraryStorageError extends Error {
  constructor(message, code = 'VIDEO_LIBRARY_STORAGE_ERROR') {
    super(message)
    this.name = 'VideoLibraryStorageError'
    this.code = code
  }
}

const now = () => new Date().toISOString()

export const emptyVideoLibrary = () => {
  const timestamp = now()
  return {
    schemaVersion: VIDEO_LIBRARY_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    videos: [],
    clips: [],
    poseRuns: [],
    llmPoseRuns: [],
    nextIds: {
      video: 1,
      clips: {},
      poseRuns: {},
      llmPoseRuns: {},
    },
  }
}

const requireString = (value, field) => {
  if (typeof value !== 'string' || !value) {
    throw new VideoLibraryStorageError(`${field} must be a non-empty string.`, 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return value
}

const optionalString = (value, field) => value === undefined || value === null || value === ''
  ? undefined
  : requireString(value, field)

const requireNumber = (value, field) => {
  if (!Number.isFinite(value)) {
    throw new VideoLibraryStorageError(`${field} must be a finite number.`, 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return value
}

const optionalNumber = (value, field) => value === undefined || value === null
  ? undefined
  : requireNumber(value, field)

const normalizeVideo = (value) => {
  if (!value || typeof value !== 'object') {
    throw new VideoLibraryStorageError('Video metadata must be an object.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  const sourceSite = optionalString(value.sourceSite, 'video.sourceSite')
  if (sourceSite && !['youtube', 'bilibili', 'other'].includes(sourceSite)) {
    throw new VideoLibraryStorageError('video.sourceSite is invalid.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return {
    videoId: requireString(value.videoId, 'video.videoId'),
    filename: requireString(value.filename, 'video.filename'),
    relativePath: requireString(value.relativePath, 'video.relativePath'),
    sourceUrl: optionalString(value.sourceUrl, 'video.sourceUrl'),
    sourceSite,
    size: optionalNumber(value.size, 'video.size') ?? 0,
    lastModified: optionalNumber(value.lastModified, 'video.lastModified') ?? 0,
    durationMs: optionalNumber(value.durationMs, 'video.durationMs'),
    createdAt: requireString(value.createdAt, 'video.createdAt'),
    updatedAt: requireString(value.updatedAt, 'video.updatedAt'),
  }
}

const normalizeClip = (value) => {
  if (!value || typeof value !== 'object') {
    throw new VideoLibraryStorageError('Clip metadata must be an object.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  const startMs = requireNumber(value.startMs, 'clip.startMs')
  const endMs = requireNumber(value.endMs, 'clip.endMs')
  if (startMs < 0 || endMs <= startMs) {
    throw new VideoLibraryStorageError('Clip range must have 0 <= startMs < endMs.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return {
    clipId: requireString(value.clipId, 'clip.clipId'),
    videoId: requireString(value.videoId, 'clip.videoId'),
    startMs,
    endMs,
    durationMs: endMs - startMs,
    label: value.label === null || value.label === undefined ? null : requireString(value.label, 'clip.label'),
    relativePath: optionalString(value.relativePath, 'clip.relativePath'),
    createdAt: requireString(value.createdAt, 'clip.createdAt'),
    updatedAt: requireString(value.updatedAt, 'clip.updatedAt'),
  }
}

const normalizeModel = (value) => {
  if (!value || typeof value !== 'object') {
    throw new VideoLibraryStorageError('Pose model metadata must be an object.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return {
    name: requireString(value.name, 'poseRun.model.name'),
    packageVersion: requireString(value.packageVersion, 'poseRun.model.packageVersion'),
    modelAssetPath: requireString(value.modelAssetPath, 'poseRun.model.modelAssetPath'),
    delegate: ['GPU', 'CPU'].includes(value.delegate) ? value.delegate : (() => {
      throw new VideoLibraryStorageError('poseRun.model.delegate is invalid.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    })(),
    runningMode: value.runningMode === 'VIDEO' ? 'VIDEO' : (() => {
      throw new VideoLibraryStorageError('poseRun.model.runningMode must be VIDEO.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    })(),
    numPoses: requireNumber(value.numPoses, 'poseRun.model.numPoses'),
    minPoseDetectionConfidence: requireNumber(value.minPoseDetectionConfidence, 'poseRun.model.minPoseDetectionConfidence'),
    minPosePresenceConfidence: requireNumber(value.minPosePresenceConfidence, 'poseRun.model.minPosePresenceConfidence'),
    minTrackingConfidence: requireNumber(value.minTrackingConfidence, 'poseRun.model.minTrackingConfidence'),
  }
}

const normalizePoseRun = (value) => ({
  poseRunId: requireString(value?.poseRunId, 'poseRun.poseRunId'),
  videoId: requireString(value?.videoId, 'poseRun.videoId'),
  clipId: requireString(value?.clipId, 'poseRun.clipId'),
  relativePath: requireString(value?.relativePath, 'poseRun.relativePath'),
  model: normalizeModel(value?.model),
  samplingFps: requireNumber(value?.samplingFps, 'poseRun.samplingFps'),
  durationMs: requireNumber(value?.durationMs, 'poseRun.durationMs'),
  frameCount: requireNumber(value?.frameCount, 'poseRun.frameCount'),
  detectedPoseFrameCount: requireNumber(value?.detectedPoseFrameCount, 'poseRun.detectedPoseFrameCount'),
  processingDurationMs: requireNumber(value?.processingDurationMs, 'poseRun.processingDurationMs'),
  createdAt: requireString(value?.createdAt, 'poseRun.createdAt'),
})

const normalizeLlmPoseRun = (value) => ({
  llmPoseRunId: requireString(value?.llmPoseRunId, 'llmPoseRun.llmPoseRunId'),
  videoId: requireString(value?.videoId, 'llmPoseRun.videoId'),
  clipId: requireString(value?.clipId, 'llmPoseRun.clipId'),
  poseRunId: requireString(value?.poseRunId, 'llmPoseRun.poseRunId'),
  relativePath: requireString(value?.relativePath, 'llmPoseRun.relativePath'),
  schemaVersion: requireNumber(value?.schemaVersion, 'llmPoseRun.schemaVersion'),
  targetFps: requireNumber(value?.targetFps, 'llmPoseRun.targetFps'),
  frameCount: requireNumber(value?.frameCount, 'llmPoseRun.frameCount'),
  sizeBytes: requireNumber(value?.sizeBytes, 'llmPoseRun.sizeBytes'),
  createdAt: requireString(value?.createdAt, 'llmPoseRun.createdAt'),
})

const ensureUnique = (values, key, collection) => {
  const ids = new Set()
  for (const value of values) {
    if (ids.has(value[key])) {
      throw new VideoLibraryStorageError(`${collection} contains duplicate ${key}.`, 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
    ids.add(value[key])
  }
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const idSequence = (id, prefix, field) => {
  const match = id.match(new RegExp(`^${escapeRegExp(prefix)}(\\d{3,})$`))
  if (!match) throw new VideoLibraryStorageError(`${field} has an invalid ancestry ID.`, 'INVALID_VIDEO_LIBRARY_SCHEMA')
  return Number(match[1])
}

const normalizeCounter = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new VideoLibraryStorageError(`${field} must be a positive integer.`, 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return value
}

const normalizeCounterMap = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VideoLibraryStorageError(`${field} must be an object.`, 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return Object.fromEntries(Object.entries(value).map(([key, counter]) => [key, normalizeCounter(counter, `${field}.${key}`)]))
}

const normalizeStore = (value) => {
  if (!value || typeof value !== 'object' || value.schemaVersion !== VIDEO_LIBRARY_SCHEMA_VERSION) {
    throw new VideoLibraryStorageError(
      `Unsupported Video Library schema. Expected schemaVersion ${VIDEO_LIBRARY_SCHEMA_VERSION}.`,
      'UNSUPPORTED_VIDEO_LIBRARY_SCHEMA',
    )
  }
  if (!Array.isArray(value.videos) || !Array.isArray(value.clips) ||
    !Array.isArray(value.poseRuns) || !Array.isArray(value.llmPoseRuns)) {
    throw new VideoLibraryStorageError('Video Library collections must be arrays.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  const library = {
    schemaVersion: VIDEO_LIBRARY_SCHEMA_VERSION,
    createdAt: requireString(value.createdAt, 'library.createdAt'),
    updatedAt: requireString(value.updatedAt, 'library.updatedAt'),
    videos: value.videos.map(normalizeVideo),
    clips: value.clips.map(normalizeClip),
    poseRuns: value.poseRuns.map(normalizePoseRun),
    llmPoseRuns: value.llmPoseRuns.map(normalizeLlmPoseRun),
    nextIds: {
      video: normalizeCounter(value.nextIds?.video, 'library.nextIds.video'),
      clips: normalizeCounterMap(value.nextIds?.clips, 'library.nextIds.clips'),
      poseRuns: normalizeCounterMap(value.nextIds?.poseRuns, 'library.nextIds.poseRuns'),
      llmPoseRuns: normalizeCounterMap(value.nextIds?.llmPoseRuns, 'library.nextIds.llmPoseRuns'),
    },
  }
  ensureUnique(library.videos, 'videoId', 'videos')
  ensureUnique(library.clips, 'clipId', 'clips')
  ensureUnique(library.poseRuns, 'poseRunId', 'poseRuns')
  ensureUnique(library.llmPoseRuns, 'llmPoseRunId', 'llmPoseRuns')
  const videoIds = new Set(library.videos.map((video) => video.videoId))
  const clips = new Map(library.clips.map((clip) => [clip.clipId, clip]))
  const poseRuns = new Map(library.poseRuns.map((poseRun) => [poseRun.poseRunId, poseRun]))
  let maximumVideoSequence = 0
  for (const video of library.videos) {
    maximumVideoSequence = Math.max(maximumVideoSequence, idSequence(video.videoId, 'video-', 'video.videoId'))
    if (!new RegExp(`^${escapeRegExp(video.videoId)}/source\\.[a-z0-9]+$`).test(video.relativePath)) {
      throw new VideoLibraryStorageError('Video relativePath must use its source-centric directory.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
  }
  if (library.nextIds.video <= maximumVideoSequence) {
    throw new VideoLibraryStorageError('library.nextIds.video would reuse an existing ID.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  for (const clip of library.clips) {
    if (!videoIds.has(clip.videoId)) throw new VideoLibraryStorageError('Clip parent video does not exist.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    const sequence = idSequence(clip.clipId, `${clip.videoId}_clip-`, 'clip.clipId')
    if (clip.relativePath && clip.relativePath !== `${clip.videoId}/clips/${clip.clipId}.mp4`) {
      throw new VideoLibraryStorageError('Clip relativePath does not match its ancestry IDs.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
    if ((library.nextIds.clips[clip.videoId] ?? 1) <= sequence) {
      throw new VideoLibraryStorageError('Clip ID counter would reuse an existing ID.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
  }
  for (const poseRun of library.poseRuns) {
    const clip = clips.get(poseRun.clipId)
    if (!clip || clip.videoId !== poseRun.videoId) throw new VideoLibraryStorageError('Pose Run ancestry is invalid.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    const sequence = idSequence(poseRun.poseRunId, `${poseRun.clipId}_pose-`, 'poseRun.poseRunId')
    if (poseRun.relativePath !== `${poseRun.videoId}/pose/${poseRun.poseRunId}.json`) {
      throw new VideoLibraryStorageError('Pose Run relativePath does not match its ancestry IDs.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
    if ((library.nextIds.poseRuns[poseRun.clipId] ?? 1) <= sequence) {
      throw new VideoLibraryStorageError('Pose Run ID counter would reuse an existing ID.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
  }
  for (const llmPoseRun of library.llmPoseRuns) {
    const poseRun = poseRuns.get(llmPoseRun.poseRunId)
    if (!poseRun || poseRun.clipId !== llmPoseRun.clipId || poseRun.videoId !== llmPoseRun.videoId) {
      throw new VideoLibraryStorageError('LLM Pose Run ancestry is invalid.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
    const sequence = idSequence(llmPoseRun.llmPoseRunId, `${llmPoseRun.poseRunId}_llm-`, 'llmPoseRun.llmPoseRunId')
    if (llmPoseRun.relativePath !== `${llmPoseRun.videoId}/llm-pose/${llmPoseRun.llmPoseRunId}.json`) {
      throw new VideoLibraryStorageError('LLM Pose Run relativePath does not match its ancestry IDs.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
    if ((library.nextIds.llmPoseRuns[llmPoseRun.poseRunId] ?? 1) <= sequence) {
      throw new VideoLibraryStorageError('LLM Pose Run ID counter would reuse an existing ID.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
  }
  return library
}

const allocateId = (prefix, sequence) => `${prefix}${String(sequence).padStart(3, '0')}`

export const createVideoLibraryRepository = (storagePath) => {
  const saveVideoLibrary = async (library) => {
    const normalized = normalizeStore({ ...library, updatedAt: now() })
    await mkdir(path.dirname(storagePath), { recursive: true })
    const temporaryPath = `${storagePath}.${globalThis.crypto.randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, storagePath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
    return normalized
  }

  const loadVideoLibrary = async () => {
    try {
      const contents = await readFile(storagePath, 'utf8')
      return normalizeStore(JSON.parse(contents))
    } catch (error) {
      if (error?.code === 'ENOENT') return saveVideoLibrary(emptyVideoLibrary())
      if (error instanceof SyntaxError) {
        throw new VideoLibraryStorageError(`Video Library JSON is invalid at ${storagePath}.`, 'INVALID_VIDEO_LIBRARY_JSON')
      }
      throw error
    }
  }

  let mutationQueue = Promise.resolve()
  const mutate = (mutator) => {
    const mutation = mutationQueue.then(async () => {
      const library = await loadVideoLibrary()
      const result = await mutator(library)
      const saved = await saveVideoLibrary(library)
      return { library: saved, result }
    })
    mutationQueue = mutation.catch(() => undefined)
    return mutation
  }

  const replaceLibrary = (value) => mutate((library) => {
    const normalized = normalizeStore(value)
    Object.assign(library, normalized, { updatedAt: now() })
  }).then(({ library }) => library)

  const createVideo = (input) => mutate((library) => {
    const videoId = allocateId('video-', library.nextIds.video)
    library.nextIds.video += 1
    const timestamp = now()
    const extension = path.extname(requireString(input.filename, 'video.filename')).toLowerCase() || '.mp4'
    const video = normalizeVideo({
      videoId,
      filename: input.filename,
      relativePath: `${videoId}/source${extension}`,
      sourceUrl: input.sourceUrl,
      sourceSite: input.sourceSite,
      size: input.size ?? 0,
      lastModified: input.lastModified ?? 0,
      durationMs: input.durationMs,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    library.videos.push(video)
    return video
  })

  const updateVideo = (videoId, patch) => mutate((library) => {
    const index = library.videos.findIndex((video) => video.videoId === videoId)
    if (index < 0) throw new VideoLibraryStorageError('Video was not found.', 'VIDEO_NOT_FOUND')
    library.videos[index] = normalizeVideo({ ...library.videos[index], ...patch, videoId, updatedAt: now() })
    return library.videos[index]
  })

  const createClip = (videoId, input) => mutate((library) => {
    if (!library.videos.some((video) => video.videoId === videoId)) {
      throw new VideoLibraryStorageError('Video was not found.', 'VIDEO_NOT_FOUND')
    }
    const sequence = library.nextIds.clips[videoId] ?? 1
    const clipId = allocateId(`${videoId}_clip-`, sequence)
    library.nextIds.clips[videoId] = sequence + 1
    const timestamp = now()
    const clip = normalizeClip({
      clipId,
      videoId,
      startMs: input.startMs,
      endMs: input.endMs,
      label: input.label ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    library.clips.push(clip)
    return clip
  })

  const updateClipLabel = (videoId, clipId, label) => mutate((library) => {
    const index = library.clips.findIndex((clip) => clip.clipId === clipId && clip.videoId === videoId)
    if (index < 0) throw new VideoLibraryStorageError('Clip was not found.', 'CLIP_NOT_FOUND')
    if (label !== null && label !== undefined && typeof label !== 'string') {
      throw new VideoLibraryStorageError('Clip label must be a string or null.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
    library.clips[index] = normalizeClip({
      ...library.clips[index],
      label: typeof label === 'string' && label.trim() ? label.trim() : null,
      updatedAt: now(),
    })
    return library.clips[index]
  })

  const attachClipArtifact = (videoId, clipId, relativePath) => mutate((library) => {
    const clip = library.clips.find((item) => item.clipId === clipId && item.videoId === videoId)
    if (!clip) throw new VideoLibraryStorageError('Clip was not found.', 'CLIP_NOT_FOUND')
    clip.relativePath = requireString(relativePath, 'clip.relativePath')
    clip.updatedAt = now()
    return clip
  })

  const createPoseRun = (videoId, clipId, input) => mutate((library) => {
    const clip = library.clips.find((item) => item.clipId === clipId && item.videoId === videoId)
    if (!clip) throw new VideoLibraryStorageError('Clip was not found.', 'CLIP_NOT_FOUND')
    if (!clip.relativePath) throw new VideoLibraryStorageError('Clip artifact does not exist.', 'CLIP_ARTIFACT_NOT_FOUND')
    const sequence = library.nextIds.poseRuns[clipId] ?? 1
    const nextPoseRunId = allocateId(`${clipId}_pose-`, sequence)
    const poseRunId = input.poseRunId ?? nextPoseRunId
    if (poseRunId !== nextPoseRunId) {
      throw new VideoLibraryStorageError('poseRunId is stale or invalid.', 'POSE_RUN_ID_CONFLICT')
    }
    const poseRun = normalizePoseRun({ ...input, poseRunId, videoId, clipId })
    library.poseRuns.push(poseRun)
    library.nextIds.poseRuns[clipId] = sequence + 1
    return poseRun
  })

  const createLlmPoseRun = (videoId, clipId, poseRunId, input) => mutate((library) => {
    const poseRun = library.poseRuns.find((item) => item.poseRunId === poseRunId &&
      item.clipId === clipId && item.videoId === videoId)
    if (!poseRun) throw new VideoLibraryStorageError('Pose Run was not found.', 'POSE_RUN_NOT_FOUND')
    const sequence = library.nextIds.llmPoseRuns[poseRunId] ?? 1
    const nextLlmPoseRunId = allocateId(`${poseRunId}_llm-`, sequence)
    const llmPoseRunId = input.llmPoseRunId ?? nextLlmPoseRunId
    if (llmPoseRunId !== nextLlmPoseRunId) {
      throw new VideoLibraryStorageError('llmPoseRunId is stale or invalid.', 'LLM_POSE_RUN_ID_CONFLICT')
    }
    const llmPoseRun = normalizeLlmPoseRun({ ...input, llmPoseRunId, videoId, clipId, poseRunId })
    library.llmPoseRuns.push(llmPoseRun)
    library.nextIds.llmPoseRuns[poseRunId] = sequence + 1
    return llmPoseRun
  })

  const findVideo = async (videoId) => {
    const library = await loadVideoLibrary()
    const video = library.videos.find((item) => item.videoId === videoId)
    if (!video) throw new VideoLibraryStorageError('Video was not found.', 'VIDEO_NOT_FOUND')
    return { library, video }
  }

  const findClip = async (videoId, clipId) => {
    const library = await loadVideoLibrary()
    const video = library.videos.find((item) => item.videoId === videoId)
    const clip = library.clips.find((item) => item.clipId === clipId && item.videoId === videoId)
    if (!video || !clip) throw new VideoLibraryStorageError('Clip was not found.', 'CLIP_NOT_FOUND')
    return { library, video, clip }
  }

  const findPoseRun = async (videoId, clipId, poseRunId) => {
    const { library, video, clip } = await findClip(videoId, clipId)
    const poseRun = library.poseRuns.find((item) => item.poseRunId === poseRunId &&
      item.clipId === clipId && item.videoId === videoId)
    if (!poseRun) throw new VideoLibraryStorageError('Pose Run was not found.', 'POSE_RUN_NOT_FOUND')
    return { library, video, clip, poseRun }
  }

  const allocatePoseRunId = async (videoId, clipId) => {
    const { library } = await findClip(videoId, clipId)
    return allocateId(`${clipId}_pose-`, library.nextIds.poseRuns[clipId] ?? 1)
  }

  const allocateLlmPoseRunId = async (videoId, clipId, poseRunId) => {
    const { library } = await findPoseRun(videoId, clipId, poseRunId)
    return allocateId(`${poseRunId}_llm-`, library.nextIds.llmPoseRuns[poseRunId] ?? 1)
  }

  const deleteLlmPoseRun = (videoId, clipId, poseRunId, llmPoseRunId) => mutate((library) => {
    const index = library.llmPoseRuns.findIndex((item) => item.llmPoseRunId === llmPoseRunId &&
      item.poseRunId === poseRunId && item.clipId === clipId && item.videoId === videoId)
    if (index < 0) throw new VideoLibraryStorageError('LLM Pose Run was not found.', 'LLM_POSE_RUN_NOT_FOUND')
    return library.llmPoseRuns.splice(index, 1)
  })

  const deletePoseRun = (videoId, clipId, poseRunId) => mutate((library) => {
    const poseRun = library.poseRuns.find((item) => item.poseRunId === poseRunId &&
      item.clipId === clipId && item.videoId === videoId)
    if (!poseRun) throw new VideoLibraryStorageError('Pose Run was not found.', 'POSE_RUN_NOT_FOUND')
    const llmPoseRuns = library.llmPoseRuns.filter((item) => item.poseRunId === poseRunId)
    library.llmPoseRuns = library.llmPoseRuns.filter((item) => item.poseRunId !== poseRunId)
    library.poseRuns = library.poseRuns.filter((item) => item.poseRunId !== poseRunId)
    return { poseRuns: [poseRun], llmPoseRuns }
  })

  const deleteClip = (videoId, clipId) => mutate((library) => {
    const clip = library.clips.find((item) => item.clipId === clipId && item.videoId === videoId)
    if (!clip) throw new VideoLibraryStorageError('Clip was not found.', 'CLIP_NOT_FOUND')
    const poseRuns = library.poseRuns.filter((item) => item.clipId === clipId)
    const poseRunIds = new Set(poseRuns.map((item) => item.poseRunId))
    const llmPoseRuns = library.llmPoseRuns.filter((item) => poseRunIds.has(item.poseRunId))
    library.llmPoseRuns = library.llmPoseRuns.filter((item) => !poseRunIds.has(item.poseRunId))
    library.poseRuns = library.poseRuns.filter((item) => item.clipId !== clipId)
    library.clips = library.clips.filter((item) => item.clipId !== clipId)
    return { clips: [clip], poseRuns, llmPoseRuns }
  })

  const deleteVideo = (videoId) => mutate((library) => {
    const video = library.videos.find((item) => item.videoId === videoId)
    if (!video) throw new VideoLibraryStorageError('Video was not found.', 'VIDEO_NOT_FOUND')
    const clips = library.clips.filter((item) => item.videoId === videoId)
    const clipIds = new Set(clips.map((item) => item.clipId))
    const poseRuns = library.poseRuns.filter((item) => clipIds.has(item.clipId))
    const poseRunIds = new Set(poseRuns.map((item) => item.poseRunId))
    const llmPoseRuns = library.llmPoseRuns.filter((item) => poseRunIds.has(item.poseRunId))
    library.llmPoseRuns = library.llmPoseRuns.filter((item) => item.videoId !== videoId)
    library.poseRuns = library.poseRuns.filter((item) => item.videoId !== videoId)
    library.clips = library.clips.filter((item) => item.videoId !== videoId)
    library.videos = library.videos.filter((item) => item.videoId !== videoId)
    return { videos: [video], clips, poseRuns, llmPoseRuns }
  })

  return {
    storagePath,
    loadVideoLibrary,
    replaceLibrary,
    createVideo,
    updateVideo,
    createClip,
    updateClipLabel,
    attachClipArtifact,
    createPoseRun,
    createLlmPoseRun,
    findVideo,
    findClip,
    findPoseRun,
    allocatePoseRunId,
    allocateLlmPoseRunId,
    deleteLlmPoseRun,
    deletePoseRun,
    deleteClip,
    deleteVideo,
  }
}

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export class VideoLibraryStorageError extends Error {
  constructor(message, code = 'VIDEO_LIBRARY_STORAGE_ERROR') {
    super(message)
    this.name = 'VideoLibraryStorageError'
    this.code = code
  }
}

export const emptyVideoLibrary = () => ({
  version: 1,
  videos: [],
})

const requireString = (value, field) => {
  if (typeof value !== 'string' || !value) {
    throw new VideoLibraryStorageError(`${field} must be a non-empty string.`, 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return value
}

const requireNumber = (value, field) => {
  if (!Number.isFinite(value)) {
    throw new VideoLibraryStorageError(`${field} must be a finite number.`, 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return value
}

const normalizeGeneratedClip = (value) => {
  if (!value || typeof value !== 'object') {
    throw new VideoLibraryStorageError('Generated clip metadata must be an object.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return {
    filename: requireString(value.filename, 'generatedClip.filename'),
    relativePath: requireString(value.relativePath, 'generatedClip.relativePath'),
    createdAt: requireString(value.createdAt, 'generatedClip.createdAt'),
  }
}

const normalizeClipRange = (value) => {
  if (!value || typeof value !== 'object') {
    throw new VideoLibraryStorageError('Clip range must be an object.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  const start = requireNumber(value.start, 'clip.start')
  const end = requireNumber(value.end, 'clip.end')
  if (start < 0 || end <= start) {
    throw new VideoLibraryStorageError('Clip range must have 0 <= start < end.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  return {
    id: requireString(value.id, 'clip.id'),
    start,
    end,
    duration: end - start,
    createdAt: requireString(value.createdAt, 'clip.createdAt'),
    outputFilename: typeof value.outputFilename === 'string' && value.outputFilename
      ? value.outputFilename
      : undefined,
    generatedClip: value.generatedClip === undefined ? undefined : normalizeGeneratedClip(value.generatedClip),
  }
}

const normalizeVideoRecord = (value) => {
  if (!value || typeof value !== 'object' || !value.file || typeof value.file !== 'object') {
    throw new VideoLibraryStorageError('Video record and file metadata must be objects.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  if (value.type !== 'local' && value.type !== 'server') {
    throw new VideoLibraryStorageError('video.type must be local or server.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  if (!Array.isArray(value.clips)) {
    throw new VideoLibraryStorageError('video.clips must be an array.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  const source = value.source === undefined ? undefined : {
    url: requireString(value.source?.url, 'video.source.url'),
    site: ['youtube', 'bilibili', 'other'].includes(value.source?.site) ? value.source.site : 'other',
  }
  const server = value.type === 'server' ? {
    relativePath: requireString(value.server?.relativePath, 'video.server.relativePath'),
    url: requireString(value.server?.url, 'video.server.url'),
  } : undefined
  return {
    id: requireString(value.id, 'video.id'),
    type: value.type,
    file: {
      name: requireString(value.file.name, 'video.file.name'),
      size: requireNumber(value.file.size, 'video.file.size'),
      lastModified: requireNumber(value.file.lastModified, 'video.file.lastModified'),
    },
    server,
    source,
    clips: value.clips.map(normalizeClipRange),
    createdAt: requireString(value.createdAt, 'video.createdAt'),
    updatedAt: requireString(value.updatedAt, 'video.updatedAt'),
    nextClipNumber: Number.isInteger(value.nextClipNumber) && value.nextClipNumber > 0
      ? value.nextClipNumber
      : value.clips.length + 1,
  }
}

const normalizeStore = (value) => {
  if (!value || typeof value !== 'object' || value.version !== 1 ||
    !Array.isArray(value.videos)) {
    throw new VideoLibraryStorageError(
      'Video library JSON must contain version 1 and videos.',
      'INVALID_VIDEO_LIBRARY_SCHEMA',
    )
  }
  return {
    version: 1,
    videos: value.videos.map(normalizeVideoRecord),
  }
}

export const createVideoLibraryRepository = (storagePath) => {
  const saveVideoLibrary = async (library) => {
    const normalized = normalizeStore(library)
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
      let value
      try {
        value = JSON.parse(contents)
      } catch (error) {
        throw new VideoLibraryStorageError(
          `Video library JSON is invalid at ${storagePath}: ${error.message}`,
          'INVALID_VIDEO_LIBRARY_JSON',
        )
      }
      try {
        return normalizeStore(value)
      } catch (error) {
        if (!(error instanceof VideoLibraryStorageError)) throw error
        throw new VideoLibraryStorageError(
          `Video library JSON has an invalid schema at ${storagePath}: ${error.message}`,
          'INVALID_VIDEO_LIBRARY_JSON',
        )
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      return saveVideoLibrary(emptyVideoLibrary())
    }
  }

  let mutationQueue = Promise.resolve()
  const mutateVideoLibrary = (mutator) => {
    const mutation = mutationQueue.then(async () => {
      const library = await loadVideoLibrary()
      await mutator(library)
      return saveVideoLibrary(library)
    })
    mutationQueue = mutation.catch(() => undefined)
    return mutation
  }

  const replaceVideos = (videos) => mutateVideoLibrary((library) => {
    if (!Array.isArray(videos)) {
      throw new VideoLibraryStorageError('videos must be an array.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
    }
    library.videos = videos.map(normalizeVideoRecord)
  })

  const upsertVideo = (video) => mutateVideoLibrary((library) => {
    const normalized = normalizeVideoRecord(video)
    const existingIndex = library.videos.findIndex((record) => record.id === normalized.id)
    if (existingIndex >= 0) library.videos[existingIndex] = normalized
    else library.videos.unshift(normalized)
  })

  const addClipRange = (videoId, clip, nextClipNumber, updatedAt) => mutateVideoLibrary((library) => {
    const video = library.videos.find((record) => record.id === videoId)
    if (!video) throw new VideoLibraryStorageError('Video record was not found.', 'VIDEO_NOT_FOUND')
    const normalized = normalizeClipRange(clip)
    if (!video.clips.some((item) => item.id === normalized.id ||
      (item.start === normalized.start && item.end === normalized.end))) {
      video.clips.unshift(normalized)
    }
    if (Number.isInteger(nextClipNumber) && nextClipNumber > 0) video.nextClipNumber = nextClipNumber
    video.updatedAt = requireString(updatedAt, 'video.updatedAt')
  })

  const deleteClipRange = (videoId, clipId, updatedAt) => mutateVideoLibrary((library) => {
    const video = library.videos.find((record) => record.id === videoId)
    if (!video) throw new VideoLibraryStorageError('Video record was not found.', 'VIDEO_NOT_FOUND')
    video.clips = video.clips.filter((clip) => clip.id !== clipId)
    video.updatedAt = requireString(updatedAt, 'video.updatedAt')
  })

  const findClipRange = async (clipRangeId) => {
    const library = await loadVideoLibrary()
    for (const video of library.videos) {
      const clip = video.clips.find((item) => item.id === clipRangeId)
      if (clip) return { library, video, clip }
    }
    throw new VideoLibraryStorageError('Clip range was not found.', 'CLIP_RANGE_NOT_FOUND')
  }

  const attachGeneratedClip = (clipRangeId, generatedClip) => mutateVideoLibrary((library) => {
    for (const video of library.videos) {
      const clip = video.clips.find((item) => item.id === clipRangeId)
      if (!clip) continue
      const normalized = normalizeGeneratedClip(generatedClip)
      clip.generatedClip = normalized
      clip.outputFilename = normalized.filename
      video.updatedAt = normalized.createdAt
      const sequence = Number(normalized.filename.match(/-clip-(\d+)\.mp4$/i)?.[1])
      if (Number.isFinite(sequence)) video.nextClipNumber = Math.max(video.nextClipNumber ?? 1, sequence + 1)
      return
    }
    throw new VideoLibraryStorageError('Clip range was not found.', 'CLIP_RANGE_NOT_FOUND')
  })

  return {
    storagePath,
    loadVideoLibrary,
    replaceVideos,
    upsertVideo,
    addClipRange,
    deleteClipRange,
    findClipRange,
    attachGeneratedClip,
  }
}

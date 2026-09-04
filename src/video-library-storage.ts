export type ClipHistoryRecord = {
  id: string
  start: number
  end: number
  duration: number
  createdAt: string
  outputFilename?: string
  generatedClip?: {
    filename: string
    relativePath: string
    createdAt: string
  }
}

export type VideoFileMetadata = {
  name: string
  size: number
  lastModified: number
}

export type VideoRecord = {
  id: string
  type: 'local' | 'server'
  file: VideoFileMetadata
  server?: {
    relativePath: string
    url: string
  }
  source?: {
    url: string
    site: 'youtube' | 'bilibili' | 'other'
  }
  clips: ClipHistoryRecord[]
  createdAt: string
  updatedAt: string
  nextClipNumber?: number
}

export type VideoLibrary = {
  version: 1
  videos: VideoRecord[]
}

export type VideoStorage = {
  kind: 'local' | 'server'
  loadLibrary: () => Promise<VideoLibrary>
  saveLibrary: (library: VideoLibrary) => Promise<VideoLibrary>
  saveVideo: (library: VideoLibrary, video: VideoRecord) => Promise<VideoLibrary>
  addClip: (library: VideoLibrary, video: VideoRecord, clip: ClipHistoryRecord) => Promise<VideoLibrary>
  deleteClip: (library: VideoLibrary, video: VideoRecord, clipId: string) => Promise<VideoLibrary>
  generateClip: (clipRangeId: string) => Promise<VideoLibrary>
}

export const videoLibraryStorageKey = 'story-voice.video-library.v1'

export const videoIdentity = (file: VideoFileMetadata) => JSON.stringify([file.name, file.size, file.lastModified])

export const serverVideoIdentity = (relativePath: string) => {
  const filename = relativePath.split('/').at(-1) ?? relativePath
  return `server:${filename}`
}

export const serverVideoUrl = (relativePath: string) =>
  `/test-videos/${relativePath.split('/').map(encodeURIComponent).join('/')}`

export const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const detectSourceSite = (sourceUrl: string): NonNullable<VideoRecord['source']>['site'] => {
  try {
    const hostname = new URL(sourceUrl).hostname.toLocaleLowerCase().replace(/^www\./, '')
    if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return 'youtube'
    if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) return 'bilibili'
  } catch {
    // yt-dlp accepts more than standard HTTP URLs, so unclassified values remain usable.
  }
  return 'other'
}

const normalizeClip = (value: unknown): ClipHistoryRecord | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ClipHistoryRecord>
  if (!Number.isFinite(candidate.start) || !Number.isFinite(candidate.end) ||
    candidate.start! < 0 || candidate.end! <= candidate.start! || typeof candidate.createdAt !== 'string') return null
  const start = Math.round(candidate.start! * 1000) / 1000
  const end = Math.round(candidate.end! * 1000) / 1000
  const generatedClip = candidate.generatedClip
  const normalizedGeneratedClip = generatedClip &&
    typeof generatedClip.filename === 'string' && generatedClip.filename &&
    typeof generatedClip.relativePath === 'string' && generatedClip.relativePath &&
    typeof generatedClip.createdAt === 'string' && generatedClip.createdAt
    ? {
        filename: generatedClip.filename,
        relativePath: generatedClip.relativePath,
        createdAt: generatedClip.createdAt,
      }
    : undefined
  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId(),
    start,
    end,
    duration: end - start,
    createdAt: candidate.createdAt,
    outputFilename: typeof candidate.outputFilename === 'string' ? candidate.outputFilename : undefined,
    generatedClip: normalizedGeneratedClip,
  }
}

const mergeClips = (existing: ClipHistoryRecord[], incoming: ClipHistoryRecord[]) => {
  const merged = new Map(existing.map((clip) => [`${clip.start}:${clip.end}`, clip]))
  for (const clip of incoming) {
    const key = `${clip.start}:${clip.end}`
    if (!merged.has(key)) merged.set(key, clip)
  }
  return [...merged.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

export const normalizeVideoRecord = (value: unknown): VideoRecord | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<VideoRecord>
  const file = candidate.file
  if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size) || !Number.isFinite(file.lastModified) ||
    !Array.isArray(candidate.clips)) return null
  const now = new Date().toISOString()
  const sourceUrl = typeof candidate.source?.url === 'string' ? candidate.source.url.trim() : ''
  const type = candidate.type === 'server' && typeof candidate.server?.relativePath === 'string' ? 'server' : 'local'
  const clips = mergeClips([], candidate.clips.map(normalizeClip).filter((clip): clip is ClipHistoryRecord => Boolean(clip)))
  return {
    id: type === 'server' ? serverVideoIdentity(candidate.server!.relativePath) : videoIdentity(file),
    type,
    file: { name: file.name, size: file.size, lastModified: file.lastModified },
    server: type === 'server' ? {
      relativePath: candidate.server!.relativePath,
      url: typeof candidate.server!.url === 'string' ? candidate.server!.url : serverVideoUrl(candidate.server!.relativePath),
    } : undefined,
    source: sourceUrl ? { url: sourceUrl, site: detectSourceSite(sourceUrl) } : undefined,
    clips,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
    nextClipNumber: Number.isInteger(candidate.nextClipNumber) && candidate.nextClipNumber! > 0
      ? candidate.nextClipNumber
      : clips.length + 1,
  }
}

export const loadVideoLibrary = (): VideoLibrary => {
  try {
    const value = JSON.parse(localStorage.getItem(videoLibraryStorageKey) ?? '{}') as Partial<VideoLibrary>
    const records = Array.isArray(value.videos)
      ? value.videos.map(normalizeVideoRecord).filter((record): record is VideoRecord => Boolean(record))
      : []
    const videos = new Map<string, VideoRecord>()
    for (const record of records) {
      videos.set(record.id, mergeVideoRecord(videos.get(record.id), record))
    }
    return {
      version: 1,
      videos: [...videos.values()],
    }
  } catch {
    return { version: 1, videos: [] }
  }
}

export const saveVideoLibrary = (library: VideoLibrary) => {
  try {
    localStorage.setItem(videoLibraryStorageKey, JSON.stringify(library))
    return true
  } catch {
    return false
  }
}

export function mergeVideoRecord(existing: VideoRecord | undefined, incoming: VideoRecord): VideoRecord {
  if (!existing) return incoming
  const existingUpdated = Date.parse(existing.updatedAt) || 0
  const incomingUpdated = Date.parse(incoming.updatedAt) || 0
  return {
    ...existing,
    server: incoming.server ?? existing.server,
    source: incoming.source ?? existing.source,
    clips: mergeClips(existing.clips, incoming.clips),
    createdAt: Date.parse(existing.createdAt) <= Date.parse(incoming.createdAt) ? existing.createdAt : incoming.createdAt,
    updatedAt: existingUpdated >= incomingUpdated ? existing.updatedAt : incoming.updatedAt,
    nextClipNumber: Math.max(existing.nextClipNumber ?? existing.clips.length + 1, incoming.nextClipNumber ?? incoming.clips.length + 1),
  }
}

const normalizeVideoLibrary = (value: unknown): VideoLibrary => {
  if (!value || typeof value !== 'object') throw new Error('Video library response must be an object.')
  const candidate = value as { version?: unknown; videos?: unknown }
  if (candidate.version !== 1 || !Array.isArray(candidate.videos)) {
    throw new Error('Video library response must contain version 1 and a videos array.')
  }
  const normalized = candidate.videos.map(normalizeVideoRecord)
  if (normalized.some((record) => !record)) throw new Error('Video library contains an invalid video record.')
  const videos = new Map<string, VideoRecord>()
  for (const record of normalized as VideoRecord[]) {
    videos.set(record.id, mergeVideoRecord(videos.get(record.id), record))
  }
  return { version: 1, videos: [...videos.values()] }
}

const requestServerVideoLibrary = async (path: string, init?: RequestInit) => {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  const value = await response.json() as unknown
  if (!response.ok) {
    const error = value as { error?: { message?: string } }
    throw new Error(error.error?.message ?? 'Server video library request failed.')
  }
  return normalizeVideoLibrary(value)
}

const saveLocalLibrary = async (library: VideoLibrary) => {
  if (!saveVideoLibrary(library)) throw new Error('Could not save the video library in this browser.')
  return library
}

const localVideoStorage: VideoStorage = {
  kind: 'local',
  loadLibrary: async () => loadVideoLibrary(),
  saveLibrary: saveLocalLibrary,
  saveVideo: saveLocalLibrary,
  addClip: saveLocalLibrary,
  deleteClip: saveLocalLibrary,
  generateClip: async () => {
    throw new Error('Server clip generation is only available in Video V2.')
  },
}

const serverVideoStorage: VideoStorage = {
  kind: 'server',
  loadLibrary: () => requestServerVideoLibrary('/api/video-v2/library'),
  saveLibrary: (library) => requestServerVideoLibrary('/api/video-v2/library', {
    method: 'PUT',
    body: JSON.stringify({ videos: library.videos }),
  }),
  saveVideo: (_library, video) => requestServerVideoLibrary('/api/video-v2/video', {
    method: 'PUT',
    body: JSON.stringify({ video }),
  }),
  addClip: (_library, video, clip) => requestServerVideoLibrary('/api/video-v2/clip', {
    method: 'POST',
    body: JSON.stringify({
      videoId: video.id,
      clip,
      nextClipNumber: video.nextClipNumber,
      updatedAt: video.updatedAt,
    }),
  }),
  deleteClip: (_library, video, clipId) => requestServerVideoLibrary('/api/video-v2/clip', {
    method: 'DELETE',
    body: JSON.stringify({ videoId: video.id, clipId, updatedAt: video.updatedAt }),
  }),
  generateClip: (clipRangeId) => requestServerVideoLibrary('/api/video-v2/clip/generate', {
    method: 'POST',
    body: JSON.stringify({ clipRangeId }),
  }),
}

export const createVideoStorage = (kind: VideoStorage['kind']) =>
  kind === 'server' ? serverVideoStorage : localVideoStorage

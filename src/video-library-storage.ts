export type ClipHistoryRecord = {
  id: string
  start: number
  end: number
  duration: number
  createdAt: string
  outputFilename?: string
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
  migratedLegacyKeys: string[]
}

const clipHistoryStoragePrefix = 'story-voice.clip-history.v1:'
export const videoLibraryStorageKey = 'story-voice.video-library.v1'

export const videoIdentity = (file: VideoFileMetadata) => JSON.stringify([file.name, file.size, file.lastModified])

export const serverVideoIdentity = (relativePath: string) => `server:${relativePath}`

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
  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId(),
    start,
    end,
    duration: end - start,
    createdAt: candidate.createdAt,
    outputFilename: typeof candidate.outputFilename === 'string' ? candidate.outputFilename : undefined,
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
    return {
      version: 1,
      videos: Array.isArray(value.videos)
        ? value.videos.map(normalizeVideoRecord).filter((record): record is VideoRecord => Boolean(record))
        : [],
      migratedLegacyKeys: Array.isArray(value.migratedLegacyKeys)
        ? value.migratedLegacyKeys.filter((key): key is string => typeof key === 'string')
        : [],
    }
  } catch {
    return { version: 1, videos: [], migratedLegacyKeys: [] }
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

export const mergeVideoRecord = (existing: VideoRecord | undefined, incoming: VideoRecord): VideoRecord => {
  if (!existing) return incoming
  const existingUpdated = Date.parse(existing.updatedAt) || 0
  const incomingUpdated = Date.parse(incoming.updatedAt) || 0
  return {
    ...existing,
    source: incoming.source ?? existing.source,
    clips: mergeClips(existing.clips, incoming.clips),
    createdAt: Date.parse(existing.createdAt) <= Date.parse(incoming.createdAt) ? existing.createdAt : incoming.createdAt,
    updatedAt: existingUpdated >= incomingUpdated ? existing.updatedAt : incoming.updatedAt,
    nextClipNumber: Math.max(existing.nextClipNumber ?? existing.clips.length + 1, incoming.nextClipNumber ?? incoming.clips.length + 1),
  }
}

export const migrateLegacyClipHistory = (library: VideoLibrary) => {
  let changed = false
  try {
    const legacyKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(clipHistoryStoragePrefix)))
    for (const storageKey of legacyKeys) {
      if (library.migratedLegacyKeys.includes(storageKey)) continue
      const identityValue = JSON.parse(storageKey.slice(clipHistoryStoragePrefix.length)) as unknown
      const rawClips = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
      if (!Array.isArray(identityValue) || identityValue.length !== 3 || !Array.isArray(rawClips)) continue
      const file = { name: identityValue[0], size: identityValue[1], lastModified: identityValue[2] }
      if (typeof file.name !== 'string' || !Number.isFinite(file.size) || !Number.isFinite(file.lastModified)) continue
      const clips = rawClips.map(normalizeClip).filter((clip): clip is ClipHistoryRecord => Boolean(clip))
      const timestamps = clips.map((clip) => clip.createdAt).sort()
      const now = new Date().toISOString()
      const incoming: VideoRecord = {
        id: videoIdentity(file),
        type: 'local',
        file,
        clips,
        createdAt: timestamps[0] ?? now,
        updatedAt: timestamps.at(-1) ?? now,
      }
      const existingIndex = library.videos.findIndex((record) => record.id === incoming.id)
      const existing = existingIndex >= 0 ? library.videos[existingIndex] : undefined
      const merged = mergeVideoRecord(existing, incoming)
      if (existingIndex >= 0) library.videos[existingIndex] = merged
      else library.videos.push(merged)
      library.migratedLegacyKeys.push(storageKey)
      changed = true
    }
  } catch {
    return false
  }
  return changed
}

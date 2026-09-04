export type VideoRecord = {
  videoId: string
  filename: string
  relativePath: string
  sourceUrl?: string
  sourceSite?: 'youtube' | 'bilibili' | 'other'
  size: number
  lastModified: number
  durationMs?: number
  createdAt: string
  updatedAt: string
}

export type ClipRecord = {
  clipId: string
  videoId: string
  startMs: number
  endMs: number
  durationMs: number
  label: string | null
  relativePath?: string
  createdAt: string
  updatedAt: string
}

export type PoseRun = {
  poseRunId: string
  videoId: string
  clipId: string
  relativePath: string
  model: {
    name: string
    packageVersion: string
    modelAssetPath: string
    delegate: 'GPU' | 'CPU'
    runningMode: 'VIDEO'
    numPoses: number
    minPoseDetectionConfidence: number
    minPosePresenceConfidence: number
    minTrackingConfidence: number
  }
  samplingFps: number
  durationMs: number
  frameCount: number
  detectedPoseFrameCount: number
  processingDurationMs: number
  createdAt: string
}

export type LlmPoseRun = {
  llmPoseRunId: string
  videoId: string
  clipId: string
  poseRunId: string
  relativePath: string
  schemaVersion: number
  targetFps: number
  frameCount: number
  sizeBytes: number
  createdAt: string
}

export type RawPoseResult = {
  schemaVersion: 1
  task: 'MediaPipe Pose Landmarker'
  model: {
    packageVersion: string
    modelName: string
    modelAssetPath: string
    runningMode: 'VIDEO'
    delegate: 'GPU' | 'CPU'
    numPoses: number
    minPoseDetectionConfidence: number
    minPosePresenceConfidence: number
    minTrackingConfidence: number
  }
  samplingFps: number
  durationMs: number
  processingDurationMs: number
  frameCount: number
  detectedPoseFrameCount: number
  frames: Array<{
    videoTimestampMs: number
    landmarks: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>
    worldLandmarks: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>
  }>
}

export type VideoLibrary = {
  schemaVersion: 3
  createdAt: string
  updatedAt: string
  videos: VideoRecord[]
  clips: ClipRecord[]
  poseRuns: PoseRun[]
  llmPoseRuns: LlmPoseRun[]
  nextIds: {
    video: number
    clips: Record<string, number>
    poseRuns: Record<string, number>
    llmPoseRuns: Record<string, number>
  }
}

export type VideoStorage = {
  kind: 'local' | 'server'
  loadLibrary: () => Promise<VideoLibrary>
  saveLibrary: (library: VideoLibrary) => Promise<VideoLibrary>
  updateVideo: (videoId: string, patch: Partial<VideoRecord>) => Promise<VideoLibrary>
  deleteVideo: (videoId: string) => Promise<VideoLibrary>
  addClip: (videoId: string, input: Pick<ClipRecord, 'startMs' | 'endMs' | 'label'>) => Promise<VideoLibrary>
  updateClipLabel: (videoId: string, clipId: string, label: string | null) => Promise<VideoLibrary>
  deleteClip: (videoId: string, clipId: string) => Promise<VideoLibrary>
  generateClip: (videoId: string, clipId: string) => Promise<VideoLibrary>
  savePoseResult: (videoId: string, clipId: string, poseData: RawPoseResult) => Promise<VideoLibrary>
  buildLlmPoseResult: (videoId: string, clipId: string, poseRunId: string) => Promise<VideoLibrary>
  deletePoseRun: (videoId: string, clipId: string, poseRunId: string) => Promise<VideoLibrary>
  deleteLlmPoseRun: (videoId: string, clipId: string, poseRunId: string, llmPoseRunId: string) => Promise<VideoLibrary>
}

export const videoLibraryStorageKey = 'story-voice.video-library.v3'

export const serverVideoUrl = (relativePath: string) =>
  `/test-videos/${relativePath.split('/').map(encodeURIComponent).join('/')}`

export const detectSourceSite = (sourceUrl: string): VideoRecord['sourceSite'] => {
  try {
    const hostname = new URL(sourceUrl).hostname.toLocaleLowerCase().replace(/^www\./, '')
    if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return 'youtube'
    if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) return 'bilibili'
  } catch {
    // Keep nonstandard yt-dlp inputs classified as other.
  }
  return 'other'
}

export const clipsForVideo = (library: VideoLibrary, videoId: string) =>
  library.clips.filter((clip) => clip.videoId === videoId)

export const poseRunsForClip = (library: VideoLibrary, clipId: string) =>
  library.poseRuns.filter((run) => run.clipId === clipId)

export const llmPoseRunsForPose = (library: VideoLibrary, poseRunId: string) =>
  library.llmPoseRuns.filter((run) => run.poseRunId === poseRunId)

export const latestByCreatedAt = <T extends { createdAt: string }>(values: readonly T[]) =>
  values.reduce<T | undefined>((latest, value) =>
    !latest || Date.parse(value.createdAt) >= Date.parse(latest.createdAt) ? value : latest, undefined)

const emptyLibrary = (): VideoLibrary => {
  const timestamp = new Date().toISOString()
  return {
    schemaVersion: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    videos: [],
    clips: [],
    poseRuns: [],
    llmPoseRuns: [],
    nextIds: { video: 1, clips: {}, poseRuns: {}, llmPoseRuns: {} },
  }
}

const normalizeLibrary = (value: unknown): VideoLibrary => {
  const candidate = value as Partial<VideoLibrary>
  if (!candidate || candidate.schemaVersion !== 3 || !Array.isArray(candidate.videos) ||
    !Array.isArray(candidate.clips) || !Array.isArray(candidate.poseRuns) || !Array.isArray(candidate.llmPoseRuns) ||
    !candidate.nextIds || typeof candidate.nextIds !== 'object' ||
    typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string') {
    throw new Error('Unsupported Video Library schema. Expected schemaVersion 3.')
  }
  return candidate as VideoLibrary
}

const requestLibrary = async (path: string, init?: RequestInit) => {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  const value = await response.json() as unknown
  if (!response.ok) {
    const error = value as { error?: { message?: string } }
    throw new Error(error.error?.message ?? 'Video Library request failed.')
  }
  return normalizeLibrary(value)
}

const unsupportedLocalAction = async (): Promise<VideoLibrary> => {
  throw new Error('This operation requires the server-backed Video Library.')
}

const localStorageAdapter: VideoStorage = {
  kind: 'local',
  loadLibrary: async () => {
    try {
      const value = localStorage.getItem(videoLibraryStorageKey)
      return value ? normalizeLibrary(JSON.parse(value)) : emptyLibrary()
    } catch {
      return emptyLibrary()
    }
  },
  saveLibrary: async (library) => {
    const normalized = normalizeLibrary(library)
    localStorage.setItem(videoLibraryStorageKey, JSON.stringify(normalized))
    return normalized
  },
  updateVideo: unsupportedLocalAction,
  deleteVideo: unsupportedLocalAction,
  addClip: unsupportedLocalAction,
  updateClipLabel: unsupportedLocalAction,
  deleteClip: unsupportedLocalAction,
  generateClip: unsupportedLocalAction,
  savePoseResult: unsupportedLocalAction,
  buildLlmPoseResult: unsupportedLocalAction,
  deletePoseRun: unsupportedLocalAction,
  deleteLlmPoseRun: unsupportedLocalAction,
}

const serverStorage: VideoStorage = {
  kind: 'server',
  loadLibrary: () => requestLibrary('/api/video-v2/library'),
  saveLibrary: (library) => requestLibrary('/api/video-v2/library', {
    method: 'PUT',
    body: JSON.stringify(library),
  }),
  updateVideo: (videoId, patch) => requestLibrary('/api/video-v2/video', {
    method: 'PATCH',
    body: JSON.stringify({ videoId, patch }),
  }),
  deleteVideo: (videoId) => requestLibrary('/api/video-v2/video', {
    method: 'DELETE',
    body: JSON.stringify({ videoId }),
  }),
  addClip: (videoId, input) => requestLibrary('/api/video-v2/clip', {
    method: 'POST',
    body: JSON.stringify({ videoId, ...input }),
  }),
  updateClipLabel: (videoId, clipId, label) => requestLibrary('/api/video-v2/clip', {
    method: 'PATCH',
    body: JSON.stringify({ videoId, clipId, label }),
  }),
  deleteClip: (videoId, clipId) => requestLibrary('/api/video-v2/clip', {
    method: 'DELETE',
    body: JSON.stringify({ videoId, clipId }),
  }),
  generateClip: (videoId, clipId) => requestLibrary('/api/video-v2/clip/generate', {
    method: 'POST',
    body: JSON.stringify({ videoId, clipId }),
  }),
  savePoseResult: (videoId, clipId, poseData) => requestLibrary('/api/video-v2/clip/pose', {
    method: 'POST',
    body: JSON.stringify({ videoId, clipId, poseData }),
  }),
  buildLlmPoseResult: (videoId, clipId, poseRunId) => requestLibrary('/api/video-v2/clip/pose/compress', {
    method: 'POST',
    body: JSON.stringify({ videoId, clipId, poseRunId }),
  }),
  deletePoseRun: (videoId, clipId, poseRunId) => requestLibrary('/api/video-v2/pose-run', {
    method: 'DELETE',
    body: JSON.stringify({ videoId, clipId, poseRunId }),
  }),
  deleteLlmPoseRun: (videoId, clipId, poseRunId, llmPoseRunId) => requestLibrary('/api/video-v2/llm-pose-run', {
    method: 'DELETE',
    body: JSON.stringify({ videoId, clipId, poseRunId, llmPoseRunId }),
  }),
}

export const createVideoStorage = (kind: VideoStorage['kind']) => kind === 'server' ? serverStorage : localStorageAdapter

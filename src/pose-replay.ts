import { DrawingUtils, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'

type PoseReplayFrame = {
  videoTimestampMs: number
  landmarks: NormalizedLandmark[][]
}

export type PoseReplayData = {
  schemaVersion: 1
  task: 'MediaPipe Pose Landmarker'
  frames: PoseReplayFrame[]
}

export type PoseReplaySession = {
  destroy: () => void
  redraw: () => void
}

const visibilityThreshold = 0.5

const validateLandmark = (value: unknown) => {
  if (!value || typeof value !== 'object') return false
  const landmark = value as Partial<NormalizedLandmark>
  return Number.isFinite(landmark.x) && Number.isFinite(landmark.y) && Number.isFinite(landmark.z) &&
    (landmark.visibility === undefined || Number.isFinite(landmark.visibility))
}

export const parsePoseReplayData = (value: unknown): PoseReplayData => {
  if (!value || typeof value !== 'object') throw new Error('Invalid Pose replay data.')
  const candidate = value as Partial<PoseReplayData>
  if (candidate.schemaVersion !== 1 || candidate.task !== 'MediaPipe Pose Landmarker' || !Array.isArray(candidate.frames)) {
    throw new Error('Invalid Pose replay data.')
  }

  let previousTimestamp = -1
  const frames = candidate.frames.map((frame, frameIndex) => {
    if (!frame || typeof frame !== 'object' || !Number.isFinite(frame.videoTimestampMs) ||
      frame.videoTimestampMs <= previousTimestamp || !Array.isArray(frame.landmarks)) {
      throw new Error(`Invalid Pose replay frame ${frameIndex}.`)
    }
    previousTimestamp = frame.videoTimestampMs
    const landmarks = frame.landmarks.map((pose) => {
      if (!Array.isArray(pose) || pose.length !== 33 || !pose.every(validateLandmark)) {
        throw new Error(`Invalid Pose landmarks in frame ${frameIndex}.`)
      }
      return pose
    })
    return { videoTimestampMs: frame.videoTimestampMs, landmarks }
  })

  if (!frames.length) throw new Error('Pose replay has no frames.')
  return { schemaVersion: 1, task: 'MediaPipe Pose Landmarker', frames }
}

export const loadPoseReplayData = async (url: string, signal?: AbortSignal) => {
  const response = await fetch(url, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`Pose JSON request failed (${response.status}).`)
  return parsePoseReplayData(await response.json())
}

const nearestFrame = (frames: PoseReplayFrame[], timestampMs: number) => {
  let low = 0
  let high = frames.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (frames[middle].videoTimestampMs < timestampMs) low = middle + 1
    else high = middle - 1
  }
  if (low <= 0) return frames[0]
  if (low >= frames.length) return frames[frames.length - 1]
  const before = frames[low - 1]
  const after = frames[low]
  return timestampMs - before.videoTimestampMs <= after.videoTimestampMs - timestampMs ? before : after
}

const maximumFrameDistance = (frames: PoseReplayFrame[]) => {
  if (frames.length < 2) return 100
  const deltas = frames.slice(1)
    .map((frame, index) => frame.videoTimestampMs - frames[index].videoTimestampMs)
    .filter((delta) => delta > 0)
    .sort((left, right) => left - right)
  const median = deltas[Math.floor(deltas.length / 2)] ?? 40
  return Math.min(250, Math.max(50, median * 2.5))
}

const landmarkVisible = (landmark: NormalizedLandmark | undefined) =>
  Boolean(landmark) && (landmark!.visibility === undefined || landmark!.visibility >= visibilityThreshold)

export const createPoseReplay = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  data: PoseReplayData,
): PoseReplaySession => {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Pose replay canvas is unavailable.')
  const drawing = new DrawingUtils(context)
  const maxDistanceMs = maximumFrameDistance(data.frames)
  let animationFrameId: number | null = null
  let destroyed = false

  const clear = () => context.clearRect(0, 0, canvas.width, canvas.height)

  const syncCanvasToVideoContent = () => {
    if (!video.videoWidth || !video.videoHeight) return false
    const videoRect = video.getBoundingClientRect()
    const stageRect = canvas.parentElement!.getBoundingClientRect()
    const scale = Math.min(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight)
    const contentWidth = video.videoWidth * scale
    const contentHeight = video.videoHeight * scale
    canvas.style.left = `${videoRect.left - stageRect.left + (videoRect.width - contentWidth) / 2}px`
    canvas.style.top = `${videoRect.top - stageRect.top + (videoRect.height - contentHeight) / 2}px`
    canvas.style.width = `${contentWidth}px`
    canvas.style.height = `${contentHeight}px`
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
    }
    return true
  }

  const redraw = () => {
    if (destroyed || !syncCanvasToVideoContent()) return
    clear()
    const timestampMs = video.currentTime * 1000
    const frame = nearestFrame(data.frames, timestampMs)
    if (Math.abs(frame.videoTimestampMs - timestampMs) > maxDistanceMs || !frame.landmarks.length) return

    for (const landmarks of frame.landmarks) {
      drawing.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
        color: ({ from, to }) => landmarkVisible(from) && landmarkVisible(to) ? '#00e5ff' : 'rgba(0, 0, 0, 0)',
        lineWidth: 3,
      })
      drawing.drawLandmarks(landmarks, {
        color: ({ from }) => landmarkVisible(from) ? '#fff' : 'rgba(0, 0, 0, 0)',
        fillColor: ({ from }) => landmarkVisible(from) ? '#ff3b30' : 'rgba(0, 0, 0, 0)',
        lineWidth: 1,
        radius: 3,
      })
    }
  }

  const stopLoop = () => {
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  const loop = () => {
    animationFrameId = null
    redraw()
    if (!video.paused && !video.ended && !destroyed) animationFrameId = requestAnimationFrame(loop)
  }
  const startLoop = () => {
    stopLoop()
    animationFrameId = requestAnimationFrame(loop)
  }
  const drawOnce = () => {
    stopLoop()
    redraw()
  }

  video.addEventListener('play', startLoop)
  video.addEventListener('pause', drawOnce)
  video.addEventListener('seeking', redraw)
  video.addEventListener('seeked', drawOnce)
  video.addEventListener('timeupdate', redraw)
  video.addEventListener('loadedmetadata', redraw)
  video.addEventListener('ended', drawOnce)
  const resizeObserver = new ResizeObserver(redraw)
  resizeObserver.observe(video)
  resizeObserver.observe(canvas.parentElement!)
  redraw()

  return {
    redraw,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      stopLoop()
      resizeObserver.disconnect()
      video.removeEventListener('play', startLoop)
      video.removeEventListener('pause', drawOnce)
      video.removeEventListener('seeking', redraw)
      video.removeEventListener('seeked', drawOnce)
      video.removeEventListener('timeupdate', redraw)
      video.removeEventListener('loadedmetadata', redraw)
      video.removeEventListener('ended', drawOnce)
      clear()
      canvas.hidden = true
      canvas.removeAttribute('style')
    },
  }
}

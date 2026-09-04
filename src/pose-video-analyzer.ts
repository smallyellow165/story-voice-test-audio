import type { RawPoseResult } from './video-library-storage'

export const poseAnalysisConfig = {
  packageVersion: '1.0.1',
  modelName: 'Pose Landmarker Lite (float16)',
  modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  wasmRoot: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  delegate: 'GPU' as const,
  runningMode: 'VIDEO' as const,
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
}

type AnalysisProgress = {
  videoTimestampMs: number
  durationMs: number
  frameCount: number
  detectedPoseFrameCount: number
}

type AnalyzeOptions = {
  signal?: AbortSignal
  onProgress?: (progress: AnalysisProgress) => void
}

const waitForVideoMetadata = (video: HTMLVideoElement, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timeout = window.setTimeout(() => finish(new Error('Video metadata did not load in time.')), 20_000)
  const onLoaded = () => finish()
  const onError = () => finish(new Error('Generated clip metadata could not be loaded.'))
  const onAbort = () => finish(new DOMException('Pose analysis was cancelled.', 'AbortError'))
  const finish = (error?: Error) => {
    window.clearTimeout(timeout)
    video.removeEventListener('loadedmetadata', onLoaded)
    video.removeEventListener('error', onError)
    signal?.removeEventListener('abort', onAbort)
    if (error) reject(error)
    else resolve()
  }
  video.addEventListener('loadedmetadata', onLoaded, { once: true })
  video.addEventListener('error', onError, { once: true })
  signal?.addEventListener('abort', onAbort, { once: true })
  video.load()
})

export const analyzePoseVideo = async (
  videoUrl: string,
  { signal, onProgress }: AnalyzeOptions = {},
): Promise<RawPoseResult> => {
  if (signal?.aborted) throw new DOMException('Pose analysis was cancelled.', 'AbortError')

  const worker = new Worker(new URL('./pose-landmarker.worker.ts', import.meta.url), { type: 'module' })
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = videoUrl
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-2px;top:-2px'
  document.body.append(video)

  let frameCallbackId: number | undefined
  let animationFrameId: number | undefined
  let workerReady = false
  let inferencePending = false
  let videoEnded = false
  let settled = false
  let actualDelegate: 'GPU' | 'CPU' = poseAnalysisConfig.delegate
  let lastScheduledTimestampMs = -1
  let resolveWorkerReady: (() => void) | undefined
  let rejectWorkerReady: ((error: Error) => void) | undefined
  let resolveAnalysis: ((result: RawPoseResult) => void) | undefined
  let rejectAnalysis: ((error: Error) => void) | undefined
  const frames: RawPoseResult['frames'] = []
  const processingStartedAt = performance.now()

  const ready = new Promise<void>((resolve, reject) => {
    resolveWorkerReady = resolve
    rejectWorkerReady = reject
  })
  const completed = new Promise<RawPoseResult>((resolve, reject) => {
    resolveAnalysis = resolve
    rejectAnalysis = reject
  })

  const cancelScheduledFrame = () => {
    if (frameCallbackId !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(frameCallbackId)
    }
    if (animationFrameId !== undefined) cancelAnimationFrame(animationFrameId)
    frameCallbackId = undefined
    animationFrameId = undefined
  }

  const cleanup = () => {
    cancelScheduledFrame()
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
    worker.postMessage({ type: 'CLOSE' })
    worker.terminate()
    signal?.removeEventListener('abort', onAbort)
  }

  const fail = (error: Error) => {
    if (settled) return
    settled = true
    rejectWorkerReady?.(error)
    rejectAnalysis?.(error)
    cleanup()
  }

  const finishIfReady = () => {
    if (settled || !videoEnded || inferencePending) return
    if (frames.length === 0) {
      fail(new Error('Pose analysis completed without any video frames.'))
      return
    }
    settled = true
    const detectedPoseFrameCount = frames.filter((frame) => frame.landmarks.length > 0).length
    resolveAnalysis?.({
      schemaVersion: 1,
      task: 'MediaPipe Pose Landmarker',
      model: {
        packageVersion: poseAnalysisConfig.packageVersion,
        modelName: poseAnalysisConfig.modelName,
        modelAssetPath: poseAnalysisConfig.modelAssetPath,
        runningMode: poseAnalysisConfig.runningMode,
        delegate: actualDelegate,
        numPoses: poseAnalysisConfig.numPoses,
        minPoseDetectionConfidence: poseAnalysisConfig.minPoseDetectionConfidence,
        minPosePresenceConfidence: poseAnalysisConfig.minPosePresenceConfidence,
        minTrackingConfidence: poseAnalysisConfig.minTrackingConfidence,
      },
      durationMs: video.duration * 1000,
      processingDurationMs: performance.now() - processingStartedAt,
      frameCount: frames.length,
      detectedPoseFrameCount,
      frames,
    })
    cleanup()
  }

  const scheduleFrame = () => {
    if (settled || videoEnded || video.paused) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
        frameCallbackId = undefined
        void processFrame(metadata.mediaTime * 1000)
        scheduleFrame()
      })
    } else {
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = undefined
        void processFrame(video.currentTime * 1000)
        scheduleFrame()
      })
    }
  }

  const processFrame = async (videoTimestampMs: number) => {
    if (settled || !workerReady || inferencePending || videoTimestampMs <= lastScheduledTimestampMs) return
    inferencePending = true
    lastScheduledTimestampMs = videoTimestampMs
    try {
      const bitmap = await createImageBitmap(video)
      if (settled) {
        bitmap.close()
        return
      }
      worker.postMessage({ type: 'DETECT', bitmap, videoTimestampMs }, [bitmap])
    } catch (error) {
      inferencePending = false
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  const onAbort = () => fail(new DOMException('Pose analysis was cancelled.', 'AbortError'))
  signal?.addEventListener('abort', onAbort, { once: true })
  video.addEventListener('ended', () => {
    videoEnded = true
    cancelScheduledFrame()
    finishIfReady()
  }, { once: true })

  worker.onmessage = (event: MessageEvent) => {
    if (event.data.type === 'READY') {
      workerReady = true
      actualDelegate = event.data.delegate
      resolveWorkerReady?.()
      return
    }
    if (event.data.type === 'ERROR') {
      fail(new Error(`MediaPipe Pose Landmarker failed: ${event.data.message}`))
      return
    }
    if (event.data.type !== 'RESULT') return
    inferencePending = false
    frames.push({
      videoTimestampMs: event.data.videoTimestampMs,
      landmarks: event.data.landmarks,
      worldLandmarks: event.data.worldLandmarks,
    })
    const detectedPoseFrameCount = frames.filter((frame) => frame.landmarks.length > 0).length
    onProgress?.({
      videoTimestampMs: event.data.videoTimestampMs,
      durationMs: video.duration * 1000,
      frameCount: frames.length,
      detectedPoseFrameCount,
    })
    finishIfReady()
  }
  worker.onerror = (event) => fail(new Error(`MediaPipe worker failed: ${event.message}`))
  worker.postMessage({ type: 'INIT', config: poseAnalysisConfig })

  try {
    await Promise.all([ready, waitForVideoMetadata(video, signal)])
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Generated clip has an invalid duration.')
    video.currentTime = 0
    await video.play()
    scheduleFrame()
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)))
  }

  return completed
}

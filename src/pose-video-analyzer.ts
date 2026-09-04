import type { RawPoseResult } from './video-library-storage'
import {
  assertCompletePoseTimeline,
  createPoseTargetTimestamps,
  processTargetsSequentially,
} from './pose-offline-sampling'

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
  samplingFps: 30,
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

type WorkerResult = RawPoseResult['frames'][number]

const abortError = () => new DOMException('Pose analysis was cancelled.', 'AbortError')

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError()
}

const waitForVideoData = (video: HTMLVideoElement, signal?: AbortSignal) => new Promise<number>((resolve, reject) => {
  const timeout = window.setTimeout(() => finish(new Error('Generated clip video data did not load in time.')), 20_000)
  let decodedFrameTimeout: number | undefined
  let frameCallbackId: number | undefined
  let loaded = false
  let decodedTimestampMs: number | undefined
  const maybeFinish = () => {
    if (loaded && decodedTimestampMs !== undefined) finish(undefined, decodedTimestampMs)
  }
  const onLoaded = () => {
    loaded = true
    if (typeof video.requestVideoFrameCallback !== 'function') decodedTimestampMs = video.currentTime * 1000
    else decodedFrameTimeout = window.setTimeout(() => finish(undefined, video.currentTime * 1000), 1_000)
    maybeFinish()
  }
  const onError = () => finish(new Error('Generated clip metadata could not be loaded.'))
  const onAbort = () => finish(abortError())
  const finish = (error?: Error, firstTimestampMs?: number) => {
    window.clearTimeout(timeout)
    if (decodedFrameTimeout !== undefined) window.clearTimeout(decodedFrameTimeout)
    if (frameCallbackId !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(frameCallbackId)
    }
    video.removeEventListener('loadeddata', onLoaded)
    video.removeEventListener('error', onError)
    signal?.removeEventListener('abort', onAbort)
    if (error) reject(error)
    else resolve(firstTimestampMs ?? 0)
  }
  video.addEventListener('loadeddata', onLoaded, { once: true })
  video.addEventListener('error', onError, { once: true })
  signal?.addEventListener('abort', onAbort, { once: true })
  if (typeof video.requestVideoFrameCallback === 'function') {
    frameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
      frameCallbackId = undefined
      decodedTimestampMs = metadata.mediaTime * 1000
      maybeFinish()
    })
  }
  video.load()
})

const seekToTarget = (video: HTMLVideoElement, targetTimestampMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    throwIfAborted(signal)
    const targetSeconds = targetTimestampMs / 1000
    if (Math.abs(video.currentTime - targetSeconds) < 0.000_001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve()
      return
    }

    const timeout = window.setTimeout(() => finish(new Error(`Timed out seeking to ${targetTimestampMs}ms.`)), 10_000)
    const onSeeked = () => finish()
    const onError = () => finish(new Error(`Generated clip could not seek to ${targetTimestampMs}ms.`))
    const onAbort = () => finish(abortError())
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
    video.currentTime = targetSeconds
  })

export const analyzePoseVideo = async (
  videoUrl: string,
  { signal, onProgress }: AnalyzeOptions = {},
): Promise<RawPoseResult> => {
  throwIfAborted(signal)

  const worker = new Worker(new URL('./pose-landmarker.worker.ts', import.meta.url), { type: 'module' })
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = videoUrl
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-2px;top:-2px'
  document.body.append(video)

  let actualDelegate: 'GPU' | 'CPU' = poseAnalysisConfig.delegate
  let nextRequestId = 1
  let workerReadyResolve: (() => void) | undefined
  let workerReadyReject: ((error: Error) => void) | undefined
  let pendingRequest: {
    requestId: number
    resolve: (result: WorkerResult) => void
    reject: (error: Error) => void
  } | undefined
  const workerReady = new Promise<void>((resolve, reject) => {
    workerReadyResolve = resolve
    workerReadyReject = reject
  })

  const rejectPending = (error: Error) => {
    workerReadyReject?.(error)
    pendingRequest?.reject(error)
    pendingRequest = undefined
  }
  const onAbort = () => rejectPending(abortError())
  signal?.addEventListener('abort', onAbort, { once: true })

  worker.onmessage = (event: MessageEvent) => {
    if (event.data.type === 'READY') {
      actualDelegate = event.data.delegate
      workerReadyResolve?.()
      return
    }
    if (event.data.type === 'ERROR') {
      rejectPending(new Error(`MediaPipe Pose Landmarker failed: ${event.data.message}`))
      return
    }
    if (event.data.type !== 'RESULT') return
    if (!pendingRequest || event.data.requestId !== pendingRequest.requestId) {
      rejectPending(new Error('MediaPipe worker returned a stale or uncorrelated result.'))
      return
    }
    const { resolve } = pendingRequest
    pendingRequest = undefined
    resolve({
      videoTimestampMs: event.data.videoTimestampMs,
      landmarks: event.data.landmarks,
      worldLandmarks: event.data.worldLandmarks,
    })
  }
  worker.onerror = (event) => rejectPending(new Error(`MediaPipe worker failed: ${event.message}`))
  worker.postMessage({ type: 'INIT', config: poseAnalysisConfig })

  const detect = (bitmap: ImageBitmap, videoTimestampMs: number) => new Promise<WorkerResult>((resolve, reject) => {
    if (signal?.aborted) {
      bitmap.close()
      reject(abortError())
      return
    }
    if (pendingRequest) {
      bitmap.close()
      reject(new Error('Pose analyzer attempted concurrent inference.'))
      return
    }
    const requestId = nextRequestId
    nextRequestId += 1
    pendingRequest = { requestId, resolve, reject }
    try {
      worker.postMessage({ type: 'DETECT', requestId, bitmap, videoTimestampMs }, [bitmap])
    } catch (error) {
      pendingRequest = undefined
      bitmap.close()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

  const processingStartedAt = performance.now()
  try {
    const [, firstDecodedTimestampMs] = await Promise.all([workerReady, waitForVideoData(video, signal)])
    throwIfAborted(signal)
    const durationMs = video.duration * 1000
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Generated clip has an invalid duration.')

    const targets = createPoseTargetTimestamps(durationMs, poseAnalysisConfig.samplingFps, firstDecodedTimestampMs)
    if (targets.length === 0) throw new Error('Generated clip is too short to sample.')
    let detectedPoseFrameCount = 0
    const frames = await processTargetsSequentially(targets, async (targetTimestampMs, index) => {
      throwIfAborted(signal)
      await seekToTarget(video, targetTimestampMs, signal)
      throwIfAborted(signal)
      const bitmap = await createImageBitmap(video)
      const result = await detect(bitmap, targetTimestampMs)
      if (result.landmarks.length > 0) detectedPoseFrameCount += 1
      onProgress?.({
        videoTimestampMs: targetTimestampMs,
        durationMs,
        frameCount: index + 1,
        detectedPoseFrameCount,
      })
      return result
    })

    assertCompletePoseTimeline(targets, frames.map((frame) => frame.videoTimestampMs))
    return {
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
      samplingFps: poseAnalysisConfig.samplingFps,
      durationMs,
      processingDurationMs: performance.now() - processingStartedAt,
      frameCount: frames.length,
      detectedPoseFrameCount,
      frames,
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
    worker.postMessage({ type: 'CLOSE' })
    worker.terminate()
  }
}

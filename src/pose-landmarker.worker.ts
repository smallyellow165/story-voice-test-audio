import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'

type PoseConfig = {
  wasmRoot: string
  modelAssetPath: string
  delegate: 'GPU' | 'CPU'
  numPoses: number
  minPoseDetectionConfidence: number
  minPosePresenceConfidence: number
  minTrackingConfidence: number
}

let poseLandmarker: PoseLandmarker | null = null
let actualDelegate: 'GPU' | 'CPU' = 'GPU'

const initialize = async (config: PoseConfig) => {
  poseLandmarker?.close()
  poseLandmarker = null
  const create = async (delegate: 'GPU' | 'CPU') => {
    // The module build is required inside an ES module Worker. A cache-busting
    // loader URL also lets a CPU retry recreate ModuleFactory after GPU setup
    // consumed the first module instance.
    const vision = await FilesetResolver.forVisionTasks(config.wasmRoot, true)
    vision.wasmLoaderPath = `${vision.wasmLoaderPath}?attempt=${delegate.toLowerCase()}-${Date.now()}`
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: config.modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numPoses: config.numPoses,
      minPoseDetectionConfidence: config.minPoseDetectionConfidence,
      minPosePresenceConfidence: config.minPosePresenceConfidence,
      minTrackingConfidence: config.minTrackingConfidence,
      outputSegmentationMasks: false,
    })
  }

  actualDelegate = config.delegate
  try {
    poseLandmarker = await create(actualDelegate)
  } catch (error) {
    if (actualDelegate !== 'GPU') throw error
    actualDelegate = 'CPU'
    poseLandmarker = await create(actualDelegate)
  }
  self.postMessage({ type: 'READY', delegate: actualDelegate })
}

const detect = (bitmap: ImageBitmap, requestId: number, videoTimestampMs: number) => {
  if (!poseLandmarker) throw new Error('Pose Landmarker is not initialized.')
  let result: PoseLandmarkerResult
  try {
    result = poseLandmarker.detectForVideo(bitmap, videoTimestampMs)
  } finally {
    bitmap.close()
  }
  self.postMessage({
    type: 'RESULT',
    requestId,
    videoTimestampMs,
    landmarks: result.landmarks,
    worldLandmarks: result.worldLandmarks,
  })
}

self.onmessage = async (event: MessageEvent) => {
  try {
    if (event.data.type === 'INIT') await initialize(event.data.config)
    else if (event.data.type === 'DETECT') detect(event.data.bitmap, event.data.requestId, event.data.videoTimestampMs)
    else if (event.data.type === 'CLOSE') {
      poseLandmarker?.close()
      poseLandmarker = null
      self.close()
    }
  } catch (error) {
    event.data.bitmap?.close?.()
    self.postMessage({
      type: 'ERROR',
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

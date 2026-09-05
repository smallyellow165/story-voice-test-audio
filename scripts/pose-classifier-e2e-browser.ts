import {
  EMADictSmoothing,
  PoseClassifier,
  RepetitionCounter,
  rawPoseFrameToClassifierLandmarks,
} from '../src/pose-classifier'
import { analyzePoseVideo } from '../src/pose-video-analyzer'

const fixtureRoot = '../test/fixtures/pose-classifier/real-pushups/'
const videoUrl = `${fixtureRoot}pushups-sample.mp4`
const resultElement = document.querySelector<HTMLPreElement>('#result')!

const loadText = async (relativePath: string) => {
  const response = await fetch(relativePath)
  if (!response.ok) throw new Error(`Could not load ${relativePath}: HTTP ${response.status}`)
  return response.text()
}

const loadVideoDimensions = (url: string) => new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
  const video = document.createElement('video')
  const cleanup = () => {
    video.removeAttribute('src')
    video.load()
  }
  video.addEventListener('loadedmetadata', () => {
    const dimensions = { width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000 }
    cleanup()
    resolve(dimensions)
  }, { once: true })
  video.addEventListener('error', () => {
    cleanup()
    reject(new Error('Could not read real push-ups video metadata.'))
  }, { once: true })
  video.preload = 'metadata'
  video.src = url
  video.load()
})

try {
  const [dimensions, downCsv, upCsv] = await Promise.all([
    loadVideoDimensions(videoUrl),
    loadText(`${fixtureRoot}pushups_down.csv`),
    loadText(`${fixtureRoot}pushups_up.csv`),
  ])
  const classifier = PoseClassifier.fromCsvFiles([
    { fileName: 'pushups_down.csv', contents: downCsv },
    { fileName: 'pushups_up.csv', contents: upCsv },
  ])
  const smoothing = new EMADictSmoothing(10, 0.2)
  const counter = new RepetitionCounter('pushups_down', 6, 4)
  const rawPose = await analyzePoseVideo(videoUrl)
  let detectedFramesClassified = 0
  const checkpoints: Array<{
    frameIndex: number
    videoTimestampMs: number
    classification: Record<string, number>
    smoothed: Record<string, number>
    repetitions: number
  }> = []

  rawPose.frames.forEach((frame, frameIndex) => {
    const landmarks = rawPoseFrameToClassifierLandmarks(frame, dimensions.width, dimensions.height)
    if (!landmarks) {
      smoothing.smooth({})
      return
    }
    detectedFramesClassified += 1
    const classification = classifier.classify(landmarks)
    const smoothed = smoothing.smooth(classification)
    const repetitions = counter.count(smoothed)
    if (frameIndex % 100 === 0 || frameIndex === rawPose.frames.length - 1) {
      checkpoints.push({ frameIndex, videoTimestampMs: frame.videoTimestampMs, classification, smoothed, repetitions })
    }
  })

  const result = {
    sourceVideo: {
      width: dimensions.width,
      height: dimensions.height,
      durationMs: dimensions.durationMs,
    },
    detector: rawPose.model,
    samplingFps: rawPose.samplingFps,
    frameCount: rawPose.frameCount,
    detectedPoseFrameCount: rawPose.detectedPoseFrameCount,
    detectedFramesClassified,
    trainingSamples: classifier.samples.length,
    lastVideoTimestampMs: rawPose.frames.at(-1)?.videoTimestampMs,
    repetitions: counter.nRepeats,
    checkpoints,
  }
  const passed = dimensions.width === 1280 && dimensions.height === 720 &&
    Math.abs(dimensions.durationMs - 17_760) < 1 &&
    rawPose.frameCount === 533 && rawPose.detectedPoseFrameCount === rawPose.frameCount &&
    detectedFramesClassified === rawPose.frameCount && classifier.samples.length === 396 &&
    (rawPose.frames.at(-1)?.videoTimestampMs ?? 0) > dimensions.durationMs - 100 &&
    counter.nRepeats === 11
  resultElement.dataset.status = passed ? 'passed' : 'failed'
  resultElement.textContent = JSON.stringify(result)
} catch (error) {
  resultElement.dataset.status = 'error'
  resultElement.textContent = JSON.stringify({ error: error instanceof Error ? error.stack ?? error.message : String(error) })
}

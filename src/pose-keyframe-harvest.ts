import {
  FullBodyPoseEmbedder,
  PoseClassifier,
  rawPoseFrameToClassifierLandmarks,
  type Point3,
  type PoseLandmarks,
  type RawPoseFrame,
} from './pose-classifier.ts'

export type PoseHarvestSeed = {
  requestedTimestampMs: number
  frameIndex: number
  videoTimestampMs: number
}

export type PoseHarvestFrame = {
  frameIndex: number
  videoTimestampMs: number
  dStateA: number
  dStateB: number
  rawPhaseScore: number
  smoothedPhaseScore: number
}

export type PoseHarvestCandidate = PoseHarvestFrame & {
  state: 'stateA' | 'stateB'
  prominence: number
}

export type PoseHarvestConfig = {
  smoothingWindowFrames: number
  extremaWindowFrames: number
  minimumProminence: number
  minimumTemporalDistanceMs: number
  epsilon: number
}

export type PoseHarvestResult = {
  config: PoseHarvestConfig
  seeds: { stateA: PoseHarvestSeed[]; stateB: PoseHarvestSeed[] }
  frames: PoseHarvestFrame[]
  candidates: PoseHarvestCandidate[]
}

export const defaultPoseHarvestConfig: PoseHarvestConfig = {
  smoothingWindowFrames: 5,
  extremaWindowFrames: 5,
  minimumProminence: 0.05,
  minimumTemporalDistanceMs: 450,
  epsilon: 1e-9,
}

const isDetectedFrame = (frame: RawPoseFrame) => frame.landmarks[0]?.length === 33

export const nearestDetectedPoseFrame = (
  frames: ReadonlyArray<RawPoseFrame>,
  requestedTimestampMs: number,
): PoseHarvestSeed => {
  if (!Number.isFinite(requestedTimestampMs) || requestedTimestampMs < 0) {
    throw new Error('Seed timestamp must be a non-negative finite number.')
  }
  const nearest = frames.reduce<{ frame: RawPoseFrame; frameIndex: number } | null>((best, frame, frameIndex) => {
    if (!isDetectedFrame(frame)) return best
    if (!best) return { frame, frameIndex }
    const distance = Math.abs(frame.videoTimestampMs - requestedTimestampMs)
    const bestDistance = Math.abs(best.frame.videoTimestampMs - requestedTimestampMs)
    return distance < bestDistance ? { frame, frameIndex } : best
  }, null)
  if (!nearest) throw new Error('The selected Raw Pose Run has no detected frames.')
  return {
    requestedTimestampMs,
    frameIndex: nearest.frameIndex,
    videoTimestampMs: nearest.frame.videoTimestampMs,
  }
}

export const centeredMovingAverage = (values: ReadonlyArray<number>, windowFrames = 5) => {
  if (!Number.isInteger(windowFrames) || windowFrames < 1 || windowFrames % 2 === 0) {
    throw new Error('Smoothing window must be a positive odd number of frames.')
  }
  const radius = Math.floor(windowFrames / 2)
  return values.map((_value, index) => {
    const start = Math.max(0, index - radius)
    const end = Math.min(values.length - 1, index + radius)
    let sum = 0
    for (let cursor = start; cursor <= end; cursor += 1) sum += values[cursor]
    return sum / (end - start + 1)
  })
}

// PoseClassifier owns the verified weighted mean-distance implementation. It is
// private at the TypeScript API boundary, but remains a normal runtime method;
// this adapter deliberately calls that implementation instead of cloning it.
const classifierMeanDistance = (
  classifier: PoseClassifier,
  left: PoseLandmarks,
  right: PoseLandmarks,
) => Reflect.get(classifier, 'meanWeightedDistance').call(classifier, left, right) as number

const mirroredLandmarks = (landmarks: PoseLandmarks): PoseLandmarks =>
  landmarks.map(([x, y, z]): Point3 => [-x, y, z])

const mean = (values: ReadonlyArray<number>) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

type EmbeddedFrame = {
  frameIndex: number
  videoTimestampMs: number
  embedding: PoseLandmarks
  mirroredEmbedding: PoseLandmarks
}

const detectedEmbeddings = (
  frames: ReadonlyArray<RawPoseFrame>,
  frameWidth: number,
  frameHeight: number,
  embedder: FullBodyPoseEmbedder,
): EmbeddedFrame[] => frames.flatMap((frame, frameIndex) => {
  const landmarks = rawPoseFrameToClassifierLandmarks(frame, frameWidth, frameHeight)
  if (!landmarks) return []
  return [{
    frameIndex,
    videoTimestampMs: frame.videoTimestampMs,
    embedding: embedder.embed(landmarks),
    mirroredEmbedding: embedder.embed(mirroredLandmarks(landmarks)),
  }]
})

export const detectPoseHarvestTurningPoints = (
  frames: ReadonlyArray<PoseHarvestFrame>,
  config: PoseHarvestConfig,
): PoseHarvestCandidate[] => {
  const candidates: PoseHarvestCandidate[] = []
  const radius = config.extremaWindowFrames
  for (let index = 1; index < frames.length - 1; index += 1) {
    const score = frames[index].smoothedPhaseScore
    const previous = frames[index - 1].smoothedPhaseScore
    const next = frames[index + 1].smoothedPhaseScore
    const isMaximum = score > previous && score >= next
    const isMinimum = score < previous && score <= next
    if (!isMaximum && !isMinimum) continue

    const left = frames.slice(Math.max(0, index - radius), index).map((frame) => frame.smoothedPhaseScore)
    const right = frames.slice(index + 1, Math.min(frames.length, index + radius + 1))
      .map((frame) => frame.smoothedPhaseScore)
    if (!left.length || !right.length) continue
    const prominence = isMaximum
      ? Math.min(score - Math.min(...left), score - Math.min(...right))
      : Math.min(Math.max(...left) - score, Math.max(...right) - score)
    if (prominence < config.minimumProminence) continue
    candidates.push({
      ...frames[index],
      state: isMaximum ? 'stateA' : 'stateB',
      prominence,
    })
  }

  // Debounce extrema of the same type. Within the time radius, retain the
  // stronger turning point rather than whichever jitter peak happened first.
  const deduplicated: PoseHarvestCandidate[] = []
  for (const candidate of candidates) {
    const priorIndex = deduplicated.findLastIndex((item) =>
      item.state === candidate.state &&
      candidate.videoTimestampMs - item.videoTimestampMs < config.minimumTemporalDistanceMs)
    if (priorIndex < 0) deduplicated.push(candidate)
    else if (candidate.prominence > deduplicated[priorIndex].prominence) deduplicated[priorIndex] = candidate
  }
  return deduplicated.sort((left, right) => left.videoTimestampMs - right.videoTimestampMs)
}

export const harvestPoseKeyframes = ({
  frames,
  frameWidth,
  frameHeight,
  stateASeedTimestampsMs,
  stateBSeedTimestampsMs,
  config: configOverrides = {},
}: {
  frames: ReadonlyArray<RawPoseFrame>
  frameWidth: number
  frameHeight: number
  stateASeedTimestampsMs: ReadonlyArray<number>
  stateBSeedTimestampsMs: ReadonlyArray<number>
  config?: Partial<PoseHarvestConfig>
}): PoseHarvestResult => {
  if (!stateASeedTimestampsMs.length || !stateBSeedTimestampsMs.length) {
    throw new Error('Each state needs at least one seed frame.')
  }
  const config = { ...defaultPoseHarvestConfig, ...configOverrides }
  if (!Number.isInteger(config.extremaWindowFrames) || config.extremaWindowFrames < 1) {
    throw new Error('Extrema window must be at least one frame.')
  }
  if (!Number.isFinite(config.minimumProminence) || config.minimumProminence < 0 ||
    !Number.isFinite(config.minimumTemporalDistanceMs) || config.minimumTemporalDistanceMs < 0 ||
    !Number.isFinite(config.epsilon) || config.epsilon <= 0) {
    throw new Error('Harvest thresholds must be finite and non-negative, and epsilon must be positive.')
  }

  const seeds = {
    stateA: stateASeedTimestampsMs.map((timestamp) => nearestDetectedPoseFrame(frames, timestamp)),
    stateB: stateBSeedTimestampsMs.map((timestamp) => nearestDetectedPoseFrame(frames, timestamp)),
  }
  const embedder = new FullBodyPoseEmbedder()
  const classifier = new PoseClassifier([], embedder)
  const embeddedFrames = detectedEmbeddings(frames, frameWidth, frameHeight, embedder)
  const embeddedByFrameIndex = new Map(embeddedFrames.map((frame) => [frame.frameIndex, frame]))
  const stateAEmbeddings = seeds.stateA.map((seed) => embeddedByFrameIndex.get(seed.frameIndex)!.embedding)
  const stateBEmbeddings = seeds.stateB.map((seed) => embeddedByFrameIndex.get(seed.frameIndex)!.embedding)

  const scored = embeddedFrames.map((frame) => {
    const distanceToSeed = (seed: PoseLandmarks) => Math.min(
      classifierMeanDistance(classifier, seed, frame.embedding),
      classifierMeanDistance(classifier, seed, frame.mirroredEmbedding),
    )
    const dStateA = mean(stateAEmbeddings.map(distanceToSeed))
    const dStateB = mean(stateBEmbeddings.map(distanceToSeed))
    return {
      frameIndex: frame.frameIndex,
      videoTimestampMs: frame.videoTimestampMs,
      dStateA,
      dStateB,
      rawPhaseScore: (dStateB - dStateA) / (dStateB + dStateA + config.epsilon),
      smoothedPhaseScore: 0,
    }
  })
  const smoothed = centeredMovingAverage(scored.map((frame) => frame.rawPhaseScore), config.smoothingWindowFrames)
  const resultFrames = scored.map((frame, index) => ({ ...frame, smoothedPhaseScore: smoothed[index] }))
  return { config, seeds, frames: resultFrames, candidates: detectPoseHarvestTurningPoints(resultFrames, config) }
}

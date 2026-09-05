import {
  rawPoseFrameToClassifierLandmarks,
  type RawPoseFrame,
} from './pose-classifier.ts'

export type PoseAnchor = {
  className: string
  timestampMs: number
}

export type AnchorFrameMatch = PoseAnchor & {
  frameIndex: number
  videoTimestampMs: number
}

export type ExportedPoseSample = {
  className: string
  frameIndex: number
  videoTimestampMs: number
  sampleName: string
  landmarks: ReturnType<typeof rawPoseFrameToClassifierLandmarks>
}

export type StarJumpDataset = {
  anchorMatches: AnchorFrameMatch[]
  samples: ExportedPoseSample[]
  csvByClass: Record<string, string>
}

export const starJumpPoseAnchors: PoseAnchor[] = [
  { className: 'star_close', timestampMs: 392 },
  { className: 'star_close', timestampMs: 1492 },
  { className: 'star_close', timestampMs: 2492 },
  { className: 'star_close', timestampMs: 3492 },
  { className: 'star_close', timestampMs: 4392 },
  { className: 'star_close', timestampMs: 5800 },
  { className: 'star_open', timestampMs: 992 },
  { className: 'star_open', timestampMs: 1992 },
  { className: 'star_open', timestampMs: 2992 },
  { className: 'star_open', timestampMs: 3992 },
  { className: 'star_open', timestampMs: 4892 },
]

const nearestFrameIndex = (frames: ReadonlyArray<RawPoseFrame>, timestampMs: number) => {
  if (!frames.length) throw new Error('Cannot match an anchor without Raw Pose frames.')
  let nearestIndex = 0
  let nearestDistance = Math.abs(frames[0].videoTimestampMs - timestampMs)
  frames.forEach((frame, frameIndex) => {
    const distance = Math.abs(frame.videoTimestampMs - timestampMs)
    // Strictly-less preserves the earlier frame if an anchor falls exactly midway.
    if (distance < nearestDistance) {
      nearestIndex = frameIndex
      nearestDistance = distance
    }
  })
  return nearestIndex
}

export const matchPoseAnchorsToFrames = (
  frames: ReadonlyArray<RawPoseFrame>,
  anchors: ReadonlyArray<PoseAnchor>,
): AnchorFrameMatch[] => anchors.map((anchor) => {
  const frameIndex = nearestFrameIndex(frames, anchor.timestampMs)
  return { ...anchor, frameIndex, videoTimestampMs: frames[frameIndex].videoTimestampMs }
})

const sampleNameFor = (poseRunId: string, frameIndex: number, videoTimestampMs: number) =>
  `${poseRunId}_frame-${String(frameIndex).padStart(3, '0')}_${Math.round(videoTimestampMs)}ms`

const csvForSamples = (samples: ReadonlyArray<ExportedPoseSample>) => samples.map((sample) => {
  if (!sample.landmarks) throw new Error(`Cannot export an undetected Pose frame: ${sample.frameIndex}`)
  return [sample.sampleName, ...sample.landmarks.flatMap((landmark) => landmark.map(String))].join(',')
}).join('\n') + (samples.length ? '\n' : '')

export const exportExtendedPoseDataset = ({
  frames,
  poseRunId,
  frameWidth,
  frameHeight,
  anchors,
  expansionRadius = 2,
}: {
  frames: ReadonlyArray<RawPoseFrame>
  poseRunId: string
  frameWidth: number
  frameHeight: number
  anchors: ReadonlyArray<PoseAnchor>
  expansionRadius?: number
}): StarJumpDataset => {
  if (!Number.isInteger(expansionRadius) || expansionRadius < 0) {
    throw new Error('Expansion radius must be a non-negative integer.')
  }
  const anchorMatches = matchPoseAnchorsToFrames(frames, anchors)
  const frameClasses = new Map<number, string>()

  anchorMatches.forEach((match) => {
    for (let offset = -expansionRadius; offset <= expansionRadius; offset += 1) {
      const frameIndex = match.frameIndex + offset
      if (frameIndex < 0 || frameIndex >= frames.length) continue
      // A source frame is never emitted twice, even if anchors overlap.
      if (!frameClasses.has(frameIndex)) frameClasses.set(frameIndex, match.className)
    }
  })

  const samples = [...frameClasses.entries()]
    .sort(([left], [right]) => frames[left].videoTimestampMs - frames[right].videoTimestampMs)
    .flatMap(([frameIndex, className]) => {
      const frame = frames[frameIndex]
      const landmarks = rawPoseFrameToClassifierLandmarks(frame, frameWidth, frameHeight)
      if (!landmarks) return []
      return [{
        className,
        frameIndex,
        videoTimestampMs: frame.videoTimestampMs,
        sampleName: sampleNameFor(poseRunId, frameIndex, frame.videoTimestampMs),
        landmarks,
      }]
    })

  const csvByClass = Object.fromEntries([...new Set(anchors.map((anchor) => anchor.className))].map((className) => [
    className,
    csvForSamples(samples.filter((sample) => sample.className === className)),
  ]))
  return { anchorMatches, samples, csvByClass }
}

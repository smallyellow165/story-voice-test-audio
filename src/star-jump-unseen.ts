import {
  EMADictSmoothing,
  PoseClassifier,
  rawPoseFrameToClassifierLandmarks,
  type RawPoseFrame,
} from './pose-classifier.ts'

export type StarJumpWinner = 'star_close' | 'star_open'

export type StarJumpFrameClassification = {
  frameIndex: number
  videoTimestampMs: number
  rawClose: number
  rawOpen: number
  emaClose: number
  emaOpen: number
  rawWinner: StarJumpWinner
  emaWinner: StarJumpWinner
}

export type StarJumpTransition = {
  from: StarJumpWinner
  to: StarJumpWinner
  videoTimestampMs: number
}

const winnerFor = (close: number, open: number): StarJumpWinner =>
  close >= open ? 'star_close' : 'star_open'

export const classifyUnseenStarJumpFrames = ({
  frames,
  frameWidth,
  frameHeight,
  classifier,
}: {
  frames: ReadonlyArray<RawPoseFrame>
  frameWidth: number
  frameHeight: number
  classifier: PoseClassifier
}): StarJumpFrameClassification[] => {
  const smoother = new EMADictSmoothing(10, 0.2)
  return frames.flatMap((frame, frameIndex) => {
    const landmarks = rawPoseFrameToClassifierLandmarks(frame, frameWidth, frameHeight)
    if (!landmarks) return []

    const raw = classifier.classify(landmarks)
    const rawClose = raw.star_close ?? 0
    const rawOpen = raw.star_open ?? 0
    const ema = smoother.smooth({ star_close: rawClose, star_open: rawOpen })
    const emaClose = ema.star_close ?? 0
    const emaOpen = ema.star_open ?? 0
    return [{
      frameIndex,
      videoTimestampMs: frame.videoTimestampMs,
      rawClose,
      rawOpen,
      emaClose,
      emaOpen,
      rawWinner: winnerFor(rawClose, rawOpen),
      emaWinner: winnerFor(emaClose, emaOpen),
    }]
  })
}

const winnerCounts = (frames: ReadonlyArray<StarJumpFrameClassification>, key: 'rawWinner' | 'emaWinner') =>
  frames.reduce<Record<StarJumpWinner, number>>((counts, frame) => {
    counts[frame[key]] += 1
    return counts
  }, { star_close: 0, star_open: 0 })

export const summarizeUnseenStarJump = (frames: ReadonlyArray<StarJumpFrameClassification>) => {
  const emaTransitions: StarJumpTransition[] = []
  frames.forEach((frame, index) => {
    if (index === 0 || frame.emaWinner === frames[index - 1].emaWinner) return
    emaTransitions.push({
      from: frames[index - 1].emaWinner,
      to: frame.emaWinner,
      videoTimestampMs: frame.videoTimestampMs,
    })
  })
  return {
    rawWinnerCounts: winnerCounts(frames, 'rawWinner'),
    emaWinnerCounts: winnerCounts(frames, 'emaWinner'),
    emaWinnerSequence: frames.length
      ? [frames[0].emaWinner, ...emaTransitions.map((transition) => transition.to)]
      : [],
    emaTransitions,
  }
}

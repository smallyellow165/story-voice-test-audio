import type { StarJumpFrameClassification } from './star-jump-unseen.ts'

export type ClassifierVoteDebug = {
  totalVotes: number
  winnerVotes: number
  winnerVoteShare: number | null
}

export const classifierVoteDebug = (frame: StarJumpFrameClassification): ClassifierVoteDebug => {
  const totalVotes = frame.rawOpen + frame.rawClose
  const winnerVotes = frame.rawWinner === 'star_open' ? frame.rawOpen : frame.rawClose
  return {
    totalVotes,
    winnerVotes,
    winnerVoteShare: totalVotes > 0 ? winnerVotes / totalVotes : null,
  }
}

export const nearestClassifiedFrame = (
  frames: ReadonlyArray<StarJumpFrameClassification>,
  videoTimestampMs: number,
) => {
  if (!frames.length || !Number.isFinite(videoTimestampMs)) return null
  return frames.reduce((nearest, frame) =>
    Math.abs(frame.videoTimestampMs - videoTimestampMs) < Math.abs(nearest.videoTimestampMs - videoTimestampMs)
      ? frame
      : nearest)
}

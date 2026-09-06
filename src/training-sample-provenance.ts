import type { PoseSample, RawPoseFrame } from './pose-classifier.ts'

export type TrainingSource = {
  videoId: string
  clipId: string
  poseRunId: string
}

export type TrainingRawPose = {
  source: TrainingSource
  frames: RawPoseFrame[]
}

export type TrainingSampleName = {
  poseRunId: string
  frameIndex: number
  encodedTimestampMs: number
}

export type TrainingSampleProvenance = TrainingSampleName & TrainingSource & {
  className: string
  sampleName: string
  videoTimestampMs: number
}

const sampleNamePattern = /^(?<poseRunId>.+)_frame-(?<frameIndex>\d+)_(?<timestampMs>\d+)ms$/

export const parseTrainingSampleName = (sampleName: string): TrainingSampleName => {
  const match = sampleNamePattern.exec(sampleName)
  const poseRunId = match?.groups?.poseRunId
  const frameIndex = Number(match?.groups?.frameIndex)
  const encodedTimestampMs = Number(match?.groups?.timestampMs)
  if (!poseRunId || !Number.isSafeInteger(frameIndex) || frameIndex < 0 ||
    !Number.isSafeInteger(encodedTimestampMs) || encodedTimestampMs < 0) {
    throw new Error(`Unsupported training sample name: ${sampleName}`)
  }
  return { poseRunId, frameIndex, encodedTimestampMs }
}

export const buildTrainingSampleProvenance = (
  samples: ReadonlyArray<PoseSample>,
  rawPose: TrainingRawPose,
): TrainingSampleProvenance[] => samples.map((sample) => {
  const parsed = parseTrainingSampleName(sample.name)
  if (parsed.poseRunId !== rawPose.source.poseRunId) {
    throw new Error(`Training sample ${sample.name} does not belong to Raw Pose Run ${rawPose.source.poseRunId}.`)
  }
  const frame = rawPose.frames[parsed.frameIndex]
  if (!frame || !Number.isFinite(frame.videoTimestampMs)) {
    throw new Error(`Training sample ${sample.name} references missing Raw Pose frame ${parsed.frameIndex}.`)
  }
  return {
    ...parsed,
    videoId: rawPose.source.videoId,
    clipId: rawPose.source.clipId,
    poseRunId: rawPose.source.poseRunId,
    className: sample.className,
    sampleName: sample.name,
    // Raw Pose is the timestamp source of truth. The rounded value encoded in
    // the CSV name is retained only as provenance/debug information.
    videoTimestampMs: frame.videoTimestampMs,
  }
})

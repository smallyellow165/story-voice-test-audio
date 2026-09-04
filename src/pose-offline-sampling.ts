export const POSE_TIMESTAMP_PRECISION = 6

const roundTimestamp = (value: number) => Number(value.toFixed(POSE_TIMESTAMP_PRECISION))

export const createPoseTargetTimestamps = (durationMs: number, samplingFps: number, firstTimestampMs = 0) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Video duration must be positive.')
  if (!Number.isFinite(samplingFps) || samplingFps <= 0) throw new Error('Pose sampling FPS must be positive.')
  if (!Number.isFinite(firstTimestampMs) || firstTimestampMs < 0 || firstTimestampMs >= durationMs) {
    throw new Error('First video timestamp must be inside the video duration.')
  }

  const frameIntervalMs = 1000 / samplingFps
  // Media duration ends one frame interval after the final frame PTS. Rounding
  // duration * FPS yields the stable sample count without inventing a target at
  // the end boundary (for example, 296 frames span 0ms through 9833.333ms while
  // the container duration is 9866.667ms).
  const roundedFirstTimestampMs = roundTimestamp(firstTimestampMs)
  const targetCount = Math.max(1, Math.round((durationMs - roundedFirstTimestampMs) / frameIntervalMs))
  return Array.from(
    { length: targetCount },
    (_, frameIndex) => roundTimestamp(roundedFirstTimestampMs + frameIndex * frameIntervalMs),
  )
}

export const processTargetsSequentially = async <T>(
  targets: readonly number[],
  processTarget: (targetTimestampMs: number, index: number) => Promise<T>,
) => {
  const results: T[] = []
  for (let index = 0; index < targets.length; index += 1) {
    results.push(await processTarget(targets[index], index))
  }
  return results
}

export const assertCompletePoseTimeline = (
  targets: readonly number[],
  actualTimestamps: readonly number[],
) => {
  if (actualTimestamps.length !== targets.length) {
    throw new Error(`Pose analysis returned ${actualTimestamps.length} of ${targets.length} planned frames.`)
  }

  for (let index = 0; index < targets.length; index += 1) {
    const actual = actualTimestamps[index]
    const expected = targets[index]
    if (!Number.isFinite(actual)) throw new Error(`Pose frame ${index + 1} has an invalid timestamp.`)
    if (index > 0 && actual <= actualTimestamps[index - 1]) {
      throw new Error(`Pose frame timestamps are not strictly increasing at frame ${index + 1}.`)
    }
    if (Math.abs(actual - expected) > 10 ** -POSE_TIMESTAMP_PRECISION) {
      throw new Error(`Pose frame ${index + 1} does not match its planned timestamp.`)
    }
  }
}

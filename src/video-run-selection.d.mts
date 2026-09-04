import type { LlmPoseRun, PoseRun, VideoLibrary } from './video-library-storage'

export type ClipRunSelection = {
  poseRuns: PoseRun[]
  selectedPoseRun: PoseRun | undefined
  llmPoseRuns: LlmPoseRun[]
  selectedLlmPoseRun: LlmPoseRun | undefined
}

export function selectPoseRun(
  library: VideoLibrary,
  clipId: string,
  poseRunId: string,
  selectedPoseRunByClipId: Map<string, string>,
): void

export function selectLlmPoseRun(
  library: VideoLibrary,
  poseRunId: string,
  llmPoseRunId: string,
  selectedLlmPoseRunByPoseRunId: Map<string, string>,
): void

export function getClipRunSelection(
  library: VideoLibrary,
  clipId: string,
  selectedPoseRunByClipId: Map<string, string>,
  selectedLlmPoseRunByPoseRunId: Map<string, string>,
): ClipRunSelection

export function findAppendedRun<T extends Record<K, string> & { createdAt: string }, K extends string>(
  beforeIds: Set<string>,
  runs: T[],
  idKey: K,
): T | undefined

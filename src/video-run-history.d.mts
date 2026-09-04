import type { LlmPoseRun, PoseRun, VideoLibrary } from './video-library-storage'

export type ClipRuns = {
  poseRuns: PoseRun[]
  llmPoseRuns: LlmPoseRun[]
}

export function getClipRuns(library: VideoLibrary, clipId: string): ClipRuns

const sortedRuns = (runs, idKey) => [...runs].sort((left, right) => {
  const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt)
  return timeDifference || String(left[idKey]).localeCompare(String(right[idKey]))
})

export const getClipRuns = (library, clipId) => ({
  poseRuns: sortedRuns(library.poseRuns.filter((run) => run.clipId === clipId), 'poseRunId'),
  llmPoseRuns: sortedRuns(library.llmPoseRuns.filter((run) => run.clipId === clipId), 'llmPoseRunId'),
})

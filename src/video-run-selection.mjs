const latestRun = (runs) => runs.reduce((latest, run) => {
  if (!latest) return run
  const latestTime = Date.parse(latest.createdAt)
  const runTime = Date.parse(run.createdAt)
  return runTime >= latestTime ? run : latest
}, undefined)

const sortedRuns = (runs, idKey) => [...runs].sort((left, right) => {
  const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt)
  return timeDifference || String(left[idKey]).localeCompare(String(right[idKey]))
})

export const selectPoseRun = (library, clipId, poseRunId, selectedPoseRunByClipId) => {
  if (!library.poseRuns.some((run) => run.clipId === clipId && run.poseRunId === poseRunId)) {
    throw new Error('Pose Run does not belong to this Clip.')
  }
  selectedPoseRunByClipId.set(clipId, poseRunId)
}

export const selectLlmPoseRun = (library, poseRunId, llmPoseRunId, selectedLlmPoseRunByPoseRunId) => {
  if (!library.llmPoseRuns.some((run) => run.poseRunId === poseRunId && run.llmPoseRunId === llmPoseRunId)) {
    throw new Error('LLM Pose Run does not belong to this Pose Run.')
  }
  selectedLlmPoseRunByPoseRunId.set(poseRunId, llmPoseRunId)
}

export const getClipRunSelection = (
  library,
  clipId,
  selectedPoseRunByClipId,
  selectedLlmPoseRunByPoseRunId,
) => {
  const poseRuns = sortedRuns(library.poseRuns.filter((run) => run.clipId === clipId), 'poseRunId')
  let selectedPoseRun = poseRuns.find((run) => run.poseRunId === selectedPoseRunByClipId.get(clipId))
  if (!selectedPoseRun) {
    selectedPoseRun = latestRun(poseRuns)
    if (selectedPoseRun) selectedPoseRunByClipId.set(clipId, selectedPoseRun.poseRunId)
    else selectedPoseRunByClipId.delete(clipId)
  }

  const llmPoseRuns = selectedPoseRun
    ? sortedRuns(library.llmPoseRuns.filter((run) => run.poseRunId === selectedPoseRun.poseRunId), 'llmPoseRunId')
    : []
  let selectedLlmPoseRun = selectedPoseRun
    ? llmPoseRuns.find((run) => run.llmPoseRunId === selectedLlmPoseRunByPoseRunId.get(selectedPoseRun.poseRunId))
    : undefined
  if (selectedPoseRun && !selectedLlmPoseRun) {
    selectedLlmPoseRun = latestRun(llmPoseRuns)
    if (selectedLlmPoseRun) {
      selectedLlmPoseRunByPoseRunId.set(selectedPoseRun.poseRunId, selectedLlmPoseRun.llmPoseRunId)
    } else {
      selectedLlmPoseRunByPoseRunId.delete(selectedPoseRun.poseRunId)
    }
  }

  return { poseRuns, selectedPoseRun, llmPoseRuns, selectedLlmPoseRun }
}

export const findAppendedRun = (beforeIds, runs, idKey) => {
  const appended = runs.filter((run) => !beforeIds.has(run[idKey]))
  return latestRun(appended)
}

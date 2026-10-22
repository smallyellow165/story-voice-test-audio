// A visual result can confirm only the immutable step reference captured at upload.
export function sameStep(a, b) {
  return !!a && !!b && ['artifactId', 'designHash', 'instanceId', 'runId', 'taskAttemptId', 'revision', 'index', 'taskId'].every(k => a[k] === b[k])
}
export function canApplyVision(result, captured, current, permitted) {
  return permitted && result?.status === 'complete' && result.evaluation?.verdict === 'confirm'
    && sameStep(result.reference, captured) && sameStep(captured, current)
}

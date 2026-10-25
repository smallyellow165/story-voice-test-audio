import { createHash } from 'node:crypto'
import { geometryAnalysisIssues, geometryValidationVersion } from './brick-reverse-geometry.mjs'

// Read-only inspection: neither repairs evidence nor changes historical status.
export function inspectGeometryOutput(record) {
  if (record.kind !== 'reverse-analysis' || record.analysis_mode !== 'geometry_only' || typeof record.rawOutput !== 'string') return null
  const report = { sourceAnalysisId: record.id, validatorVersion: geometryValidationVersion,
    rawOutputSha256: createHash('sha256').update(record.rawOutput).digest('hex'),
    stage: 'json_parse_failed', valid: false, parsed: false, observationCount: 0, relationCount: 0, issues: [] }
  if (record.httpStatus >= 400 || record.finishReason && !['completed', 'STOP'].includes(record.finishReason)) {
    return { ...report, stage: 'provider_failed', issues: [{ path: '$', expected: 'Successful completed provider response', actual: { httpStatus: record.httpStatus, finishReason: record.finishReason }, message: 'Provider failed or returned an incomplete response; no revision allowed' }] }
  }
  let output
  try { output = record.revision ? record.revisionOutput : JSON.parse(record.rawOutput) }
  catch { return { ...report, issues: [{ path: '$', expected: 'JSON object', actual: 'Invalid JSON', message: 'Saved model output is not valid JSON' }] } }
  report.parsed = true
  report.stage = 'output_validation_failed'
  report.observationCount = Array.isArray(output?.observations) ? output.observations.length : 0
  report.relationCount = Array.isArray(output?.relations) ? output.relations.length : 0
  report.issues = geometryAnalysisIssues(output)
  for (const issue of report.issues) {
    const match = /^\$\.observations\[(\d+)\]\.dimensions\.(width_studs|depth_studs|height_brick_units)\.anchor_ids\[\d+\]$/.exec(issue.path)
    if (match) issue.context = { observationId: output.observations[Number(match[1])].id, dimension: output.observations[Number(match[1])].dimensions[match[2]] }
  }
  report.anchors = Array.isArray(output?.anchors) ? output.anchors : []
  report.valid = report.issues.length === 0
  if (report.valid) report.stage = 'valid'
  return report
}

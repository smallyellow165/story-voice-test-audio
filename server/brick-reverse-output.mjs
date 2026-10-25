import { createHash } from 'node:crypto'
import { geometryAnalysisIssues, geometryValidationVersion } from './brick-reverse-geometry.mjs'

// Read-only inspection: neither repairs evidence nor changes historical status.
export function inspectGeometryOutput(record) {
  if (record.kind !== 'reverse-analysis' || record.analysis_mode !== 'geometry_only' || typeof record.rawOutput !== 'string') return null
  const report = { sourceAnalysisId: record.id, validatorVersion: geometryValidationVersion,
    rawOutputSha256: createHash('sha256').update(record.rawOutput).digest('hex'),
    valid: false, parsed: false, observationCount: 0, relationCount: 0, issues: [] }
  let output
  try { output = JSON.parse(record.rawOutput) }
  catch { return { ...report, issues: [{ path: '$', expected: 'JSON object', actual: 'Invalid JSON', message: 'Saved model output is not valid JSON' }] } }
  report.parsed = true
  report.observationCount = Array.isArray(output?.observations) ? output.observations.length : 0
  report.relationCount = Array.isArray(output?.relations) ? output.relations.length : 0
  report.issues = geometryAnalysisIssues(output)
  report.valid = report.issues.length === 0
  return report
}

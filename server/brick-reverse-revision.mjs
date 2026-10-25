import { geometryAnalysisIssues } from './brick-reverse-geometry.mjs'
const reject = message => { throw Object.assign(new Error(message), { statusCode: 422 }) }
// Only an invalid dimension anchor reference may be changed. Evidence text and
// all values/statuses are deliberately outside this editor's authority.
export function reviseAnchorReference(output, operation) {
  const match = /^\$\.observations\[(\d+)\]\.dimensions\.(width_studs|depth_studs|height_brick_units)\.anchor_ids\[(\d+)\]$/.exec(operation?.path || '')
  if (!match || !['replace', 'remove'].includes(operation?.action)) reject('仅允许替换或移除无效的尺寸 Anchor 引用。')
  if (typeof operation.reason !== 'string' || !operation.reason.trim() || operation.reason.length > 2000 || operation.confirmed !== true) reject('必须填写证据审核理由并明确确认修订。')
  const issues = geometryAnalysisIssues(output)
  const issue = issues.find(i => i.path === operation.path)
  if (!issue || !Array.isArray(issue.expected)) reject('所选字段不是可修订的非法 Anchor 引用。')
  const result = structuredClone(output), ids = result.observations[Number(match[1])].dimensions[match[2]].anchor_ids
  const index = Number(match[3]), before = ids[index]
  if (operation.action === 'replace') {
    if (typeof operation.anchorId !== 'string' || !result.anchors.some(a => a.observation_id === operation.anchorId)) reject('目标 Anchor 必须已声明并附有证据；不能自动提升 Observation。')
    ids[index] = operation.anchorId
  } else ids.splice(index, 1)
  return { output: result, change: { path: operation.path, action: operation.action, before, after: operation.action === 'remove' ? null : operation.anchorId, reason: operation.reason.trim(), confirmed: true } }
}

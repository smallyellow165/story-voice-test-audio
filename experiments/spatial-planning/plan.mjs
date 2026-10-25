// Pure contract and diagnostics. Never snaps, repairs, or invents placements.
export const promptVersion = 'spatial-assembly-plan-v1'
const str = { type: 'STRING' }, num = { type: 'NUMBER' }
const array = items => ({ type: 'ARRAY', items })
const object = properties => ({ type: 'OBJECT', required: Object.keys(properties), properties })
const nullable = schema => ({ ...schema, nullable: true })
const range = nullable(object({ min: num, max: num }))
const point = object({ u: num, v: num })
export const planSchema = object({
  version: { type: 'STRING', enum: [promptVersion] },
  scene: object({ method: { type: 'STRING', enum: ['near_planar', 'general_3d', 'uncertain'] },
    cameraEvidence: str, depthAxisEvidence: str, scaleEvidence: str, unknowns: array(str) }),
  parts: array(object({
    id: str, role: str,
    image: object({ bbox: nullable(array(num)), features: array(object({ label: str, point, evidence: str })), occlusion: str }),
    pose: object({ relativeTo: nullable(str), offsetLdu: object({ x: range, y: range, z: range }),
      yawCandidates: array(num), upright: nullable({ type: 'BOOLEAN' }), evidence: str,
      confidence: num, unknowns: array(str) }),
    connections: array(object({ other: str, intent: { type: 'STRING', enum: ['mates', 'touches', 'uncertain'] },
      ownSurface: { type: 'STRING', enum: ['top', 'bottom', 'side', 'unknown'] },
      otherSurface: { type: 'STRING', enum: ['top', 'bottom', 'side', 'unknown'] },
      ownConnector: nullable({ type: 'INTEGER' }), otherConnector: nullable({ type: 'INTEGER' }),
      visibility: { type: 'STRING', enum: ['observed', 'inferred', 'unknown'] }, evidence: str })),
  })),
  relations: array(object({ from: str, to: str, kind: { type: 'STRING', enum: ['above', 'left', 'front', 'separated', 'overlaps_projection', 'occludes'] }, evidence: str })),
  alternatives: array(object({ affectedIds: array(str), explanation: str })),
  missingGeometry: array(str),
})

// Same contract is checked locally for both providers.
export function validatePlan(plan, input) {
  const issues = []
  function check(v, s, p) {
    if (v === null && s.nullable) return
    const type = s.type
    if (type === 'OBJECT') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) { issues.push(p + ': object required'); return }
      for (const k of Object.keys(v)) if (!Object.hasOwn(s.properties,k)) issues.push(p + '.' + k + ': unexpected field')
      for (const [k, child] of Object.entries(s.properties)) check(v[k], child, p + '.' + k)
    } else if (type === 'ARRAY') {
      if (!Array.isArray(v)) { issues.push(p + ': array required'); return }
      v.forEach((x, i) => check(x, s.items, p + '[' + i + ']'))
    } else if (type === 'STRING' ? typeof v !== 'string' : type === 'BOOLEAN' ? typeof v !== 'boolean' : !Number.isFinite(v) || (type === 'INTEGER' && !Number.isInteger(v))) issues.push(p + ': invalid ' + type)
    if (s.enum && !s.enum.includes(v)) issues.push(p + ': invalid enum')
  }
  check(plan, planSchema, 'plan')
  if (issues.length) return { valid: false, issues }
  const expected = new Map(input.observations.map(o => [o.id, o]))
  const parts = new Map()
  for (const p of plan.parts) {
    if (!expected.has(p.id) || parts.has(p.id)) issues.push('Unknown or duplicate observation: ' + p.id)
    parts.set(p.id, p)
    if (!p.role.trim() || !p.pose.evidence.trim()) issues.push(p.id + ': role and pose evidence required')
    if (p.pose.confidence < 0 || p.pose.confidence > 1) issues.push(p.id + ': confidence outside 0..1')
    const b = p.image.bbox
    if (b && (b.length !== 4 || b.some(x => x < 0 || x > 1) || b[0] >= b[2] || b[1] >= b[3])) issues.push(p.id + ': invalid bbox')
    for (const f of p.image.features) if (f.point.u < 0 || f.point.u > 1 || f.point.v < 0 || f.point.v > 1) issues.push(p.id + ': invalid image point')
    for (const r of Object.values(p.pose.offsetLdu)) if (r && (r.min > r.max || Math.max(Math.abs(r.min), Math.abs(r.max)) > 100000)) issues.push(p.id + ': invalid offset range')
    if (p.pose.yawCandidates.some(y => ![0,90,180,270].includes(y)) || new Set(p.pose.yawCandidates).size !== p.pose.yawCandidates.length) issues.push(p.id + ': invalid yaw candidates')
    for (const c of p.connections) {
      if (!expected.has(c.other) || c.other === p.id) issues.push(p.id + ': invalid connection target')
      for (const [id, surface, index] of [[p.id,c.ownSurface,c.ownConnector],[c.other,c.otherSurface,c.otherConnector]]) {
        if (index !== null && (!['top','bottom'].includes(surface) || index < 0 || index >= (expected.get(id)?.geometry?.[surface]?.length ?? 0))) issues.push(p.id + ': invalid connector index')
      }
    }
  }
  for (const id of expected.keys()) if (!parts.has(id)) issues.push('Missing observation: ' + id)
  const anchors = plan.parts.filter(p => p.pose.relativeTo === null)
  if (anchors.length !== 1) issues.push('Exactly one anchor required')
  for (const p of anchors) if (Object.values(p.pose.offsetLdu).some(r => !r || r.min !== 0 || r.max !== 0)) issues.push('Anchor must have exact zero offsets')
  for (const p of plan.parts) {
    const visited = new Set(); let current = p
    while (current) {
      if (visited.has(current.id)) { issues.push('Relative pose cycle: ' + p.id); break }
      visited.add(current.id)
      const ref = current.pose.relativeTo
      if (ref === null) break
      current = parts.get(ref)
      if (!current) issues.push(p.id + ': missing relativeTo ' + ref)
    }
  }
  for (const r of plan.relations) if (!expected.has(r.from) || !expected.has(r.to) || r.from === r.to) issues.push('Invalid relation identity')
  for (const a of plan.alternatives) if (!a.affectedIds.length || a.affectedIds.some(id => !expected.has(id))) issues.push('Invalid alternative identity')
  return { valid: !issues.length, issues }
}

export function assessConversion(plan, input) {
  const validation = validatePlan(plan, input)
  if (!validation.valid) return { status: 'invalid_plan', validation, geometryStatus: 'not_run' }
  const unresolved = [], poses = new Map(), byId = new Map(plan.parts.map(p => [p.id,p]))
  function world(p) {
    if (poses.has(p.id)) return poses.get(p.id)
    const parent = p.pose.relativeTo === null ? {x:{min:0,max:0},y:{min:0,max:0},z:{min:0,max:0}} : world(byId.get(p.pose.relativeTo))
    const result = Object.fromEntries(['x','y','z'].map(axis => { const a=parent[axis], b=p.pose.offsetLdu[axis]; return [axis,a && b ? {min:a.min+b.min,max:a.max+b.max} : null] }))
    poses.set(p.id,result); return result
  }
  const candidates = plan.parts.map(p => {
    const position = world(p)
    for (const [axis,r] of Object.entries(position)) if (!r || r.min !== r.max) unresolved.push(p.id + ': unresolved world ' + axis)
    if (p.pose.upright !== true || p.pose.yawCandidates.length !== 1) unresolved.push(p.id + ': unresolved/unsupported orientation')
    return {id:p.id,worldOffsetLdu:position,yawCandidates:p.pose.yawCandidates}
  })
  for (const a of plan.alternatives) unresolved.push('Alternative: '+a.affectedIds.join(', ')+': '+a.explanation)
  for (const m of plan.missingGeometry) unresolved.push('Model reports: '+m)
  return { status: unresolved.length ? 'needs_resolution' : 'single_pose_hypothesis', validation,
    geometryStatus: 'not_run', candidates, unresolved,
    hiddenConnections: plan.parts.flatMap(p => p.connections.filter(c => c.visibility !== 'observed' || c.ownConnector === null || c.otherConnector === null).map(c => ({id:p.id,...c}))),
    nextSteps: ['Resolve ranges/alternatives without changing visual relations.', 'Translate all origins by one common ground offset; x/studLdu, z/studLdu, y/layerLdu.', 'Reject off-grid poses; never silently round. Validate shared collision/connectors and supplied spatial constraints independently of build order.'] }
}

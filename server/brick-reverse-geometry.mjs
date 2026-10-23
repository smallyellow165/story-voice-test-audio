// Geometry observations are visual claims, never Assembly V2 validation results.
// All piece types: width/depth in 16 mm Stud Units, height in 19.2 mm Brick Height Units.
// NUMBER values and alternatives allow fractional heights (e.g. 0.5); never classify to choose units.
// Future Catalog matching must convert reliable physical dimensions to these units
// (width/depth mm / 16, body-height mm / 19.2), keeping verified measurements separate
// from these Vision estimates. A Brick/Plate name is not dimension evidence.
const text = { type: 'STRING' }
const number = { type: 'NUMBER' }
const nullableNumber = { type: 'NUMBER', nullable: true }
const list = items => ({ type: 'ARRAY', items })
const obj = properties => ({ type: 'OBJECT', properties, required: Object.keys(properties) })
const status = { type: 'STRING', enum: ['observed', 'inferred', 'unknown'] }
const dimension = obj({ value: nullableNumber, status, confidence: number, evidence: text,
  alternatives: list(obj({ value: number, evidence: text })), anchor_ids: list(text) })
export const geometrySchema = obj({
  appearance: text, scale_evidence: text, unknowns: list(text),
  anchors: list(obj({ observation_id: text, evidence: text, confidence: number })),
  observations: list(obj({ id: text, color: text,
    bbox: { type: 'ARRAY', items: number, nullable: true }, confidence: number,
    dimensions: obj({ width_studs: dimension, depth_studs: dimension, height_brick_units: dimension }),
    orientation: obj({ description: text, yaw_degrees: nullableNumber, status, evidence: text }),
    visible_studs: { type: 'INTEGER', nullable: true }, visible_seams: list(text),
    evidence: text, occlusion: text, unknowns: list(text), alternatives: list(text),
  })),
  relations: list(obj({ from: text, to: text,
    relation: { type: 'STRING', enum: ['above', 'below', 'left', 'right', 'front', 'behind', 'contact', 'supports', 'connected', 'unknown'] },
    status, confidence: number, evidence: text })),
})
const fail = () => { throw Object.assign(new Error('Geometry Observation 结构或证据状态无效；模型推断不能标为 Validated。'), { statusCode: 422 }) }
const string = s => typeof s === 'string' && s.length <= 2000
const array = (a, max = 200) => Array.isArray(a) && a.length <= max
const strings = a => array(a) && a.every(string)
const confidence = n => Number.isFinite(n) && n >= 0 && n <= 1
const positive = n => Number.isFinite(n) && n > 0 && n <= 100
const state = s => ['observed', 'inferred', 'unknown'].includes(s)
export function validateGeometryAnalysis(value) {
  if (!value || !string(value.appearance) || !string(value.scale_evidence) || !strings(value.unknowns)
    || !array(value.anchors, 100) || !array(value.observations, 100) || !array(value.relations, 300)) fail()
  const ids = new Set()
  for (const o of value.observations) {
    if (!o || typeof o.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(o.id) || ids.has(o.id)
      || !string(o.color) || !confidence(o.confidence) || !string(o.evidence) || !string(o.occlusion)
      || !strings(o.visible_seams) || !strings(o.unknowns) || !strings(o.alternatives)
      || !(o.visible_studs === null || Number.isSafeInteger(o.visible_studs) && o.visible_studs >= 0)
      || !(o.bbox === null || Array.isArray(o.bbox) && o.bbox.length === 4 && o.bbox.every(confidence) && o.bbox[0] < o.bbox[2] && o.bbox[1] < o.bbox[3])) fail()
    const orientation = o.orientation
    if (!orientation || !string(orientation.description) || !string(orientation.evidence) || !state(orientation.status)
      || !(orientation.yaw_degrees === null || [0, 90, 180, 270].includes(orientation.yaw_degrees))
      || orientation.status === 'unknown' && orientation.yaw_degrees !== null) fail()
    for (const key of ['width_studs', 'depth_studs', 'height_brick_units']) {
      const d = o.dimensions?.[key]
      if (!d || !state(d.status) || !confidence(d.confidence) || !string(d.evidence) || !strings(d.anchor_ids)
        || !array(d.alternatives, 20) || !d.alternatives.every(a => a && positive(a.value) && string(a.evidence))
        || !(d.status === 'unknown' ? d.value === null : positive(d.value) && d.evidence.trim())) fail()
    }
    ids.add(o.id)
  }
  const anchors = new Set()
  for (const a of value.anchors) {
    if (!a || !ids.has(a.observation_id) || anchors.has(a.observation_id) || !string(a.evidence) || !a.evidence.trim() || !confidence(a.confidence)) fail()
    anchors.add(a.observation_id)
  }
  for (const o of value.observations) for (const d of Object.values(o.dimensions)) {
    if (!d || !Array.isArray(d.anchor_ids) || d.anchor_ids.some(id => !anchors.has(id))) fail()
  }
  for (const r of value.relations) {
    if (!r || !ids.has(r.from) || !ids.has(r.to) || r.from === r.to || !state(r.status)
      || !['above','below','left','right','front','behind','contact','supports','connected','unknown'].includes(r.relation)
      || !confidence(r.confidence) || !string(r.evidence)
      || r.relation === 'connected' && r.status === 'observed') fail()
  }
  return value
}

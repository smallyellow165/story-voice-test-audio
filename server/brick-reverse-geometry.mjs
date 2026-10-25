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
export const geometryValidationVersion = 'geometry-observation-v1-diagnostics-1'
// This walks the published shape, then checks the existing semantic constraints.
// It never normalizes evidence, fills unknowns or promotes an observation to an anchor.
export function geometryAnalysisIssues(value) {
  const issues = []
  const issue = (path, expected, actual, message) => issues.push({path, expected, actual: actual === undefined ? '(missing)' : actual, message})
  function walk(v, schema, path) {
    if (v === null && schema.nullable) return
    const type = schema.type
    if (type === 'OBJECT') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) { issue(path, 'object', v, 'Expected an object'); return }
      for (const [key, child] of Object.entries(schema.properties)) walk(v[key], child, path+'.'+key)
    } else if (type === 'ARRAY') {
      const max = path === '$.relations' ? 300 : ['$.anchors','$.observations'].includes(path) ? 100 : /dimensions\.[^.]+\.alternatives$/.test(path) ? 20 : 200
      if (!Array.isArray(v) || v.length > max) {issue(path, `array, max ${max} items`, v, 'Invalid array'); return}
      v.forEach((entry,i)=>walk(entry,schema.items,`${path}[${i}]`))
    } else if (type === 'STRING') {
      if (typeof v !== 'string' || v.length > 2000) issue(path, 'string, max 2000 characters', v, 'Invalid text')
      else if (schema.enum && !schema.enum.includes(v)) issue(path, schema.enum, v, 'Value outside allowed enum; visual claims cannot be validated')
    } else if (!Number.isFinite(v) || type === 'INTEGER' && !Number.isSafeInteger(v)) issue(path, schema.nullable ? `${type.toLowerCase()} or null` : type.toLowerCase(), v, 'Invalid number')
  }
  walk(value, geometrySchema, '$')
  // Structural faults are explicit; do not traverse malformed containers.
  if (issues.length) return issues
  const ids = new Set(), anchors = new Set(value.anchors.map(a=>a.observation_id))
  const confidence = (v,path) => {if(v<0||v>1)issue(path,'number in [0,1]',v,'Confidence out of range')}
  const positive = v => Number.isFinite(v)&&v>0&&v<=100
  value.observations.forEach((o,i)=>{
    const p=`$.observations[${i}]`
    if(!/^[a-zA-Z0-9_-]{1,40}$/.test(o.id)||ids.has(o.id))issue(p+'.id','unique ID, 1..40 letters/digits/_/-',o.id,'Invalid or duplicate Observation ID')
    ids.add(o.id);confidence(o.confidence,p+'.confidence')
    if(o.visible_studs!==null&&o.visible_studs<0)issue(p+'.visible_studs','nonnegative integer or null',o.visible_studs,'Invalid visible count')
    if(o.bbox!==null&&(o.bbox.length!==4||o.bbox.some(n=>n<0||n>1)||o.bbox[0]>=o.bbox[2]||o.bbox[1]>=o.bbox[3]))issue(p+'.bbox','[left,top,right,bottom] in [0,1], positive area, or null',o.bbox,'Invalid bounding box')
    const orientation=o.orientation
    if(!(orientation.yaw_degrees===null||[0,90,180,270].includes(orientation.yaw_degrees))||orientation.status==='unknown'&&orientation.yaw_degrees!==null)issue(p+'.orientation.yaw_degrees',orientation.status==='unknown'?'null':'null or 0/90/180/270',orientation.yaw_degrees,'Unknown orientation must not carry a definite yaw')
    for(const key of ['width_studs','depth_studs','height_brick_units']){
      const d=o.dimensions[key],dp=p+'.dimensions.'+key
      confidence(d.confidence,dp+'.confidence')
      if(!(d.status==='unknown'?d.value===null:positive(d.value)))issue(dp+'.value',d.status==='unknown'?'null':'positive number <=100',d.value,'Dimension value must agree with evidence status')
      if(d.status!=='unknown'&&!d.evidence.trim())issue(dp+'.evidence','nonempty evidence',d.evidence,'Observed/inferred values require evidence')
      d.alternatives.forEach((a,j)=>{if(!positive(a.value))issue(`${dp}.alternatives[${j}].value`,'positive number <=100',a.value,'Invalid alternative dimension')})
      d.anchor_ids.forEach((id,j)=>{if(!anchors.has(id))issue(`${dp}.anchor_ids[${j}]`,[...anchors],id,'Reference must name a declared anchors[].observation_id; an existing Observation is not automatically an anchor')})
    }
    // Preserve the previous rejection of malformed additional dimension fields.
    for(const key of Object.keys(o.dimensions).filter(k=>!['width_studs','depth_studs','height_brick_units'].includes(k))){const d=o.dimensions[key];if(!d||!Array.isArray(d.anchor_ids)||d.anchor_ids.some(id=>!anchors.has(id)))issue(p+'.dimensions.'+key,'dimension with declared anchor references',d,'Invalid dimension references')}
  })
  const seenAnchors=new Set()
  value.anchors.forEach((a,i)=>{const p=`$.anchors[${i}]`;if(!ids.has(a.observation_id)||seenAnchors.has(a.observation_id))issue(p+'.observation_id','unique existing Observation ID',a.observation_id,'Invalid anchor identity');seenAnchors.add(a.observation_id);confidence(a.confidence,p+'.confidence');if(!a.evidence.trim())issue(p+'.evidence','nonempty evidence',a.evidence,'Anchor needs evidence')})
  value.relations.forEach((r,i)=>{const p=`$.relations[${i}]`;for(const key of ['from','to'])if(!ids.has(r[key]))issue(p+'.'+key,[...ids],r[key],'Unknown Observation reference');if(r.from===r.to)issue(p+'.to','different from from',r.to,'Self relation');confidence(r.confidence,p+'.confidence');if(r.relation==='connected'&&r.status==='observed')issue(p+'.status',['inferred','unknown'],r.status,'Visual stud engagement cannot be marked observed')})
  return issues
}
export function validateGeometryAnalysis(value) {
  const issues=geometryAnalysisIssues(value)
  if(issues.length)throw Object.assign(new Error('Output Validation Failed: '+issues.map(i=>i.path+': '+i.message).join('; ')),{statusCode:422,code:'OUTPUT_VALIDATION_FAILED',validationIssues:issues})
  return value
}

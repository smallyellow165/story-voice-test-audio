/** Model interpretations, never executable piece inventory or authoritative poses. */
export const shapeFamilies = ['square','rectangle','triangle','polygon','curved','unknown'] as const
export type ShapeFamily3D = typeof shapeFamilies[number]
export type ShapeAssessment3D = {
  family: ShapeFamily3D; alternativeFamilies: ShapeFamily3D[]; evidence: string
  perspectiveUncertainty: string; exactProfileUncertainty: string
}
export type VisualConnection3D = {
  pieceA: string; pieceB: string; featureA: string|null; featureB: string|null
  relationship: 'shared_edge'|'occlusion'|'separate'|'uncertain'
  foldAngleCandidatesDeg: number[]; angleRange: {min:number;max:number}|null
  evidenceRefs: string[]; reasoning: string; uncertainty: string
}
export type SpatialUnderstanding3D = {
  camera: {viewpoint:'above'|'level'|'below'|'oblique'|'unknown';evidence:string;uncertainty:string}
  faces: {pieceId:string;orientation:'horizontal'|'vertical'|'inclined'|'unknown';evidenceRefs:string[];reasoning:string;uncertainty:string}[]
  connections: VisualConnection3D[]
  overallShapeHypotheses: {label:string;visiblePieceIds:string[];evidenceRefs:string[];reasoning:string;uncertainty:string}[]
  hiddenStructureHypotheses: {description:string;reasoning:string;uncertainty:string}[]
  alternatives: {label:string;description:string;evidenceRefs:string[];uncertainty:string}[]
  unknowns: string[]
}
const fail=(s:string):never=>{throw Error(s)}
export function fields(value:unknown,required:string[],optional:string[]=[]):void {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>![...required,...optional].includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail('Visible 3D 字段缺失或包含未支持字段')
}
const text=(s:unknown):void=>{if(typeof s!=='string'||s.length>4000)fail('空间解释文本无效')}
function array(value:unknown,max=48):asserts value is unknown[]{if(!Array.isArray(value)||value.length>max)fail('空间解释列表超出范围')}
const family=(s:unknown):void=>{if(!shapeFamilies.includes(s as ShapeFamily3D))fail('Shape Family 无效')}
export function assertShapeAssessment(s:ShapeAssessment3D):void{
  fields(s,['family','alternativeFamilies','evidence','perspectiveUncertainty','exactProfileUncertainty']);family(s.family);array(s.alternativeFamilies,6);s.alternativeFamilies.forEach(family)
  ;[s.evidence,s.perspectiveUncertainty,s.exactProfileUncertainty].forEach(text)
}
export function assertShapeReview(f:unknown,note:unknown):void{family(f);text(note)}
export function assertInterpretationReview(v:{status:string;note:string}):void{fields(v,['status','note']);if(!['unreviewed','accepted','corrected','rejected'].includes(v.status))fail('整体解释人工审核状态无效');text(v.note)}
export function assertSpatialUnderstanding(s:SpatialUnderstanding3D,observations:readonly {id:string;features:readonly {id:string}[]}[]):void{
  fields(s,['camera','faces','connections','overallShapeHypotheses','hiddenStructureHypotheses','alternatives','unknowns'])
  const ids=new Set(observations.map(o=>o.id)),refs=new Set(observations.flatMap(o=>[o.id,...o.features.map(f=>o.id+':'+f.id)]))
  function evidence(values:string[]){array(values,32);values.forEach(r=>{if(typeof r!=='string'||!refs.has(r))fail('空间解释证据引用不存在')})}
  function piece(id:string){if(!ids.has(id))fail('空间解释只能引用可见实例，禁止引入隐藏 Piece ID')}
  fields(s.camera,['viewpoint','evidence','uncertainty']);if(!['above','level','below','oblique','unknown'].includes(s.camera.viewpoint))fail('相机定性方向无效');text(s.camera.evidence);text(s.camera.uncertainty)
  array(s.faces,12);const faces=new Set<string>()
  for(const f of s.faces){fields(f,['pieceId','orientation','evidenceRefs','reasoning','uncertainty']);piece(f.pieceId);if(faces.has(f.pieceId))fail('重复面方向解释');faces.add(f.pieceId);if(!['horizontal','vertical','inclined','unknown'].includes(f.orientation))fail('面方向解释无效');evidence(f.evidenceRefs);text(f.reasoning);text(f.uncertainty)}
  array(s.connections);const pairs=new Set<string>()
  for(const c of s.connections){
    fields(c,['pieceA','pieceB','featureA','featureB','relationship','foldAngleCandidatesDeg','angleRange','evidenceRefs','reasoning','uncertainty']);piece(c.pieceA);piece(c.pieceB)
    const pair=[c.pieceA,c.pieceB].sort().join('|');if(c.pieceA===c.pieceB||pairs.has(pair))fail('重复或自连接空间解释');pairs.add(pair)
    for(const [id,feature] of [[c.pieceA,c.featureA],[c.pieceB,c.featureB]])if(feature!==null&&!observations.find(o=>o.id===id)?.features.some(f=>f.id===feature))fail('空间解释边角引用不存在')
    if(!['shared_edge','occlusion','separate','uncertain'].includes(c.relationship))fail('可见空间关系无效')
    array(c.foldAngleCandidatesDeg,9);if(c.foldAngleCandidatesDeg.some(n=>!Number.isFinite(n)||Math.abs(n)>180))fail('视觉折角候选无效')
    if(c.angleRange!==null){fields(c.angleRange,['min','max']);if(![c.angleRange.min,c.angleRange.max].every(n=>Number.isFinite(n)&&Math.abs(n)<=180)||c.angleRange.min>c.angleRange.max)fail('视觉折角区间无效')}
    evidence(c.evidenceRefs);text(c.reasoning);text(c.uncertainty)
  }
  array(s.overallShapeHypotheses,8);for(const h of s.overallShapeHypotheses){fields(h,['label','visiblePieceIds','evidenceRefs','reasoning','uncertainty']);array(h.visiblePieceIds,12);h.visiblePieceIds.forEach(piece);evidence(h.evidenceRefs);[h.label,h.reasoning,h.uncertainty].forEach(text)}
  array(s.hiddenStructureHypotheses,8);for(const h of s.hiddenStructureHypotheses){fields(h,['description','reasoning','uncertainty']);[h.description,h.reasoning,h.uncertainty].forEach(text)}
  array(s.alternatives,8);for(const a of s.alternatives){fields(a,['label','description','evidenceRefs','uncertainty']);evidence(a.evidenceRefs);[a.label,a.description,a.uncertainty].forEach(text)}
  array(s.unknowns,32);s.unknowns.forEach(text)
}

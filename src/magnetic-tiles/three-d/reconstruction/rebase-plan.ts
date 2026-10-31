import {adaptProfile} from '../profile-adapter.ts'
import {parseSpatialHypothesis,validateVisibleInput} from './contracts.ts'
import type {ConnectionHypothesis3D,SpatialHypothesis3D,VisibleInput3D,VisibleReview3D,ReviewedPiece3D} from './contracts.ts'
/** Explicit human continuation. Preserves old plan/trace, creates no poses or parts. */
export function rebaseSpatialPlan(old:SpatialHypothesis3D,previous:VisibleInput3D,input:VisibleInput3D){
 validateVisibleInput(input);parseSpatialHypothesis(old,previous)
 const diagnostics=['沿用旧空间假设并按当前人工 Review 适配；未重新调用模型，未认证照片匹配'],parts=input.review.pieces.filter(p=>p.confirmed&&!p.excluded),ids=new Set(parts.map(p=>p.id))
 function connections(values:ConnectionHypothesis3D[]){return values.filter(c=>{const keep=ids.has(c.pieceA)&&ids.has(c.pieceB);if(!keep)diagnostics.push(`移除未采用实例的旧连接 ${c.pieceA}/${c.pieceB}`);return keep}).map(original=>{
  const c=structuredClone(original)
  for(const side of ['A','B'] as const){const p=parts.find(p=>p.id===c[`piece${side}`])!,before=previous.review.pieces.find(o=>o.id===p.id),snapshot=input.profiles.find(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion)
   if(before?.profileId!==p.profileId||before?.profileVersion!==p.profileVersion||!snapshot||!adaptProfile(snapshot).shape.ports.some(p=>p.portId===c[`port${side}`])){c[`port${side}`]=null;diagnostics.push(`${p.id}: Profile/Port 已变化，旧端口对应置为 Unknown；需人工核对`)}
  }return c
 })}
 const plan:SpatialHypothesis3D={...structuredClone(old),parts:parts.map(p=>({id:p.id,profileId:p.profileId,profileVersion:p.profileVersion,orientationEvidence:old.parts.find(o=>o.id===p.id)?.orientationEvidence??'人工新增确认，方向未知'})),connections:connections(old.connections),alternatives:old.alternatives.map(a=>({...a,connections:connections(a.connections)})),relations:old.relations.filter(r=>ids.has(r.from)&&ids.has(r.to)),unknowns:structuredClone(old.unknowns)}
 if(plan.spatialInterpretation){const s=plan.spatialInterpretation;s.faces=s.faces.filter(f=>ids.has(f.pieceId)).map(f=>({...f,evidenceRefs:f.evidenceRefs.filter(r=>ids.has(r.split(':')[0]))}));s.connections=s.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB)).map(c=>({...c,evidenceRefs:c.evidenceRefs.filter(r=>ids.has(r.split(':')[0]))}));s.overallShapeHypotheses=s.overallShapeHypotheses.map(h=>({...h,visiblePieceIds:h.visiblePieceIds.filter(id=>ids.has(id)),evidenceRefs:h.evidenceRefs.filter(r=>ids.has(r.split(':')[0]))}));s.alternatives=s.alternatives.map(a=>({...a,evidenceRefs:a.evidenceRefs.filter(r=>ids.has(r.split(':')[0]))}))}
 return {plan:parseSpatialHypothesis(plan,input),diagnostics:[...new Set(diagnostics)]}
}

/** Review-local edits invalidate references; original saved snapshots stay immutable. */
export function editReviewedPiece(review:VisibleReview3D,id:string,patch:Partial<Omit<ReviewedPiece3D,'id'>>){
 const result=structuredClone(review),old=result.pieces.find(p=>p.id===id);if(!old)throw Error('Observation 不存在')
 const geometryChanged=patch.profileId!==undefined&&patch.profileId!==old.profileId||patch.profileVersion!==undefined&&patch.profileVersion!==old.profileVersion
 Object.assign(old,patch)
 if(!old.confirmed||old.excluded){result.constraints=result.constraints.filter(c=>c.pieceA!==id&&c.pieceB!==id);if(result.spatialChecks)result.spatialChecks=result.spatialChecks.filter(c=>c.pieceA!==id&&c.pieceB!==id)}
 else if(geometryChanged)result.constraints=result.constraints.map(c=>({...c,portA:c.pieceA===id?null:c.portA,portB:c.pieceB===id?null:c.portB}))
 return result
}

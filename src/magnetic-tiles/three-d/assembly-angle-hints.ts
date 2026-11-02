import {canonical} from '../build-plan.ts'
import {parseAssembly3D} from './assembly.ts'
import type {Assembly3D} from './assembly.ts'
import type {Connection} from './vendor/engine/types.ts'
import type {PhotoOrigin3D} from './reconstruction/adopt-draft.ts'
import type {SpatialHypothesis3D,ConnectionHypothesis3D,VisibleInput3D} from './reconstruction/contracts.ts'
import type {VisibleExecution3D} from './reconstruction/execute.ts'
import type {ConstraintRefinement,RefinementReference} from './reconstruction/constraint-refinement.ts'

type Ref={id:string;hash:string}
type Lineage={sourceId:string;sourceHash:string;analysisId?:string;analysisHash?:string;reviewId:string;reviewHash:string}
export type AnglePlanRecord=Ref&Lineage&{plan:SpatialHypothesis3D;reconstructionScope?:unknown}
export type AngleExecutionRecord=Ref&Lineage&VisibleExecution3D&{planId:string;planHash:string;reconstructionScope?:unknown;refinement?:RefinementReference}
export type AngleRefinementRecord=Ref&Lineage&{planId:string;planHash:string;refinement:ConstraintRefinement;candidateHashes:Record<string,string>}
export type AngleHintSource={executionId?:string;executionHash?:string;omittedConnections?:ConnectionHypothesis3D[];planId:string;originId:string;scope:string;plan:SpatialHypothesis3D;executedVariant:number|null;refined:boolean;reviewInput?:VisibleInput3D;original:Assembly3D;mapping:Map<string,string>}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b)
const pair=(a:string,b:string)=>[a,b].sort().join('|')
const fail=():never=>{throw Error('角度建议来源、Hash 或几何快照不一致；未显示其他 Plan 的建议')}
export function angleHintSourceKey(assembly:Assembly3D,sidecar:PhotoOrigin3D|null){
 if(!sidecar)return ''
 try{if(parseAssembly3D(sidecar.assemblyRaw).id!==assembly.id)return ''}catch{return ''}
 const o=sidecar.origin
 return typeof o.id==='string'&&typeof o.hash==='string'&&typeof o.planId==='string'&&typeof o.executionId==='string'?canonical([assembly.id,o.id,o.hash,o.planId,o.planHash,o.executionId,o.executionHash]):''
}
/** Read-only binding to immutable records fetched through existing lineage APIs.
 * Neither the Studio history selection nor current edited poses choose a Plan. */
export function bindAngleHintSource(sidecar:PhotoOrigin3D,storedOrigin:Record<string,unknown>,plan:AnglePlanRecord,execution:AngleExecutionRecord,refinement?:AngleRefinementRecord):AngleHintSource{
 const o=storedOrigin,original=parseAssembly3D(sidecar.assemblyRaw)
 if(!same(o,sidecar.origin)||!same(o.assembly,original)||plan.id!==o.planId||plan.hash!==o.planHash||execution.id!==o.executionId||execution.hash!==o.executionHash||execution.planId!==plan.id||execution.planHash!==plan.hash)fail()
 for(const k of ['sourceId','sourceHash','reviewId','reviewHash'] as const)if(!o[k]||plan[k]!==o[k]||execution[k]!==o[k])fail()
 for(const k of ['analysisId','analysisHash'] as const)if(!o[k]||plan[k]!==undefined&&plan[k]!==o[k])fail()
 if(!same(o.reconstructionScope??null,execution.reconstructionScope??null)||!same(plan.reconstructionScope??null,execution.reconstructionScope??null)||!same(o.refinement??null,execution.refinement??null))fail()
 const candidate=[...execution.candidates,...execution.diagnosticCandidates??[]].find(c=>c.id===o.candidateId)??fail()
 if(!candidate||!same({...candidate.assembly,id:original.id,revision:original.revision},original))fail()
 let executedVariant=candidate.construction?.variantIndex??null
 if(execution.refinement){
  const ref=execution.refinement
  refinement=refinement??fail()
  if(!refinement||refinement.id!==ref.id||refinement.hash!==ref.hash||refinement.planId!==plan.id||refinement.planHash!==plan.hash||refinement.reviewId!==plan.reviewId||refinement.reviewHash!==plan.reviewHash||refinement.sourceId!==plan.sourceId||refinement.sourceHash!==plan.sourceHash||refinement.candidateHashes[ref.candidateId]!==ref.candidateHash)fail()
  const refined=refinement.refinement.candidates.find(c=>c.id===ref.candidateId)??fail();executedVariant=refined.variantIndex
 }
 if(executedVariant!==null&&(!Number.isSafeInteger(executedVariant)||executedVariant<0||executedVariant>plan.plan.alternatives.length))fail()
 const mapping=new Map<string,string>(),used=new Set<string>()
 for(const m of (o.observationMap??[]) as {observationId:string;pieceId:string}[]){
  if(mapping.has(m.observationId)||used.has(m.pieceId)||!plan.plan.parts.some(p=>p.id===m.observationId)||!original.pieces.some(p=>p.id===m.pieceId))fail()
  mapping.set(m.observationId,m.pieceId);used.add(m.pieceId)
 }
 const scope=o.reconstructionScope as {groupName?:string;imageName?:string}|undefined
 return {executionId:execution.id,executionHash:execution.hash,omittedConnections:candidate.construction?.omittedHypotheses,planId:plan.id,originId:String(o.id),scope:scope?[scope.groupName,scope.imageName].filter(Boolean).join(' / '):'原记录未注明 Group / Image 范围',plan:plan.plan,executedVariant,refined:!!execution.refinement,original,mapping}
}
export type AngleComparison='in-range'|'out-of-range'|'suggested'|'other-angle'|'no-angle'|'not-comparable'|'unconnected'|'no-hint'
export type AngleHintRow={key:string;pieceA:string;pieceB:string;connectionIndex?:number;current?:Connection;hint?:ConnectionHypothesis3D;comparison:AngleComparison;reason?:string;angleInPlanDirection?:number;missingPieces?:string[]}
/** Plan angles are about A's original directed port. Reversing A/B negates the
 * signed angle only when flip=false, matching the existing Solver convention. */
export function comparePlanAngle(c:Connection,h:ConnectionHypothesis3D,reversed:boolean):Pick<AngleHintRow,'comparison'|'reason'|'angleInPlanDirection'>{
 if(h.intent==='separate')return {comparison:'not-comparable',reason:'Plan 描述为分离关系，不是已确认连接'}
 if(h.portA===null||h.portB===null)return {comparison:'not-comparable',reason:'Plan Port 未确定'}
 if(h.portA!==(reversed?c.portB:c.portA)||h.portB!==(reversed?c.portA:c.portB))return {comparison:'not-comparable',reason:'当前 Port 与 Plan 不同'}
 if(h.flip!==null&&h.flip!==(c.flip??false))return {comparison:'not-comparable',reason:'当前 Flip 与 Plan 不同'}
 const angle=reversed&&!(c.flip??false)?-c.dihedralDeg:c.dihedralDeg,values=[angle,angle-360,angle+360]
 if(h.angleRange)return {comparison:values.some(v=>v>=h.angleRange!.min&&v<=h.angleRange!.max)?'in-range':'out-of-range',angleInPlanDirection:angle}
 if(h.angles.length)return {comparison:h.angles.some(a=>values.includes(a))?'suggested':'other-angle',angleInPlanDirection:angle}
 return {comparison:'no-angle',angleInPlanDirection:angle}
}
export function assemblyAngleHintRows(a:Assembly3D,source:AngleHintSource,variantIndex:number):AngleHintRow[]{
 const variant=[{label:'primary',connections:source.plan.connections},...source.plan.alternatives][variantIndex]
 if(!variant)return []
 // Exact Observation IDs remain meaningful when an originally unresolved piece
 // is explicitly added later. No color, ordering or symmetry inference.
 const mapped=(id:string)=>source.mapping.get(id)??id
 const hypotheses=variant.connections.map((hint,i)=>({hint,i,a:mapped(hint.pieceA),b:mapped(hint.pieceB)})),represented=new Set<number>(),rows:AngleHintRow[]=[]
 function profileUnchanged(observationId:string,pieceId:string){
  const planned=source.plan.parts.find(p=>p.id===observationId),current=a.pieces.find(p=>p.id===pieceId)
  if(!planned||!current||planned.profileId!==current.profileId||planned.profileVersion!==current.profileVersion)return false
  const find=(assembly:Assembly3D)=>assembly.profiles.find(s=>s.profile.id===current.profileId&&s.profile.version===current.profileVersion)
  return same(find(a),find(source.original))
 }
 a.connections.forEach((c,index)=>{
  const matches=hypotheses.filter(h=>pair(h.a,h.b)===pair(c.pieceA,c.pieceB))
  const exact=matches.filter(h=>h.hint.portA===(c.pieceA===h.a?c.portA:c.portB)&&h.hint.portB===(c.pieceA===h.a?c.portB:c.portA))
  const match=exact.length===1?exact[0]:matches.length===1?matches[0]:undefined,base={key:'connection-'+index,pieceA:c.pieceA,pieceB:c.pieceB,current:c,connectionIndex:index}
  if(!match){rows.push({...base,comparison:'no-hint'});return}
  represented.add(match.i)
  const comparison=!profileUnchanged(match.hint.pieceA,match.a)||!profileUnchanged(match.hint.pieceB,match.b)?{comparison:'not-comparable' as const,reason:'当前 Profile / 几何快照与来源不同'}:comparePlanAngle(c,match.hint,c.pieceA!==match.a)
  rows.push({...base,hint:match.hint,...comparison})
 })
 for(const h of hypotheses)if(!represented.has(h.i))rows.push({key:'unconnected-'+h.i,pieceA:h.a,pieceB:h.b,hint:h.hint,comparison:'unconnected',missingPieces:[h.a,h.b].filter(id=>!a.pieces.some(p=>p.id===id))})
 return rows
}

import type {Assembly3D} from '../assembly.ts'
import type {VisibleInput3D} from './contracts.ts'
import {fields} from './spatial-understanding.ts'
import {inspectPieceGeometry,planeAngleDeg} from './pose-inspection.ts'
export type ReviewedSpatialCheck3D={
 id:string;pieceA:string;pieceB:string;relation:'plane-angle'|'shared-edge'|'occludes'|'above-in-image'
 minDeg:number|null;maxDeg:number|null;evidenceRefs:string[];note:string
}
export type ObservationPieceMap3D={observationId:string;pieceId:string}[]
export type SpatialConsistency3D={
 status:'consistent'|'contradicted'|'unverified';scope:'reviewed-relative-relations'
 checks:{id:string;pieces:string[];relation:string;status:'passed'|'contradicted'|'unverified';actualAngleDeg?:number;message:string}[]
 unverified:string[]
}
export function assertSpatialChecks(checks:ReviewedSpatialCheck3D[],input:VisibleInput3D){
 if(!Array.isArray(checks)||checks.length>48)throw Error('已审核空间检查列表无效')
 const ids=new Set(input.review.pieces.filter(p=>p.confirmed&&!p.excluded).map(p=>p.id)),seen=new Set<string>(),refs=new Set(input.evidence.observations.flatMap(o=>[o.id,...o.features.map(f=>o.id+':'+f.id)]))
 for(const c of checks){
  fields(c,['id','pieceA','pieceB','relation','minDeg','maxDeg','evidenceRefs','note'])
  if(typeof c.id!=='string'||!/^[-a-zA-Z0-9_.]{1,100}$/.test(c.id)||seen.has(c.id)||c.pieceA===c.pieceB||!ids.has(c.pieceA)||!ids.has(c.pieceB))throw Error('空间检查必须引用不同的已确认可见实例');seen.add(c.id)
  if(!['plane-angle','shared-edge','occludes','above-in-image'].includes(c.relation)||typeof c.note!=='string'||c.note.length>4000)throw Error('空间检查关系或说明无效')
  if(!Array.isArray(c.evidenceRefs)||c.evidenceRefs.length>32||c.evidenceRefs.some(r=>!refs.has(r)))throw Error('空间检查证据引用无效')
  if(c.relation==='plane-angle'){if(![c.minDeg,c.maxDeg].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=90)||c.minDeg!>c.maxDeg!)throw Error('无向面夹角范围须为 0..90°')}
  else if(c.minDeg!==null||c.maxDeg!==null)throw Error('非面夹角检查不能含角度范围')
 }
}
/** Explicit construction-time identity map; never inferred from hue or ordering. */
export function candidateObservationMap(assembly:Assembly3D,input:VisibleInput3D):ObservationPieceMap3D{
 return assembly.pieces.map(p=>{if(!input.review.pieces.some(o=>o.id===p.id&&o.confirmed&&!o.excluded))throw Error('Candidate Piece 不属于固定可见实例集合');return {observationId:p.id,pieceId:p.id}})
}
export function inspectSpatialConsistency(assembly:Assembly3D,input:VisibleInput3D,map=candidateObservationMap(assembly,input)):SpatialConsistency3D{
 const parts=inspectPieceGeometry(assembly),resolve=(id:string)=>parts.find(p=>p.id===map.find(m=>m.observationId===id)?.pieceId)
 const checks:SpatialConsistency3D['checks']=(input.review.spatialChecks??[]).map(c=>{
  const a=resolve(c.pieceA),b=resolve(c.pieceB),base={id:c.id,pieces:[c.pieceA,c.pieceB],relation:c.relation}
  if(!a||!b)return {...base,status:'unverified',message:'局部候选缺少对应可见实例，无法检查此关系'}
  if(c.relation==='plane-angle'){
   const actualAngleDeg=planeAngleDeg(a.normal,b.normal),passed=actualAngleDeg>=c.minDeg!-1e-5&&actualAngleDeg<=c.maxDeg!+1e-5
   return {...base,status:passed?'passed':'contradicted',actualAngleDeg,message:`实际无向面夹角 ${actualAngleDeg.toFixed(4)}°；人工确认范围 ${c.minDeg}..${c.maxDeg}°（不依赖世界轴或法向正负）`}
  }
  if(c.relation==='shared-edge'){
   const connected=assembly.connections.some(c=>(c.pieceA===a.id&&c.pieceB===b.id)||(c.pieceB===a.id&&c.pieceA===b.id))
   return {...base,status:connected?'passed':'contradicted',message:connected?'存在经原 Geometry Validator 检查的对应连接；具体照片边到 Port 的对应仍需人工核对':'确认的共享边未在候选 Connection Graph 中建立'}
  }
  return {...base,status:'unverified',message:c.relation==='occludes'?'遮挡/前后关系依赖相机和可见性，未作投影检查':'图片上下不等于世界高度；缺少相机标定，未执行高度约束'}
 })
 return {status:checks.some(c=>c.status==='contradicted')?'contradicted':checks.length&&checks.every(c=>c.status==='passed')?'consistent':'unverified',scope:'reviewed-relative-relations',checks,
 unverified:['相机、照片匹配、绝对世界朝向未验证；不会把 horizontal/vertical 直接绑定世界坐标',...(!checks.length?['没有逐项人工确认的相对空间检查；整体解释 accepted 不自动认证所有模型关系']:[]),...(input.evidence.spatialInterpretation?['Vision 的整体结构、面方向及未逐项确认的视觉关系保留为解释，未转为硬约束']:[])]}
}
export function observationState(id:string,input:VisibleInput3D,map:ObservationPieceMap3D){
 const p=input.review.pieces.find(p=>p.id===id)
 return p?.excluded?'excluded':!p?.confirmed?'unconfirmed':!p.profileId?'unknown-profile':map.some(m=>m.observationId===id)?'reconstructed':'unresolved'
}
/** For visual unsigned fold hints only; no claim about signed engine Dihedral. */
export function visualPlaneRange(min:number,max:number):[number,number]{
 const fold=(x:number)=>Math.acos(Math.abs(Math.cos(x*Math.PI/180)))*180/Math.PI
 const values=[fold(min),fold(max)];for(let n=-180;n<=180;n+=90)if(n>=min&&n<=max)values.push(fold(n))
 return [Math.min(...values),Math.max(...values)]
}

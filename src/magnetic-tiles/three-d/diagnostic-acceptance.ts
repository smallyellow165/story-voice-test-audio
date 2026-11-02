import {Quaternion,Vector3} from 'three'
import {canonical} from '../build-plan.ts'
import {assertAssembly3D} from './assembly.ts'
import type {Assembly3D} from './assembly.ts'
import type {ValidationIssue,ValidationResult} from './vendor/engine/types.ts'

/** Authorization evidence beside the existing Assembly, never a geometry flag.
 * The server constructs this from a verified immutable Diagnostic origin. */
export type AcceptedDiagnostic3D={
  version:1;origin:{id:string;hash:string};execution?:{id:string;hash:string};diagnostic?:{id:string;hash:string};parents?:import('./assembly.ts').AssemblyParent3D[];
  assembly:Assembly3D;geometry:ValidationResult;
}
// Numerical equivalence of rigid transforms only, NOT a Validator tolerance.
const EQUIVALENCE_EPS=1e-9
const connectionCodes=new Set(['loop-position-error','loop-direction-error','loop-dihedral-error','port-length'])
function scope(a:Assembly3D,i:ValidationIssue):{ids:string[];feature:string}|null{
  if(i.severity!=='error')return null
  let ids:string[]=[],feature:unknown
  if(i.code==='intersection'){
    if(i.relatedPieceIds?.length!==2||new Set(i.relatedPieceIds).size!==2||!Number.isFinite(i.penetrationDepth)||i.penetrationDepth!<=0)return null
    ids=[...i.relatedPieceIds].sort();feature={code:i.code,ids}
  }else if(connectionCodes.has(i.code??'')){
    const c=i.connectionIndex===undefined?undefined:a.connections[i.connectionIndex]
    if(!c)return null
    ids=[c.pieceA,c.pieceB].sort();feature={code:i.code,connection:c}
  }else if(i.code==='port-reuse'){
    if(!i.pieceId||!i.portId||!i.relatedPieceIds?.length)return null
    ids=[...new Set([i.pieceId,...i.relatedPieceIds])].sort();feature={code:i.code,pieceId:i.pieceId,portId:i.portId,edgeId:i.edgeId,ids}
  }else return null // Unknown/unlocatable/other workflow errors fail closed.
  if(ids.length<2||ids.some(id=>!a.pieces.some(p=>p.id===id)))return null
  return {ids,feature:canonical(feature)}
}
const incident=(a:Assembly3D,ids:string[],present?:Set<string>)=>a.connections
  .filter(c=>(ids.includes(c.pieceA)||ids.includes(c.pieceB))&&(!present||present.has(c.pieceA)&&present.has(c.pieceB)))
  .map(c=>canonical(c)).sort()
function sameRelation(a:Assembly3D,baseline:Assembly3D,ids:string[],partial:boolean){
  const currentIds=new Set(a.pieces.map(p=>p.id))
  if(canonical(incident(a,ids))!==canonical(incident(baseline,ids,partial?currentIds:undefined)))return false
  const root=a.pieces.find(p=>p.id===ids[0])!,oldRoot=baseline.pieces.find(p=>p.id===ids[0])
  if(!oldRoot)return false
  const q=new Quaternion(...root.pose.quaternion).invert(),oldQ=new Quaternion(...oldRoot.pose.quaternion).invert()
  for(const id of ids){
    const p=a.pieces.find(p=>p.id===id)!,old=baseline.pieces.find(p=>p.id===id)
    if(!old||p.profileId!==old.profileId||p.profileVersion!==old.profileVersion)return false
    const profile=a.profiles.find(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion)
    const oldProfile=baseline.profiles.find(s=>s.profile.id===old.profileId&&s.profile.version===old.profileVersion)
    if(canonical(profile)!==canonical(oldProfile))return false
    const pos=new Vector3(...p.pose.position).sub(new Vector3(...root.pose.position)).applyQuaternion(q)
    const oldPos=new Vector3(...old.pose.position).sub(new Vector3(...oldRoot.pose.position)).applyQuaternion(oldQ)
    const rot=q.clone().multiply(new Quaternion(...p.pose.quaternion)),oldRot=oldQ.clone().multiply(new Quaternion(...old.pose.quaternion))
    // Compare quaternion components after choosing a common sign; dot/acos
    // alone loses precision for very small but actual relative rotations.
    const sign=rot.dot(oldRot)<0?-1:1
    if(pos.distanceTo(oldPos)>EQUIVALENCE_EPS||rot.toArray().some((v,j)=>Math.abs(v-sign*oldRot.toArray()[j])>EQUIVALENCE_EPS))return false
  }
  return true
}
/** A partial Tutorial may omit unbuilt joints, but must be an exact induced
 * subset of the current server-authorized Assembly (checked by its caller).
 * Normal Draft edits always compare the complete incident connection set. */
export function acceptedDiagnosticErrors(a:Assembly3D,report:ValidationResult,acceptance:AcceptedDiagnostic3D,partial=false){
  assertAssembly3D(a);assertAssembly3D(acceptance.assembly)
  const errors=report.issues.filter(i=>i.severity==='error'),accepted:ValidationIssue[]=[],blockers:ValidationIssue[]=[]
  if(acceptance.version!==1||a.id!==acceptance.assembly.id)return {accepted,blockers:errors,complete:!errors.length}
  for(const i of errors){
    const s=scope(a,i)
    const old=s&&acceptance.geometry.issues.filter(o=>o.severity==='error').find(o=>{
      const prior=scope(acceptance.assembly,o)
      return prior?.feature===s.feature&&(i.code!=='intersection'||Math.abs(i.penetrationDepth!-o.penetrationDepth!)<=EQUIVALENCE_EPS)
    })
    if(s&&old&&sameRelation(a,acceptance.assembly,s.ids,partial))accepted.push(i);else blockers.push(i)
  }
  return {accepted,blockers,complete:!blockers.length}
}
export function diagnosticAcceptanceEligibility(a:Assembly3D,report:ValidationResult){
  assertAssembly3D(a)
  const errors=report.issues.filter(i=>i.severity==='error'),blockers=errors.filter(i=>!scope(a,i))
  // Ambiguous repeated descriptors cannot be tracked reliably across versions.
  const keys=errors.map(i=>scope(a,i)?.feature),duplicate=keys.some((k,j)=>k&&keys.indexOf(k)!==j)
  return {eligible:!report.valid&&errors.length>0&&!blockers.length&&!duplicate,blockers:duplicate?errors:blockers}
}

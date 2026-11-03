import {Quaternion,Vector3} from 'three'
import type {Assembly3D} from './assembly.ts'
import {createViewerModel} from './viewer-model.ts'
import {moduleBounds,moduleCenter,moduleById} from './module-transform.ts'
import type {ModulePreview} from './module-transform.ts'
import {validateAssembly3D} from './engine-adapter.ts'
import {collisionErrorKey} from './human-collision-policy.ts'
import {computeAllConnectionResiduals,portWorldEndpoints} from './vendor/engine/solver.ts'

/** Explicit session intent, independent of the Tile subsequently chosen for Snap.
 * Never inferred from colour, a saved pose, Group frame, or Snap's Moving Tile. */
export type SnapOrientationTarget={groupId:string;pieceId:string;direction:'up'|'front'}
const degrees=180/Math.PI
export const orientationAxis=(direction:SnapOrientationTarget['direction'])=>direction==='up'?new Vector3(0,1,0):new Vector3(0,0,1)
export function faceWorldNormal(a:Assembly3D,pieceId:string){
 const p=a.pieces.find(p=>p.id===pieceId);if(!p)throw Error('方向参考 Tile 不存在')
 return new Vector3(0,0,1).applyQuaternion(new Quaternion(...p.pose.quaternion)).normalize()
}
const pairKey=(ids:readonly string[])=>JSON.stringify([...ids].sort())
/** Read-only projection of the EXISTING solver / strict Validator results.
 * A directed segment correspondence plus signed dihedral fixes a single SE(3)
 * pose. Flip/angle changes are different inputs, never alternative candidates. */
export function moduleSnapDiagnostics(before:Assembly3D,preview:ModulePreview,movingId:string,fixedId:string,target?:SnapOrientationTarget,acceptedKeys:readonly string[]=[],beforeReport=validateAssembly3D(before)){
 const c=preview.connection;if(!c)throw Error('需要 Module Snap 预览')
 const next=preview.assembly,models=createViewerModel(next),transforms=Object.fromEntries(models.map(p=>[p.id,p.transform])),getShape=(id:string)=>models.find(p=>p.id===id)?.shape
 const residual=computeAllConnectionResiduals([c],transforms,getShape)[0]
 const fixedPort=portWorldEndpoints(c.pieceA,c.portA,transforms,getShape)
 if(!residual||!fixedPort)throw Error('指定 Canonical Port 不存在')
 const oldPose=before.pieces.find(p=>p.id===c.pieceB)!.pose,newPose=next.pieces.find(p=>p.id===c.pieceB)!.pose
 const rotationDeg=new Quaternion(...oldPose.quaternion).angleTo(new Quaternion(...newPose.quaternion))*degrees
 const bottomGapBefore=moduleBounds(before,movingId).min.y-moduleBounds(before,fixedId).min.y
 const bottomGap=moduleBounds(next,movingId).min.y-moduleBounds(next,fixedId).min.y
 const pivotDistance=moduleCenter(before,movingId).distanceTo(moduleCenter(next,movingId))
 const belongs=new Map(before.modules!.flatMap(m=>m.pieces.map(p=>[p.id,m.id] as const)))
 const intersections=(report:ModulePreview['geometry'])=>report.issues.filter(i=>i.severity==='error'&&i.code==='intersection')
 const old=intersections(beforeReport),after=intersections(preview.geometry),oldPairs=new Set(old.map(i=>pairKey(i.relatedPieceIds??[]))),afterPairs=new Set(after.map(i=>pairKey(i.relatedPieceIds??[])))
 const isCross=(ids:readonly string[])=>ids.length===2&&belongs.get(ids[0])!==belongs.get(ids[1])
 const added=after.filter(i=>!oldPairs.has(pairKey(i.relatedPieceIds??[])))
 const collisions={before:old.length,retained:after.filter(i=>oldPairs.has(pairKey(i.relatedPieceIds??[]))).length,removed:old.filter(i=>!afterPairs.has(pairKey(i.relatedPieceIds??[]))).length,
  // Acceptance describes ONLY the authoritative input snapshot. It is not
  // propagated by pair identity and never grants acceptance to this preview.
  acceptedBefore:old.filter(i=>acceptedKeys.includes(collisionErrorKey(i))).length,
  newCross:added.filter(i=>isCross(i.relatedPieceIds??[])).length,newInternal:added.filter(i=>!isCross(i.relatedPieceIds??[])).length,
  newCrossMaxDepth:Math.max(0,...added.filter(i=>isCross(i.relatedPieceIds??[])).map(i=>i.penetrationDepth??0)),
  changedCross:after.filter(i=>isCross(i.relatedPieceIds??[])&&oldPairs.has(pairKey(i.relatedPieceIds??[]))&&!old.some(o=>collisionErrorKey(o)===collisionErrorKey(i))).length}
 const reference=target?.groupId===movingId&&moduleById(before,movingId).pieces.some(p=>p.id===target.pieceId)?target:undefined
 let orientation:undefined|{target:SnapOrientationTarget;normal:number[];beforeAngleDeg:number;angleDeg:number;requiredDihedralDeg:number|null}
 if(reference){
  const normal=faceWorldNormal(next,reference.pieceId),goal=orientationAxis(reference.direction),axis=fixedPort.dir
  // Exact hinge freedom ONLY when changing the explicitly prescribed angle.
  // Rotation about A cannot change a normal's axial component. No sampling.
  const axial=normal.dot(axis),goalAxial=goal.dot(axis),p=normal.clone().addScaledVector(axis,-axial),q=goal.clone().addScaledVector(axis,-goalAxial)
  let requiredDihedralDeg:number|null=null
  if(Math.abs(axial-goalAxial)<1e-9&&p.lengthSq()>1e-16&&q.lengthSq()>1e-16){
   p.normalize();q.normalize();const delta=Math.atan2(axis.dot(p.clone().cross(q)),p.dot(q))*degrees,total=c.dihedralDeg+delta
   requiredDihedralDeg=Math.atan2(Math.sin(total/degrees),Math.cos(total/degrees))*degrees
  }
  orientation={target:reference,normal:normal.toArray(),beforeAngleDeg:faceWorldNormal(before,reference.pieceId).angleTo(goal)*degrees,angleDeg:normal.angleTo(goal)*degrees,requiredDihedralDeg}
 }
 const connectionErrors=preview.geometry.issues.filter(i=>i.severity==='error'&&i.code!=='intersection')
 return {residual,rotationDeg,pivotDistance,bottomGapBefore,bottomGap,orientation,collisions,connectionErrors,geometryValid:preview.geometry.valid}
}

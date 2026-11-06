import {Quaternion,Vector3} from 'three'
import {canonical} from '../build-plan.ts'
import {serializeAssembly3D} from './assembly.ts'
import type {Assembly3D} from './assembly.ts'
import {moduleCenter} from './module-transform.ts'
import type {MoveConstraint} from './move-controls.ts'
import {parentModule} from './combined-editing.ts'
import {createViewerModel} from './viewer-model.ts'
import {portWorldEndpoints,computeTransformFromConnection} from './vendor/engine/solver.ts'
import {portsCompatible} from './vendor/editor/snap.ts'
import {portPairKey} from './vendor/engine/port-compatibility.ts'
import {previewSnapSession,confirmSnapSession} from './snap-session.ts'
import type {SnapRequest,SnapSessionPreview} from './snap-session.ts'
import type {EdgeSnapMode} from './editor-snap.ts'
import {validateAssembly3D} from './engine-adapter.ts'
import {commit} from './vendor/editor/state.ts'
import type {EditorHistory} from './vendor/editor/state.ts'

export type MoveObject={kind:'tile';tileId:string}|{kind:'group';groupId:string}
export type MoveObjectCandidate={key:string;request:SnapRequest;distance:number;rotationDeg:number;score:number;preview?:SnapSessionPreview;error?:string}
export type ObjectMoveConstraint={axes:MoveConstraint;origin:Vector3;orientation:Quaternion}
export type MoveObjectSearch={candidates:MoveObjectCandidate[];automaticKey:string|null;total:number}
export type MoveObjectSession={sourceRaw:string;moving:MoveObject;raw:Assembly3D;dragged:Assembly3D;search:MoveObjectSearch;selectedKey:string|null;released:boolean}
export const objectCandidate=(s:MoveObjectSession|null)=>s?.search.candidates.find(c=>c.key===s.selectedKey)
export const objectCollisions=(p:SnapSessionPreview)=>p.geometry.issues.filter(i=>i.severity==='error'&&i.code==='intersection')
export function movingObjectIds(a:Assembly3D,moving:MoveObject){
 if(moving.kind==='group'){
  const m=a.modules?.find(m=>m.id===moving.groupId);if(!m)throw Error('请选择当前作品的 Moving Group')
  return new Set(m.pieces.map(p=>p.id))
 }
 if(!a.pieces.some(p=>p.id===moving.tileId)||parentModule(a,moving.tileId))throw Error('Moving 必须是可编辑的独立 Tile；Parent 成员请使用 Group')
 return new Set([moving.tileId])
}

/** Candidate discovery only. The existing Solver supplies every target Pose;
 * the existing Snap session supplies all validation and the eventual commit.
 * Move preserves the user's orientation: corrections above 12° are not proposed. */
export function createMoveObjectSearch(source:Assembly3D,moving:MoveObject){
 const ids=movingObjectIds(source,moving),models=createViewerModel(source),byId=new Map(models.map(m=>[m.id,m])),getShape=(id:string)=>byId.get(id)?.shape
 const fixedTransforms=Object.fromEntries(models.map(p=>[p.id,p.transform]))
 const fixed=models.filter(m=>!ids.has(m.id)).flatMap(m=>m.shape.ports.map(port=>({id:m.id,port,world:portWorldEndpoints(m.id,port.portId,fixedTransforms,getShape)!})))
 const existing=new Set(source.connections.map(portPairKey)),cache=new Map<string,{preview?:SnapSessionPreview;error?:string}>()
 return (raw:Assembly3D,mode:EdgeSnapMode,constraint?:ObjectMoveConstraint):MoveObjectSearch=>{
  const live=Object.fromEntries(raw.pieces.filter(p=>ids.has(p.id)).map(p=>[p.id,{position:new Vector3(...p.pose.position),quaternion:new Quaternion(...p.pose.quaternion)}]))
  const near:MoveObjectCandidate[]=[]
  for(const id of ids)for(const port of getShape(id)!.ports){
   const B=portWorldEndpoints(id,port.portId,live,getShape);if(!B)continue
   for(const f of fixed){
    if(!portsCompatible(port,f.port))continue
    for(const flip of [false,true]){
     const direction=flip?B.dir.clone().negate():B.dir
     if(direction.dot(f.world.dir)<Math.cos(12*Math.PI/180))continue
     const distance=(B.p0.distanceTo(flip?f.world.p1:f.world.p0)+B.p1.distanceTo(flip?f.world.p0:f.world.p1))/2
     if(distance>port.length*.35)continue
     // Same signed A-axis convention as Connection Rotate / residual diagnostics.
     // This proposes the closest dihedral to the current orientation, not a new solver.
     const normal=B.normal.clone().addScaledVector(f.world.dir,-B.normal.dot(f.world.dir));if(normal.lengthSq()<1e-12)continue;normal.normalize()
     const angle=Math.atan2(f.world.normal.clone().cross(normal).dot(f.world.dir),f.world.normal.dot(normal))*180/Math.PI
     const dihedralDeg=Number(angle.toFixed(8)),c={pieceA:f.id,portA:f.port.portId,pieceB:id,portB:port.portId,dihedralDeg,flip}
     if(existing.has(portPairKey(c)))continue
     const tf=computeTransformFromConnection(fixedTransforms[f.id],getShape(f.id)!,c.portA,getShape(id)!,c.portB,dihedralDeg,flip)
     if(!tf)continue
     const rotationDeg=tf.quaternion.angleTo(live[id].quaternion)*180/Math.PI;if(rotationDeg>12+1e-7)continue
     const request:SnapRequest={moving:{kind:moving.kind,groupId:moving.kind==='group'?moving.groupId:'',tileId:id,portId:port.portId},fixed:{kind:'tile',groupId:parentModule(source,f.id)?.id??'',tileId:f.id,portId:f.port.portId},dihedralDeg,flip,mode}
     near.push({key:canonical(request),request,distance,rotationDeg,score:distance/port.length+rotationDeg/180})
    }
   }
  }
  near.sort((a,b)=>a.score-b.score||a.key.localeCompare(b.key))
  const candidates=near.slice(0,12).map(c=>{
   let checked=cache.get(c.key)
   if(!checked){
    try{
     const relaxed=previewSnapSession(source,{...c.request,mode:'less-strict'})
     if(mode==='strict'&&objectCollisions(relaxed).length)checked={preview:{...relaxed,mode,request:c.request},error:'Strict 阻断实体碰撞；原 Draft 保留。'}
     else checked={preview:mode==='strict'?previewSnapSession(source,c.request):relaxed}
    }catch(e){checked={error:String(e)}}
    cache.set(c.key,checked);if(cache.size>64)cache.delete(cache.keys().next().value!)
   }
   let axisError:string|undefined
   if(constraint&&constraint.axes!=='XYZ'&&checked.preview){const a=checked.preview.assembly,target=moving.kind==='group'?moduleCenter(a,moving.groupId):new Vector3(...a.pieces.find(p=>p.id===moving.tileId)!.pose.position),delta=target.sub(constraint.origin).applyQuaternion(constraint.orientation.clone().invert());if(['X','Y','Z'].some((axis,i)=>!constraint.axes.includes(axis)&&Math.abs(delta.getComponent(i))>1e-7))axisError='当前轴约束不允许此吸附；可取消并切换 XYZ 或调整位置。'}
   return{...c,...checked,...(axisError?{error:checked.error??axisError}:{})}
  })
  // Close competitors are explicitly ambiguous, including different Ports at the same seam.
  const clear=candidates.length&&(!near[1]||near[1].score-near[0].score>.08)
  return{candidates,automaticKey:clear?candidates[0].key:null,total:near.length}
 }
}
export function confirmMoveObjectSnap(h:EditorHistory,s:MoveObjectSession){
 const c=objectCandidate(s)
 if(c&&(s.moving.kind!==c.request.moving.kind||(s.moving.kind==='group'?s.moving.groupId!==c.request.moving.groupId:s.moving.tileId!==c.request.moving.tileId)))throw Error('Moving 范围已变化，未应用')
 if(!s.released||s.sourceRaw!==serializeAssembly3D(h.current)||!c?.preview||c.error)throw Error('对象吸附不可确认或输入已变化；原 Draft 保留')
 const checked=previewSnapSession(h.current,c.request)
 if(c.request.mode==='strict'&&objectCollisions(checked).length)throw Error('Strict 阻断实体碰撞')
 return confirmSnapSession(h,checked,c.request)
}
/** Ordinary Move fallback creates no Connection, and never breaks existing ones.
 * Only used while Object Snap is enabled; the original Move path is untouched. */
export function confirmObjectMoveFallback(h:EditorHistory,sourceRaw:string,raw:Assembly3D,moving:MoveObject){
 if(sourceRaw!==serializeAssembly3D(h.current))throw Error('Move 输入已变化，未应用')
 const a=h.current,ids=movingObjectIds(a,moving)
 const metadata=(v:Assembly3D)=>({...v,pieces:v.pieces.map(p=>({...p,pose:ids.has(p.id)?null:p.pose})),modules:v.modules?.map(m=>({...m,frame:moving.kind==='group'&&m.id===moving.groupId?null:m.frame}))})
 if(canonical(metadata(a))!==canonical(metadata(raw)))throw Error('Move 不能修改 Fixed、Profile 或 Connection')
 const errors=validateAssembly3D(raw).issues.filter(i=>i.severity==='error'&&i.code!=='intersection')
 if(errors.length)throw Error('Move 会破坏已有连接，未应用：'+errors.map(i=>i.message).join('；'))
 return commit(h,()=>raw)
}

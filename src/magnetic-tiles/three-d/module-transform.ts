import {Box3,Quaternion,Vector3} from 'three'
import {assertAssembly3D,assertPose3D,serializeAssembly3D,fromEnginePose} from './assembly.ts'
import type {Assembly3D,AssemblyParent3D,ModulePlacement3D,Pose3D} from './assembly.ts'
import {createViewerModel} from './viewer-model.ts'
import {pieceWorldVertices} from './vendor/components/magnet3d/cameraUtils.ts'
import {edgeSnapTransform} from './editor-snap.ts'
import {validateAssembly3D} from './engine-adapter.ts'
import type {Connection} from './vendor/engine/types.ts'
import {canonical} from '../build-plan.ts'
export const IDENTITY_FRAME:Pose3D={position:[0,0,0],quaternion:[0,0,0,1]}
export type ModuleSpace='global'|'local'|'face'
export type ModulePreview={sourceRaw:string;assembly:Assembly3D;geometry:ReturnType<typeof validateAssembly3D>;connection?:Connection}
export function combineAssemblySnapshots(id:string,parents:{name:string;parent:AssemblyParent3D;assembly:Assembly3D}[]):Assembly3D{
 if(parents.length<2||parents.length>8||new Set(parents.map(p=>p.parent.id)).size!==parents.length)throw Error('请选择 2–8 个不同的已保存作品')
 const a:Assembly3D={kind:'magnetic-assembly-3d',schemaVersion:1,id,revision:0,profiles:[],pieces:[],connections:[],modules:[]}
 parents.forEach((p,index)=>{
  assertAssembly3D(p.assembly);const mapped=new Map<string,string>(),module:ModulePlacement3D={id:`module-${index}`,name:p.name,parent:p.parent,pieces:[],frame:structuredClone(IDENTITY_FRAME)}
  for(const profile of p.assembly.profiles){const old=a.profiles.find(s=>s.profile.id===profile.profile.id&&s.profile.version===profile.profile.version);if(old&&canonical(old)!==canonical(profile))throw Error('相同 Profile 版本的实体快照不一致');if(!old)a.profiles.push(structuredClone(profile))}
  p.assembly.pieces.forEach((piece,j)=>{const id=`m${index}-p${j}-${piece.id.slice(0,96)}`;mapped.set(piece.id,id);module.pieces.push({id,sourceId:piece.id});a.pieces.push({...structuredClone(piece),id})})
  a.connections.push(...p.assembly.connections.map(c=>({...c,pieceA:mapped.get(c.pieceA)!,pieceB:mapped.get(c.pieceB)!})));a.modules!.push(module)
 });assertAssembly3D(a);return a
}
export function moduleById(a:Assembly3D,id:string){const m=a.modules?.find(m=>m.id===id);if(!m)throw Error('请选择当前 Combined Draft 的模块');return m}
export function moduleCenter(a:Assembly3D,id:string){const ids=new Set(moduleById(a,id).pieces.map(p=>p.id)),box=new Box3();for(const p of createViewerModel(a).filter(p=>ids.has(p.id)))for(const v of pieceWorldVertices(p.shape,p.transform.position,p.transform.quaternion))box.expandByPoint(v);if(box.isEmpty())throw Error('模块没有可用几何');return box.getCenter(new Vector3())}
export function moduleOrientation(a:Assembly3D,id:string,space:ModuleSpace,faceId?:string){const m=moduleById(a,id);if(space==='global')return new Quaternion();if(space==='local')return new Quaternion(...m.frame.quaternion);const p=a.pieces.find(p=>p.id===faceId&&m.pieces.some(x=>x.id===p.id));if(!p)throw Error('Face 坐标需要选择当前移动模块的参考 Tile');return new Quaternion(...p.pose.quaternion)}
export function modulePivot(a:Assembly3D,id:string,space:ModuleSpace,faceId?:string):Pose3D{return {position:moduleCenter(a,id).toArray(),quaternion:moduleOrientation(a,id,space,faceId).toArray()}}
export function pivotDelta(start:Pose3D,target:Pose3D):Pose3D{assertPose3D(start);assertPose3D(target);const q=new Quaternion(...target.quaternion).multiply(new Quaternion(...start.quaternion).invert()).normalize(),t=new Vector3(...target.position).sub(new Vector3(...start.position).applyQuaternion(q));return {position:t.toArray(),quaternion:q.toArray()}}
/** A single SE(3) action on all module members. No solver propagation/re-grounding. */
export function transformModule(a:Assembly3D,id:string,delta:Pose3D):Assembly3D{
 assertPose3D(delta);const m=moduleById(a,id),ids=new Set(m.pieces.map(p=>p.id)),q=new Quaternion(...delta.quaternion),t=new Vector3(...delta.position),next=structuredClone(a)
 for(const p of next.pieces)if(ids.has(p.id)){p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(t).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).normalize().toArray()}
 const frame=moduleById(next,id).frame;frame.position=new Vector3(...frame.position).applyQuaternion(q).add(t).toArray();frame.quaternion=q.clone().multiply(new Quaternion(...frame.quaternion)).normalize().toArray();assertAssembly3D(next);return next
}
export function moduleStep(a:Assembly3D,id:string,kind:'translate'|'rotate',axis:'x'|'y'|'z',value:number,space:ModuleSpace,faceId?:string){
 if(!Number.isFinite(value))throw Error('位移 / 角度必须为有限数');const direction=new Vector3(axis==='x'?1:0,axis==='y'?1:0,axis==='z'?1:0).applyQuaternion(moduleOrientation(a,id,space,faceId));if(kind==='translate')return transformModule(a,id,{position:direction.multiplyScalar(value).toArray(),quaternion:[0,0,0,1]});const q=new Quaternion().setFromAxisAngle(direction,value*Math.PI/180),pivot=moduleCenter(a,id);return transformModule(a,id,{position:pivot.clone().sub(pivot.clone().applyQuaternion(q)).toArray(),quaternion:q.toArray()})
}
export function alignModuleFace(a:Assembly3D,id:string,faceId:string,direction:'up'|'front'){
 const face=moduleOrientation(a,id,'face',faceId),normal=new Vector3(0,0,1).applyQuaternion(face),target=direction==='up'?new Vector3(0,1,0):new Vector3(0,0,1)
 // Minimal rotation; antiparallel case uses Three's deterministic orthogonal axis.
 const q=new Quaternion().setFromUnitVectors(normal,target),pivot=moduleCenter(a,id);return transformModule(a,id,{position:pivot.clone().sub(pivot.clone().applyQuaternion(q)).toArray(),quaternion:q.toArray()})
}
export function previewModuleTransform(a:Assembly3D,next:Assembly3D):ModulePreview{return {sourceRaw:serializeAssembly3D(a),assembly:next,geometry:validateAssembly3D(next)}}
export function previewModuleSnap(a:Assembly3D,movingId:string,fixedId:string,c:Connection):ModulePreview{
 if(movingId===fixedId)throw Error('固定模块与移动模块必须不同');const moving=moduleById(a,movingId),fixed=moduleById(a,fixedId)
 if(!moving.pieces.some(p=>p.id===c.pieceB)||!fixed.pieces.some(p=>p.id===c.pieceA))throw Error('两个 Port 必须分别属于移动模块 B 与固定模块 A')
 const old=a.pieces.find(p=>p.id===c.pieceB)!,target=fromEnginePose(edgeSnapTransform(a,c)),next=transformModule(a,movingId,pivotDelta(old.pose,target));next.connections.push(structuredClone(c));return {...previewModuleTransform(a,next),connection:c}
}
export function assertModuleConnections(preview:ModulePreview){const errors=preview.geometry.issues.filter(i=>i.severity==='error'&&i.code!=='intersection');if(errors.length)throw Error('模块连接验证失败：'+errors.map(i=>`${i.code}: ${i.message}`).join('；'))}
export function confirmModulePreview(a:Assembly3D,preview:ModulePreview){if(serializeAssembly3D(a)!==preview.sourceRaw)throw Error('模块预览已过期，未应用');const fresh=previewModuleTransform(a,preview.assembly);if(canonical(fresh.geometry)!==canonical(preview.geometry))throw Error('模块预览诊断不一致');assertModuleConnections(fresh);return structuredClone(preview.assembly)}

/** Provenance check at save/review/Build trust boundaries; frames are editable. */
export function assertModuleOrigin(a:Assembly3D,origin:{kind?:unknown;assembly?:unknown}){
 if(origin.kind==='combined-assembly'){
  const baseline=origin.assembly as Assembly3D
  if(!a.modules||canonical(a.modules.map(({frame,...m})=>m))!==canonical(baseline?.modules?.map(({frame,...m})=>m)))throw Error('Combined Parent 与模块成员不可重绑')
 }else if(a.modules)throw Error('模块布局必须属于独立 Combined Assembly')
}

import {Vector2,Vector3,Raycaster} from 'three'
import type {Camera,Object3D} from 'three'
import type {ViewerPiece} from './viewer-model.ts'
import type {AnnotationPiece} from './AssemblyAnnotations.tsx'
export type ModuleSnapSelection={fixedTile:string;fixedPort:string;movingPort:string}
export type SnapPicker='fixed-tile'|'fixed-port'|'moving-tile'|'moving-port'
export type SnapViewport={picker:SnapPicker|null;fixed:{tileId:string;portId:string;members:string[]};moving:{tileId:string;portId:string;members:string[]};onPick:(tileId:string,portId?:string)=>void}

/** Selection validation only; no pose, connection or solver operations. */
export function validSnapPort(models:readonly Pick<ViewerPiece,'id'|'shape'>[],tileId:string,portId:string){return models.find(p=>p.id===tileId)?.shape.ports.some(p=>p.portId===portId)?portId:''}
export function normalizeModuleSnapSelection(models:readonly Pick<ViewerPiece,'id'|'shape'>[],fixedMembers:readonly string[],movingTile:string,s:ModuleSnapSelection):ModuleSnapSelection{
 const fixedTile=fixedMembers.includes(s.fixedTile)?s.fixedTile:fixedMembers[0]??''
 return {fixedTile,fixedPort:validSnapPort(models,fixedTile,s.fixedPort),movingPort:validSnapPort(models,movingTile,s.movingPort)}
}
/** Camera-facing surface feedback for the actual canonical segment, not screen-side edge names. */
export function snapPortSegment(piece:AnnotationPiece,portId:string,camera:Camera){
 const port=piece.shape.ports.find(p=>p.portId===portId);if(!port)return null
 const normal=new Vector3(0,0,1).applyQuaternion(piece.transform.quaternion),toward=camera.getWorldDirection(new Vector3()).negate()
 const offset=normal.multiplyScalar((normal.dot(toward)>=0?1:-1)*(piece.shape.thickness/2+.001))
 const world=(v:{x:number;y:number})=>new Vector3(v.x,v.y,0).applyQuaternion(piece.transform.quaternion).add(piece.transform.position).add(offset)
 return {portId,p0:world(port.p0),p1:world(port.p1)}
}
export function tileOwner(object:Object3D){let current:Object3D|null=object;while(current){if(current.userData.tileId)return String(current.userData.tileId);current=current.parent}return ''}
export function solidHits(ray:Raycaster,solids:Object3D){return ray.intersectObject(solids,true).filter(h=>{const o=h.object as {isMesh?:boolean;isLineSegments2?:boolean};return o.isMesh&&!o.isLineSegments2})}
export function pickSnapTile(ray:Raycaster,solids:Object3D,members:readonly string[]){
 const hits=solidHits(ray,solids),first=hits[0];if(!first)return null
 const id=tileOwner(first.object)
 if(!members.includes(id)||hits.some(h=>Math.abs(h.distance-first.distance)<1e-6&&tileOwner(h.object)!==id))return null
 return id
}
/** Conservative screen-space hit area + real solid occlusion. Multiple visible segments never guess a winner. */
export function pickSnapPort(piece:AnnotationPiece,camera:Camera,size:{width:number;height:number},pointer:Vector2,solids:Object3D,ray=new Raycaster()){
 const normal=new Vector3(0,0,1).applyQuaternion(piece.transform.quaternion)
 if(Math.abs(normal.dot(camera.getWorldDirection(new Vector3())))<.08)return {portId:null,ambiguous:true}
 const candidates:string[]=[]
 for(const p of piece.shape.ports){
  const segment=snapPortSegment(piece,p.portId,camera)!,a=segment.p0.clone().project(camera),b=segment.p1.clone().project(camera)
  if(a.z< -1||a.z>1||b.z< -1||b.z>1)continue
  const p0=new Vector2((a.x+1)*size.width/2,(1-a.y)*size.height/2),p1=new Vector2((b.x+1)*size.width/2,(1-b.y)*size.height/2),d=p1.clone().sub(p0),length=d.lengthSq()
  if(length<16)continue
  const t=Math.max(0,Math.min(1,pointer.clone().sub(p0).dot(d)/length)),screen=p0.clone().addScaledVector(d,t)
  if(screen.distanceTo(pointer)>6)continue
  const world=segment.p0.clone().lerp(segment.p1,t)
  ray.setFromCamera(new Vector2(screen.x/size.width*2-1,1-screen.y/size.height*2),camera)
  const depth=world.clone().sub(ray.ray.origin).dot(ray.ray.direction)
  if(solidHits(ray,solids).some(h=>tileOwner(h.object)!==piece.id&&h.distance<=depth+.002))continue
  candidates.push(p.portId)
 }
 return {portId:candidates.length===1?candidates[0]:null,ambiguous:candidates.length>1}
}

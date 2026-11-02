import {Box3,Vector3} from 'three'
import type {Assembly3D} from './assembly.ts'
import {createViewerModel} from './viewer-model.ts'
import type {ViewerPiece} from './viewer-model.ts'
import {pieceWorldVertices} from './vendor/components/magnet3d/cameraUtils.ts'

export type AssemblyVisibility=Record<string,boolean>
export const ASSEMBLY_VISIBILITY_KEY='magnetic-tiles.assembly-visibility.v1:'
/** UI preference only. The active identity still comes from the existing working Draft. */
export function readAssemblyVisibility(storage:Pick<Storage,'getItem'>,projectId:string,activeId:string):AssemblyVisibility{
 const raw=storage.getItem(ASSEMBLY_VISIBILITY_KEY+projectId)
 if(raw===null)return {[activeId]:true}
 const value:unknown=JSON.parse(raw)
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.values(value).some(v=>typeof v!=='boolean'))throw Error('Assembly 显示偏好损坏；作品数据未修改')
 return value as AssemblyVisibility
}
export function saveAssemblyVisibility(storage:Pick<Storage,'setItem'>,projectId:string,value:AssemblyVisibility){storage.setItem(ASSEMBLY_VISIBILITY_KEY+projectId,JSON.stringify(value))}
export function displayPieceKey(assemblyId:string,pieceId:string){return JSON.stringify([assemblyId,pieceId])}
export type ReadOnlyAssemblyDisplay={id:string;name:string;snapshotHash:string;pieces:ViewerPiece[];offset:[number,number,number]}
export const EMPTY_ASSEMBLY_DISPLAYS:ReadOnlyAssemblyDisplay[]=[]
export type ReadOnlyPieceSelection={assemblyId:string;pieceId:string}|null
export type MultiAssemblyDisplayProps={readOnlyAssemblies?:ReadOnlyAssemblyDisplay[];activeVisible?:boolean;onInspectAssemblyPiece?:(assemblyId:string,pieceId:string)=>void;readOnlySelection?:ReadOnlyPieceSelection}
function bounds(pieces:ViewerPiece[]){const box=new Box3();for(const p of pieces)for(const v of pieceWorldVertices(p.shape,p.transform.position,p.transform.quaternion))box.expandByPoint(v);return box.isEmpty()?box.set(new Vector3(),new Vector3()):box}
/** Exact saved poses inside independent groups. No registration, solving or edits.
 * Keep the active coordinate system at identity so Gizmo/Snap/Collision stay local.
 */
export function arrangeAssemblyDisplays(anchor:Assembly3D,others:{id:string;name:string;snapshotHash:string;assembly:Assembly3D}[]):ReadOnlyAssemblyDisplay[]{
 const box=bounds(createViewerModel(anchor)),center=box.getCenter(new Vector3()),size=box.getSize(new Vector3()),gap=Math.max(.5,Math.max(size.x,size.y,size.z)*.2)
 let right=box.max.x
 return [...others].sort((a,b)=>a.id.localeCompare(b.id)).map(s=>{
  const pieces=createViewerModel(s.assembly),b=bounds(pieces),c=b.getCenter(new Vector3()),offset:[number,number,number]=[right+gap-b.min.x,center.y-c.y,center.z-c.z]
  right=b.max.x+offset[0]
  return {id:s.id,name:s.name,snapshotHash:s.snapshotHash,pieces,offset}
 })
}
export function displayAnnotationPieces(layers:ReadOnlyAssemblyDisplay[]){return layers.flatMap(a=>a.pieces.map(p=>({...p,id:displayPieceKey(a.id,p.id),transform:{position:p.transform.position.clone().add(new Vector3(...a.offset)),quaternion:p.transform.quaternion}})))}
export function displayLabels(layers:ReadOnlyAssemblyDisplay[]){return Object.fromEntries(layers.flatMap(a=>a.pieces.map(p=>[displayPieceKey(a.id,p.id),`${a.name} · ${p.id} · 只读`])))}

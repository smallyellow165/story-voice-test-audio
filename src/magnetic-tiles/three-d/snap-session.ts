import {canonical} from '../build-plan.ts'
import {fromEnginePose,serializeAssembly3D} from './assembly.ts'
import type {Assembly3D} from './assembly.ts'
import {parentModule} from './combined-editing.ts'
import {createViewerModel} from './viewer-model.ts'
import {edgeSnapTransform,previewEdgeSnap,confirmEdgeSnap} from './editor-snap.ts'
import type {EdgeSnapMode,EdgeSnapPreview} from './editor-snap.ts'
import {moduleById,pivotDelta,transformModule,previewModuleTransform} from './module-transform.ts'
import {commit} from './vendor/editor/state.ts'
import type {EditorHistory} from './vendor/editor/state.ts'
import type {Connection} from './vendor/engine/types.ts'

/** Session-only endpoint scope, independent of the Viewer's current pick grain. */
export type SnapObject={kind:'group'|'tile';groupId:string;tileId:string;portId:string}
export type SnapObjects={moving:SnapObject;fixed:SnapObject}
export type SnapRequest=SnapObjects&{dihedralDeg:number;flip:boolean;mode:EdgeSnapMode}
export type SnapSessionPreview=EdgeSnapPreview&{request:SnapRequest}
export const sameSnapRequest=(a:SnapRequest,b:SnapRequest)=>canonical(a)===canonical(b)
export function snapObject(a:Assembly3D,kind:SnapObject['kind'],tileId:string,portId='',groupId=''):SnapObject{
 const group=parentModule(a,tileId),ports=createViewerModel(a).find(p=>p.id===tileId)?.shape.ports??[]
 return{kind,groupId:group?.id??groupId,tileId,portId:portId?(ports.some(p=>p.portId===portId)?portId:''):ports[0]?.portId??''}
}
export function initialSnapObjects(a:Assembly3D,kind:SnapObject['kind'],selectedId='',movingGroupId='',fixedGroupId=''):SnapObjects{
 const group=parentModule(a,selectedId)??a.modules?.find(m=>m.id===movingGroupId)??a.modules?.[1]??a.modules?.[0]
 const movingId=kind==='group'?group?.pieces.find(p=>p.id===selectedId)?.id??group?.pieces[0]?.id??'':a.pieces.find(p=>p.id===selectedId)?.id??a.pieces.find(p=>!parentModule(a,p.id))?.id??''
 const other=kind==='group'?a.modules?.find(m=>m.id===fixedGroupId&&m.id!==group?.id)??a.modules?.find(m=>m.id!==group?.id):undefined
 const fixedId=other?.pieces[0]?.id??a.pieces.find(p=>p.id!==movingId&&(kind!=='group'||!group?.pieces.some(m=>m.id===p.id)))?.id??''
 return{moving:snapObject(a,kind,movingId),fixed:snapObject(a,other?'group':'tile',fixedId)}
}
export const snapConnection=(r:SnapRequest):Connection=>({pieceA:r.fixed.tileId,portA:r.fixed.portId,pieceB:r.moving.tileId,portB:r.moving.portId,dihedralDeg:r.dihedralDeg,flip:r.flip})

export function previewSnapSession(a:Assembly3D,input:SnapRequest):SnapSessionPreview{
 const r=structuredClone(input),c=snapConnection(r)
 if(r.mode!=='strict'&&r.mode!=='less-strict')throw Error('无效的 Snap 验证模式')
 for(const [label,end]of [['Moving',r.moving],['Fixed',r.fixed]] as const){
  if(end.kind!=='group'&&end.kind!=='tile')throw Error(`无效的 ${label} 对象类型`)
  if(!a.pieces.some(p=>p.id===end.tileId))throw Error(`请选择 ${label} Tile`)
  if(end.kind==='group'&&!moduleById(a,end.groupId).pieces.some(p=>p.id===end.tileId))throw Error(`${label} Tile 不属于所选 Group`)
 }
 if(r.moving.kind==='tile')return{...previewEdgeSnap(a,c,r.mode),request:r}
 const moving=moduleById(a,r.moving.groupId)
 if(moving.pieces.some(p=>p.id===c.pieceA))throw Error('Fixed 不能属于本次 Moving Group；不会移动或重绑 Fixed')
 // Reuse the existing Port alignment and Group SE(3) application. Fixed is
 // only a real Tile Port; it need not belong to a second module.
 const old=a.pieces.find(p=>p.id===c.pieceB)!,target=fromEnginePose(edgeSnapTransform(a,c))
 const next=transformModule(a,moving.id,pivotDelta(old.pose,target));next.connections.push(c)
 const checked=previewModuleTransform(a,next)
 const blockers=checked.geometry.issues.filter(i=>i.severity==='error'&&(r.mode==='strict'||i.code!=='intersection'))
 if(blockers.length)throw Error('Group Snap 被验证拒绝，原 Draft 保留：'+blockers.map(i=>i.message).join('；'))
 return{...checked,connection:c,mode:r.mode,request:r}
}
export function confirmSnapSession(h:EditorHistory,p:SnapSessionPreview,currentRequest:SnapRequest){
 if(p.sourceRaw!==serializeAssembly3D(h.current)||!sameSnapRequest(p.request,currentRequest))throw Error('Snap 输入或作品已变化，请重新预览；原 Draft 保留')
 const checked=previewSnapSession(h.current,currentRequest)
 return checked.request.moving.kind==='tile'?confirmEdgeSnap(h,checked,currentRequest.mode):commit(h,()=>checked.assembly)
}

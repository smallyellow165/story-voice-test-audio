import {assertCameraView} from '../camera-view.ts'
import type {CameraView3D} from '../camera-view.ts'
import {serializeAssembly3D,parseAssembly3D} from '../assembly.ts'
import type {Assembly3D} from '../assembly.ts'
import {DRAFT_3D_KEY,saveDraft3D} from '../draft-storage.ts'
import {validateAssembly3D} from '../engine-adapter.ts'
import {contentHash} from '../../build-plan.ts'
export const PHOTO_ORIGIN_3D_KEY='magnetic-tiles.assembly3d-origin.v1'
export type DraftGeometryReview3D={assemblyId:string;revision:number;assemblyHash:string;assemblyRaw:string;geometry:ReturnType<typeof validateAssembly3D>}
export type PhotoOrigin3D={origin:Record<string,unknown>;assemblyRaw:string;cameraView?:CameraView3D;geometryReview?:DraftGeometryReview3D;symmetryFills?:{sourceIds:string[];addedIds:string[];plane:{normal:[number,number,number];offset:number};sourceRevision:number;addedRevision:number}[]}
/** Existing Draft CAS remains authoritative. The optional sidecar binds exact bytes.
 * Preserve the previous provenance when an adoption fails before updating the Draft.
 */
export function adoptReconstructionDraft(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,assembly:Assembly3D,origin:Record<string,unknown>,expected:string|null,cameraView?:CameraView3D){
 if(cameraView)assertCameraView(cameraView)
 const assemblyRaw=serializeAssembly3D(assembly)
 if(typeof origin.id!=='string'||JSON.stringify(origin.assembly)!==assemblyRaw)throw Error('采用来源与 Assembly 快照不一致')
 if(storage.getItem(DRAFT_3D_KEY)!==expected)throw Error('3D 草稿已被其他页面更新；未替换草稿或来源')
 const previous=storage.getItem(PHOTO_ORIGIN_3D_KEY),sidecar:PhotoOrigin3D={origin,assemblyRaw,...(cameraView?{cameraView:structuredClone(cameraView)}:{})},encoded=JSON.stringify(sidecar)
 storage.setItem(PHOTO_ORIGIN_3D_KEY,encoded)
 try{return {raw:saveDraft3D(storage,assembly,expected),sidecar}}
 catch(error){
  // Another tab's newer sidecar is never rolled back.
  if(storage.getItem(PHOTO_ORIGIN_3D_KEY)===encoded){if(previous===null)storage.removeItem(PHOTO_ORIGIN_3D_KEY);else storage.setItem(PHOTO_ORIGIN_3D_KEY,previous)}
  throw error
 }
}

export function loadPhotoOrigin(storage:Pick<Storage,'getItem'>):PhotoOrigin3D|null{
 try{const value=JSON.parse(storage.getItem(PHOTO_ORIGIN_3D_KEY)||'null');if(!value||typeof value.origin?.id!=='string')return null;parseAssembly3D(value.assemblyRaw);if(value.cameraView){try{assertCameraView(value.cameraView)}catch{delete value.cameraView}}return value}catch{return null}
}

/** Legacy overrides still require an explicit current revalidation receipt.
 * This local provenance gate never authorizes Invalid geometry: Human Accepted
 * Diagnostics need the existing authoritative server grant at the caller. */
export function photoDraftGeometryGate(assembly:Assembly3D,sidecar:PhotoOrigin3D|null,geometry=validateAssembly3D(assembly)){
 const legacyRepair=sidecar?.origin.entryMode==='diagnostic-override'&&parseAssembly3D(sidecar.assemblyRaw).id===assembly.id;
 const repair=!!sidecar&&['diagnostic-override','human-accepted-diagnostic'].includes(String(sidecar.origin.entryMode))&&parseAssembly3D(sidecar.assemblyRaw).id===assembly.id;
 const review=repair?sidecar?.geometryReview:undefined;
 const current=!!review&&review.assemblyId===assembly.id&&review.revision===assembly.revision&&review.assemblyRaw===serializeAssembly3D(assembly);
 const blocker=!geometry.valid?'Geometry Invalid：当前 Draft 未通过严格验证，不能作为合法 Assembly 或进入 Build Tutorial。':legacyRepair&&(!current||!review?.geometry?.valid)?'验证已过期或尚未复验：请对当前 Draft 执行 Revalidate Geometry。':null;
 return {repair,receiptRequired:legacyRepair,current,geometry,ready:!blocker,blocker};
}
export function assertPhotoDraftReady(storage:Pick<Storage,'getItem'>,assembly:Assembly3D){
 const sidecar=loadPhotoOrigin(storage);
 if(storage.getItem(PHOTO_ORIGIN_3D_KEY)!==null&&!sidecar)throw Error('照片来源元数据损坏，请返回 Assembly 检查，不能使用未知验证状态。');
 const gate=photoDraftGeometryGate(assembly,sidecar);
 if(gate.blocker)throw Error(gate.blocker);
 return gate;
}
export async function revalidatePhotoDraft(storage:Pick<Storage,'getItem'|'setItem'>,assembly:Assembly3D,expectedDraft:string|null){
 const previous=storage.getItem(PHOTO_ORIGIN_3D_KEY),sidecar=loadPhotoOrigin(storage),assemblyRaw=serializeAssembly3D(assembly),geometry=validateAssembly3D(assembly);
 if(!sidecar||!photoDraftGeometryGate(assembly,sidecar,geometry).repair)throw Error('当前作品没有待修复照片 Draft 来源');
 const geometryReview:DraftGeometryReview3D={assemblyId:assembly.id,revision:assembly.revision,assemblyHash:await contentHash(assembly),assemblyRaw,geometry};
 if(storage.getItem(DRAFT_3D_KEY)!==expectedDraft||storage.getItem(PHOTO_ORIGIN_3D_KEY)!==previous)throw Error('Draft 或来源已被其他页面更新，复验记录未覆盖');
 const next={...sidecar,geometryReview};storage.setItem(PHOTO_ORIGIN_3D_KEY,JSON.stringify(next));
 return next;
}

import {assertCameraView} from '../camera-view.ts'
import type {CameraView3D} from '../camera-view.ts'
import {serializeAssembly3D,parseAssembly3D} from '../assembly.ts'
import type {Assembly3D} from '../assembly.ts'
import {DRAFT_3D_KEY,saveDraft3D} from '../draft-storage.ts'
export const PHOTO_ORIGIN_3D_KEY='magnetic-tiles.assembly3d-origin.v1'
export type PhotoOrigin3D={origin:Record<string,unknown>;assemblyRaw:string;cameraView?:CameraView3D}
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

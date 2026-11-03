import {intakeApi} from '../intake/api.ts'
import {loadDraft3D,loadDraftCollisionPolicy,saveDraft3D,DRAFT_3D_KEY,DRAFT_COLLISION_POLICY_KEY} from './draft-storage.ts'
import {loadPhotoOrigin,PHOTO_ORIGIN_3D_KEY} from './reconstruction/adopt-draft.ts'
import {serializeAssembly3D} from './assembly.ts'
import {canonical} from '../build-plan.ts'
import type {Assembly3D} from './assembly.ts'
import type {PhotoOrigin3D} from './reconstruction/adopt-draft.ts'
export const ASSEMBLY_SAVED_REF_KEY='magnetic-tiles.assembly3d-saved-ref.v1'
export type AssemblySnapshot={assembly:Assembly3D;photoOrigin:PhotoOrigin3D;nonRepairable:string[]}
export type SavedAssemblySummary={id:string;version:number;name:string;type:'group'|'combined';project:{id:string;hash:string};group:{id:string;name:string};revision:number;tiles:number;connections:number;hash:string;snapshotHash:string;savedAt:string;parent:{kind:'geometry-origin';id:string;hash:string}|{kind:'assemblies';assemblies:import('./assembly.ts').AssemblyParent3D[]}}
export type SavedAssembly={assembly:{id:string};name:string;type:'group'|'combined';project:SavedAssemblySummary['project'];group:SavedAssemblySummary['group'];parent:SavedAssemblySummary['parent'];version:number;hash:string;snapshotHash:string;snapshot:AssemblySnapshot;lineage:{selected:boolean;error:string|null}}
export type SavedAssemblyRef={id:string;hash:string;projectId:string}
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>
export function savedAssemblyRef(storage:Pick<Storage,'getItem'>):SavedAssemblyRef|null{
 const raw=storage.getItem(ASSEMBLY_SAVED_REF_KEY);if(raw===null)return null
 const value=JSON.parse(raw);if(typeof value?.id!=='string'||typeof value.hash!=='string'||typeof value.projectId!=='string')throw Error('Assembly 保存引用损坏；未覆盖存档')
 return value
}
export function groupSnapshot(assembly:Assembly3D,origin:PhotoOrigin3D|null,nonRepairable:readonly string[]):AssemblySnapshot|null{
 if(!origin||JSON.parse(origin.assemblyRaw).id!==assembly.id)return null
 const sidecar=structuredClone(origin),ids=new Set(assembly.pieces.map(p=>p.id))
 if(sidecar.symmetryFills)sidecar.symmetryFills=sidecar.symmetryFills.filter(f=>f.addedIds.every(id=>ids.has(id))&&f.addedRevision<=assembly.revision)
 // Retain old receipts only in immutable historical records, never in new saves.
 delete sidecar.geometryReview
 return {assembly,photoOrigin:sidecar,nonRepairable:[...nonRepairable]}
}
export async function saveAssemblySnapshot(snapshot:AssemblySnapshot,expected:SavedAssemblyRef|null){
 if(expected&&expected.id===snapshot.assembly.id&&expected.projectId!==snapshot.photoOrigin.origin.sourceId)throw Error('Assembly Project 不一致')
 return intakeApi<SavedAssembly>('assembly3d/save',{snapshot,expectedHash:expected?.id===snapshot.assembly.id?expected.hash:null})
}
/** Register the already SAVED working document before replacement. Never copies
 * unsaved editor memory or reconstructs geometry from an Execution. */
export async function preserveSavedAssembly(storage:Store){
 const saved=loadDraft3D(storage),origin=loadPhotoOrigin(storage)
 if(!saved.assembly)return null
 const policy=loadDraftCollisionPolicy(storage,saved.assembly,saved.raw),snapshot=groupSnapshot(saved.assembly,origin,policy.nonRepairable)
 if(!snapshot)return null // Unlinked examples are working documents, not Project Assemblies.
 const originRaw=storage.getItem(PHOTO_ORIGIN_3D_KEY),receiptRaw=storage.getItem(ASSEMBLY_SAVED_REF_KEY)
 const ref=savedAssemblyRef(storage)
 let result:SavedAssembly
 if(ref?.id===saved.assembly.id){
  const stored=await intakeApi<SavedAssembly>('assembly3d/records/'+ref.id)
  if(stored.hash!==ref.hash)throw Error('已保存作品被其他页面更新；未覆盖当前工作区，请明确选择服务端存档')
  result=serializeAssembly3D(stored.snapshot.assembly)===saved.raw&&canonical(stored.snapshot.nonRepairable)===canonical(snapshot.nonRepairable)&&canonical(stored.snapshot.photoOrigin.origin)===canonical(snapshot.photoOrigin.origin)?stored:await saveAssemblySnapshot(snapshot,ref)
 }else result=await saveAssemblySnapshot(snapshot,ref)
 if(storage.getItem(DRAFT_3D_KEY)!==saved.raw||storage.getItem(PHOTO_ORIGIN_3D_KEY)!==originRaw||storage.getItem(ASSEMBLY_SAVED_REF_KEY)!==receiptRaw)throw Error('登记期间工作区已切换；已保存存档保留，未替换当前 Draft')
 storage.setItem(ASSEMBLY_SAVED_REF_KEY,JSON.stringify({id:result.assembly.id,hash:result.hash,projectId:result.project.id}))
 return result
}
/** Reuses the one working Draft CAS and sidecar. A saved 12-tile document must
 * never pass through adoptReconstructionDraft's immutable 8-tile origin payload. */
export function restoreAssemblySnapshot(storage:Store,record:SavedAssembly,expected:{raw:string|null;policy:string|null;origin:string|null}){
 if(storage.getItem(DRAFT_3D_KEY)!==expected.raw||storage.getItem(DRAFT_COLLISION_POLICY_KEY)!==expected.policy||storage.getItem(PHOTO_ORIGIN_3D_KEY)!==expected.origin)throw Error('工作区已被其他页面更新，未切换 Assembly')
 const beforeRef=storage.getItem(ASSEMBLY_SAVED_REF_KEY),originRaw=JSON.stringify(record.snapshot.photoOrigin),refRaw=JSON.stringify({id:record.assembly.id,hash:record.hash,projectId:record.project.id})
 try{
  storage.setItem(PHOTO_ORIGIN_3D_KEY,originRaw);storage.setItem(ASSEMBLY_SAVED_REF_KEY,refRaw)
  const raw=saveDraft3D(storage,record.snapshot.assembly,expected.raw,{nonRepairable:record.snapshot.nonRepairable,expectedRaw:expected.policy})
  return {raw,policy:storage.getItem(DRAFT_COLLISION_POLICY_KEY),photoOrigin:record.snapshot.photoOrigin}
 }catch(e){
  if(storage.getItem(PHOTO_ORIGIN_3D_KEY)===originRaw){if(expected.origin===null)storage.removeItem(PHOTO_ORIGIN_3D_KEY);else storage.setItem(PHOTO_ORIGIN_3D_KEY,expected.origin)}
  if(storage.getItem(ASSEMBLY_SAVED_REF_KEY)===refRaw){if(beforeRef===null)storage.removeItem(ASSEMBLY_SAVED_REF_KEY);else storage.setItem(ASSEMBLY_SAVED_REF_KEY,beforeRef)}
  throw e
 }
}

import { assertAssembly3D, parseAssembly3D, serializeAssembly3D } from './assembly.ts'
import type { Assembly3D } from './assembly.ts'
import {nonRepairableKeys} from './non-repairable.ts'

// Geometry stays in the existing Assembly3D document. Optimization preferences
// are an exact-snapshot sidecar, never supplied as Validator/approval input.
export const DRAFT_3D_KEY = 'magnetic-tiles.assembly3d-draft.v1'
export const DRAFT_COLLISION_POLICY_KEY = 'magnetic-tiles.assembly3d-collision-policy.v1'
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage,'removeItem'>>
export type DraftCollisionPolicySave={nonRepairable:readonly string[];expectedRaw:string|null}
export function loadDraftCollisionPolicy(storage:Pick<Storage,'getItem'>,assembly:Assembly3D|null,raw:string|null){
 const policyRaw=storage.getItem(DRAFT_COLLISION_POLICY_KEY)
 if(policyRaw===null||policyRaw==='null')return {policyRaw,nonRepairable:[] as string[]}
 let value;try{value=JSON.parse(policyRaw)}catch{throw Error('3D Draft 不可修复碰撞标记损坏；未清除保存内容')}
 if(value?.version!==1||typeof value.assemblyRaw!=='string'||!Array.isArray(value.nonRepairable)||value.nonRepairable.some((k:unknown)=>typeof k!=='string'))throw Error('3D Draft 碰撞修复偏好格式无效')
 return {policyRaw,nonRepairable:assembly&&value.assemblyRaw===raw?nonRepairableKeys(assembly,value.nonRepairable):[]}
}
export function loadDraft3D(storage: Pick<Storage, 'getItem'>): { raw: string | null; assembly: Assembly3D | null } {
 const raw = storage.getItem(DRAFT_3D_KEY)
 return { raw, assembly: raw === null ? null : parseAssembly3D(raw) }
}
export function saveDraft3D(storage: DraftStorage, assembly: Assembly3D, expected: string | null,policy?:DraftCollisionPolicySave): string {
 assertAssembly3D(assembly) // Structural check only: invalid geometry drafts are allowed.
 if (storage.getItem(DRAFT_3D_KEY) !== expected) throw Error('3D 草稿已被其他页面更新。请先导出当前草稿，再重新加载已保存草稿。')
 const previous=storage.getItem(DRAFT_COLLISION_POLICY_KEY)
 if(policy&&previous!==policy.expectedRaw)throw Error('不可修复碰撞标记已被其他页面更新，请重新加载已保存 Draft')
 const raw = serializeAssembly3D(assembly),writePolicy=!!policy||previous!==null
 const next=JSON.stringify({version:1,assemblyRaw:raw,nonRepairable:nonRepairableKeys(assembly,policy?.nonRepairable??[])})
 if(writePolicy)storage.setItem(DRAFT_COLLISION_POLICY_KEY,next)
 try{storage.setItem(DRAFT_3D_KEY, raw)}catch(e){
  if(writePolicy&&storage.getItem(DRAFT_COLLISION_POLICY_KEY)===next){if(previous===null&&storage.removeItem)storage.removeItem(DRAFT_COLLISION_POLICY_KEY);else storage.setItem(DRAFT_COLLISION_POLICY_KEY,previous??'null')}
  throw e
 }
 return raw
}

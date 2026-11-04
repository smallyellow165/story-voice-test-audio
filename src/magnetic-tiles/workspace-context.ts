// Explicit URL identity, independent of the last opened Project or global Draft.
export type WorkspaceContext = {mode:'create';id:string}|{mode:'edit';id:string;galleryId:string;assemblyId:string;version:number;hash:string}
export type WorkspaceStore = Pick<Storage,'getItem'|'setItem'|'removeItem'>
export function readWorkspaceContext(href:string):WorkspaceContext|null {
 const p=new URL(href).searchParams,mode=p.get('workspace')
 if(mode===null)return null
 if(mode==='create'){
  const id=p.get('workspaceId');if(!id||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw Error('Create 工作区 ID 无效')
  return {mode,id}
 }
 if(mode!=='edit')throw Error('Studio 工作上下文无效')
 const galleryId=p.get('galleryId'),assemblyId=p.get('assemblyId'),version=Number(p.get('version')),hash=p.get('hash')
 if(!galleryId||!/^[a-f0-9]{64}$/.test(galleryId)||!assemblyId||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(assemblyId)||!Number.isSafeInteger(version)||version<1||!hash||!/^[a-f0-9]{64}$/.test(hash))throw Error('Edit 需要明确的 Gallery / Assembly 固定版本')
 return {mode,id:galleryId+'.'+hash,galleryId,assemblyId,version,hash}
}
export function workspaceStore(storage:WorkspaceStore,context:WorkspaceContext):WorkspaceStore {
 const prefix='magnetic-studio.workspace.v1.'+context.mode+'.'+context.id+'.'
 return {getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,value),removeItem:key=>storage.removeItem(prefix+key)}
}
// Called only after the entry bootstrap succeeds. No mutable global identity.
export function currentWorkspace(){return readWorkspaceContext(location.href)}
export function studioStorage():WorkspaceStore {const c=currentWorkspace();return c?workspaceStore(localStorage,c):localStorage}
export const WORKSPACE_BINDING_KEY='binding'
export const WORKING_DRAFT_KEY='working-draft'
export const WORKSPACE_RECORD_KEY='saved-record-reference'
export const WORKSPACE_HEAD_KEY='save-head'
export const WORKSPACE_ASSEMBLIES_KEY='saved-assemblies'
export type RecordReference={id:string;version:number;hash:string}
export function ownAssemblyReferences(storage:WorkspaceStore):RecordReference[]{
 const refs=JSON.parse(storage.getItem(WORKSPACE_ASSEMBLIES_KEY)||'[]')
 if(!Array.isArray(refs)||refs.some(r=>typeof r?.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(r.id)||!Number.isSafeInteger(r.version)||r.version<1||typeof r.hash!=='string'||!/^[a-f0-9]{64}$/.test(r.hash)))throw Error('本工作区 Assembly 引用损坏；未加载 Project 全局记录')
 return refs
}
export function rememberSavedAssembly(storage:WorkspaceStore,ref:RecordReference){
 storage.setItem(WORKSPACE_ASSEMBLIES_KEY,JSON.stringify([...ownAssemblyReferences(storage).filter(r=>r.id!==ref.id),ref]))
}
export type WorkspaceHistory={refs:Pick<RecordReference,'id'|'hash'>[];requestIds:string[]}
export function workspaceHistory(storage:WorkspaceStore):WorkspaceHistory {
 const raw=storage.getItem('history');if(raw===null)return {refs:[],requestIds:[]}
 const value=JSON.parse(raw)
 if(!Array.isArray(value?.refs)||!Array.isArray(value.requestIds))throw Error('工作区历史索引损坏；未加载全局历史')
 return value
}
// Only receipts returned by operations performed in this URL context become
// candidates. Sharing a photo, name or Project never establishes ownership.
export function rememberWorkspaceResult(storage:WorkspaceStore,result:unknown,requestId?:unknown){
 const h=workspaceHistory(storage)
 if(typeof requestId==='string'&&!h.requestIds.includes(requestId))h.requestIds.push(requestId)
 function visit(v:unknown){
  if(!v||typeof v!=='object')return
  const r=v as Record<string,unknown>
  if(typeof r.id==='string'&&typeof r.hash==='string'&&typeof r.createdAt==='string'&&!h.refs.some(x=>x.id===r.id&&x.hash===r.hash))h.refs.push({id:r.id,hash:r.hash})
  // Responses may wrap a completed immutable result. Never traverse arbitrary
  // parents/origin/geometry and infer ownership of their historical inputs.
  if(r.record)visit(r.record)
 }
 visit(result);storage.setItem('history',JSON.stringify(h))
}
export function ownSelectedHead<T>(value:T,history:WorkspaceHistory):T {
 const h=structuredClone(value) as Record<string,any>,owns=(id:unknown,hash:unknown)=>history.refs.some(r=>r.id===id&&r.hash===hash)
 if(!owns(h.analysisId,h.analysisHash)){h.analysisId=null;h.analysisHash=null;h.reviewId=null;h.reviewHash=null;h.groups={}}
 else if(!owns(h.reviewId,h.reviewHash)){h.reviewId=null;h.reviewHash=null;h.groups={}}
 else h.groups=Object.fromEntries(Object.entries(h.groups??{}).filter(([,v])=>{const s=v as any;return owns(s.plan?.id,s.plan?.hash)}).map(([k,v])=>{const s=v as any;return [k,{...s,...(s.execution&&!owns(s.execution.id,s.execution.hash)?{execution:null}:{})}]}))
 return h as T
}

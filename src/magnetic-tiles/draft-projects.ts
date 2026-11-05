import {workspaceStore,WORKSPACE_BINDING_KEY,ownAssemblyReferences} from './workspace-context.ts'
import type {WorkspaceStore} from './workspace-context.ts'
import {canonical} from './build-plan.ts'
import {workflowStages} from './studio-url.ts'
import type {WorkflowStage} from './studio-url.ts'

export const DRAFT_PROJECT_PREFIX='magnetic-studio.draft-project.v1.'
export const WORKFLOW_DRAFT_KEY='workflow-draft.v1'
export const LEGACY_CONTEXT_KEY='magnetic-visible3d-context.v2'
const MIGRATION_KEY='magnetic-studio.draft-project-migration.v1'
export type DraftProject={schemaVersion:1;workspaceId:string;name:string;updatedAt:string;stage:WorkflowStage}
type BrowserStore=WorkspaceStore&Pick<Storage,'length'|'key'>
export const isWorkspaceId=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
export function readDraftProject(storage:WorkspaceStore,id:string):DraftProject|null{
 if(!isWorkspaceId(id))throw Error('Draft Workspace ID 无效')
 const raw=storage.getItem(DRAFT_PROJECT_PREFIX+id);if(raw===null)return null
 const v=JSON.parse(raw)
 if(v?.schemaVersion!==1||v.workspaceId!==id||typeof v.name!=='string'||!v.name.trim()||!Number.isFinite(Date.parse(v.updatedAt))||!workflowStages.includes(v.stage))throw Error('未完成作品索引损坏：'+id+'；原数据保留')
 return v
}
export function touchDraftProject(storage:WorkspaceStore,id:string,patch:Partial<Pick<DraftProject,'name'|'stage'>>={}){
 const old=readDraftProject(storage,id),next:DraftProject={schemaVersion:1,workspaceId:id,name:old?.name??'未完成作品',stage:old?.stage??'assembly',...patch,updatedAt:new Date().toISOString()}
 storage.setItem(DRAFT_PROJECT_PREFIX+id,JSON.stringify(next));return next
}
export function listDraftProjects(storage:BrowserStore,published:readonly {assemblyRef:{id:string}}[]=[]){
 const projects:DraftProject[]=[],warnings:string[]=[]
 for(let i=0;i<storage.length;i++){
  const key=storage.key(i);if(!key?.startsWith(DRAFT_PROJECT_PREFIX))continue
  const id=key.slice(DRAFT_PROJECT_PREFIX.length)
  try{
   const p=readDraftProject(storage,id)!;const scoped=workspaceStore(storage,{mode:'create',id})
   if(scoped.getItem(WORKSPACE_BINDING_KEY)!==canonical({mode:'create',id}))throw Error('工作区身份绑定缺失或不一致：'+id)
   const owned=ownAssemblyReferences(scoped)
   // Publication of any exact owned Assembly identity completes this Create.
   // Versions remain pinned in Gallery; local drafts are retained, never deleted.
   if(published.some(item=>owned.some(ref=>ref.id===item.assemblyRef.id)))continue
   projects.push(p)
  }catch(e){warnings.push(String(e))}
 }
 return {projects:projects.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.workspaceId.localeCompare(b.workspaceId)),warnings}
}
export type MigrationReport={migrated:string[];skipped:{id:string;reason:string}[]}
/** One additive migration. Reads only UUID-scoped, explicitly bound workspaces.
 * Legacy bytes are never removed/rewritten; normal recovery only reads v1. */
export async function migrateDraftProjects(storage:BrowserStore,migrateWorkflow:(id:string,scoped:WorkspaceStore)=>Promise<void>):Promise<MigrationReport>{
 const reportRaw=storage.getItem(MIGRATION_KEY);if(reportRaw)return JSON.parse(reportRaw)
 const report:MigrationReport={migrated:[],skipped:[]},ids:string[]=[]
 for(let i=0;i<storage.length;i++){const m=storage.key(i)?.match(/^magnetic-studio\.workspace\.v1\.create\.([a-f0-9-]+)\.binding$/);if(m&&isWorkspaceId(m[1]))ids.push(m[1])}
 for(const id of ids)try{
  if(readDraftProject(storage,id))continue
  const scoped=workspaceStore(storage,{mode:'create',id})
  if(scoped.getItem(WORKSPACE_BINDING_KEY)!==canonical({mode:'create',id}))throw Error('身份绑定不一致')
  await migrateWorkflow(id,scoped)
  const prefs=JSON.parse(scoped.getItem('magnetic-studio.right-panel.v1')??'{}')
  const stage=workflowStages.includes(prefs.lastStage)?prefs.lastStage:'assembly'
  touchDraftProject(storage,id,{stage});report.migrated.push(id)
 }catch(e){report.skipped.push({id,reason:String(e)})}
 storage.setItem(MIGRATION_KEY,JSON.stringify(report));return report
}

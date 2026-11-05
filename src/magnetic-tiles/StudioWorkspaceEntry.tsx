import {useEffect,useState} from 'react'
import {StudioLayout} from './StudioLayout.tsx'
import {intakeApi} from './intake/api.ts'
import {readWorkspaceContext,workspaceStore,rememberSavedAssembly,WORKSPACE_BINDING_KEY,WORKSPACE_RECORD_KEY,WORKSPACE_HEAD_KEY} from './workspace-context.ts'
import type {RecordReference} from './workspace-context.ts'
import {restoreAssemblySnapshot} from './three-d/assembly-library.ts'
import type {SavedAssembly} from './three-d/assembly-library.ts'
import {DRAFT_3D_KEY,DRAFT_COLLISION_POLICY_KEY,saveDraft3D} from './three-d/draft-storage.ts'
import {PHOTO_ORIGIN_3D_KEY,loadPhotoOrigin} from './three-d/reconstruction/adopt-draft.ts'
import {serializeAssembly3D} from './three-d/assembly.ts'
import {canonical} from './build-plan.ts'
import {claimWorkspace} from './workspace-session.ts'
import {readDraftProject,touchDraftProject,WORKFLOW_DRAFT_KEY} from './draft-projects.ts'
import {emptyWorkflowDraft,migrateLegacyWorkflow,readWorkflowDraft} from './three-d/reconstruction/workflow-draft.ts'

export async function prepareStudioWorkspace(){
 const url=new URL(location.href)
 if(url.searchParams.get('workspace')==='create'&&!url.searchParams.has('workspaceId')){
  url.searchParams.set('workspaceId',crypto.randomUUID());url.searchParams.set('stage','assembly')
  history.replaceState(null,'',url)
 }
 const context=readWorkspaceContext(location.href)
 if(!context)throw Error('缺少 Studio 工作上下文')
 await claimWorkspace(context)
 if(context.mode==='create'&&url.searchParams.has('sourceId'))throw Error('Create 不接受其他作品的来源恢复参数')
 if(context.mode==='edit'&&!['assembly','build'].includes(url.searchParams.get('stage')??'assembly'))throw Error('Edit 只允许编辑当前快照；历史来源仅供追溯')
 const storage=workspaceStore(localStorage,context),binding=storage.getItem(WORKSPACE_BINDING_KEY)
 if(binding!==null&&binding!==canonical(context))throw Error('工作区绑定不一致；原 Draft 保留')
 if(storage.getItem(PHOTO_ORIGIN_3D_KEY)!==null&&!loadPhotoOrigin(storage))throw Error('本作品来源草稿损坏；原始数据保留，未按无来源作品恢复')
 if(context.mode==='create'){
  const project=readDraftProject(localStorage,context.id)
  if(project){if(binding===null)throw Error('未完成作品的工作区身份绑定缺失；原数据保留');readWorkflowDraft(storage,context.id);if(storage.getItem(WORKFLOW_DRAFT_KEY)===null)throw Error('工作流程草稿缺失；原工作区保留，未回退到服务器最新记录')}
  else if(binding!==null)await migrateLegacyWorkflow(context.id,storage,intakeApi)
 }
 if(context.mode==='edit'){
  const opened=await intakeApi<{item:{assemblyRef:RecordReference};saved:SavedAssembly;saveHead:RecordReference}>('gallery/edit-context/'+context.galleryId)
  if(canonical(opened.item.assemblyRef)!==canonical({id:context.assemblyId,version:context.version,hash:context.hash}))throw Error('Gallery 固定引用与 Edit 链接不一致；未加载其他版本')
  if(binding===null){
   if(storage.getItem(DRAFT_3D_KEY)!==null)throw Error('未完成初始化的工作区含有 Draft；保留原数据，请导出后处理')
   restoreAssemblySnapshot(storage,opened.saved,{raw:null,policy:null,origin:null})
   storage.setItem(WORKSPACE_RECORD_KEY,JSON.stringify(opened.item.assemblyRef))
   storage.setItem(WORKSPACE_HEAD_KEY,JSON.stringify(opened.saveHead))
  }
 }
 if(binding===null&&context.mode==='create'){
  if(storage.getItem(DRAFT_3D_KEY)!==null)throw Error('新建工作区已有未绑定 Draft；未覆盖')
  saveDraft3D(storage,{kind:'magnetic-assembly-3d',schemaVersion:1,id:'creation-'+context.id,revision:0,profiles:[],pieces:[],connections:[]},null,{nonRepairable:[],expectedRaw:null})
 }
 // A saved slot is verified against its own immutable version, never the head.
 const refRaw=storage.getItem(WORKSPACE_RECORD_KEY)
 if(binding!==null&&refRaw){
  const ref=JSON.parse(refRaw) as RecordReference,r=await intakeApi<SavedAssembly>('assembly3d/records/'+encodeURIComponent(ref.id)+'/versions/'+ref.version)
  if(r.hash!==ref.hash||serializeAssembly3D(r.snapshot.assembly)!==storage.getItem(DRAFT_3D_KEY)||canonical(r.snapshot.photoOrigin)!==canonical(JSON.parse(storage.getItem(PHOTO_ORIGIN_3D_KEY)||'null')))throw Error('本作品 Draft 与保存版本不一致；未回退加载其他作品或最新版本')
  const policy=JSON.parse(storage.getItem(DRAFT_COLLISION_POLICY_KEY)||'null')
  if(canonical(policy?.nonRepairable??[])!==canonical(r.snapshot.nonRepairable))throw Error('本作品碰撞偏好与保存快照不一致')
 }
 if(context.mode==='create'&&refRaw)rememberSavedAssembly(storage,JSON.parse(refRaw))
 storage.setItem(WORKSPACE_BINDING_KEY,canonical(context))
 if(context.mode==='create'){
  if(storage.getItem(WORKFLOW_DRAFT_KEY)===null)storage.setItem(WORKFLOW_DRAFT_KEY,JSON.stringify(emptyWorkflowDraft(context.id)))
  let project=readDraftProject(localStorage,context.id)
  if(!project){const preferences=JSON.parse(storage.getItem('magnetic-studio.right-panel.v1')??'{}');project=touchDraftProject(localStorage,context.id,{stage:preferences.lastStage??'assembly'})}
  if(!url.searchParams.has('stage')){url.searchParams.set('stage',project.stage);history.replaceState(null,'',url)}
 }
}

export function StudioWorkspaceEntry(){
 const [state,setState]=useState({ready:false,error:''})
 useEffect(()=>{
  let live=true,identity:string|null=null
  const pop=(event:PopStateEvent)=>{
   if(identity===null)return
   let same=false;try{same=canonical(readWorkspaceContext(location.href))===identity}catch{}
   if(!same){event.stopImmediatePropagation();location.reload()}
  }
  window.addEventListener('popstate',pop)
  void prepareStudioWorkspace().then(()=>{if(live){identity=canonical(readWorkspaceContext(location.href));setState({ready:true,error:''})}}).catch(e=>{if(live)setState({ready:false,error:String(e)})})
  return()=>{live=false;window.removeEventListener('popstate',pop)}
 },[])
 return state.ready?<StudioLayout dragging={false}>{null}</StudioLayout>:<main className="tiles-app"><p role={state.error?'alert':'status'}>{state.error||'正在打开作品工作区…'}</p><a href="magnetic-gallery.html">返回作品集</a></main>
}

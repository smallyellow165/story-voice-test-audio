import {canonical} from '../../build-plan.ts'
import {WORKFLOW_DRAFT_KEY,LEGACY_CONTEXT_KEY} from '../../draft-projects.ts'
import type {WorkspaceStore} from '../../workspace-context.ts'
import type {SelectedHead,SelectedRef} from './selected-lineage.ts'
import type {VisibleReview3D} from './contracts.ts'
import type {Source} from '../../intake/contracts.ts'
import type {RefinementReference} from './constraint-refinement.ts'

export type WorkflowDraft={schemaVersion:1;workspaceId:string;source:SelectedRef|null;inputSource:SelectedRef|null;head:SelectedHead;form:VisibleReview3D|null;selected:string;candidateId:string;candidateChoices:Record<string,string>;model:string;planningModel:string;analysisTraceRequestId:string;annotation:string;manual:string;refinement:RefinementReference|null;rebaseId:string}
type RecordBase=SelectedRef&{projectId?:string;sourceId:string;sourceHash:string}
type DraftAnalysis=RecordBase&{evidence:{observations:{id:string;color:string}[]}}
type DraftReview=RecordBase&{analysisId:string;analysisHash:string;input:{review:VisibleReview3D}}
export type DraftHistory={analyses:DraftAnalysis[];reviews:DraftReview[];plans:(RecordBase&{reviewId:string;reviewHash:string})[];executions:(RecordBase&{reviewId:string;reviewHash:string;planId:string;planHash:string})[]}
export const emptySelectedHead=():SelectedHead=>({revision:0,selectedRevision:0,analysisId:null,reviewId:null,groups:{}})
export function emptyWorkflowDraft(workspaceId:string):WorkflowDraft{return {schemaVersion:1,workspaceId,source:null,inputSource:null,head:emptySelectedHead(),form:null,selected:'',candidateId:'',candidateChoices:{},model:'',planningModel:'',analysisTraceRequestId:'latest',annotation:'',manual:'',refinement:null,rebaseId:''}}
export function readWorkflowDraft(storage:WorkspaceStore,id:string):{raw:string|null;value:WorkflowDraft|null}{
 const raw=storage.getItem(WORKFLOW_DRAFT_KEY);if(raw===null)return {raw,value:null}
 const v=JSON.parse(raw)
 if(v?.schemaVersion!==1||v.workspaceId!==id||!v.head||!Number.isSafeInteger(v.head.revision)||!Number.isSafeInteger(v.head.selectedRevision)||!v.head.groups||typeof v.candidateChoices!=='object'||v.candidateChoices===null||['selected','candidateId','model','planningModel','analysisTraceRequestId','annotation','manual','rebaseId'].some(k=>typeof v[k]!=='string'))throw Error('工作流程恢复数据损坏或跨 Project；原数据保留，未加载其他记录')
 for(const ref of [v.source,v.inputSource])if(ref!==null&&(!ref||typeof ref.id!=='string'||typeof ref.hash!=='string'))throw Error('工作流程 Source 引用损坏；原数据保留')
 if(Array.isArray(v.head.groups)||Object.values(v.candidateChoices).some(choice=>typeof choice!=='string'))throw Error('工作流程选择格式损坏')
 for(const stage of ['analysis','review']){const id=v.head[stage+'Id'],hash=v.head[stage+'Hash'];if(id!==null&&(typeof id!=='string'||typeof hash!=='string'))throw Error('工作流程引用缺少明确 ID / Hash')}
 return {raw,value:v}
}
export function saveWorkflowDraft(storage:WorkspaceStore,value:WorkflowDraft,expected:string|null){
 if(storage.getItem(WORKFLOW_DRAFT_KEY)!==expected)throw Error('工作流程草稿已被其他页面更新；未覆盖，请保留本页并导出当前草稿')
 const raw=JSON.stringify(value);if(raw!==expected)storage.setItem(WORKFLOW_DRAFT_KEY,raw);return raw
}
export function resolveWorkflowDraft(draft:WorkflowDraft,history:DraftHistory){
 const source=draft.source,head=draft.head
 const exact=<T extends RecordBase>(records:T[],id:string|null,hash?:string|null):T|null=>{
  if(!id){if(hash)throw Error('恢复引用缺少 ID');return null}
  const r=records.find(r=>r.id===id&&r.hash===hash)
  if(!r||r.projectId!==draft.workspaceId||r.sourceId!==source?.id||r.sourceHash!==source.hash)throw Error('恢复记录的 Project / Source / ID / Hash 不一致：'+id+'；原草稿保留')
  return r
 }
 const analysis=exact(history.analyses,head.analysisId,head.analysisHash),review=exact(history.reviews,head.reviewId,head.reviewHash)
 if(review&&(review.analysisId!==analysis?.id||review.analysisHash!==analysis?.hash))throw Error('恢复 Review 的 Analysis 来源不一致')
 if(analysis){
  const ids=analysis.evidence.observations.map(o=>o.id).sort(),pieces=draft.form?.pieces
  if(!Array.isArray(pieces)||canonical(pieces.map(p=>p.id).sort())!==canonical(ids)||!Array.isArray(draft.form?.constraints)||pieces.some(p=>typeof p.confirmed!=='boolean'||typeof p.excluded!=='boolean'))throw Error('恢复 Review 草稿成员或格式与 Analysis 不一致')
 }else if(draft.form!==null||review)throw Error('恢复草稿缺少明确的 Analysis')
 for(const slot of Object.values(head.groups)){
  const plan=exact(history.plans,slot.plan.id,slot.plan.hash)
  if(!review||plan?.reviewId!==review.id||plan?.reviewHash!==review.hash)throw Error('恢复 Plan 的 Review 来源不一致')
  if(slot.execution){const x=exact(history.executions,slot.execution.id,slot.execution.hash);if(x?.planId!==plan?.id||x?.planHash!==plan?.hash||x?.reviewId!==review.id||x?.reviewHash!==review.hash)throw Error('恢复 Execution 的 Plan 来源不一致')}
 }
 return {analysis,review}
}
export function selectedHeadsEqual(a:SelectedHead,b:SelectedHead){
 return canonical({...a,analysisHash:a.analysisHash??null,reviewHash:a.reviewHash??null})===canonical({...b,analysisHash:b.analysisHash??null,reviewHash:b.reviewHash??null})
}
export type SelectionReceipt={kind:'plan'|'execution';id:string;hash:string;groupId:string}
export function headMatchesOwnSelection(old:SelectedHead,next:SelectedHead,receipt:SelectionReceipt){
 const selected=next.groups[receipt.groupId]?.[receipt.kind]
 const otherGroups=(h:SelectedHead)=>Object.fromEntries(Object.entries(h.groups).filter(([id])=>id!==receipt.groupId))
 return next.revision===old.revision&&next.analysisId===old.analysisId&&next.analysisHash===old.analysisHash&&next.reviewId===old.reviewId&&next.reviewHash===old.reviewHash&&selected?.id===receipt.id&&selected?.hash===receipt.hash&&canonical(otherGroups(next))===canonical(otherGroups(old))
}

/** Migration has one explicit source (the scoped legacy context) and one
 * project-owned Selected head. It never searches for a latest/nearby record. */
export async function migrateLegacyWorkflow(id:string,storage:WorkspaceStore,api:<T>(route:string)=>Promise<T>){
 if(storage.getItem(WORKFLOW_DRAFT_KEY)!==null){readWorkflowDraft(storage,id);return}
 const old=JSON.parse(storage.getItem(LEGACY_CONTEXT_KEY)??'null'),draft=emptyWorkflowDraft(id)
 if(old){
  if(old.sourceId){
   const source=await api<Source>('sources/'+old.sourceId),prefix='visible3d/project/'+id+'/'
   const [history,head]=await Promise.all([api<DraftHistory>(prefix+'history'),api<SelectedHead>(prefix+'head/'+source.id)])
   draft.source={id:source.id,hash:source.hash};draft.head=head
   if(head.analysisId){
    const a=history.analyses.find(a=>a.id===head.analysisId&&a.hash===head.analysisHash&&a.projectId===id),r=history.reviews.find(r=>r.id===head.reviewId&&r.hash===head.reviewHash&&r.projectId===id)
    if(!a||head.reviewId&&!r)throw Error('旧工作区的明确 Selected 记录不可验证')
    draft.form=r?structuredClone(r.input.review):{pieces:a.evidence.observations.map(o=>({id:o.id,confirmed:false,excluded:false,profileId:null,profileVersion:null,color:o.color})),constraints:[]}
   }
   resolveWorkflowDraft(draft,history)
  }
  if(old.inputSourceId){const s=await api<Source>('sources/'+old.inputSourceId);draft.inputSource={id:s.id,hash:s.hash}}
  if(typeof old.model==='string')draft.model=old.model
  if(typeof old.analysisTraceRequestId==='string')draft.analysisTraceRequestId=old.analysisTraceRequestId
  if(typeof old.candidateId==='string')draft.candidateId=old.candidateId
  if(old.candidateChoices){if(typeof old.candidateChoices!=='object'||Array.isArray(old.candidateChoices)||Object.values(old.candidateChoices).some(v=>typeof v!=='string'))throw Error('旧工作区候选选择格式损坏');draft.candidateChoices=old.candidateChoices}
 }
 saveWorkflowDraft(storage,draft,null)
}

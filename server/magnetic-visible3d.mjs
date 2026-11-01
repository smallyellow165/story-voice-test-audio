import {rebaseSpatialPlan,exactProfileReview} from '../src/magnetic-tiles/three-d/reconstruction/rebase-plan.ts'
import {candidateObservationMap,inspectSpatialConsistency} from '../src/magnetic-tiles/three-d/reconstruction/spatial-consistency.ts'
// Shared DUPLO request lifecycle + immutable magnetic evidence records; no brick geometry.
import {mkdir,readFile,writeFile,link,unlink,readdir,rename} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {recordedSpatialOperation,resumeSpatialOperation} from './spatial-operation.mjs'
import {shareText} from './llm-traces.mjs'
import {planningParticipation} from '../src/magnetic-tiles/three-d/reconstruction/planning-preflight.ts'
import {modelOptions,providerStatus} from './brick-model-registry.mjs'
import {assertImageEvidence} from '../src/magnetic-tiles/intake/image-set.ts'
import {runVisibleModel,resumeVisibleAnalysis,visiblePromptStatus,visiblePromptVersion} from './magnetic-visible3d-vision.mjs'
import {parseVisibleEvidence,validateVisibleInput,parseSpatialHypothesis} from '../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {adaptProfile} from '../src/magnetic-tiles/three-d/profile-adapter.ts'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {diagnosticHandoffCheck} from '../src/magnetic-tiles/three-d/reconstruction/diagnostic-handoff.ts'
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const kinds=['analyses','reviews','plans','executions','origins']
const identifier=x=>{if(typeof x!=='string'||!/^([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(x))fail('Visible 3D 记录 ID 无效');return x}
export function createVisible3DWorkflow(directory,{readSource,readImage,readImages,getRegistry,runModel=runVisibleModel}){
 const operation=recordedSpatialOperation(path.join(directory,'requests'))
 const filename=(kind,id)=>path.join(directory,kind,identifier(id)+'.json')
 async function put(kind,data){
  const payload={...data,id:data.id??randomUUID(),createdAt:data.createdAt??new Date().toISOString()},r={...payload,hash:hash(payload)},f=filename(kind,r.id),temp=f+'.'+randomUUID()+'.tmp'
  await mkdir(path.dirname(f),{recursive:true});await writeFile(temp,JSON.stringify(r),{flag:'wx',mode:0o600})
  try{await link(temp,f)}finally{await unlink(temp)} return r
 }
 async function read(kind,id){if(!kinds.includes(kind))fail('未知记录类型');const r=JSON.parse(await readFile(filename(kind,id),'utf8'));const {hash:h,...p}=r;if(h!==hash(p)||r.id!==id)fail('记录 Hash 不一致');return r}
 async function head(sourceId){try{return JSON.parse(await readFile(filename('heads',sourceId),'utf8'))}catch(e){if(e.code==='ENOENT')return {revision:0,reviewId:null};throw e}}
 async function locked(sourceId,work){const f=filename('heads',sourceId)+'.lock';await mkdir(path.dirname(f),{recursive:true});try{await writeFile(f,'lock',{flag:'wx',mode:0o600})}catch(e){if(e.code==='EEXIST')fail('该来源正在更新；请重新加载后重试',409);throw e}try{return await work()}finally{await unlink(f)}}
 async function verifyModelRecord(r){
  if(r.origin!=='model')return
  const trace=JSON.parse(await readFile(path.join(directory,'model-traces',identifier(r.traceId)+'.json'),'utf8'))
  if(hash(trace)!==r.traceHash||trace.status!=='plan_ready_for_review'||trace.wireStatus!=='response_saved'||hash(trace.plan)!==hash(r.evidence??r.plan)||hash(JSON.parse(trace.rawOutput))!==hash(trace.plan)||trace.requestInput.source.hash!==r.sourceHash||trace.requestInput.source.id!==r.sourceId)fail('模型 Trace 与正式记录不一致',409)
 }
 async function lineage(kind,id){
  const r=await read(kind,id),review=kind==='reviews'?r:kind==='plans'?await read('reviews',r.reviewId):kind==='executions'?await read('reviews',r.reviewId):null
  const analysis=kind==='analyses'?r:await read('analyses',review.analysisId),source=await readSource(analysis.sourceId)
  if(analysis.sourceHash!==source.hash||review&&(review.analysisHash!==analysis.hash||review.sourceHash!==source.hash)||r.sourceHash!==source.hash)fail('来源关联不一致',409)
  if(kind==='plans'&&r.reviewHash!==review.hash||kind==='executions'&&r.reviewHash!==review.hash)fail('Review Hash 不一致',409)
  if(kind==='executions'){const p=await read('plans',r.planId);if(p.hash!==r.planHash||p.reviewId!==review.id||p.reviewHash!==review.hash)fail('Execution Plan 来源不一致',409)}
  await verifyModelRecord(analysis);if(kind==='plans')await verifyModelRecord(r);if(kind==='executions')await verifyModelRecord(await read('plans',r.planId))
  const current=await head(source.id)
  return {record:r,review,analysis,source,head:current,outdated:!!review&&current.reviewId!==review.id}
 }
 async function modelRecord(kind,body,checkpoint){
  const source=kind==='analysis'?await readSource(body.sourceId):(await lineage('reviews',body.reviewId)).source
  let review=null
  if(kind==='plan'){const l=await lineage('reviews',body.reviewId);if(l.outdated)fail('Review 已过期',409);review=l.review;const {blocker}=planningParticipation(review.input.review);if(blocker)fail(blocker,422)}
  const image=await readImage(source),registry=await getRegistry()
  const geometryInput=review?{...review.input,review:exactProfileReview(review.input.review)}:undefined
  if(source.images?.length>1&&!readImages)fail('多图来源缺少图片集合适配器；未调用模型')
  const images=readImages?await readImages(source):null
  const prepared={image,source,...(images?{images}:{}),input:{source:{id:source.id,hash:source.hash,width:source.view.width,height:source.view.height},...(source.images?{referenceImageId:source.primaryImageId,images:source.images,...(source.images.length>1?{analysisMode:'visible3d',imageEvidencePolicy:'Target final state only. A physical tile may move between steps. Per-frame feature IDs are local to their image. Executable evidenceRefs use observation IDs or reference-image observationId:featureId; cite other image IDs explicitly in evidence/uncertainty. Never treat step poses/connections as final by default.'}:{})}:{}),...(geometryInput?{geometryInput,ports:geometryInput.profiles.map(s=>({profileId:s.profile.id,profileVersion:s.profile.version,...adaptProfile(s)}))}:{catalog:registry.profiles})},imagePayloadSha256:source.view.hash,geometrySnapshot:geometryInput?.profiles??registry.profiles}
  const trace=await runModel(prepared,{model:body.model,directory:path.join(directory,'model-traces'),sources:[{sourceId:source.id,sourceHash:source.hash,reviewId:review?.id??null,reviewHash:review?.hash??null}],execute:true,onTrace:async t=>{if(t.background)await checkpoint({trace:t,state:'running'})}},kind==='analysis'?'analysis':'plan')
  return saveModelResult(kind,trace,source,registry,review)
 }
 async function saveModelResult(kind,trace,source,registry,review){
  const geometryInput=review?.input
  // A parsed object alone is insufficient: require complete saved wire provenance.
  const usable=trace.status==='plan_ready_for_review'&&trace.parseStatus==='parsed'&&trace.validation?.valid&&trace.wireStatus==='response_saved'&&['STOP','completed'].includes(trace.finishReason)&&hash(JSON.parse(trace.rawOutput))===hash(trace.plan)
  if(!usable){
   const error=trace.error?.message||(trace.parseStatus==='invalid_json'?'模型输出 JSON 解析失败；原始响应已保留。':trace.validation?.issues?.join('；'))||(trace.background?.state==='completed'?'后台请求已完成，但没有通过契约检查的输出；请查看 Trace。':'后台请求尚未完成；不会重新提交。')
   return {trace,usable:false,...(trace.background?{state:['running','submitting'].includes(trace.background.state)?'running':['timeout','unknown'].includes(trace.background.state)?trace.background.state:'failed',error}:{})}
  }
  if(kind==='analysis'){assertImageEvidence(trace.plan,source);if(source.images?.length>1&&trace.plan.referenceImageId!==source.primaryImageId)fail('参考图片来源不一致')}
  if(kind==='analysis')for(const o of parseVisibleEvidence(trace.plan).observations)for(const p of o.profileCandidates)if(!registry.profiles.some(r=>r.id===p.profileId&&r.version===p.profileVersion))fail('模型候选 Profile 不在 Registry')
  const data=kind==='analysis'?{evidence:parseVisibleEvidence(trace.plan)}:{plan:parseSpatialHypothesis(trace.plan,geometryInput),reviewId:review.id,reviewHash:review.hash}
  // Stable ID makes completion recovery idempotent even after a server restart
  // between immutable Analysis creation and the request checkpoint.
  const target=kind==='analysis'?'analyses':'plans'
  if(trace.background){const old=await read(target,trace.id).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(old){if(old.traceHash!==hash(trace)||old.sourceHash!==source.hash)fail('完成记录与 Trace 不一致',409);return {record:old,trace,usable:true,state:'complete'}}}
  const r=await put(target,{...data,...(trace.background?{id:trace.id}:{}),sourceId:source.id,sourceHash:source.hash,origin:'model',promptVersion:trace.promptVersion??visiblePromptVersion,traceId:trace.id,traceHash:hash(trace),...(kind==='analysis'?{catalogHash:registry.hash}:{})})
  return {record:r,trace,usable:true,...(trace.background?{state:'complete',error:null}:{})}
 }
 return {read,head,lineage,async dispatch(method,route,body={}){
  if(method==='GET'&&route==='status')return {models:modelOptions('reverse'),planningModels:modelOptions('design'),providers:providerStatus(),prompt:await visiblePromptStatus()}
  if(method==='GET'&&route==='requests'){const files=await readdir(path.join(directory,'requests')).catch(e=>{if(e.code==='ENOENT')return [];throw e});return Promise.all(files.filter(f=>/^[a-f0-9-]+\.json$/.test(f)).map(async f=>{
   const r=JSON.parse(await readFile(path.join(directory,'requests',f),'utf8')),b=r.trace?.background
   // Presentation only: an interrupted submit cannot be called "running"
   // forever. Keep the saved evidence unchanged and never retry the POST.
   if(b?.state==='submitting'&&!b.responseId&&Date.now()-Date.parse(r.createdAt)>95000)return {...r,state:'unknown',error:'提交确认中断；未保存 Provider Response ID，执行与计费状态未知，不会自动重发。',trace:{...r.trace,background:{...b,state:'unknown'}}}
   return r
  }))}
  if(method==='GET'&&route==='history'){
   const result={};for(const k of kinds){const files=await readdir(path.join(directory,k)).catch(e=>{if(e.code==='ENOENT')return [];throw e});result[k]=await Promise.all(files.filter(f=>/^[a-f0-9-]+\.json$/.test(f)).map(f=>read(k,f.slice(0,-5))));result[k].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}return result
  }
  if(method==='GET'&&route.startsWith('trace/')){
   const [,value,section,...extra]=route.split('/'),traceId=identifier(value)
   if(extra.length||section&&section!=='wire')fail('未知 Trace 内容',404)
   const prefix=path.join(directory,'model-traces',traceId),trace=JSON.parse(await readFile(prefix+'.json','utf8'))
   if(!section)return trace
   // Read-only view adapter: derive paths from the validated ID, never from a
   // stored absolute path. Reuse the existing Trace redaction and availability.
   async function wire(suffix){try{return {available:true,origin:traceId+suffix,...shareText(await readFile(prefix+suffix,'utf8'))}}catch(e){if(e.code==='ENOENT')return {available:false,text:'未保存实际 HTTP wire 正文；不会用应用请求或解析结果补齐。'};throw e}}
   const submission=await wire('.response.txt')
   let response=submission
   if(trace.latestPollId){const pollId=identifier(trace.latestPollId);response=await (async()=>{try{return {available:true,origin:traceId+'.polls/'+pollId+'.response.txt',...shareText(await readFile(path.join(directory,'model-traces',traceId+'.polls',pollId+'.response.txt'),'utf8'))}}catch(e){if(e.code==='ENOENT')return {available:false,text:'该次 GET 未收到实际响应；不会用之前的响应冒充。'};throw e}})()}
   return {traceId,request:await wire('.request.json'),response,...(trace.background?{submissionResponse:submission,pollingNote:'每次查询的 GET 元数据与原始响应保存在同一 Trace 的 .polls 目录；不是重新生成。'}:{})}
  }
  if(method==='GET'&&route.startsWith('head/'))return head(identifier(route.slice(5)))
  if(method==='GET'&&route.includes('/')){const [kind,id]=route.split('/');if(kind==='origins')return read(kind,id);return lineage(kind,id)}
  if(method!=='POST')fail('未知 Visible 3D 操作',404)
  if(route==='analyze'||route==='plan')return operation(body,route,checkpoint=>modelRecord(route==='analyze'?'analysis':'plan',body,checkpoint))
  if(route==='resume-analyze')return resumeSpatialOperation(path.join(directory,'requests'),body.requestId,async(saved,checkpoint)=>{
   const source=await readSource(body.sourceId),traceId=identifier(saved.trace?.id)
   const trace=JSON.parse(await readFile(path.join(directory,'model-traces',traceId+'.json'),'utf8'))
   if(saved.kind!=='analyze'||source.hash!==body.sourceHash||trace.requestInput?.source?.id!==source.id||trace.requestInput.source.hash!==source.hash||!trace.sources?.some(s=>s.sourceId===source.id&&s.sourceHash===source.hash))fail('后台任务来源不一致；未查询或生成。',409)
   if(saved.record)return saved
   if(!trace.background?.responseId)fail('尚无 Provider Response ID，无法恢复该请求；不能确认是否已计费，不会自动重发。',409)
   const updated=await resumeVisibleAnalysis(path.join(directory,'model-traces'),traceId,source,async t=>checkpoint({trace:t}))
   return saveModelResult('analysis',updated,source,await getRegistry(),null)
  })
  if(route==='annotate'){
   const source=await readSource(body.sourceId),evidence=parseVisibleEvidence(body.evidence),registry=await getRegistry()
   assertImageEvidence(evidence,source);if(source.images?.length>1&&evidence.referenceImageId!==source.primaryImageId)fail('参考图片来源不一致')
   for(const o of evidence.observations)for(const p of o.profileCandidates)if(!registry.profiles.some(r=>r.id===p.profileId&&r.version===p.profileVersion))fail('Observation 引用了未知 Catalog Profile')
   return put('analyses',{sourceId:source.id,sourceHash:source.hash,evidence,origin:'human-annotation',traceId:null,warning:'人工标注，不代表模型识别测试成功'})
  }
  if(route==='reviews'){
   const {analysis,source}=await lineage('analyses',body.analysisId)
   const registry=await getRegistry(),snapshots=[]
   for(const p of body.review?.pieces??[]){if(!p.profileId)continue;const profile=registry.profiles.find(r=>r.id===p.profileId&&r.version===p.profileVersion);if(!profile)fail('Review Profile 不在 Registry');if(!snapshots.some(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion))snapshots.push({profile,thickness:body.thickness??0.06})}
   const input=validateVisibleInput({evidence:analysis.evidence,review:body.review,profiles:snapshots})
   input.review=exactProfileReview(input.review)
   return locked(source.id,async()=>{const current=await head(source.id);if(body.expectedRevision!==current.revision)fail('Review 已被其他页面更新，未覆盖',409)
    const review=await put('reviews',{sourceId:source.id,sourceHash:source.hash,analysisId:analysis.id,analysisHash:analysis.hash,input,registryHash:registry.hash})
    const next={revision:current.revision+1,reviewId:review.id,reviewHash:review.hash},f=filename('heads',source.id),temp=f+'.tmp';await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,f);return {record:review,head:next}
   })
  }
  if(route==='manual-plan'){
   const l=await lineage('reviews',body.reviewId);if(l.outdated)fail('Review 已过期',409)
   let base=null;if(body.basedOnPlanId){const b=await lineage('plans',body.basedOnPlanId);if(b.outdated||b.review.id!==l.review.id)fail('人工计划的来源 Plan 已过期或不属于当前 Review',409);base=b.record}
   return put('plans',{sourceId:l.source.id,sourceHash:l.source.hash,reviewId:l.review.id,reviewHash:l.review.hash,plan:parseSpatialHypothesis(body.plan,l.review.input),origin:'human-hypothesis',traceId:null,...(base?{basedOnPlanId:base.id,basedOnPlanHash:base.hash}:{})})
  }
  if(route==='rebase-plan'){
   const current=await lineage('reviews',body.reviewId),old=await lineage('plans',body.planId)
   if(current.outdated||current.source.id!==old.source.id||current.analysis.id!==old.analysis.id)fail('只能在同一 Analysis 的当前 Review 中明确沿用旧计划',409)
   const rebased=rebaseSpatialPlan(old.record.plan,old.review.input,current.review.input)
   return put('plans',{sourceId:current.source.id,sourceHash:current.source.hash,reviewId:current.review.id,reviewHash:current.review.hash,...rebased,origin:'human-rebased-hypothesis',traceId:null,basedOnPlanId:old.record.id,basedOnPlanHash:old.record.hash,basedOnReviewId:old.review.id,basedOnReviewHash:old.review.hash})
  }
  if(route==='execute')return operation(body,route,async()=>{
   const l=await lineage('plans',body.planId);if(l.outdated)fail('Review 已改变，旧 Plan 不可执行',409)
   const execution=executeVisible3D(l.record.plan,l.review.input,{...body.options,algorithmVersion:3})
   return {record:await put('executions',{...execution,options:body.options??{},planId:l.record.id,planHash:l.record.hash,reviewId:l.review.id,reviewHash:l.review.hash,sourceId:l.source.id,sourceHash:l.source.hash})}
  })
  if(route==='open-diagnostic-draft'){
   const initial=await lineage('executions',body.executionId)
   return locked(initial.source.id,async()=>{
    const l=await lineage('executions',body.executionId),r=l.record
    if(l.outdated)fail('Review 已改变：Diagnostic 过期，禁止进入编辑器',409)
    if(body.override!==true)fail('请明确授权强制允许进入 Assembly Editor')
    if(body.executionHash!==r.hash)fail('Diagnostic Execution Hash 不一致',409)
    const p=await read('plans',r.planId)
    if(r.sourceId!==l.source.id||l.review.sourceId!==l.source.id||p.sourceId!==l.source.id||p.reviewId!==l.review.id)fail('Diagnostic 来源身份不一致',409)
    const verified=executeVisible3D(p.plan,l.review.input,{...r.options,algorithmVersion:3})
    const c=r.diagnosticCandidates?.find(c=>c.id===body.candidateId),actual=verified.diagnosticCandidates?.find(c=>c.id===body.candidateId)
    if(r.version<3||!c||!actual||hash(c)!==hash(actual))fail('Diagnostic 身份或快照复核失败')
    const check=diagnosticHandoffCheck(c)
    if(!check.allowed)fail('仅 Ideal Geometry Valid 且 Solid Collision Invalid 的 Diagnostic 可进入待修复 Draft')
    const observationMap=c.observationMap??candidateObservationMap(c.assembly,l.review.input),spatialConsistency=inspectSpatialConsistency(c.assembly,l.review.input,observationMap)
    if(spatialConsistency.status==='contradicted')fail('违反已审核空间关系，不能通过实体碰撞 Override 进入编辑器')
    const assembly={...structuredClone(c.assembly),id:'visible-'+randomUUID(),revision:0}
    return put('origins',{sourceId:l.source.id,sourceHash:l.source.hash,analysisId:l.analysis.id,analysisHash:l.analysis.hash,reviewId:l.review.id,reviewHash:l.review.hash,planId:p.id,planHash:p.hash,executionId:r.id,executionHash:r.hash,candidateId:c.id,candidateHash:hash(c),assembly,coverage:c.coverage,unverifiedConstraints:c.unverifiedConstraints,photoMatch:c.photoMatch,humanReview:{status:'pending'},observationMap,spatialConsistency,
     entryMode:'diagnostic-override',authorization:{scope:'editor-draft-only',explicit:true,at:new Date().toISOString()},diagnostic:{id:c.id,hash:hash(c),geometry:c.geometry,validation:c.validation??check.validation,recheckedGeometry:check.geometry,collisions:c.collisions??[],construction:c.construction??null}})
   })
  }
  if(route==='adopt'){
   const initial=await lineage('executions',body.executionId)
   return locked(initial.source.id,async()=>{
    const l=await lineage('executions',body.executionId);if(l.outdated)fail('Review 已改变：Candidate 过期，禁止采用',409)
    if(body.visualChecked!==true)fail('请先对照原图，确认候选及未验证项')
    const r=l.record;
    if(r.diagnosticCandidates?.some(c=>c.id===body.candidateId))fail('Diagnostic Candidate 未通过严格 Validator，仅供观察，禁止普通采用',422)
    const p=await read('plans',r.planId),verified=executeVisible3D(p.plan,l.review.input,{...r.options,algorithmVersion:r.version>=3?3:2})
    const c=r.candidates.find(c=>c.id===body.candidateId),actual=verified.candidates.find(c=>c.id===body.candidateId)
    const {observationMap:_mapping,spatialConsistency:_spatial,...legacyActual}=actual??{}
    const matches=c&&actual&&hash(c)===hash(r.version===1?legacyActual:actual)
    if(!r.completeSearch||!c||!actual||!matches||!validateAssembly3D(c.assembly).valid)fail('Candidate 复核失败或不是 Geometry Valid',422)
    const observationMap=c.observationMap??candidateObservationMap(c.assembly,l.review.input),spatialConsistency=inspectSpatialConsistency(c.assembly,l.review.input,observationMap)
    if(spatialConsistency.status==='contradicted')fail('Geometry Valid 但违反已审核空间关系；请修正 Review 后重新执行',422)
    // Identity is unique per adoption, all authoritative poses/profiles remain exact.
    const assembly={...c.assembly,id:'visible-'+randomUUID(),revision:0}
    return put('origins',{sourceId:l.source.id,sourceHash:l.source.hash,analysisId:l.analysis.id,analysisHash:l.analysis.hash,reviewId:l.review.id,reviewHash:l.review.hash,planId:p.id,planHash:p.hash,executionId:r.id,executionHash:r.hash,candidateId:c.id,candidateHash:hash(c),assembly,coverage:c.coverage,unverifiedConstraints:c.unverifiedConstraints,photoMatch:c.photoMatch,humanReview:{status:'accepted',at:new Date().toISOString()},observationMap,spatialConsistency})
   })
  }
  fail('未知 Visible 3D 操作',404)
 }}
}

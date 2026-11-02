import {canonicalGeometryContract,canonicalProfileSnapshot,canonicalGeometryManifest,assertCanonicalProfiles} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {reconstructionInput,reconstructionScopeMatches} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-scope.ts'
import {assertModules,changeModules} from '../src/magnetic-tiles/three-d/reconstruction/module-plan.ts'
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
import {refineConstraints} from '../src/magnetic-tiles/three-d/reconstruction/constraint-refinement.ts'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {diagnosticHandoffCheck,humanDiagnosticHandoffCheck} from '../src/magnetic-tiles/three-d/reconstruction/diagnostic-handoff.ts'
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const kinds=['analyses','reviews','plans','executions','origins','refinements','module-plans']
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
  const r=await read(kind,id),review=kind==='reviews'?r:kind==='plans'?await read('reviews',r.reviewId):['executions','refinements','module-plans'].includes(kind)?await read('reviews',r.reviewId):null
  const analysis=kind==='analyses'?r:await read('analyses',review.analysisId),source=await readSource(analysis.sourceId)
  if(analysis.sourceHash!==source.hash||review&&(review.analysisHash!==analysis.hash||review.sourceHash!==source.hash)||r.sourceHash!==source.hash)fail('来源关联不一致',409)
  if(kind==='plans'&&r.reviewHash!==review.hash||['executions','refinements','module-plans'].includes(kind)&&r.reviewHash!==review.hash)fail('Review Hash 不一致',409)
  if(['executions','refinements'].includes(kind)){const p=await read('plans',r.planId);if(p.hash!==r.planHash||p.reviewId!==review.id||p.reviewHash!==review.hash)fail('Execution Plan 来源不一致',409)}
  await verifyModelRecord(analysis);if(kind==='plans')await verifyModelRecord(r);if(['executions','refinements'].includes(kind))await verifyModelRecord(await read('plans',r.planId))
  if(kind==='module-plans'){if(r.kind!=='magnetic-module-plan'||r.schemaVersion!==1||r.analysisId!==analysis.id||r.analysisHash!==analysis.hash||r.sourceId!==source.id||r.reviewId!==review.id)fail('Module Plan 来源不一致',409);assertModules(r.modules,review.input.review)}
  const current=await head(source.id)
  const planRecord=kind==='plans'?r:['executions','refinements'].includes(kind)?await read('plans',r.planId):null
  const geometryReview=planRecord?await scopedPlanReview(planRecord,review,source):review
  if(kind==='executions'&&r.reconstructionScope&&hash(r.reconstructionScope)!==hash(planScope(planRecord)))fail('Execution 重建范围与 Plan 不一致',409)
  return {record:r,review,geometryReview,analysis,source,head:current,outdated:!!review&&current.reviewId!==review.id}
 }
 // A view preference is never trusted as executable input. Re-derive every
 // immutable refinement from the exact Plan + Review on execution and adoption.
 async function executionPlan(p,review,reference){
  if(p.geometryContract!==canonicalGeometryContract)fail('Plan 缺少当前 Canonical Geometry 契约，请重新 Spatial Planning；不转换历史 Port 编号',409)
  assertCanonicalProfiles(review.input.profiles,(await getRegistry()).profiles)
  if(reference===undefined||reference===null)return p.plan
  const r=await read('refinements',reference.id).catch(e=>{if(e.code==='ENOENT')fail('Refinement 文件不存在，不能回退到原始 Plan',409);throw e})
  if(r.version!==1||r.refinement.version!==1||r.refinement.algorithm!=='port-conflict-subsets-v1')fail('Refinement 版本不支持',409)
  if(r.hash!==reference.hash||r.planId!==p.id||r.planHash!==p.hash||r.reviewId!==review.id||r.reviewHash!==review.hash||r.sourceId!==p.sourceId||r.sourceHash!==p.sourceHash)fail('Refinement 来源或 Hash 不一致',409)
  const actual=refineConstraints(p.plan,review.input,{...r.refinement.options,protectPlan:p.origin!=='model'})
  if(hash(actual)!==hash(r.refinement))fail('Refinement 差异复核失败',409)
  const c=actual.candidates.find(c=>c.id===reference.candidateId)
  if(!c||hash(c)!==reference.candidateHash||c.consistency.portConflicts.length)fail('Refinement Candidate 身份或约束复核失败',409)
  return c.plan
 }
 function executePlan(plan,review,options,refined){
  const result=executeVisible3D(plan,review.input,options)
  if(!refined)return result
  const pair=c=>[c.pieceA,c.pieceB].sort().join('|')
  const allowed=c=>review.input.review.constraints.filter(c=>c.intent==='connect').every(required=>c.assembly.connections.some(edge=>pair(edge)===pair(required)))&&
   (review.input.review.spatialChecks??[]).filter(s=>s.relation==='plane-angle'||s.relation==='shared-edge').every(s=>[s.pieceA,s.pieceB].every(id=>c.assembly.pieces.some(p=>p.id===id)))&&c.spatialConsistency?.status!=='contradicted'
  const rejected=result.candidates.filter(c=>!allowed(c))
  if(rejected.length){result.candidates=result.candidates.filter(allowed);result.diagnostics.push('REFINEMENT_REVIEW_BLOCKED: 局部候选缺少或违反人工硬约束，不能采用：'+rejected.map(c=>c.id).join(', '));if(result.status==='candidates_found'&&!result.candidates.length)result.status='no_valid_candidate'}
  return result
 }
 async function replayExecution(r,p,review){
  review=await scopedPlanReview(p,review,await readSource(review.sourceId))
  const plan=await executionPlan(p,review,r.refinement)
  if(r.refinement&&r.effectivePlanHash!==hash(plan))fail('Execution Refinement 快照不一致',409)
  return executePlan(plan,review,{...r.options,...(r.version===5?{protectPlanConnections:p.origin!=='model'}:{}),algorithmVersion:r.version===5?5:r.version===4?4:r.version>=3?3:2},!!r.refinement)
 }
 async function moduleHead(reviewId){try{return JSON.parse(await readFile(filename('module-heads',reviewId),'utf8'))}catch(e){if(e.code==='ENOENT')return {revision:0,recordId:null,recordHash:null,modulePlanId:null};throw e}}
 async function moduleState(reviewId){
  const l=await lineage('reviews',identifier(reviewId)),h=await moduleHead(l.review.id),history=[]
  for(const f of await readdir(path.join(directory,'module-plans')).catch(e=>{if(e.code==='ENOENT')return [];throw e})){if(!/^[a-f0-9-]+\.json$/.test(f))continue;const r=await read('module-plans',f.slice(0,-5));if(r.reviewId===l.review.id){await lineage('module-plans',r.id);history.push(r)}}
  history.sort((a,b)=>b.revision-a.revision||b.createdAt.localeCompare(a.createdAt))
  const record=h.recordId?history.find(r=>r.id===h.recordId):null
  if(h.recordId&&(!record||record.hash!==h.recordHash||record.revision!==h.revision||record.modulePlanId!==h.modulePlanId))fail('Module Plan Head / Hash 不一致',409)
  return {head:h,record,history,outdated:l.outdated,reviewId:l.review.id,reviewHash:l.review.hash}
 }
 async function writeModuleHead(record){
  const next={revision:record.revision,recordId:record.id,recordHash:record.hash,modulePlanId:record.modulePlanId},f=filename('module-heads',record.reviewId),tmp=f+'.'+randomUUID()+'.tmp'
  await mkdir(path.dirname(f),{recursive:true});await writeFile(tmp,JSON.stringify(next),{mode:0o600});await rename(tmp,f);return next
 }
 function inheritedModules(previous,review){
  if(previous.sourceId!==review.sourceId||previous.sourceHash!==review.sourceHash||previous.analysisId!==review.analysisId||previous.analysisHash!==review.analysisHash)fail('不能跨 Analysis 或图片来源继承模块',409)
  const allowed=new Set(review.input.review.pieces.map(p=>p.id)),modules=previous.modules.map(m=>({...m,observationIds:m.observationIds.filter(id=>allowed.has(id))}))
  assertModules(modules,review.input.review)
  return {modules,change:{kind:'inherit',moved:[],inheritedFrom:{id:previous.id,hash:previous.hash}}}
 }
 function planScope(plan){return plan.reconstructionScope??{version:1,groupId:'all',groupName:'全部模块',imageId:'all',imageName:'所有图片',observationIds:plan.plan.parts.map(p=>p.id)}}
 async function requestedScope(review,source,selection){
  const groupId=selection?.groupId??'all'
  const modules=groupId==='all'?null:(await moduleState(review.id)).record
  let projected;try{projected=reconstructionInput(review.input,source,selection,modules)}catch(e){fail(e.message,422)}
  if(selection?.observationIds&&!reconstructionScopeMatches(selection,projected.scope))fail('重建范围已变化，请重新选择范围后执行',409)
  return projected
 }
 async function scopedPlanReview(plan,review,source){
  if(!plan.reconstructionScope)return review
  const scope=plan.reconstructionScope
  let modules=null
  if(scope.groupId!=='all'){
   if(!scope.modulePlan)fail('模块范围缺少保存来源',409)
   const saved=await lineage('module-plans',scope.modulePlan.id)
   if(saved.review.id!==review.id||saved.record.hash!==scope.modulePlan.hash)fail('模块范围来源或 Hash 不一致',409)
   modules=saved.record
  }
  const projected=reconstructionInput(review.input,source,scope,modules)
  if(hash(projected.scope)!==hash(scope))fail('Plan 重建范围或 Observation 快照不一致',409)
  if(plan.origin==='model'){
   const trace=JSON.parse(await readFile(path.join(directory,'model-traces',identifier(plan.traceId)+'.json'),'utf8'))
   if(hash(trace.requestInput.reconstructionScope)!==hash(scope)||hash(trace.requestInput.geometryInput)!==hash({...projected.input,review:exactProfileReview(projected.input.review)}))fail('Planning Trace 重建输入不一致',409)
  }
  return {...review,input:projected.input}
 }
 async function assertRequestedPlanScope(body,l){
  if(!body.reconstructionScope)return
  const actual=await requestedScope(l.review,l.source,body.reconstructionScope)
  if(!reconstructionScopeMatches(l.record.reconstructionScope,actual.scope,l.record.plan.parts.map(p=>p.id)))fail('所选 Plan 不属于当前 Group / Image 范围',409)
 }
 async function modelRecord(kind,body,checkpoint){
  const source=kind==='analysis'?await readSource(body.sourceId):(await lineage('reviews',body.reviewId)).source
  let review=null,scope=null
  if(kind==='plan'){const l=await lineage('reviews',body.reviewId);if(l.outdated)fail('Review 已过期',409);const {blocker:globalBlocker}=planningParticipation(l.review.input.review);if(globalBlocker)fail(globalBlocker,422);const projected=await requestedScope(l.review,l.source,body.reconstructionScope);if(!projected.scope.observationIds.length)fail('当前 Group 与 Image 没有可重建的交集；未调用模型',422);scope=projected.scope;review={...l.review,input:projected.input};const {blocker}=planningParticipation(review.input.review);if(blocker)fail(blocker,422)}
  const image=await readImage(source),registry=await getRegistry()
  const geometryInput=review?{...review.input,review:exactProfileReview(review.input.review)}:undefined
  if(source.images?.length>1&&!readImages)fail('多图来源缺少图片集合适配器；未调用模型')
  const images=readImages?await readImages(source):null
  if(geometryInput)assertCanonicalProfiles(geometryInput.profiles,registry.profiles)
  const prepared={image,source,...(images?{images}:{}),input:{...(scope?{reconstructionScope:scope}:{}),source:{id:source.id,hash:source.hash,width:source.view.width,height:source.view.height},...(source.images?{referenceImageId:source.primaryImageId,images:source.images,...(source.images.length>1?{analysisMode:'visible3d',imageEvidencePolicy:'Target final state only. A physical tile may move between steps. Per-frame feature IDs are local to their image. Executable evidenceRefs use observation IDs or reference-image observationId:featureId; cite other image IDs explicitly in evidence/uncertainty. Never treat step poses/connections as final by default.'}:{})}:{}),geometryContract:canonicalGeometryManifest(geometryInput?.profiles??registry.profiles.map(canonicalProfileSnapshot)),...(geometryInput?{geometryInput,ports:geometryInput.profiles.map(s=>({profileId:s.profile.id,profileVersion:s.profile.version,...adaptProfile(s)}))}:{catalog:registry.profiles})},imagePayloadSha256:source.view.hash,geometrySnapshot:geometryInput?.profiles??registry.profiles}
  const trace=await runModel(prepared,{model:body.model,directory:path.join(directory,'model-traces'),sources:[{sourceId:source.id,sourceHash:source.hash,reviewId:review?.id??null,reviewHash:review?.hash??null}],execute:true,onTrace:async t=>{if(t.background)await checkpoint({trace:t,state:'running'})}},kind==='analysis'?'analysis':'plan')
  return saveModelResult(kind,trace,source,registry,review,scope)
 }
 async function saveModelResult(kind,trace,source,registry,review,scope=null){
  const geometryInput=review?.input
  // A parsed object alone is insufficient: require complete saved wire provenance.
  const usable=trace.status==='plan_ready_for_review'&&trace.parseStatus==='parsed'&&trace.validation?.valid&&trace.wireStatus==='response_saved'&&['STOP','completed'].includes(trace.finishReason)&&hash(JSON.parse(trace.rawOutput))===hash(trace.plan)
  if(!usable){
   const error=trace.error?.message||(trace.parseStatus==='invalid_json'?'模型输出 JSON 解析失败；原始响应已保留。':trace.validation?.issues?.join('；'))||(trace.background?.state==='completed'?'后台请求已完成，但没有通过契约检查的输出；请查看 Trace。':'后台请求尚未完成；不会重新提交。')
   return {trace,usable:false,...(trace.background?{state:['running','submitting'].includes(trace.background.state)?'running':['timeout','unknown'].includes(trace.background.state)?trace.background.state:'failed',error}:{})}
  }
  if(kind==='analysis'){assertImageEvidence(trace.plan,source);if(source.images?.length>1&&trace.plan.referenceImageId!==source.primaryImageId)fail('参考图片来源不一致')}
  if(kind==='analysis')for(const o of parseVisibleEvidence(trace.plan).observations)for(const p of o.profileCandidates)if(!registry.profiles.some(r=>r.id===p.profileId&&r.version===p.profileVersion))fail('模型候选 Profile 不在 Registry')
  const data=kind==='analysis'?{evidence:parseVisibleEvidence(trace.plan)}:{geometryContract:canonicalGeometryContract,plan:parseSpatialHypothesis(trace.plan,geometryInput),reviewId:review.id,reviewHash:review.hash,...(scope?{reconstructionScope:scope}:{})}
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
  if(method==='GET'&&route.startsWith('module-state/'))return moduleState(route.slice(13))
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
   for(const p of body.review?.pieces??[]){if(!p.profileId)continue;const profile=registry.profiles.find(r=>r.id===p.profileId&&r.version===p.profileVersion);if(!profile)fail('Review Profile 不在 Registry');if(!snapshots.some(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion))snapshots.push(canonicalProfileSnapshot(profile))}
   if(body.thickness!==undefined&&snapshots.some(s=>s.thickness!==body.thickness))fail('厚度属于 Canonical Profile 版本；请在 Catalog 创建新版本，不能覆盖 Review 快照')
   const input=validateVisibleInput({evidence:analysis.evidence,review:body.review,profiles:snapshots})
   input.review=exactProfileReview(input.review)
   return locked(source.id,async()=>{const current=await head(source.id);if(body.expectedRevision!==current.revision)fail('Review 已被其他页面更新，未覆盖',409)
    // The selected Review is the editing base, even when it is historical.
    // Older clients fall back to the current Review of this exact Analysis.
    let base=null
    if(body.baseReview){const l=await lineage('reviews',identifier(body.baseReview.id));if(l.review.hash!==body.baseReview.hash||l.analysis.id!==analysis.id||l.analysis.hash!==analysis.hash||l.source.id!==source.id)fail('Review 编辑来源或 Hash 不一致',409);base=l.review}
    else if(current.reviewId){const l=await lineage('reviews',current.reviewId);if(l.analysis.id===analysis.id&&l.analysis.hash===analysis.hash)base=l.review}
    const previous=base?(await moduleState(base.id)).record:null
    const review=await put('reviews',{sourceId:source.id,sourceHash:source.hash,analysisId:analysis.id,analysisHash:analysis.hash,input,registryHash:registry.hash,...(base?{parentReview:{id:base.id,hash:base.hash}}:{})})
    if(previous){
     const record=await put('module-plans',{kind:'magnetic-module-plan',schemaVersion:1,modulePlanId:randomUUID(),revision:1,parent:null,sourceId:source.id,sourceHash:source.hash,analysisId:analysis.id,analysisHash:analysis.hash,reviewId:review.id,reviewHash:review.hash,...inheritedModules(previous,review)})
     await writeModuleHead(record)
    }
    const next={revision:current.revision+1,reviewId:review.id,reviewHash:review.hash},f=filename('heads',source.id),temp=f+'.tmp';await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,f);return {record:review,head:next}
   })
  }
  if(route==='module-plans'){
   const initial=await lineage('reviews',body.reviewId)
   return locked(initial.source.id,async()=>{
    const l=await lineage('reviews',body.reviewId)
    // Grouping an immutable Review is independent of whether it is the latest geometry input.
    if(body.reviewHash!==l.review.hash)fail('Review Hash 不一致，不能保存模块',409)
    if(l.outdated&&!['create','rename'].includes(body.command?.kind))fail('Review 已过期，不能修改历史模块成员',409)
    const current=await moduleHead(l.review.id)
    if(body.expectedRevision!==current.revision||body.expectedHash!==current.recordHash)fail('Module Plan 已被其他页面更新；请重新加载，未覆盖',409)
    const previous=current.recordId?await read('module-plans',current.recordId):null
    if(previous&&(previous.hash!==current.recordHash||previous.revision!==current.revision||previous.reviewId!==l.review.id||previous.reviewHash!==l.review.hash||previous.modulePlanId!==current.modulePlanId))fail('Module Plan 当前快照不一致',409)
    let next
    if(body.command?.kind==='inherit'){
     // Repair a Review saved by older versions, without overwriting any grouping
     // already created there. Explicit immutable provenance; no GET-time writes.
     if(previous)fail('当前 Review 已有模块记录，不能覆盖继承',409)
     const old=await lineage('module-plans',identifier(body.command.recordId))
     if(old.record.hash!==body.command.recordHash||old.review.id===l.review.id||old.review.createdAt>l.review.createdAt||old.record.createdAt>l.review.createdAt)fail('模块继承来源或保存时间不一致',409)
     next=inheritedModules(old.record,l.review)
    }else if(body.command?.kind==='restore'){
     const old=await lineage('module-plans',body.command.recordId)
     if(old.record.reviewId!==l.review.id||old.record.reviewHash!==l.review.hash||old.record.modulePlanId!==current.modulePlanId)fail('不能跨 Review 恢复 Module Plan',409)
     next={modules:structuredClone(old.record.modules),change:{kind:'restore',moved:[],restoredFrom:old.record.id}}
    }else next=changeModules(previous?.modules??[],l.review.input.review,body.command,randomUUID())
    const record=await put('module-plans',{kind:'magnetic-module-plan',schemaVersion:1,modulePlanId:current.modulePlanId??randomUUID(),revision:current.revision+1,parent:previous?{id:previous.id,hash:previous.hash}:null,sourceId:l.source.id,sourceHash:l.source.hash,analysisId:l.analysis.id,analysisHash:l.analysis.hash,reviewId:l.review.id,reviewHash:l.review.hash,...next})
    const nextHead=await writeModuleHead(record)
    return {record,head:nextHead}
   })
  }
  if(route==='manual-plan'){
   const l=await lineage('reviews',body.reviewId);if(l.outdated)fail('Review 已过期',409)
   let base=null;if(body.basedOnPlanId){const b=await lineage('plans',body.basedOnPlanId);if(b.outdated||b.review.id!==l.review.id)fail('人工计划的来源 Plan 已过期或不属于当前 Review',409);base=b.record}
   const selection=body.reconstructionScope??base?.reconstructionScope
   const projected=selection?await requestedScope(l.review,l.source,selection):null
   if(projected&&!projected.scope.observationIds.length)fail('当前范围没有可重建实例')
   assertCanonicalProfiles(l.review.input.profiles,(await getRegistry()).profiles)
   return put('plans',{geometryContract:canonicalGeometryContract,sourceId:l.source.id,sourceHash:l.source.hash,reviewId:l.review.id,reviewHash:l.review.hash,...(projected?{reconstructionScope:projected.scope}:{}),plan:parseSpatialHypothesis(body.plan,projected?.input??l.review.input),origin:'human-hypothesis',traceId:null,...(base?{basedOnPlanId:base.id,basedOnPlanHash:base.hash}:{})})
  }
  if(route==='rebase-plan'){
   const current=await lineage('reviews',body.reviewId),old=await lineage('plans',body.planId)
   if(current.outdated||current.source.id!==old.source.id||current.analysis.id!==old.analysis.id)fail('只能在同一 Analysis 的当前 Review 中明确沿用旧计划',409)
   if(old.record.geometryContract!==canonicalGeometryContract)fail('旧 Plan 缺少 Canonical Geometry 契约，请重新规划，不转换历史编号',409)
   assertCanonicalProfiles(current.review.input.profiles,(await getRegistry()).profiles)
   const projected=body.reconstructionScope||old.record.reconstructionScope?await requestedScope(current.review,current.source,body.reconstructionScope??old.record.reconstructionScope):null
   const rebased=rebaseSpatialPlan(old.record.plan,old.geometryReview.input,projected?.input??current.review.input)
   return put('plans',{geometryContract:canonicalGeometryContract,sourceId:current.source.id,sourceHash:current.source.hash,reviewId:current.review.id,reviewHash:current.review.hash,...(projected?{reconstructionScope:projected.scope}:{}),...rebased,origin:'human-rebased-hypothesis',traceId:null,basedOnPlanId:old.record.id,basedOnPlanHash:old.record.hash,basedOnReviewId:old.review.id,basedOnReviewHash:old.review.hash})
  }
  if(route==='refine-constraints'){
   const l=await lineage('plans',body.planId)
   if(l.outdated||body.planHash!==l.record.hash)fail('Plan 已过期或 Hash 不一致，不能生成修正候选',409)
   const refinement=refineConstraints(l.record.plan,l.geometryReview.input,{maxNodes:body.options?.maxNodes,maxCandidates:body.options?.maxCandidates,protectPlan:l.record.origin!=='model'})
   return put('refinements',{version:1,planId:l.record.id,planHash:l.record.hash,reviewId:l.review.id,reviewHash:l.review.hash,sourceId:l.source.id,sourceHash:l.source.hash,refinement,candidateHashes:Object.fromEntries(refinement.candidates.map(c=>[c.id,hash(c)]))})
  }
  if(route==='execute')return operation(body,route,async()=>{
   const l=await lineage('plans',body.planId);if(l.outdated)fail('Review 已改变，旧 Plan 不可执行',409)
   await assertRequestedPlanScope(body,l)
   const effectivePlan=await executionPlan(l.record,l.geometryReview,body.refinement)
   const execution=executePlan(effectivePlan,l.geometryReview,{...body.options,algorithmVersion:5,protectPlanConnections:l.record.origin!=='model'},!!body.refinement)
   return {record:await put('executions',{...execution,reconstructionScope:planScope(l.record),options:body.options??{},...(body.refinement?{refinement:body.refinement,effectivePlanHash:hash(effectivePlan)}:{}),planId:l.record.id,planHash:l.record.hash,reviewId:l.review.id,reviewHash:l.review.hash,sourceId:l.source.id,sourceHash:l.source.hash})}
  })
  if(route==='open-diagnostic-draft'){
   const initial=await lineage('executions',body.executionId)
   return locked(initial.source.id,async()=>{
    const l=await lineage('executions',body.executionId),r=l.record
    if(l.outdated)fail('Review 已改变：Diagnostic 过期，禁止进入编辑器',409)
    if(body.override!==true&&body.humanAccepted!==true)fail('请明确授权强制允许进入 Assembly Editor 或人工采用 Diagnostic')
    if(body.executionHash!==r.hash)fail('Diagnostic Execution Hash 不一致',409)
    const p=await read('plans',r.planId)
    if(r.sourceId!==l.source.id||l.review.sourceId!==l.source.id||p.sourceId!==l.source.id||p.reviewId!==l.review.id)fail('Diagnostic 来源身份不一致',409)
    const verified=await replayExecution(r,p,l.review)
    const c=r.diagnosticCandidates?.find(c=>c.id===body.candidateId),actual=verified.diagnosticCandidates?.find(c=>c.id===body.candidateId)
    if(r.version<3||!c||!actual||(body.humanAccepted===true?hash({...c,geometry:actual.geometry,validation:actual.validation,collisions:actual.collisions})!==hash(actual):hash(c)!==hash(actual)))fail('Diagnostic 身份或快照复核失败')
    const check=diagnosticHandoffCheck(c),acceptance=body.humanAccepted===true?humanDiagnosticHandoffCheck(c):null
    if(acceptance&&!acceptance.allowed)fail('Diagnostic 包含无法可靠定位或比较的错误，不能人工采用')
    if(!acceptance&&!check.allowed)fail('仅 Ideal Geometry Valid 且 Solid Collision Invalid 的 Diagnostic 可进入待修复 Draft')
    const observationMap=c.observationMap??candidateObservationMap(c.assembly,l.geometryReview.input),spatialConsistency=inspectSpatialConsistency(c.assembly,l.geometryReview.input,observationMap)
    if(spatialConsistency.status==='contradicted')fail('违反已审核空间关系，不能通过实体碰撞 Override 进入编辑器')
    const assembly={...structuredClone(c.assembly),id:'visible-'+randomUUID(),revision:0}
    return put('origins',{sourceId:l.source.id,sourceHash:l.source.hash,analysisId:l.analysis.id,analysisHash:l.analysis.hash,reviewId:l.review.id,reviewHash:l.review.hash,planId:p.id,planHash:p.hash,executionId:r.id,executionHash:r.hash,...(r.refinement?{refinement:r.refinement,effectivePlanHash:r.effectivePlanHash}:{}),candidateId:c.id,candidateHash:hash(c),...(r.reconstructionScope?{reconstructionScope:r.reconstructionScope}:{}),assembly,coverage:c.coverage,...(r.version===5?{pendingObservations:l.geometryReview.input.review.pieces.filter(p=>!p.excluded&&!c.assembly.pieces.some(x=>x.id===p.id)).map(p=>({...p,profileSnapshot:l.geometryReview.input.profiles.find(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion)??null,observation:l.geometryReview.input.evidence.observations.find(o=>o.id===p.id)})),searchProgress:r.search.progressive}:{}),unverifiedConstraints:c.unverifiedConstraints,photoMatch:c.photoMatch,humanReview:{status:acceptance?'accepted':'pending'},observationMap,spatialConsistency,
     entryMode:acceptance?'human-accepted-diagnostic':'diagnostic-override',authorization:{scope:acceptance?'accepted-diagnostic-errors':'editor-draft-only',explicit:true,at:new Date().toISOString()},diagnostic:{id:c.id,hash:hash(c),geometry:c.geometry,validation:c.validation??check.validation,recheckedGeometry:check.geometry,collisions:c.collisions??[],construction:c.construction??null}})
   })
  }
  if(route==='adopt'){
   const initial=await lineage('executions',body.executionId)
   return locked(initial.source.id,async()=>{
    const l=await lineage('executions',body.executionId);if(l.outdated)fail('Review 已改变：Candidate 过期，禁止采用',409)
    if(body.visualChecked!==true)fail('请先对照原图，确认候选及未验证项')
    const r=l.record;
    if(r.diagnosticCandidates?.some(c=>c.id===body.candidateId))fail('Diagnostic Candidate 未通过严格 Validator，仅供观察，禁止普通采用',422)
    const p=await read('plans',r.planId),verified=await replayExecution(r,p,l.review)
    const c=r.candidates.find(c=>c.id===body.candidateId),actual=verified.candidates.find(c=>c.id===body.candidateId)
    const {observationMap:_mapping,spatialConsistency:_spatial,...legacyActual}=actual??{}
    const matches=c&&actual&&hash(c)===hash(r.version===1?legacyActual:actual)
    if(r.version===5&&(!c||!actual)&&verified.diagnostics.some(d=>d.startsWith('REVIEW_BLOCKED')))fail('Candidate 未满足人工硬约束或已审核空间关系；请核对 Review',422)
    if((!r.completeSearch&&r.version!==5)||!c||!actual||!matches||!validateAssembly3D(c.assembly).valid)fail('Candidate 复核失败或不是 Geometry Valid',422)
    const observationMap=c.observationMap??candidateObservationMap(c.assembly,l.geometryReview.input),spatialConsistency=inspectSpatialConsistency(c.assembly,l.geometryReview.input,observationMap)
    if(spatialConsistency.status==='contradicted')fail('Geometry Valid 但违反已审核空间关系；请修正 Review 后重新执行',422)
    // Identity is unique per adoption, all authoritative poses/profiles remain exact.
    const assembly={...c.assembly,id:'visible-'+randomUUID(),revision:0}
    return put('origins',{sourceId:l.source.id,sourceHash:l.source.hash,analysisId:l.analysis.id,analysisHash:l.analysis.hash,reviewId:l.review.id,reviewHash:l.review.hash,planId:p.id,planHash:p.hash,executionId:r.id,executionHash:r.hash,...(r.refinement?{refinement:r.refinement,effectivePlanHash:r.effectivePlanHash}:{}),candidateId:c.id,candidateHash:hash(c),...(r.reconstructionScope?{reconstructionScope:r.reconstructionScope}:{}),assembly,coverage:c.coverage,...(r.version===5?{pendingObservations:l.geometryReview.input.review.pieces.filter(p=>!p.excluded&&!c.assembly.pieces.some(x=>x.id===p.id)).map(p=>({...p,profileSnapshot:l.geometryReview.input.profiles.find(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion)??null,observation:l.geometryReview.input.evidence.observations.find(o=>o.id===p.id)})),searchProgress:r.search.progressive}:{}),unverifiedConstraints:c.unverifiedConstraints,photoMatch:c.photoMatch,humanReview:{status:'accepted',at:new Date().toISOString()},observationMap,spatialConsistency})
   })
  }
  fail('未知 Visible 3D 操作',404)
 }}
}

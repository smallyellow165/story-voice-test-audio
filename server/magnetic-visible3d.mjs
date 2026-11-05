import {assertTutorial3D} from '../src/magnetic-tiles/three-d/tutorial.ts'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {selectedScopeKey} from '../src/magnetic-tiles/three-d/reconstruction/selected-lineage.ts'
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
import {prepareAnalysisEvidence,validateAnalysisEvidence} from './magnetic-analysis-validation.mjs'
import {runVisibleModel,resumeVisibleAnalysis,visiblePromptStatus,visiblePromptVersion} from './magnetic-visible3d-vision.mjs'
import {parseVisibleEvidence,validateVisibleInput,parseSpatialHypothesis} from '../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {adaptProfile} from '../src/magnetic-tiles/three-d/profile-adapter.ts'
import {refineConstraints} from '../src/magnetic-tiles/three-d/reconstruction/constraint-refinement.ts'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {assertAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {diagnosticHandoffCheck} from '../src/magnetic-tiles/three-d/reconstruction/diagnostic-handoff.ts'
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode})}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
// Legacy execution labels carry no geometry or authorization semantics.
const candidateDigest=c=>{const {humanReview:legacyLabel,...snapshot}=c;return hash(snapshot)}
const kinds=['analyses','reviews','plans','executions','origins','refinements','module-plans']
const identifier=x=>{if(typeof x!=='string'||!/^([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(x))fail('Visible 3D 记录 ID 无效');return x}
export function createVisible3DWorkflow(directory,options){
 const {readSource,readImage,readImages,getRegistry,runModel=runVisibleModel,projectId}=options,projects=new Map()
 const operation=recordedSpatialOperation(path.join(directory,'requests'))
 const filename=(kind,id)=>path.join(directory,kind,identifier(id)+'.json')
 async function put(kind,data){
  const payload={...data,...(projectId?{projectId}:{}),id:data.id??randomUUID(),createdAt:data.createdAt??new Date().toISOString()},r={...payload,hash:hash(payload)},f=filename(kind,r.id),temp=f+'.'+randomUUID()+'.tmp'
  await mkdir(path.dirname(f),{recursive:true});await writeFile(temp,JSON.stringify(r),{flag:'wx',mode:0o600})
  try{await link(temp,f)}finally{await unlink(temp)} return r
 }
 async function read(kind,id){if(!kinds.includes(kind))fail('未知记录类型');const r=JSON.parse(await readFile(filename(kind,id),'utf8'));const {hash:h,...p}=r;if(h!==hash(p)||r.id!==id)fail('记录 Hash 不一致');if(projectId&&r.projectId!==projectId)fail('记录不属于当前作品 Project',409);return r}
 const headFile=(sourceId,owner=projectId)=>filename('heads'+(owner?'/'+identifier(owner):''),sourceId)
 async function head(sourceId,owner=projectId){try{const h=JSON.parse(await readFile(headFile(sourceId,owner),'utf8'));return {analysisId:null,reviewId:null,groups:{},...h,selectedRevision:h.selectedRevision??0}}catch(e){if(e.code==='ENOENT')return {revision:0,selectedRevision:0,analysisId:null,reviewId:null,groups:{}};throw e}}
 async function locked(sourceId,work){const f=headFile(sourceId)+'.lock';await mkdir(path.dirname(f),{recursive:true});try{await writeFile(f,'lock',{flag:'wx',mode:0o600})}catch(e){if(e.code==='EEXIST')fail('该来源正在更新；请重新加载后重试',409);throw e}try{return await work()}finally{await unlink(f)}}
 // Mutable Selected pointers live in the existing Project head. Never choose
 // by timestamps or by traversing the immutable result history.
 async function writeHead(sourceId,value){const f=headFile(sourceId),tmp=f+'.'+randomUUID()+'.tmp';await mkdir(path.dirname(f),{recursive:true});await writeFile(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(tmp,f);return value}
 const ref=r=>({id:r.id,hash:r.hash})
 async function liveScope(p,review,source){
  const saved=planScope(p),current=await requestedScope(review,source,saved)
  if(!reconstructionScopeMatches(saved,current.scope,p.plan.parts.map(p=>p.id)))fail('Group 成员或 Image 范围已变化；请选择兼容 Plan 或重新规划',409)
  return current.scope
 }
 async function assertSelected(l,stage){
  const h=await head(l.source.id,l.analysis.projectId)
  if(h.analysisId!==l.analysis.id||h.analysisHash!==l.analysis.hash||h.reviewId!==l.review?.id||h.reviewHash!==l.review?.hash)fail('当前 Selected Analysis / Review 已变化，来源过期；不能消费其他历史来源',409)
  if(stage==='review')return h
  const p=stage==='plan'?l.record:await read('plans',l.record.planId)
  const scope=await liveScope(p,l.review,l.source),slot=h.groups?.[selectedScopeKey(scope)]
  if(slot?.plan.id!==p.id||slot.plan.hash!==p.hash)fail('该 Group 当前 Selected Plan 不匹配；请明确选择完整 Plan',409)
  if(stage==='execution'&&(slot.execution?.id!==l.record.id||slot.execution.hash!==l.record.hash))fail('该 Group 当前 Selected Execution 不匹配；请明确选择完整 Execution',409)
  return h
 }
 async function selectResult(body){
  const source=await readSource(identifier(body.sourceId));return locked(source.id,async()=>{
   const h=await head(source.id)
   if(body.expectedRevision!==(h.selectedRevision??0))fail('Selected 已被其他页面更新；本次选择未覆盖，请刷新历史后重试',409)
   const kind={analysis:'analyses',review:'reviews',plan:'plans',execution:'executions'}[body.stage]
   if(!kind)fail('无效 Selected 阶段')
   const l=await lineage(kind,identifier(body.id)),r=l.record
   if(l.analysis.projectId!==projectId||l.source.id!==source.id||l.source.hash!==source.hash||body.hash!==r.hash)fail('Selected 结果与 Project / Hash 不一致',409)
   let next={...h,analysisId:h.analysisId??null,groups:h.groups??{}}
   if(body.stage==='analysis'){
    if(h.analysisId===r.id&&h.analysisHash===r.hash)return h
    next={...next,analysisId:r.id,analysisHash:r.hash,reviewId:null,reviewHash:null,groups:{}}
   }else if(body.stage==='review'){
    if(h.analysisId!==l.analysis.id||h.analysisHash!==l.analysis.hash)fail('Review 不属于 Selected Analysis；请先选择其完整 Analysis',409)
    if(h.reviewId===r.id&&h.reviewHash===r.hash)return h
    next={...next,reviewId:r.id,reviewHash:r.hash,groups:{}}
   }else{
    await assertSelected(l,'review')
    if(body.stage==='execution'&&r.version!==5)fail('旧 Execution 契约仅供读取，请使用当前 Plan 重新执行',409)
    const p=body.stage==='plan'?r:await read('plans',r.planId);if(p.geometryContract!==canonicalGeometryContract)fail('Plan 缺少当前 Canonical Geometry 契约，请重新规划',409);assertCanonicalProfiles(l.geometryReview.input.profiles,(await getRegistry()).profiles);const scope=await liveScope(p,l.review,l.source),key=selectedScopeKey(scope),old=next.groups[key]
    if(body.stage==='execution'&&(old?.plan.id!==p.id||old.plan.hash!==p.hash))fail('Execution 不属于该 Group 的 Selected Plan；请先选择其完整 Plan',409)
    if(body.stage==='plan'&&old?.plan.id===p.id&&old.plan.hash===p.hash||body.stage==='execution'&&old?.execution?.id===r.id&&old.execution.hash===r.hash)return h
    const slot={scope,plan:ref(p),...(body.stage==='execution'?{execution:ref(r)}:{})}
    next={...next,groups:{...next.groups,[key]:slot}}
   }
   return writeHead(source.id,{...next,selectedRevision:(h.selectedRevision??0)+1})
  })
 }
 async function originSnapshot(id){
  const origin=await read('origins',identifier(id)),l=await lineage('executions',origin.executionId)
  for(const k of ['sourceId','sourceHash','reviewId','reviewHash','planId','planHash'])if(origin[k]!==l.record[k])fail('Assembly 来源身份不一致',409)
  if(origin.projectId!==l.analysis.projectId)fail('Assembly 来源跨作品 Project',409)
  if(origin.executionHash!==l.record.hash||origin.analysisId!==l.analysis.id||origin.analysisHash!==l.analysis.hash)fail('当前 Assembly 不属于该 Group 的 Selected 来源链；请重新选择并采用',409)
  return origin
 }
 async function selectedOrigin(id){const origin=await originSnapshot(id);await assertSelected(await lineage('executions',origin.executionId),'execution');return origin}
 async function publishOrigin(data,l){
  // Creation is not a second Draft selector. The existing workspace Draft CAS
  // chooses which immutable origin it adopts. A failed/cancelled client handoff
  // must not invalidate another Draft of this same selected Execution.
  await assertSelected(l,'execution');return put('origins',data)
 }
 async function verifyModelRecord(r){
  if(r.origin!=='model')return
  const trace=JSON.parse(await readFile(path.join(directory,'model-traces',identifier(r.traceId)+'.json'),'utf8'))
  if(hash(trace)!==r.traceHash||trace.wireStatus!=='response_saved'||hash(JSON.parse(trace.rawOutput))!==hash(trace.plan)||trace.requestInput.source.hash!==r.sourceHash||trace.requestInput.source.id!==r.sourceId)fail('模型 Trace 与正式记录不一致',409)
  if(r.projectId&&trace.requestInput?.projectId!==r.projectId)fail('模型 Trace 的作品 Project 不一致',409)
  if(r.analysisValidation){
   const source=await readSource(r.sourceId),prepared=prepareAnalysisEvidence(trace.plan,source)
   if(!completeAnalysisTrace(trace)||hash(prepared.evidence)!==hash(r.evidence)||hash(prepared.rawEvidence??null)!==hash(r.rawEvidence??null)||hash(prepared.analysisValidation)!==hash(r.analysisValidation))fail('Analysis 规范化结果与原始 Trace 不一致',409)
  }else if(trace.status!=='plan_ready_for_review'||hash(trace.plan)!==hash(r.evidence??r.plan))fail('模型 Trace 与正式记录不一致',409)
 }
 async function lineage(kind,id){
  const r=await read(kind,id),review=kind==='reviews'?r:kind==='plans'?await read('reviews',r.reviewId):['executions','refinements','module-plans'].includes(kind)?await read('reviews',r.reviewId):null
  const analysis=kind==='analyses'?r:await read('analyses',review.analysisId),source=await readSource(analysis.sourceId)
  if(analysis.sourceId!==source.id||r.sourceId!==source.id||analysis.sourceHash!==source.hash||review&&(review.sourceId!==source.id||review.analysisHash!==analysis.hash||review.sourceHash!==source.hash)||r.sourceHash!==source.hash)fail('来源关联不一致',409)
  if(kind==='plans'&&r.reviewHash!==review.hash||['executions','refinements','module-plans'].includes(kind)&&r.reviewHash!==review.hash)fail('Review Hash 不一致',409)
  if(['executions','refinements'].includes(kind)){const p=await read('plans',r.planId);if(p.hash!==r.planHash||p.sourceId!==source.id||p.sourceHash!==source.hash||p.reviewId!==review.id||p.reviewHash!==review.hash)fail('Execution Plan 来源不一致',409)}
  if(r.projectId!==analysis.projectId||review&&review.projectId!==analysis.projectId)fail('来源跨作品 Project',409)
  await verifyModelRecord(analysis);if(kind==='plans')await verifyModelRecord(r);if(['executions','refinements'].includes(kind))await verifyModelRecord(await read('plans',r.planId))
  if(kind==='module-plans'){if(r.kind!=='magnetic-module-plan'||r.schemaVersion!==1||r.analysisId!==analysis.id||r.analysisHash!==analysis.hash||r.sourceId!==source.id||r.reviewId!==review.id)fail('Module Plan 来源不一致',409);assertModules(r.modules,review.input.review)}
  const current=await head(source.id,analysis.projectId)
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
  if(r.version!==5)fail('旧 Execution 契约仅供读取，请重新执行',409)
  review=await scopedPlanReview(p,review,await readSource(review.sourceId))
  const plan=await executionPlan(p,review,r.refinement)
  if(r.refinement&&r.effectivePlanHash!==hash(plan))fail('Execution Refinement 快照不一致',409)
  return executePlan(plan,review,{...r.options,protectPlanConnections:p.origin!=='model',algorithmVersion:5},!!r.refinement)
 }
 async function moduleHead(reviewId){try{return JSON.parse(await readFile(filename('module-heads',reviewId),'utf8'))}catch(e){if(e.code==='ENOENT')return {revision:0,recordId:null,recordHash:null,modulePlanId:null};throw e}}
 async function moduleState(reviewId){
  const l=await lineage('reviews',identifier(reviewId)),h=await moduleHead(l.review.id),history=[]
  for(const f of await readdir(path.join(directory,'module-plans')).catch(e=>{if(e.code==='ENOENT')return [];throw e})){
   if(!/^[a-f0-9-]+\.json$/.test(f))continue
   // The directory is shared by all Projects. Select candidates by the exact
   // Review before strict read() applies this request's Project/Hash checks.
   const id=f.slice(0,-5),candidate=JSON.parse(await readFile(filename('module-plans',id),'utf8'))
   if(candidate.reviewId!==l.review.id)continue
   const r=await read('module-plans',id)
   await lineage('module-plans',r.id);history.push(r)
  }
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
 function planScope(plan){if(!plan.reconstructionScope)fail('Plan 缺少明确的 Group / Image 来源范围，请重新规划',409);return plan.reconstructionScope}
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
  if(canonical(projected.scope)!==canonical(scope))fail('Plan 重建范围或 Observation 快照不一致',409)
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
 async function assertWriteProject(body){
  // Global immutable reads used by saved Assembly provenance do not authorize
  // writes into another Project. Recorded operations keep failures in their log.
  for(const [field,kind] of [['analysisId','analyses'],['reviewId','reviews'],['planId','plans'],['executionId','executions']])if(body[field]){
   const parent=await read(kind,identifier(body[field]));if(parent.projectId!==projectId)fail('写入必须使用所属作品 Project',409)
  }
 }
 async function modelRecord(kind,body,checkpoint){
  const source=kind==='analysis'?await readSource(body.sourceId):(await lineage('reviews',body.reviewId)).source
  if(kind==='analysis'&&body.sourceHash!==undefined&&body.sourceHash!==source.hash)fail('Analysis 输入 Hash 不一致；未调用模型',409)
  let review=null,scope=null,selectedRevision=null
  if(kind==='plan'){const l=await lineage('reviews',body.reviewId);selectedRevision=(await assertSelected(l,'review')).selectedRevision??0;if(body.expectedSelectedRevision!==undefined&&body.expectedSelectedRevision!==selectedRevision)fail('Selected 已变化，请刷新后明确执行；未调用模型',409);const {blocker:globalBlocker}=planningParticipation(l.review.input.review);if(globalBlocker)fail(globalBlocker,422);const projected=await requestedScope(l.review,l.source,body.reconstructionScope);if(!projected.scope.observationIds.length)fail('当前 Group 与 Image 没有可重建的交集；未调用模型',422);scope=projected.scope;review={...l.review,input:projected.input};const {blocker}=planningParticipation(review.input.review);if(blocker)fail(blocker,422)}
  const image=await readImage(source),registry=await getRegistry()
  const geometryInput=review?{...review.input,review:exactProfileReview(review.input.review)}:undefined
  if(source.images?.length>1&&!readImages)fail('多图来源缺少图片集合适配器；未调用模型')
  const images=readImages?await readImages(source):null
  if(geometryInput)assertCanonicalProfiles(geometryInput.profiles,registry.profiles)
  const prepared={image,source,...(images?{images}:{}),input:{...(projectId?{projectId}:{}),...(scope?{reconstructionScope:scope}:{}),source:{id:source.id,hash:source.hash,width:source.view.width,height:source.view.height},...(source.images?{referenceImageId:source.primaryImageId,images:source.images,...(source.images.length>1?{analysisMode:'visible3d',imageEvidencePolicy:'Target final state only. A physical tile may move between steps.'+(kind==='analysis'?' Root bbox/features are canonical annotations in referenceImageId only; the reference imageEvidence entry must repeat exactly those bbox/features (including feature IDs, points and visibility).':'')+' Per-frame feature IDs are local to their image. Executable evidenceRefs use observation IDs or reference-image observationId:featureId; cite other image IDs explicitly in evidence/uncertainty. Never treat step poses/connections as final by default.'}:{})}:{}),geometryContract:canonicalGeometryManifest(geometryInput?.profiles??registry.profiles.map(canonicalProfileSnapshot)),...(geometryInput?{geometryInput,ports:geometryInput.profiles.map(s=>({profileId:s.profile.id,profileVersion:s.profile.version,...adaptProfile(s)}))}:{catalog:registry.profiles})},imagePayloadSha256:source.view.hash,geometrySnapshot:geometryInput?.profiles??registry.profiles}
  const trace=await runModel(prepared,{model:body.model,directory:path.join(directory,'model-traces'),sources:[{sourceId:source.id,sourceHash:source.hash,reviewId:review?.id??null,reviewHash:review?.hash??null}],execute:true,onTrace:async t=>{if(t.background)await checkpoint({trace:t,state:'running'})}},kind==='analysis'?'analysis':'plan')
  await checkpoint({trace})
  const result=await saveModelResult(kind,trace,source,registry,review,scope)
  if(kind==='plan'&&result.record)await selectResult({sourceId:source.id,stage:'plan',id:result.record.id,hash:result.record.hash,expectedRevision:selectedRevision})
  return result
 }
 function completeAnalysisTrace(trace){
  return ['plan_ready_for_review','invalid_plan'].includes(trace.status)&&!trace.error&&trace.parseStatus==='parsed'&&trace.wireStatus==='response_saved'&&['STOP','completed'].includes(trace.finishReason)&&hash(JSON.parse(trace.rawOutput))===hash(trace.plan)
 }
 async function saveModelResult(kind,trace,source,registry,review,scope=null){
  const geometryInput=review?.input
  // Completion/wire and source integrity are independent of AI annotation quality.
  // Plans retain the original strict validation. Analysis is reclassified locally,
  // keeping the original Trace bytes/status unchanged (including old failures).
  const validation=kind==='analysis'&&completeAnalysisTrace(trace)?validateAnalysisEvidence(trace.plan,source):null
  const usable=kind==='analysis'?!!validation?.valid:trace.status==='plan_ready_for_review'&&trace.parseStatus==='parsed'&&trace.validation?.valid&&trace.wireStatus==='response_saved'&&['STOP','completed'].includes(trace.finishReason)&&hash(JSON.parse(trace.rawOutput))===hash(trace.plan)
  if(!usable){
   const error=trace.error?.message||(trace.parseStatus==='invalid_json'?'模型输出 JSON 解析失败；原始响应已保留。':(validation??trace.validation)?.issues?.join('；'))||(trace.background?.state==='completed'?'后台请求已完成，但没有可安全审核的输出；请查看 Trace。':'后台请求尚未完成；不会重新提交。')
   return {trace,usable:false,state:trace.background&&['running','submitting'].includes(trace.background.state)?'running':trace.background&&['timeout','unknown'].includes(trace.background.state)?trace.background.state:'failed',error,...(validation?{analysisValidation:validation}:{})}
  }
  if(trace.requestInput?.source?.id!==source.id||trace.requestInput.source.hash!==source.hash)fail('模型输出来源 ID / Hash 不一致',409)
  if(source.images?.length>1&&(hash(trace.requestInput.images)!==hash(source.images)||trace.requestInput.referenceImageId!==source.primaryImageId))fail('模型图片集合与来源不一致',409)
  const data=kind==='analysis'?prepareAnalysisEvidence(trace.plan,source):{geometryContract:canonicalGeometryContract,plan:parseSpatialHypothesis(trace.plan,geometryInput),reviewId:review.id,reviewHash:review.hash,...(scope?{reconstructionScope:scope}:{})}
  if(kind==='analysis')for(const o of data.evidence.observations)for(const p of o.profileCandidates)if(!registry.profiles.some(r=>r.id===p.profileId&&r.version===p.profileVersion))fail('模型候选 Profile 不在 Registry')
  // Stable Analysis ID also covers a crash between snapshot creation and linking
  // the operation, for foreground and background responses alike.
  const target=kind==='analysis'?'analyses':'plans',stable=kind==='analysis'||trace.background
  if(stable){const old=await read(target,trace.id).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(old){if(old.traceHash!==hash(trace)||old.sourceHash!==source.hash)fail('完成记录与 Trace 不一致',409);return {record:old,trace,usable:true,state:'complete',error:null,...(old.analysisValidation?{analysisValidation:old.analysisValidation}:{})}}}
  const r=await put(target,{...data,...(stable?{id:trace.id}:{}),sourceId:source.id,sourceHash:source.hash,origin:'model',promptVersion:trace.promptVersion??visiblePromptVersion,traceId:trace.id,traceHash:hash(trace),...(kind==='analysis'?{catalogHash:registry.hash}:{})})
  return {record:r,trace,usable:true,state:'complete',error:null,...(r.analysisValidation?{analysisValidation:r.analysisValidation}:{})}
 }
 return {read,head,lineage,originSnapshot,selectedOrigin,async dispatch(method,route,body={}){
  if(!projectId&&route.startsWith('project/')){
   const [,owner,...parts]=route.split('/')
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(owner))fail('作品 Project ID 无效')
   if(!projects.has(owner))projects.set(owner,createVisible3DWorkflow(directory,{...options,projectId:owner}))
   return projects.get(owner).dispatch(method,parts.join('/'),body)
  }
  if(projectId&&method==='POST'){
   if(body.projectId!==undefined&&body.projectId!==projectId)fail('请求跨作品 Project',409)
   body={...body,projectId}
  }
  if(method==='POST'&&!['workspace-history','build-check','analyze','plan','execute'].includes(route))await assertWriteProject(body)
  if(method==='POST'&&route==='build-check'){
   const origin=await selectedOrigin(body.originId),a=body.assembly;assertAssembly3D(a)
   if(a.id!==origin.assembly.id)fail('Assembly 与所选来源不一致',409)
   assertCanonicalProfiles(a.profiles,(await getRegistry()).profiles)
   if(body.tutorial){const t=body.tutorial;assertTutorial3D(t);if(canonical(t.assembly)!==canonical(a)||t.source.reconstructionOrigin?.id!==origin.id||t.source.reconstructionOrigin?.hash!==origin.hash)fail('Tutorial 与当前 Assembly / Origin 来源不一致',409)}
   const geometry=validateAssembly3D(a)
   return {origin:{id:origin.id,hash:origin.hash},assemblyHash:hash(a),geometry}
  }
  if(method==='POST'&&route==='selected')return selectResult(body)
  if(method==='GET'&&route.startsWith('selected-origin/'))return selectedOrigin(route.slice(16))
  if(method==='GET'&&route==='status')return {models:modelOptions('reverse'),planningModels:modelOptions('design'),providers:providerStatus(),prompt:await visiblePromptStatus()}
  if(method==='GET'&&route==='requests'){const files=await readdir(path.join(directory,'requests')).catch(e=>{if(e.code==='ENOENT')return [];throw e});return (await Promise.all(files.filter(f=>/^[a-f0-9-]+\.json$/.test(f)).map(async f=>{
   const r=JSON.parse(await readFile(path.join(directory,'requests',f),'utf8')),b=r.trace?.background
   // Presentation only: an interrupted submit cannot be called "running"
   // forever. Keep the saved evidence unchanged and never retry the POST.
   if(b?.state==='submitting'&&!b.responseId&&Date.now()-Date.parse(r.createdAt)>95000)return {...r,state:'unknown',error:'提交确认中断；未保存 Provider Response ID，执行与计费状态未知，不会自动重发。',trace:{...r.trace,background:{...b,state:'unknown'}}}
   return r
  }))).filter(r=>!projectId||r.projectId===projectId)}
  if(method==='POST'&&route==='workspace-history'){
   if(projectId)fail('Project History 不使用浏览器收据查询',404)
   if(!Array.isArray(body.refs)||body.refs.length>10000||!Array.isArray(body.requestIds)||body.requestIds.length>10000)fail('工作区历史引用无效')
   const result=Object.fromEntries(kinds.map(k=>[k,[]]))
   for(const ref of body.refs){identifier(ref.id);for(const k of kinds){try{const r=await read(k,ref.id);if(r.hash!==ref.hash)fail('工作区历史 Hash 不一致',409);result[k].push(r)}catch(e){if(e.code!=='ENOENT')throw e}}}
   for(const k of kinds)result[k].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
   result.requests=[]
   for(const id of body.requestIds){identifier(id);try{
    const request=JSON.parse(await readFile(path.join(directory,'requests',id+'.json'),'utf8'));result.requests.push(request)
    // A workspace's own durable request is an exact receipt for its recovered
    // result, including after a crash or offline recovery in another session.
    if(request.kind==='analyze'&&request.usable&&request.record){
     const a=await read('analyses',request.record.id)
     if(a.hash!==request.record.hash||a.traceId!==request.trace?.id||!request.trace?.sources?.some(s=>s.sourceId===a.sourceId&&s.sourceHash===a.sourceHash))fail('工作区请求与 Analysis 结果不一致',409)
     if(!result.analyses.some(r=>r.id===a.id))result.analyses.push(a)
    }
   }catch(e){if(e.code!=='ENOENT')throw e}}
   result.analyses.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
   return result
  }
  if(method==='GET'&&route==='history'){
   const result={};for(const k of kinds){const files=await readdir(path.join(directory,k)).catch(e=>{if(e.code==='ENOENT')return [];throw e});result[k]=(await Promise.all(files.filter(f=>/^[a-f0-9-]+\.json$/.test(f)).map(async f=>{if(projectId){const raw=JSON.parse(await readFile(path.join(directory,k,f),'utf8'));if(raw.projectId!==projectId)return null}return read(k,f.slice(0,-5))}))).filter(Boolean);result[k].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
   if(projectId){
    result.projectId=projectId;result.sources=[]
    for(const r of kinds.flatMap(k=>result[k])){
     const found=result.sources.find(s=>s.id===r.sourceId),source=found??await readSource(r.sourceId);if(source.hash!==r.sourceHash)fail('Project 历史输入 Hash 不一致',409);if(!found)result.sources.push(source)
    }
   }
   return result
  }
  if(method==='GET'&&route.startsWith('trace/')){
   const [,value,section,...extra]=route.split('/'),traceId=identifier(value)
   if(extra.length||section&&section!=='wire')fail('未知 Trace 内容',404)
   const prefix=path.join(directory,'model-traces',traceId),trace=JSON.parse(await readFile(prefix+'.json','utf8'))
   if(projectId&&trace.requestInput?.projectId!==projectId)fail('Trace 不属于当前作品 Project',409)
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
  if(route==='analyze'||route==='plan')return operation(body,route,async checkpoint=>{await assertWriteProject(body);return modelRecord(route==='analyze'?'analysis':'plan',body,checkpoint)})
  if(route==='resume-analyze')return resumeSpatialOperation(path.join(directory,'requests'),body.requestId,async(saved,checkpoint)=>{
   if(projectId&&saved.projectId!==projectId)fail('请求不属于当前作品 Project',409)
   const source=await readSource(body.sourceId),traceId=identifier(saved.trace?.id)
   const trace=JSON.parse(await readFile(path.join(directory,'model-traces',traceId+'.json'),'utf8'))
   if(projectId&&trace.requestInput?.projectId!==projectId)fail('Trace 不属于当前作品 Project',409)
   if(saved.kind!=='analyze'||source.hash!==body.sourceHash||trace.requestInput?.source?.id!==source.id||trace.requestInput.source.hash!==source.hash||!trace.sources?.some(s=>s.sourceId===source.id&&s.sourceHash===source.hash))fail('后台任务来源不一致；未查询或生成。',409)
   if(saved.record){const l=await lineage('analyses',saved.record.id);if(l.analysis.hash!==saved.record.hash||l.analysis.traceId!==traceId)fail('已保存结果与请求不一致',409);return saved}
   // Completed raw output can be reclassified entirely offline. Do not poll,
   // overwrite the Trace or generate a new provider response.
   if(['plan_ready_for_review','invalid_plan'].includes(trace.status)&&!trace.error&&['STOP','completed'].includes(trace.finishReason)&&trace.wireStatus==='response_saved'){
    await readImage(source);if(source.images?.length>1){if(!readImages)fail('多图来源缺少图片集合适配器');await readImages(source)}
    return saveModelResult('analysis',trace,source,await getRegistry(),null)
   }
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
    if(body.expectedSelectedRevision!==undefined&&body.expectedSelectedRevision!==(current.selectedRevision??0))fail('Selected 在 Review 保存前已变化，旧保存请求未采用',409)
    if(current.analysisId&&current.analysisId!==analysis.id)fail('Review 来源必须消费当前 Selected Analysis；请先明确选择 Analysis',409)
    // The selected Review is the editing base, even when it is historical.
    // Older clients fall back to the current Review of this exact Analysis.
    let base=null
    if(body.baseReview&&(body.baseReview.id!==current.reviewId||body.baseReview.hash!==current.reviewHash))fail('Review 编辑来源 ID / Hash 不是当前 Selected Review，未继承其他历史模块',409)
    if(body.baseReview){const l=await lineage('reviews',identifier(body.baseReview.id));if(l.review.hash!==body.baseReview.hash||l.analysis.id!==analysis.id||l.analysis.hash!==analysis.hash||l.source.id!==source.id)fail('Review 编辑来源或 Hash 不一致',409);base=l.review}
    else if(current.reviewId){const l=await lineage('reviews',current.reviewId);if(l.analysis.id===analysis.id&&l.analysis.hash===analysis.hash)base=l.review}
    const previous=base?(await moduleState(base.id)).record:null
    const review=await put('reviews',{sourceId:source.id,sourceHash:source.hash,analysisId:analysis.id,analysisHash:analysis.hash,input,registryHash:registry.hash,...(base?{parentReview:{id:base.id,hash:base.hash}}:{})})
    if(previous){
     const record=await put('module-plans',{kind:'magnetic-module-plan',schemaVersion:1,modulePlanId:randomUUID(),revision:1,parent:null,sourceId:source.id,sourceHash:source.hash,analysisId:analysis.id,analysisHash:analysis.hash,reviewId:review.id,reviewHash:review.hash,...inheritedModules(previous,review)})
     await writeModuleHead(record)
    }
    const next={revision:current.revision+1,selectedRevision:(current.selectedRevision??0)+1,analysisId:analysis.id,analysisHash:analysis.hash,reviewId:review.id,reviewHash:review.hash,groups:{}},f=headFile(source.id),temp=f+'.tmp';await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,f);return {record:review,head:next}
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
    const selected=await head(l.source.id)
    if(selected.reviewId===l.review.id){const groups=Object.fromEntries(Object.entries(selected.groups??{}).filter(([,slot])=>{const id=slot.scope.groupId;if(id==='all')return true;return JSON.stringify(previous?.modules.find(m=>m.id===id)?.observationIds.slice().sort()??[])===JSON.stringify(record.modules.find(m=>m.id===id)?.observationIds.slice().sort()??[])}));if(hash(groups)!==hash(selected.groups??{}))await writeHead(l.source.id,{...selected,selectedRevision:(selected.selectedRevision??0)+1,groups})}
    return {record,head:nextHead}
   })
  }
  if(route==='manual-plan'){
   const l=await lineage('reviews',body.reviewId);await assertSelected(l,'review')
   let base=null;if(body.basedOnPlanId){const b=await lineage('plans',body.basedOnPlanId);await assertSelected(b,'plan');if(b.outdated||b.review.id!==l.review.id)fail('人工计划的来源 Plan 已过期或不属于当前 Review',409);base=b.record}
   const selection=body.reconstructionScope??base?.reconstructionScope
   const projected=await requestedScope(l.review,l.source,selection??{})
   if(projected&&!projected.scope.observationIds.length)fail('当前范围没有可重建实例')
   assertCanonicalProfiles(l.review.input.profiles,(await getRegistry()).profiles)
   const p=await put('plans',{geometryContract:canonicalGeometryContract,sourceId:l.source.id,sourceHash:l.source.hash,reviewId:l.review.id,reviewHash:l.review.hash,...(projected?{reconstructionScope:projected.scope}:{}),plan:parseSpatialHypothesis(body.plan,projected?.input??l.review.input),origin:'human-hypothesis',traceId:null,...(base?{basedOnPlanId:base.id,basedOnPlanHash:base.hash}:{})})
   await selectResult({sourceId:l.source.id,stage:'plan',id:p.id,hash:p.hash,expectedRevision:l.head.selectedRevision??0});return p
  }
  if(route==='rebase-plan'){
   const current=await lineage('reviews',body.reviewId),old=await lineage('plans',body.planId)
   if(current.outdated||current.source.id!==old.source.id||current.analysis.id!==old.analysis.id)fail('只能在同一 Analysis 的当前 Review 中明确沿用旧计划',409)
   if(old.record.geometryContract!==canonicalGeometryContract)fail('旧 Plan 缺少 Canonical Geometry 契约，请重新规划，不转换历史编号',409)
   assertCanonicalProfiles(current.review.input.profiles,(await getRegistry()).profiles)
   const projected=await requestedScope(current.review,current.source,body.reconstructionScope??old.record.reconstructionScope??{})
   await assertSelected(current,'review')
   if(planScope(old.record).groupId!==projected.scope.groupId||planScope(old.record).imageId!==projected.scope.imageId)fail('不能跨 Group / Image 抽取旧 Plan；请选择对应范围的完整来源',409)
   const rebased=rebaseSpatialPlan(old.record.plan,old.geometryReview.input,projected?.input??current.review.input)
   const p=await put('plans',{geometryContract:canonicalGeometryContract,sourceId:current.source.id,sourceHash:current.source.hash,reviewId:current.review.id,reviewHash:current.review.hash,...(projected?{reconstructionScope:projected.scope}:{}),...rebased,origin:'human-rebased-hypothesis',traceId:null,basedOnPlanId:old.record.id,basedOnPlanHash:old.record.hash,basedOnReviewId:old.review.id,basedOnReviewHash:old.review.hash})
   await selectResult({sourceId:current.source.id,stage:'plan',id:p.id,hash:p.hash,expectedRevision:current.head.selectedRevision??0});return p
  }
  if(route==='refine-constraints'){
   const l=await lineage('plans',body.planId)
   await assertSelected(l,'plan')
   if(l.outdated||body.planHash!==l.record.hash)fail('Plan 已过期或 Hash 不一致，不能生成修正候选',409)
   const refinement=refineConstraints(l.record.plan,l.geometryReview.input,{maxNodes:body.options?.maxNodes,maxCandidates:body.options?.maxCandidates,protectPlan:l.record.origin!=='model'})
   return put('refinements',{version:1,planId:l.record.id,planHash:l.record.hash,reviewId:l.review.id,reviewHash:l.review.hash,sourceId:l.source.id,sourceHash:l.source.hash,refinement,candidateHashes:Object.fromEntries(refinement.candidates.map(c=>[c.id,hash(c)]))})
  }
  if(route==='execute')return operation(body,route,async()=>{
   await assertWriteProject(body)
   const l=await lineage('plans',body.planId);await assertSelected(l,'plan')
   await assertRequestedPlanScope(body,l)
   const effectivePlan=await executionPlan(l.record,l.geometryReview,body.refinement)
   const execution=executePlan(effectivePlan,l.geometryReview,{...body.options,algorithmVersion:5,protectPlanConnections:l.record.origin!=='model'},!!body.refinement)
   const record=await put('executions',{...execution,reconstructionScope:planScope(l.record),options:body.options??{},...(body.refinement?{refinement:body.refinement,effectivePlanHash:hash(effectivePlan)}:{}),planId:l.record.id,planHash:l.record.hash,reviewId:l.review.id,reviewHash:l.review.hash,sourceId:l.source.id,sourceHash:l.source.hash});await selectResult({sourceId:l.source.id,stage:'execution',id:record.id,hash:record.hash,expectedRevision:l.head.selectedRevision??0});return {record}
  })
  if(route==='open-diagnostic-draft'){
   const initial=await lineage('executions',body.executionId)
   return locked(initial.source.id,async()=>{
    const l=await lineage('executions',body.executionId),r=l.record
    await assertSelected(l,'execution')
    if(l.outdated)fail('Review 已改变：Diagnostic 过期，禁止进入编辑器',409)
    if(body.executionHash!==r.hash)fail('Diagnostic Execution Hash 不一致',409)
    const p=await read('plans',r.planId)
    if(r.sourceId!==l.source.id||l.review.sourceId!==l.source.id||p.sourceId!==l.source.id||p.reviewId!==l.review.id)fail('Diagnostic 来源身份不一致',409)
    const verified=await replayExecution(r,p,l.review)
    const c=r.diagnosticCandidates?.find(c=>c.id===body.candidateId),actual=verified.diagnosticCandidates?.find(c=>c.id===body.candidateId)
    if(r.version<3||!c||!actual||candidateDigest(c)!==candidateDigest(actual))fail('Diagnostic 身份或快照复核失败')
    const check=diagnosticHandoffCheck(c)
    const observationMap=c.observationMap??candidateObservationMap(c.assembly,l.geometryReview.input),spatialConsistency=inspectSpatialConsistency(c.assembly,l.geometryReview.input,observationMap)
    if(spatialConsistency.status==='contradicted')fail('违反已审核空间关系，请修正空间关系后再进入编辑器')
    const assembly={...structuredClone(c.assembly),id:'visible-'+randomUUID(),revision:0}
    return publishOrigin({sourceId:l.source.id,sourceHash:l.source.hash,analysisId:l.analysis.id,analysisHash:l.analysis.hash,reviewId:l.review.id,reviewHash:l.review.hash,planId:p.id,planHash:p.hash,executionId:r.id,executionHash:r.hash,...(r.refinement?{refinement:r.refinement,effectivePlanHash:r.effectivePlanHash}:{}),candidateId:c.id,candidateHash:hash(c),...(r.reconstructionScope?{reconstructionScope:r.reconstructionScope}:{}),assembly,coverage:c.coverage,...(r.version===5?{pendingObservations:l.geometryReview.input.review.pieces.filter(p=>!p.excluded&&!c.assembly.pieces.some(x=>x.id===p.id)).map(p=>({...p,profileSnapshot:l.geometryReview.input.profiles.find(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion)??null,observation:l.geometryReview.input.evidence.observations.find(o=>o.id===p.id)})),searchProgress:r.search.progressive}:{}),unverifiedConstraints:c.unverifiedConstraints,photoMatch:c.photoMatch,observationMap,spatialConsistency,
     entryMode:'diagnostic-draft',diagnostic:{id:c.id,hash:hash(c),geometry:c.geometry,validation:c.validation??check.validation,recheckedGeometry:check.geometry,collisions:c.collisions??[],construction:c.construction??null}},l)
   })
  }
  if(route==='adopt'){
   const initial=await lineage('executions',body.executionId)
   return locked(initial.source.id,async()=>{
    const l=await lineage('executions',body.executionId);await assertSelected(l,'execution');if(l.outdated)fail('Review 已改变：Candidate 过期，禁止采用',409)
    const r=l.record;if(body.executionHash!==undefined&&body.executionHash!==r.hash)fail('Execution Hash 不一致',409)
    if(r.diagnosticCandidates?.some(c=>c.id===body.candidateId))fail('Diagnostic Candidate 未通过严格 Validator，仅供观察，禁止普通采用',422)
    const p=await read('plans',r.planId),verified=await replayExecution(r,p,l.review)
    const c=r.candidates.find(c=>c.id===body.candidateId),actual=verified.candidates.find(c=>c.id===body.candidateId)
    const matches=c&&actual&&candidateDigest(c)===candidateDigest(actual)
    if(r.version===5&&(!c||!actual)&&verified.diagnostics.some(d=>d.startsWith('REVIEW_BLOCKED')))fail('Candidate 未满足人工硬约束或已审核空间关系；请核对 Review',422)
    if((!r.completeSearch&&r.version!==5)||!c||!actual||!matches||!validateAssembly3D(c.assembly).valid)fail('Candidate 复核失败或不是 Geometry Valid',422)
    const observationMap=c.observationMap??candidateObservationMap(c.assembly,l.geometryReview.input),spatialConsistency=inspectSpatialConsistency(c.assembly,l.geometryReview.input,observationMap)
    if(spatialConsistency.status==='contradicted')fail('Geometry Valid 但违反已审核空间关系；请修正 Review 后重新执行',422)
    // Identity is unique per adoption, all authoritative poses/profiles remain exact.
    const assembly={...c.assembly,id:'visible-'+randomUUID(),revision:0}
    return publishOrigin({sourceId:l.source.id,sourceHash:l.source.hash,analysisId:l.analysis.id,analysisHash:l.analysis.hash,reviewId:l.review.id,reviewHash:l.review.hash,planId:p.id,planHash:p.hash,executionId:r.id,executionHash:r.hash,...(r.refinement?{refinement:r.refinement,effectivePlanHash:r.effectivePlanHash}:{}),candidateId:c.id,candidateHash:hash(c),...(r.reconstructionScope?{reconstructionScope:r.reconstructionScope}:{}),assembly,coverage:c.coverage,...(r.version===5?{pendingObservations:l.geometryReview.input.review.pieces.filter(p=>!p.excluded&&!c.assembly.pieces.some(x=>x.id===p.id)).map(p=>({...p,profileSnapshot:l.geometryReview.input.profiles.find(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion)??null,observation:l.geometryReview.input.evidence.observations.find(o=>o.id===p.id)})),searchProgress:r.search.progressive}:{}),unverifiedConstraints:c.unverifiedConstraints,photoMatch:c.photoMatch,observationMap,spatialConsistency},l)
   })
  }
  fail('未知 Visible 3D 操作',404)
 }}
}

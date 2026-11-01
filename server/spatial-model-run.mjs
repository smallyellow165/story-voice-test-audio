import { mkdir, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { callBrickModel } from './brick-model-call.mjs'
import { captureVisionWire } from './brick-vision-wire.mjs'
import { resolveModel, modelSettings, providerConfigured } from './brick-model-registry.mjs'
import { requestOpenaiBackground } from './openai-responses.mjs'
import { readFile } from 'node:fs/promises'
async function saveTrace(file,record,onTrace){
 const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(record,null,2),{mode:0o600});await rename(temp,file);if(onTrace)await onTrace(record)
}
function finishRecord(record,input,{validate,assess=()=>null},error){
 if(record.rawOutput){try{record.plan=JSON.parse(record.rawOutput);record.parseStatus='parsed'}catch{record.parseStatus='invalid_json'}}else record.parseStatus='no_output'
 if(record.parseStatus==='parsed'){record.validation=validate(record.plan,input);record.conversion=assess(record.plan,input)}
 const complete=record.provider==='gemini'?record.finishReason==='STOP':record.finishReason==='completed'
 record.status=error?'provider_or_trace_failed':!complete?'model_incomplete':!record.validation?.valid?'invalid_plan':'plan_ready_for_review'
 record.error=error?{code:record.failureKind??'PROVIDER_OR_CAPTURE_FAILED',message:record.background?error.message:error?.providerDiagnostic?error.message:'Provider/trace failed; inspect persisted wireStatus and raw response. No retry.',diagnostic:error.providerDiagnostic??null}:null
}
function backgroundState(record,error,retrieval=false){
 const b=record.background,s=record.finishReason
 b.responseId=record.providerResponseId??b.responseId??null;b.providerStatus=s??b.providerStatus??null
 b.possiblyCharged=!!record.providerRequestStarted
 b.state=error?(record.failureKind==='timeout'?'timeout':record.transportError||retrieval&&record.httpStatus>=400?'unknown':record.httpStatus>=400?'failed':record.failureKind==='provider_incomplete'?'failed':record.failureKind==='refusal'?'failed':s==='failed'||s==='cancelled'?'failed':'unknown'):['queued','in_progress'].includes(s)?'running':s==='completed'?'completed':'unknown'
 b.events.push({at:new Date().toISOString(),state:b.state,providerStatus:b.providerStatus,responseId:b.responseId,httpStatus:record.httpStatus??null,requestId:record.providerRequestId??record.responseId??null,error:error?.message??null})
}
// Exactly one explicit provider call; no recognition, repair, retry, or fallback.
export async function runStructuredSpatialModel(prepared, { model, directory, sources = [], execute = false, onTrace }, contract) {
  const { runtimeStatus, task = "design", recordTask = "spatial-planning", promptVersion, buildRequest, validate, assess = () => null, call = callBrickModel, capture = captureVisionWire } = contract
  if(!(await runtimeStatus()).current)throw new Error('Spatial Prompt source changed; restart the development server before preparing or generating. No API call made')
  const definition = resolveModel(model,task)
  if (execute && !providerConfigured(definition.provider)) throw new Error('Missing ' + (definition.provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY') + '; no API call made')
  const id = randomUUID(), tracePath = path.resolve(directory,id+'.json')
  const record = {id,generationId:id,task:recordTask,promptVersion,createdAt:new Date().toISOString(),
    status:'prepared',provider:definition.provider,model,generationSettings:modelSettings(model,task),
    ...(prepared.partsSnapshotId?{inputContract:'parts-input-snapshot-v1',partsSnapshotId:prepared.partsSnapshotId,preparationContextId:prepared.preparationContextId}:{}),
    sources,requestInput:prepared.input,image:prepared.image,geometrySnapshot:prepared.geometrySnapshot,
    imagePayloadSha256:prepared.imagePayloadSha256,request:buildRequest(model,prepared),tracePath,
    rawOutput:null,plan:null,parseStatus:'not_run',validation:null,conversion:null,geometryCorrection:null}
  if(contract.background&&definition.provider==='openai'){
    record.request={...record.request,background:true,store:true};record.startedAt=new Date().toISOString()
    record.background={state:'submitting',responseId:null,providerStatus:null,events:[],polls:[],possiblyCharged:false}
  }
  await mkdir(directory,{recursive:true})
  await writeFile(tracePath,JSON.stringify(record,null,2),{flag:'wx',mode:0o600})
  const persist = () => saveTrace(tracePath,record,onTrace)
  if(onTrace)await onTrace(record)
  if (!execute) return record
  const started = performance.now()
  let providerError = null,backgroundError=null
  try {
    record.status = 'requesting'
    await capture(directory,record,persist,() => call({model,task,request:record.request,record,...(record.background?{requestOpenai:(request,r)=>requestOpenaiBackground(request,r,{clientRequestId:id})}:{})}))
  } catch (error) {
    backgroundError=error
    providerError = {code:'PROVIDER_OR_CAPTURE_FAILED',message:error?.providerDiagnostic ? error.message : 'Provider/trace failed; inspect persisted wireStatus and raw response. No retry.',
      diagnostic:error?.providerDiagnostic ?? null}
  }
  if(record.background){
    const error=backgroundError
    backgroundState(record,error)
    if(!error&&record.background.state==='running'){record.status='provider_running';record.parseStatus='pending';record.elapsedMs=Math.round(performance.now()-started);await persist();return record}
    finishRecord(record,prepared.input,contract,error);record.elapsedMs=Math.round(performance.now()-started);await persist();return record
  }
  // Even incomplete or rejected provider responses remain inspectable when text exists.
  if (record.rawOutput) {
    try { record.plan=JSON.parse(record.rawOutput); record.parseStatus='parsed' }
    catch { record.parseStatus='invalid_json' }
  } else record.parseStatus='no_output'
  if (record.parseStatus === 'parsed') {
    record.validation=validate(record.plan,prepared.input)
    record.conversion=assess(record.plan,prepared.input)
  }
  const complete = record.provider === 'gemini' ? record.finishReason === 'STOP' : record.finishReason === 'completed'
  record.status = providerError ? 'provider_or_trace_failed' : !complete ? 'model_incomplete'
    : !record.validation?.valid ? 'invalid_plan' : 'plan_ready_for_review'
  record.error=providerError
  record.elapsedMs=Math.round(performance.now()-started)
  // Failure here propagates: never report success if the final trace was not saved.
  await persist()
  return record
}

// Query only a previously persisted provider ID. Never build or POST a new
// generation request here. The caller serializes updates on the request ID.
export async function resumeStructuredSpatialModel(directory,id,contract,onTrace){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('无效 Trace ID')
 const file=path.join(directory,id+'.json'),record=JSON.parse(await readFile(file,'utf8')),b=record.background
 if(!b?.responseId||record.provider!=='openai'||record.task!=='magnetic-visible3d-analysis')throw Error('尚无 Provider Response ID，无法安全恢复；不会重新提交。')
 if(['completed','failed'].includes(b.state))return record
 const poll={id:randomUUID(),createdAt:new Date().toISOString()},pollDir=path.join(directory,id+'.polls')
 await mkdir(pollDir,{recursive:true});const save=()=>saveTrace(file,record,onTrace)
 // Link an in-flight GET before sending it, for crash/network diagnostics.
 b.polls.push(poll);await save()
 let error=null
 try{await captureVisionWire(pollDir,poll,save,()=>requestOpenaiBackground(null,poll,{responseId:b.responseId,clientRequestId:poll.id}))}catch(e){error=e}
 record.latestPollId=poll.id
 for(const key of ['httpStatus','responseId','providerRequestId','rawResponseBody','response','modelVersion','usageMetadata','finishReason','providerErrorCode','failureKind','transportError','rawOutput']){if(poll[key]!==undefined)record[key]=poll[key];else delete record[key]}
 // Failed GETs must retain the original provider ID and last known state.
 record.providerResponseId=b.responseId
 if(!poll.finishReason)record.finishReason=b.providerStatus
 record.wireStatus=poll.wireStatus
 backgroundState(record,error,true)
 if(!error&&b.state==='running'){record.status='provider_running';record.parseStatus='pending';record.error=null}
 else finishRecord(record,record.requestInput,contract,error)
 record.elapsedMs=Date.now()-Date.parse(record.startedAt??record.createdAt);await save();return record
}

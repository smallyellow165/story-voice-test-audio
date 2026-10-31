import { mkdir, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { callBrickModel } from './brick-model-call.mjs'
import { captureVisionWire } from './brick-vision-wire.mjs'
import { resolveModel, modelSettings, providerConfigured } from './brick-model-registry.mjs'
// Exactly one explicit provider call; no recognition, repair, retry, or fallback.
export async function runStructuredSpatialModel(prepared, { model, directory, sources = [], execute = false }, contract) {
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
  await mkdir(directory,{recursive:true})
  await writeFile(tracePath,JSON.stringify(record,null,2),{flag:'wx',mode:0o600})
  const persist = async () => {
    await writeFile(tracePath+'.tmp',JSON.stringify(record,null,2),{mode:0o600})
    await rename(tracePath+'.tmp',tracePath)
  }
  if (!execute) return record
  const started = performance.now()
  let providerError = null
  try {
    record.status = 'requesting'
    await capture(directory,record,persist,() => call({model,task,request:record.request,record}))
  } catch (error) {
    providerError = {code:'PROVIDER_OR_CAPTURE_FAILED',message:error?.providerDiagnostic ? error.message : 'Provider/trace failed; inspect persisted wireStatus and raw response. No retry.',
      diagnostic:error?.providerDiagnostic ?? null}
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

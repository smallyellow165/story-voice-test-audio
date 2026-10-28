import { AsyncLocalStorage } from 'node:async_hooks'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const scope = new AsyncLocalStorage()
let installed = false
function tagged(error,stage){
 error.failureStage=stage
 error.failureCategory='trace_persist_failed'
 return error
}
// SDK uses global fetch. Capture only the current request; never retry the provider.
export async function captureVisionWire(directory, record, persist, call) {
 if (!installed) {
  const transport=globalThis.fetch
  globalThis.fetch=async(input,init)=>{
   const capture=scope.getStore()
   if(!capture)return transport(input,init)
   if(capture.called)throw Object.assign(new Error('Vision 禁止重复 HTTP 请求'),{failureCategory:'provider_request_failed',failureStage:'duplicate_request_guard'})
   capture.called=true
   const {record:r,directory:dir,persist:save}=capture
   if(typeof init?.body!=='string')throw tagged(new Error('无法完整保存 Vision HTTP 请求正文，未发送'),'request_capture')
   const url=new URL(input instanceof Request?input.url:String(input))
   r.endpoint=url.origin+url.pathname
   r.rawRequestPath=path.resolve(dir,`${r.id}.request.json`)
   const saveAt=async stage=>{try{await save()}catch(e){throw tagged(e,stage)}}
   try{await writeFile(r.rawRequestPath,init.body,{flag:'wx',mode:0o600})}
   catch(e){throw tagged(e,'raw_request_write')}
   r.wireStatus='request_saved'
   await saveAt('request_metadata_write')
   let response
   r.providerRequestStarted=true
   try{response=await transport(input,init)}
   catch(error){
    r.wireStatus='no_response';r.transportError=error?.name||'TransportError'
    error.failureCategory='provider_request_failed';error.failureStage='provider_transport'
    await saveAt('transport_error_metadata_write')
    throw error
   }
   r.httpStatus=response.status
   r.responseId=response.headers.get('x-request-id')
   r.rawResponsePath=path.resolve(dir,`${r.id}.response.txt`)
   try{
    // Retain the response in metadata too if the sidecar write subsequently fails.
    r.rawResponseBody=await response.clone().text()
    await writeFile(r.rawResponsePath,r.rawResponseBody,{flag:'wx',mode:0o600})
    r.wireStatus='response_saved'
   }catch(error){
    r.wireStatus='response_capture_failed'
    r.responseCaptureError=error?.code||error?.name||'CaptureError'
    // The caller persists classified diagnostics; do not mask this stage.
    throw tagged(error,'raw_response_capture_or_write')
   }
   await saveAt('response_metadata_write')
   return response
  }
  installed=true
 }
 return scope.run({directory,record,persist,called:false},call)
}

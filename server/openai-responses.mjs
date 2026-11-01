import { resolveModel, modelSettings, providerConfigured } from './brick-model-registry.mjs'
export const openaiResponsesEndpoint = 'https://api.openai.com/v1/responses'
export const openaiConfigured = () => providerConfigured('openai')
export function buildOpenaiRequest({ model, task, prompt, schema, content }) {
  if (resolveModel(model, task).provider !== 'openai') throw new Error('OpenAI adapter received a different provider')
  return { model, store: false, text: { format: { type: 'json_object' } }, ...modelSettings(model, task),
    instructions: prompt + '\nReturn a JSON object only, no markdown. Follow this business output contract (type names describe fields, not output values):\n' + JSON.stringify(schema),
    // JSON mode requires an explicit JSON instruction in input, not only instructions.
    input: [{ role: 'user', content: content.some(p=>p.type==='input_text'&&/json/i.test(p.text||'')) ? content : [{type:'input_text',text:'Return a JSON object only, following the output contract in the instructions. No markdown.'},...content] }],
  }
}
export async function requestOpenaiResponse(request, record, fetchImpl = fetch) {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) throw Object.assign(new Error('Test Audio 服务端缺少 OPENAI_API_KEY；未调用其他 Provider。'), { statusCode: 503 })
  record.endpoint = openaiResponsesEndpoint
  // One fetch only. No retry, fallback, background polling or redirects.
  const response = await fetchImpl(openaiResponsesEndpoint, { method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(180000) })
  record.httpStatus = response.status
  record.responseId = response.headers.get('x-request-id')
  record.rawResponseBody = await response.text()
  let data = null
  try { data = JSON.parse(record.rawResponseBody) } catch { /* original body retained */ }
  record.response = data
  record.modelVersion = data?.model ?? null
  record.usageMetadata = data?.usage ?? null
  record.finishReason = data?.status ?? null
  if (!response.ok) {
    throw Object.assign(new Error(typeof data?.error?.message === 'string' ? data.error.message : `OpenAI HTTP ${response.status}`), {
      statusCode: response.status, providerDiagnostic: { httpStatus: response.status,
        rawErrorBody: record.rawResponseBody, errorBody: data },
    })
  }
  record.rawOutput = (data?.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('')
  if (data?.status !== 'completed') throw Object.assign(new Error(`OpenAI 未完成：${data?.status || '无状态'}；${JSON.stringify(data?.incomplete_details || data?.error || null)}`), { statusCode: 422 })
  if ((data.output || []).some(item => item.content?.some(c => c.type === 'refusal'))) {
    throw Object.assign(new Error('OpenAI 拒绝了本次请求；原始响应已保留。'), { statusCode: 422 })
  }
}

// Opt-in background transport. A call is exactly one POST (submit) OR one GET
// (retrieve); transport failures never cause a second generation request.
export async function requestOpenaiBackground(request, record, {responseId, clientRequestId, fetchImpl=fetch}={}) {
  const key=process.env.OPENAI_API_KEY?.trim()
  if(!key)throw Object.assign(Error('服务端缺少 OPENAI_API_KEY；未发送请求。'),{statusCode:503,code:'PROVIDER_CONFIG'})
  if(responseId&&!/^resp_[A-Za-z0-9_-]+$/.test(responseId))throw Error('无效 Provider Response ID')
  const endpoint=openaiResponsesEndpoint+(responseId?'/'+responseId:''),method=responseId?'GET':'POST'
  record.endpoint=endpoint;record.method=method;record.requestStartedAt=new Date().toISOString()
  let response
  try {
    response=await fetchImpl(endpoint,{method,redirect:'error',headers:{Authorization:`Bearer ${key}`,...(!responseId?{'Content-Type':'application/json'}:{}),...(clientRequestId?{'X-Client-Request-Id':clientRequestId}:{})},...(!responseId?{body:JSON.stringify(request)}:{}),signal:AbortSignal.timeout(responseId?30000:90000)})
    record.httpStatus=response.status;record.responseId=response.headers.get('x-request-id');record.providerRequestId=record.responseId
    record.rawResponseBody=await response.text()
  } catch(error) {
    record.transportError=error.name;record.failureKind=error.name==='TimeoutError'?'timeout':'network_error'
    throw error
  }
  let data=null;try{data=JSON.parse(record.rawResponseBody)}catch{/* original wire retained */}
  record.response=data;record.providerResponseId=data?.id??responseId??null;record.modelVersion=data?.model??null
  record.usageMetadata=data?.usage??null;record.finishReason=data?.status??null;record.providerErrorCode=data?.error?.code??null
  if(!response.ok){record.failureKind=data?.error?.code==='insufficient_quota'?'insufficient_quota':response.status===400?'request_rejected':'http_error';throw Object.assign(Error(data?.error?.message??`OpenAI HTTP ${response.status}`),{statusCode:response.status,providerDiagnostic:{httpStatus:response.status,code:record.providerErrorCode,errorBody:data}})}
  record.rawOutput=(data?.output??[]).flatMap(i=>i.content??[]).filter(p=>p.type==='output_text').map(p=>p.text).join('')
  if(!/^resp_[A-Za-z0-9_-]+$/.test(data?.id??'')||responseId&&data.id!==responseId||!['queued','in_progress','completed','failed','cancelled','incomplete'].includes(data?.status)){record.failureKind='unknown_response';throw Error('OpenAI Response ID / 状态无效或与查询任务不一致；不会自动重发。')}
  if(['queued','in_progress'].includes(data.status))return
  if(data.status!=='completed'){record.failureKind='provider_'+data.status;throw Object.assign(Error(`OpenAI ${data.status}：${JSON.stringify(data.error??data.incomplete_details??null)}`),{statusCode:422})}
  if((data.output??[]).some(i=>i.content?.some(c=>c.type==='refusal'))){record.failureKind='refusal';throw Object.assign(Error('OpenAI 拒绝了本次请求；原始响应已保留。'),{statusCode:422})}
}

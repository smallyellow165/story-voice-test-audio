import { resolveModel, modelSettings, providerConfigured } from './brick-model-registry.mjs'
export const openaiResponsesEndpoint = 'https://api.openai.com/v1/responses'
export const openaiConfigured = () => providerConfigured('openai')
export function buildOpenaiRequest({ model, task, prompt, schema, content }) {
  if (resolveModel(model, task).provider !== 'openai') throw new Error('OpenAI adapter received a different provider')
  return { model, store: false, text: { format: { type: 'json_object' } }, ...modelSettings(model, task),
    instructions: prompt + '\nReturn a JSON object only, no markdown. Follow this business output contract (type names describe fields, not output values):\n' + JSON.stringify(schema),
    input: [{ role: 'user', content }],
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

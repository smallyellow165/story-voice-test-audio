// Test Audio has no existing OpenAI Node client. Keep this adapter limited to
// native Responses transport; all recognition and Catalog rules remain shared.
export const openaiVisionModel = 'gpt-4.1' // Already configured in V4; official image-input model.
export const openaiVisionEndpoint = 'https://api.openai.com/v1/responses'
export function openaiVisionConfigured() { return !!process.env.OPENAI_API_KEY?.trim() }

export function buildOpenaiVisionRequest({ model, image, colors, prompt, schema }) {
  return { model, store: false, text: { format: { type: 'json_object' } },
    instructions: `${prompt}\nReturn a JSON object only, no markdown. Follow this business output contract (type names describe fields, not output values):\n${JSON.stringify(schema)}`,
    input: [{ role: 'user', content: [
      // JSON mode checks input messages, not just top-level instructions.
      { type: 'input_text', text: `Return a JSON object only, following the business output contract in the instructions. No markdown.\n${JSON.stringify({ mode: 'inventory', colors, context: null })}` },
      { type: 'input_image', image_url: `data:${image.mimeType};base64,${image.imageBase64}` },
    ] }],
  }
}

export async function requestOpenaiVision(request, record, fetchImpl = fetch) {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) throw Object.assign(new Error('Test Audio 服务端缺少 OPENAI_API_KEY；未调用其他 Provider。'), { statusCode: 503 })
  record.endpoint = openaiVisionEndpoint
  // One fetch only. No retry, fallback, background polling or redirects.
  const response = await fetchImpl(openaiVisionEndpoint, { method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(180000) })
  record.httpStatus = response.status
  record.responseId = response.headers.get('x-request-id')
  record.rawResponseBody = await response.text()
  let data = null
  try { data = JSON.parse(record.rawResponseBody) } catch { /* original body retained */ }
  record.response = data
  if (!response.ok) {
    throw Object.assign(new Error(typeof data?.error?.message === 'string' ? data.error.message : `OpenAI HTTP ${response.status}`), {
      statusCode: response.status, providerDiagnostic: { httpStatus: response.status,
        rawErrorBody: record.rawResponseBody, errorBody: data },
    })
  }
  record.modelVersion = data?.model ?? null
  record.usageMetadata = data?.usage ?? null
  record.finishReason = data?.status ?? null
  record.rawOutput = (data?.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('')
  if (data?.status !== 'completed') throw Object.assign(new Error(`OpenAI 未完成：${data?.status || '无状态'}；${JSON.stringify(data?.incomplete_details || data?.error || null)}`), { statusCode: 422 })
  if ((data.output || []).some(item => item.content?.some(c => c.type === 'refusal'))) {
    throw Object.assign(new Error('OpenAI 拒绝了本次识别；原始响应已保留。'), { statusCode: 422 })
  }
}

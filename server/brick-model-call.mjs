import { resolveModel } from './brick-model-registry.mjs'
import { createGeminiClient } from './gemini-client.mjs'
import { requestOpenaiResponse } from './openai-responses.mjs'

// Shared transport and response extraction only. Business validation stays with
// each caller, and both callers wrap this in the existing raw-wire trace scope.
export async function callBrickModel({ model, task, request, record, createClient = createGeminiClient, requestOpenai = requestOpenaiResponse }) {
  const definition = resolveModel(model, task)
  if (request.model !== model) throw new Error('Request model does not match registry selection')
  record.provider = definition.provider; record.model = model
  if (definition.provider === 'openai') return requestOpenai(request, record)
  let client
  try { client = createClient() }
  catch { throw Object.assign(new Error('Gemini 客户端不可用，请检查 GEMINI_API_KEY 和服务端依赖。'), { statusCode: 503, code: 'PROVIDER_CONFIG' }) }
  const response = await client.models.generateContent(request)
  record.response = response
  record.httpStatus ??= response.sdkHttpResponse?.status ?? null
  record.modelVersion = response.modelVersion ?? null
  record.usageMetadata = response.usageMetadata ?? null
  record.responseId = response.responseId ?? null
  const candidate = response.candidates?.[0]
  record.finishReason = candidate?.finishReason ?? null
  record.finishMessage = candidate?.finishMessage ?? null
  record.blockReason = response.promptFeedback?.blockReason ?? null
  record.rawOutput = candidate?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') || ''
}

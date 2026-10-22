import { modelOptions, resolveModel } from './brick-model-registry.mjs'
import { buildOpenaiRequest } from './openai-responses.mjs'
export { openaiConfigured as openaiVisionConfigured, openaiResponsesEndpoint as openaiVisionEndpoint, requestOpenaiResponse as requestOpenaiVision } from './openai-responses.mjs'
export const openaiVisionModel = modelOptions('inventory').find(m => m.provider === 'openai').id
export function openaiVisionModelOptions() { return modelOptions('inventory').filter(m => m.provider === 'openai') }
export function resolveOpenaiVisionModel(model) {
  if (resolveModel(model, 'inventory').provider !== 'openai') throw Object.assign(new Error('不支持的 OpenAI Vision 模型'), { statusCode: 400 })
  return model
}
export function buildOpenaiVisionRequest({ model, image, colors, prompt, schema }) {
  return buildOpenaiRequest({ model, task: 'inventory', prompt, schema, content: [
    { type: 'input_text', text: 'Return a JSON object only, following the business output contract in the instructions. No markdown.\n' + JSON.stringify({ mode: 'inventory', colors, context: null }) },
    { type: 'input_image', image_url: 'data:' + image.mimeType + ';base64,' + image.imageBase64 },
  ] })
}

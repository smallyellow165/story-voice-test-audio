// Request-only isolation. Never used by the production recognition route.
export const diagnosticStages = ['image', 'json', 'schema', 'budget', 'full', 'inventory-schema']

export function buildVisionDiagnostic(record, stage) {
  if (!diagnosticStages.includes(stage)) throw new Error(`Choose one stage: ${diagnosticStages.join(', ')}`)
  if (!record?.request?.model || !Array.isArray(record.request.contents)
    || !record.request.contents.some(c => c.parts?.some(p => p.inlineData?.data))) {
    throw new Error('Source record must contain the actual image and Gemini request')
  }
  const request = structuredClone(record.request)
  if (stage === 'image') {
    const images = request.contents.flatMap(c => c.parts || []).filter(p => p.inlineData)
    if (images.length !== 1 || images[0].inlineData.mimeType !== 'image/jpeg') throw new Error('Minimal image diagnostic requires exactly one JPEG')
    const data = images[0].inlineData.data
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid raw Base64 image data')
    const bytes = Buffer.from(data, 'base64')
    if (bytes.toString('base64') !== data || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error('Invalid JPEG encoding or signature')
    // Official generateContent inline-image format. No config at all; the
    // shared client's transport still enforces one attempt and its timeout.
    return { model: request.model, contents: [
      { inlineData: { mimeType: 'image/jpeg', data } },
      { text: '请描述图片中的积木，包括数量、颜色和形状。' },
    ] }
  }
  const original = request.config
  if (!original?.responseSchema || !original.httpOptions) throw new Error('Source generation config missing')
  if (stage === 'inventory-schema') {
    if (record.mode !== 'inventory' || !original.responseSchema.properties?.observations) throw new Error('Inventory source required')
    // Controlled ablation: keep all other request fields, including the prompt,
    // identical. This is not a production inventory result or validator bypass.
    request.config.responseSchema = { type: 'OBJECT', required: ['observations'],
      properties: { observations: original.responseSchema.properties.observations } }
  } else if (stage !== 'full') {
    // Hold image, text, system instruction, model and transport fixed. Add one
    // generation-config group per stage. No automatic stage progression.
    request.config = { httpOptions: original.httpOptions, systemInstruction: original.systemInstruction }
    if (stage !== 'image') {
      request.config.responseMimeType = original.responseMimeType
      request.config.responseSchema = stage === 'json'
        ? { type: 'OBJECT', required: ['description'], properties: { description: { type: 'STRING' } } }
        : original.responseSchema
    }
    if (stage === 'budget') request.config.maxOutputTokens = original.maxOutputTokens
  }
  if (request.config.httpOptions?.retryOptions?.attempts !== 1) throw new Error('Diagnostic requires retry attempts = 1')
  return request
}

// Single model identity/capability source for Brick tasks. Account access is
// checked by the provider, never assumed or repaired with another model.
const geminiSettings = { maxOutputTokens: 32768, thinkingConfig: { thinkingLevel: 'MEDIUM' },
  httpOptions: { timeout: 180000, retryOptions: { attempts: 1 } } }
export const brickModels = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', provider: 'gemini', tasks: ['inventory', 'step', 'design'], settings: geminiSettings },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)', provider: 'gemini', tasks: ['inventory', 'step', 'design'], settings: geminiSettings },
  { id: 'gpt-4.1', label: 'OpenAI GPT-4.1', provider: 'openai', tasks: ['inventory', 'design'], settings: {} },
  { id: 'gpt-6.1-sol', label: 'OpenAI GPT-6.1 Sol', provider: 'openai', tasks: ['inventory', 'design'], settings: { reasoning: { effort: 'medium' } } },
  { id: 'gpt-6-luna', label: 'OpenAI GPT-6 Luna', provider: 'openai', tasks: ['inventory', 'design'], settings: { reasoning: { effort: 'medium' } } },
  { id: 'gpt-6-astra', label: 'OpenAI GPT-6 Astra', provider: 'openai', tasks: ['inventory', 'design'], settings: { reasoning: { effort: 'medium' } } },
]
export const defaultBrickModel = brickModels[0].id
export function resolveModel(id, task) {
  const model = brickModels.find(m => m.id === id)
  if (!model || !model.tasks.includes(task)) throw Object.assign(new Error('模型未登记或不支持当前任务：' + id + ' / ' + task), { statusCode: 400 })
  return model
}
export function modelOptions(task) { return brickModels.filter(m => m.tasks.includes(task)).map(({ id, label, provider }) => ({ id, label, provider })) }
export function providerConfigured(provider) {
  if (provider === 'gemini') return !!process.env.GEMINI_API_KEY?.trim()
  if (provider === 'openai') return !!process.env.OPENAI_API_KEY?.trim()
  return false
}
export function providerStatus() { return { gemini: providerConfigured('gemini'), openai: providerConfigured('openai') } }
export function modelSettings(id, task) { return structuredClone(resolveModel(id, task).settings) }

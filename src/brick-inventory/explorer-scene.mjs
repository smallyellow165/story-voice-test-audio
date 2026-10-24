// Shared URL serialization; never triggers recognition, saving, or inventory changes.
export function parseExplorerScene(href) {
  const params = new URL(href).searchParams, warnings = []
  const value = key => params.has(key) ? params.get(key).trim() : undefined
  const strategies = { loose: 'loose', assembled: 'geometry_only', geometry_only: 'geometry_only', catalog_match: 'catalog_match' }
  const sources = { server: 'server_library', server_library: 'server_library', upload: 'upload' }
  const strategy = Object.hasOwn(strategies, value('strategy')) ? strategies[value('strategy')] : undefined
  const imageSource = Object.hasOwn(sources, value('imageSource')) ? sources[value('imageSource')] : undefined
  if (params.has('strategy') && !strategy) warnings.push('无效 strategy；使用默认策略。')
  if (params.has('imageSource') && !imageSource) warnings.push('无效 imageSource；使用默认图片来源。')
  const imageValue = value('image')
  const image = imageValue && !/[\/\\\x00-\x1f]/.test(imageValue) && /\.(jpe?g|png|webp)$/i.test(imageValue) ? imageValue : undefined
  if (params.has('image') && !image) warnings.push('无效 image；请选择服务器图片列表中的文件。')
  const analysis = value('analysisId')
  const analysisId = analysis && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(analysis) ? analysis.toLowerCase() : undefined
  if (params.has('analysisId') && !analysisId) warnings.push('无效 analysisId；未自动加载历史。')
  const token = key => {
    const text = value(key)
    if (text === undefined) return undefined
    if (/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(text)) return text
    warnings.push('无效 ' + key + '；使用已有模型设置。')
    return undefined
  }
  if (image && imageSource === 'upload') warnings.push('image 仅用于服务器图片；Upload 请手动选择本地文件。')
  return { strategy, imageSource, image, analysisId, provider: token('provider'), model: token('model'), warnings }
}
export function resolveSceneHistory(scene, loose, assembled) {
  const l = loose.find(r => r.id === scene.analysisId), a = assembled.find(r => r.id === scene.analysisId)
  const found = l && a ? undefined : l ? 'loose' : a ? a.analysis_mode || 'catalog_match' : undefined
  const actual = ['loose', 'geometry_only', 'catalog_match'].includes(found) ? found : undefined
  const strategy = scene.strategy || actual || 'loose'
  const warning = !actual ? '历史记录不存在、不可读取或 ID 类型不唯一；未自动加载。'
    : scene.strategy && scene.strategy !== actual ? 'URL 策略与历史记录类型不兼容；未自动加载，请选择正确策略和历史。' : ''
  return { strategy, analysisId: warning ? undefined : scene.analysisId, warning }
}
export function selectSceneModel(models, fallback, scene = {}) {
  if (!scene.provider && !scene.model) return { id: fallback, warning: '' }
  // provider may also carry a full model ID for the original URL shorthand.
  const providerIsModel = !scene.model && models.some(m => m.id === scene.provider)
  const invalidProvider = scene.provider && !providerIsModel && !['gemini', 'openai'].includes(scene.provider)
  const id = scene.model || (providerIsModel ? scene.provider : undefined)
  const options = models.filter(m => (!scene.provider || providerIsModel || invalidProvider || m.provider === scene.provider) && (!id || m.id === id))
  const chosen = options.find(m => m.id === fallback) || options[0]
  return { id: chosen?.id || fallback, warning: !chosen || invalidProvider ? 'URL Provider / Model 不可用；无效参数已忽略，使用有效选项或已有设置。' : '' }
}
export function buildExplorerSceneLink(href, scene, stripSecrets = true) {
  const url = new URL(href)
  for (const key of ['strategy', 'imageSource', 'image', 'provider', 'model', 'analysisId']) url.searchParams.delete(key)
  // Never propagate credentials accidentally present in a pasted base URL.
  for (const key of [...url.searchParams.keys()]) if (stripSecrets && /^(api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|authorization)$/i.test(key)) url.searchParams.delete(key)
  url.searchParams.set('strategy', scene.strategy === 'geometry_only' ? 'assembled' : scene.strategy)
  if (scene.imageSource) url.searchParams.set('imageSource', scene.imageSource === 'server_library' ? 'server' : 'upload')
  if (scene.imageSource === 'server_library' && scene.image) url.searchParams.set('image', scene.image)
  if (scene.provider) url.searchParams.set('provider', scene.provider)
  if (scene.model) url.searchParams.set('model', scene.model)
  if (scene.analysisId) url.searchParams.set('analysisId', scene.analysisId)
  return url.href
}

// Address-bar synchronization owns only scene parameters; preserve unrelated URL state.
export function replaceExplorerScene(browser, scene, ready) {
  if (!ready) return false
  const next = buildExplorerSceneLink(browser.location.href, scene, false)
  if (next === browser.location.href) return false
  browser.history.replaceState(browser.history.state, '', next)
  return true
}

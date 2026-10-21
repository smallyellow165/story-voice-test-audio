// Shared response handling only; requests still use the existing API routes.
export async function requestJson(url, init, stage, fetchImpl = fetch, safeDetailOnly = false) {
  let response
  const fail = (reason, status = response?.status ?? null) => {
    throw Object.assign(new Error(`${stage} · HTTP ${status ?? '未收到响应'}：${reason}`), {
      stage, httpStatus: status, statusCode: status && status >= 400 ? status : 502,
    })
  }
  try { response = await fetchImpl(url, init) }
  catch (error) {
    fail(error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? '请求超时或已取消；未自动重试。' : '无法连接服务；请检查服务地址及运行状态。')
  }
  let text
  try { text = await response.text() }
  catch { fail('读取响应中断，未收到完整内容；未自动重试。') }
  const hint = response.status === 404
    ? (safeDetailOnly ? ' 请检查 My-Good-GYM 是否已加载 Mapping 路由，以及所请求的型号或颜色是否存在。'
      : ' API 路由或记录不存在；请确认使用 npm run dev 的 Test Audio 服务，且已重启以加载最新服务端代码。') : ''
  if (!text.trim()) fail('响应体为空。' + hint)
  let result
  try { result = JSON.parse(text) }
  catch { fail('响应不是完整有效的 JSON（可能是错误页面或响应被截断）。' + hint) }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('响应格式错误：需要 JSON 对象。')
  if (!response.ok) {
    const detail = result.error?.message ?? result.error ?? result.detail
    // Upstream DB/HTML/credential-bearing errors must not reach the browser.
    const reason = typeof detail === 'string' && (!safeDetailOnly || /^[a-z_]+$/.test(detail))
      ? detail : '服务返回错误，未提供可公开的原因。'
    fail(reason + hint)
  }
  return result
}

export async function postBrickGame(action, body, fetchImpl = fetch) {
  const stage = action === 'review' ? 'Inventory Review' : 'Game Generation'
  const result = await requestJson(`/api/brick-games/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
  }, stage, fetchImpl)
  if (action === 'review' && (result.schemaVersion !== 1 || typeof result.id !== 'string'
    || !result.session || !Array.isArray(result.session.items)
    || typeof result.mapping?.valid !== 'boolean' || !Array.isArray(result.mapping.rows)
    || !Array.isArray(result.mapping.inventory) || !Array.isArray(result.mapping.issues)
    || result.mapping.rows.some(row => !Array.isArray(row?.partCandidateChecks)
      || row.partCandidateChecks.some(candidate => !candidate?.local || !Array.isArray(candidate.reasons))))) {
    throw new Error('Inventory Review · HTTP 200：响应缺少完整的库存或 Mapping Review 数据；请检查服务端版本。')
  }
  return result
}

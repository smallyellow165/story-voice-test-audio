// Same-origin, GET-only bridge to the existing Application Server. No DB client.
export async function proxyBrickCatalog(request, response, url) {
  if (!url.pathname.startsWith('/api/brick-catalog/')) return false
  const send = (status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(data))
  }
  const route = url.pathname.slice('/api/brick-catalog/'.length)
  if (request.method !== 'GET') { send(405, { detail: 'get_only' }); return true }
  if (!['parts', 'filters', 'images', 'color-image', 'selection', 'schema', 'candidates'].includes(route)) { send(404, { detail: 'not_found' }); return true }
  // LAN/mobile same-origin access is supported; cross-site requests must not
  // spend the owner's Rebrickable quota. Keys never reach the browser.
  let foreignOrigin = false
  try { foreignOrigin = Boolean(request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) }
  catch { foreignOrigin = true }
  if (request.headers['sec-fetch-site'] === 'cross-site' || foreignOrigin) {
    send(403, { detail: 'same_origin_required' }); return true
  }
  const fail = (status, detail, stage, extra = {}) => {
    send(status, { detail, diagnostics: { route, stage, ...extra } })
    return true
  }
  let target
  try {
    target = new URL(process.env.APPLICATION_SERVER_URL || 'http://127.0.0.1:8001')
    if (!['http:', 'https:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
        || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('configuration')
    target.pathname = `/rebrickable-catalog/${route}`
    target.search = url.search
  } catch {
    return fail(503, 'application_server_configuration_error', 'proxy_configuration')
  }
  const context = { upstream: target.origin }
  const transportFailure = (error, stage) => {
    const code = error?.cause?.code ?? error?.code
    const errorCode = typeof code === 'string' && /^[A-Z0-9_]{1,60}$/.test(code) ? code : undefined
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return fail(504, 'application_server_timeout', stage, { ...context, timeoutMs: 25000, errorCode })
    }
    return fail(502, stage === 'upstream_body' ? 'application_server_response_interrupted'
      : 'application_server_network_error', stage, { ...context, errorCode })
  }
  let result
  try {
    result = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json' } })
  } catch (error) {
    return transportFailure(error, 'upstream_fetch')
  }
  context.upstreamStatus = result.status
  let body
  try { body = await result.text() }
  catch (error) { return transportFailure(error, 'upstream_body') }
  if (!body.trim()) return fail(502, 'application_server_empty_response', 'upstream_json', context)
  let data
  try { data = JSON.parse(body) }
  catch { return fail(502, 'application_server_invalid_json', 'upstream_json', context) }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail(502, 'application_server_invalid_response', 'upstream_json', context)
  }
  // Never relay HTML, SQL errors, credentials or arbitrary upstream error text.
  if (!result.ok) {
    return fail(result.status, typeof data.detail === 'string' && /^[a-z_]+$/.test(data.detail)
      ? data.detail : 'catalog_request_failed', 'backend_api', context)
  }
  send(result.status, data)
  return true
}

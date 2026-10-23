// Same-origin bridge; image retry is the only POST. No DB client or remote-image fetch.
export async function proxyBrickCatalog(request, response, url) {
  if (!url.pathname.startsWith('/api/brick-catalog/')) return false
  const send = (status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(data))
  }
  const route = url.pathname.slice('/api/brick-catalog/'.length)
  if (request.method !== (route === 'image-retry' ? 'POST' : 'GET')) { send(405, { detail: 'method_not_allowed' }); return true }
  if (!['parts', 'filters', 'images', 'color-image', 'image-file', 'image-retry', 'selection', 'schema', 'candidates'].includes(route)) { send(404, { detail: 'not_found' }); return true }
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
    result = await fetch(target, { method: request.method, redirect: 'error', signal: AbortSignal.timeout(25000), headers: { Accept: route === 'image-file' ? 'image/*' : 'application/json' } })
  } catch (error) {
    return transportFailure(error, 'upstream_fetch')
  }
  context.upstreamStatus = result.status
  if (route === 'image-file' && result.ok) {
    const mime = result.headers.get('content-type')?.split(';')[0]
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) return fail(502, 'invalid_image_content', 'upstream_body', context)
    try {
      const reader = result.body.getReader(), chunks = []
      let size = 0
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        if (size > 12 * 1024 * 1024) { await reader.cancel(); return fail(502, 'image_too_large', 'upstream_body', context) }
        chunks.push(Buffer.from(value))
      }
      if (!size) return fail(502, 'invalid_image_content', 'upstream_body', context)
      response.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      response.end(Buffer.concat(chunks))
      return true
    } catch (error) { return transportFailure(error, 'upstream_body') }
  }
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
  if (['images', 'color-image', 'image-retry'].includes(route)) {
    const records = route === 'images' ? Object.values(data.images || {}) : [data]
    for (const image of records) {
      if (typeof image?.url === 'string' && /^\/rebrickable-catalog\/image-file\?id=\d+$/.test(image.url)) {
        image.url = image.url.replace('/rebrickable-catalog/', '/api/brick-catalog/')
      }
    }
  }
  send(result.status, data)
  return true
}

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
  try {
    const target = new URL(process.env.APPLICATION_SERVER_URL || 'http://127.0.0.1:8001')
    if (!['http:', 'https:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
        || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('configuration')
    target.pathname = `/rebrickable-catalog/${route}`
    target.search = url.search
    const result = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json' } })
    const data = await result.json()
    // Never relay HTML, SQL errors, credentials or arbitrary upstream error text.
    send(result.status, result.ok ? data : { detail: typeof data.detail === 'string' && /^[a-z_]+$/.test(data.detail)
      ? data.detail : 'catalog_request_failed' })
  } catch {
    send(503, { detail: 'application_server_unavailable' })
  }
  return true
}

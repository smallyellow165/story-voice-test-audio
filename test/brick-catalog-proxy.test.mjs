import test from 'node:test'
import assert from 'node:assert/strict'
import { proxyBrickCatalog } from '../server/brick-catalog.mjs'

// Offline transport fixtures only. No real Backend, database or image API.
async function invoke(t, fetchImpl, target = 'http://127.0.0.1:8001') {
  const previous = process.env.APPLICATION_SERVER_URL
  process.env.APPLICATION_SERVER_URL = target
  t.after(() => {
    if (previous === undefined) delete process.env.APPLICATION_SERVER_URL
    else process.env.APPLICATION_SERVER_URL = previous
  })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (...args) => { calls++; return fetchImpl(...args) })
  const response = {
    status: null, body: null,
    writeHead(status) { this.status = status },
    end(body) { this.body = JSON.parse(body) },
  }
  const url = new URL('http://localhost/api/brick-catalog/candidates?color=25&size=2%C3%972&shape=curved_top&printed=unknown&page=1&page_size=24')
  assert.equal(await proxyBrickCatalog({ method: 'GET', headers: {} }, response, url), true)
  return { ...response, calls }
}

test('strict feature query reaches the existing Backend unchanged, including an empty success', async t => {
  const expected = { items: [], total: 0, eligible_total: 0, page: 1, page_size: 24 }
  const result = await invoke(t, async (url, init) => {
    assert.equal(url.origin, 'http://127.0.0.1:8001')
    assert.equal(url.pathname, '/rebrickable-catalog/candidates')
    assert.equal(url.searchParams.get('size'), '2×2')
    assert.equal(url.searchParams.get('color'), '25')
    assert.equal(url.searchParams.get('shape'), 'curved_top')
    assert.equal(url.searchParams.has('include_mismatches'), false)
    assert.equal(init.redirect, 'error')
    return Response.json(expected)
  })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, expected)
  assert.equal(result.calls, 1)
})

test('timeout is HTTP 504, distinct from connection failure, with no retry', async t => {
  const result = await invoke(t, async () => { throw Object.assign(new Error('private'), { name: 'TimeoutError' }) })
  assert.equal(result.status, 504)
  assert.equal(result.body.detail, 'application_server_timeout')
  assert.equal(result.body.diagnostics.stage, 'upstream_fetch')
  assert.equal(result.body.diagnostics.timeoutMs, 25000)
  assert.equal(result.calls, 1)
})

test('transport errors retain a safe code without arbitrary error text', async t => {
  const result = await invoke(t, async () => { throw new TypeError('private credentials', { cause: { code: 'ECONNREFUSED' } }) })
  assert.equal(result.status, 502)
  assert.equal(result.body.detail, 'application_server_network_error')
  assert.equal(result.body.diagnostics.errorCode, 'ECONNREFUSED')
  assert.equal(JSON.stringify(result.body).includes('credentials'), false)
  assert.equal(result.calls, 1)
})

for (const [body, upstreamStatus, detail] of [
  ['', 500, 'application_server_empty_response'],
  ['<html>private database error</html>', 500, 'application_server_invalid_json'],
  ['{"items":', 200, 'application_server_invalid_json'],
  ['null', 200, 'application_server_invalid_response'],
]) {
  test(`upstream ${upstreamStatus} ${detail} is not reported as a connection failure`, async t => {
    const result = await invoke(t, async () => new Response(body, { status: upstreamStatus }))
    assert.equal(result.status, 502)
    assert.equal(result.body.detail, detail)
    assert.equal(result.body.diagnostics.upstreamStatus, upstreamStatus)
    assert.equal(result.body.diagnostics.stage, 'upstream_json')
    assert.equal(JSON.stringify(result.body).includes('private'), false)
    assert.equal(result.calls, 1)
  })
}

test('body read failures preserve the received upstream HTTP status', async t => {
  const result = await invoke(t, async () => ({ status: 200, text: async () => { throw new Error('terminated') } }))
  assert.equal(result.status, 502)
  assert.equal(result.body.detail, 'application_server_response_interrupted')
  assert.equal(result.body.diagnostics.upstreamStatus, 200)
  assert.equal(result.body.diagnostics.stage, 'upstream_body')
})

for (const [status, detail, expected] of [
  [503, 'rebrickable_catalog_database_connection_failed', 'rebrickable_catalog_database_connection_failed'],
  [503, 'rebrickable_catalog_database_query_failed', 'rebrickable_catalog_database_query_failed'],
  [422, [{ msg: 'private' }], 'catalog_request_failed'],
  [500, 'database password=private', 'catalog_request_failed'],
]) {
  test(`Backend HTTP ${status} reason ${expected} stays an API failure`, async t => {
    const result = await invoke(t, async () => Response.json({ detail }, { status }))
    assert.equal(result.status, status)
    assert.equal(result.body.detail, expected)
    assert.equal(result.body.diagnostics.upstreamStatus, status)
    assert.equal(result.body.diagnostics.stage, 'backend_api')
    assert.equal(JSON.stringify(result.body).includes('private'), false)
  })
}

test('invalid configuration is distinguished before fetching and never leaks credentials', async t => {
  const result = await invoke(t, async () => { throw new Error('must not fetch') }, 'http://owner:private@127.0.0.1:8001')
  assert.equal(result.calls, 0)
  assert.equal(result.status, 503)
  assert.equal(result.body.detail, 'application_server_configuration_error')
  assert.equal(result.body.diagnostics.stage, 'proxy_configuration')
  assert.equal(JSON.stringify(result.body).includes('private'), false)
})

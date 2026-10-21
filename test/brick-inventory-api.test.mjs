import test from 'node:test'
import assert from 'node:assert/strict'
import { postBrickGame, requestJson } from '../src/brick-inventory/api.mjs'

// Transport fixtures only: no model requests or hard-coded Brick inventory.
test('empty 404 reports route/version diagnosis instead of JSON SyntaxError', async () => {
  let calls = 0
  await assert.rejects(postBrickGame('review', {}, async () => {
    calls++; return new Response(null, { status: 404 })
  }), error => error.name !== 'SyntaxError' && /Inventory Review.*HTTP 404.*响应体为空.*重启/.test(error.message))
  assert.equal(calls, 1)
})

test('empty success, truncated JSON and HTML retain stage and HTTP status', async () => {
  for (const [body, status] of [['', 200], ['{"id":', 200], ['<html>proxy error</html>', 502]]) {
    await assert.rejects(requestJson('/api/brick-games/review', {}, 'Inventory Review', async () => new Response(body, { status })),
      error => error.name !== 'SyntaxError' && error.message.includes(`HTTP ${status}`) && !error.message.includes('<html>'))
  }
})

test('upstream HTTP error retains safe backend reason, but never exposes arbitrary error text', async () => {
  for (const detail of ['rebrickable_catalog_disabled', 'database password=private']) {
    await assert.rejects(requestJson('http://localhost/mapping-part', {}, 'My-Good-GYM /mapping-part',
      async () => Response.json({ detail }, { status: 503 }), true), error => {
      assert.equal(error.httpStatus, 503)
      assert.match(error.message, /My-Good-GYM.*HTTP 503/)
      assert.equal(error.message.includes(detail), detail === 'rebrickable_catalog_disabled')
      return true
    })
  }
})

test('network failure and interrupted body are explicit, without retries', async () => {
  for (const fetchImpl of [
    async () => { throw new TypeError('fetch failed') },
    async () => ({ status: 200, text: async () => { throw new Error('terminated') } }),
  ]) {
    let calls = 0
    await assert.rejects(requestJson('/api/brick-games/review', {}, 'Inventory Review', (...args) => { calls++; return fetchImpl(...args) }), /Inventory Review.*HTTP/)
    assert.equal(calls, 1)
  }
})

test('malformed successful review is rejected before UI consumes mapping rows', async () => {
  for (const value of [{}, { schemaVersion: 1, id: 'review', session: { items: [] }, mapping: { valid: true } }]) {
    await assert.rejects(postBrickGame('review', {}, async () => Response.json(value)), /HTTP 200.*Mapping Review/)
  }
})

test('complete invalid review remains invalid and preserves server evidence', async () => {
  const review = { schemaVersion: 1, id: 'review', session: { items: [] },
    mapping: { valid: false, rows: [], inventory: [], issues: ['mapping failed'] } }
  const input = { session: review.session }
  const result = await postBrickGame('review', input, async (url, init) => {
    assert.equal(url, '/api/brick-games/review')
    assert.equal(init.method, 'POST')
    assert.deepEqual(JSON.parse(init.body), input)
    return Response.json(review)
  })
  assert.deepEqual(result, review)
})

test('old Review responses without candidate diagnostics fail clearly rather than crashing the UI', async () => {
  const review = { schemaVersion: 1, id: 'review', session: { items: [] },
    mapping: { valid: false, rows: [{}], inventory: [], issues: [] } }
  await assert.rejects(postBrickGame('review', {}, async () => Response.json(review)), /检查服务端版本/)
})

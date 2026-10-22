import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createBrickVision } from '../server/brick-vision.mjs'
import { captureVisionWire } from '../server/brick-vision-wire.mjs'

test('history is read-only, excludes failed/step records and never uses providers or Catalog', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vision-history-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const id = '11111111-1111-4111-8111-111111111111'
  const record = { id, status: 'complete', mode: 'inventory', provider: 'openai', model: 'model', createdAt: '2026-10-21T00:00:00Z', image: { sha256: 'image' }, matches: [{ observation: { id: 'original' } }] }
  const original = JSON.stringify(record)
  await writeFile(path.join(dir, `${id}.json`), original)
  for (const [suffix, changes] of [['2', { status: 'failed' }], ['3', { mode: 'step' }]]) {
    const other = id.slice(0, -1) + suffix
    await writeFile(path.join(dir, `${other}.json`), JSON.stringify({ ...record, id: other, ...changes }))
  }
  const forbidden = () => { throw new Error('No model, Catalog or Validator call allowed') }
  const service = createBrickVision(dir, { createClient: forbidden, requestOpenai: forbidden, getMetadata: forbidden, loadRules: forbidden })
  assert.deepEqual((await service.history()).records.map(r => r.id), [id])
  const loaded = await service.historyRecord(id)
  loaded.matches[0].observation.id = 'edited in UI'
  assert.equal((await service.historyRecord(id)).matches[0].observation.id, 'original')
  assert.equal(await readFile(path.join(dir, `${id}.json`), 'utf8'), original)
  await assert.rejects(service.historyRecord('../outside'), /无效/)
  await assert.rejects(service.historyRecord(id.slice(0, -1) + '2'), /仅可复用成功/)
})

test('wire capture persists exact bodies before parsing, including HTTP failures, without auth', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vision-wire-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // Local HTTP fixture only; no external provider or paid model request.
  const server = createServer((req, res) => { req.resume(); res.writeHead(req.url === '/bad' ? 400 : 200); res.end('not JSON: raw provider fixture') })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  for (const [index, route] of ['/ok', '/bad'].entries()) {
    const record = { id: `test-${index}` }
    const body = '{ "image": "base64", "prompt": "actual request" }'
    await assert.rejects(captureVisionWire(dir, record, async () => {}, async () => {
      const response = await fetch(base + route, { method: 'POST', headers: { Authorization: 'secret-test-only' }, body })
      return response.json() // Deliberate parser failure after durable capture.
    }))
    assert.equal(record.httpStatus, index ? 400 : 200)
    assert.equal(await readFile(record.rawRequestPath, 'utf8'), body)
    assert.equal(await readFile(record.rawResponsePath, 'utf8'), 'not JSON: raw provider fixture')
    assert.equal(record.wireStatus, 'response_saved')
    assert.ok(!JSON.stringify(record).includes('secret-test-only'))
  }
})

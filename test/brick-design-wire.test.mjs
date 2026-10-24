import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { captureVisionWire } from '../server/brick-vision-wire.mjs'

// Isolated transport fixture. No external HTTP or provider calls.
test('each call preserves complete wire bodies, including image tails and HTTP errors, without auth', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'design-wire-'))
  const originalFetch = globalThis.fetch
  t.after(async () => { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }) })
  const image = Buffer.alloc(1024 * 1024, 127).toString('base64')
  const body = JSON.stringify({ model: 'fixture', input: [{ image_url: 'data:image/png;base64,' + image }], instructions: 'full prompt', inventory: [{ part: '3437', quantity: 2 }] })
  const payload = JSON.stringify({ output: 'long-response'.repeat(30000) + 'FINAL-MARKER', usage: { total_tokens: 123 }, metadata: { complete: true } })
  let status = 200, offline = false
  globalThis.fetch = async () => { if (offline) throw new TypeError('offline'); return new Response(payload, { status }) }
  for (const [id, code] of [['generation', 200], ['repair', 400]]) {
    status = code
    const record = { id, provider: 'fixture', model: 'fixture' }
    const persist = () => writeFile(path.join(root, id + '.json'), JSON.stringify(record))
    await captureVisionWire(root, record, persist, () => fetch('https://fixture.invalid/models?key=secret', { method: 'POST', headers: { Authorization: 'Bearer secret' }, body }))
    assert.equal(record.wireStatus, 'response_saved')
    assert.equal(record.httpStatus, code)
    assert.equal(await readFile(record.rawRequestPath, 'utf8'), body)
    assert.equal(await readFile(record.rawResponsePath, 'utf8'), payload)
    assert.equal(JSON.stringify(record).includes('secret'), false)
    assert.equal(record.endpoint, 'https://fixture.invalid/models')
  }
  assert.notEqual(await readFile(path.join(root, 'generation.json'), 'utf8'), await readFile(path.join(root, 'repair.json'), 'utf8'))
  offline = true
  const record = { id: 'offline' }
  await assert.rejects(captureVisionWire(root, record, async () => {}, () => fetch('https://fixture.invalid', { method: 'POST', body })))
  assert.equal(record.wireStatus, 'no_response')
  assert.equal(await readFile(record.rawRequestPath, 'utf8'), body)
  assert.equal(record.rawResponsePath, undefined)
})

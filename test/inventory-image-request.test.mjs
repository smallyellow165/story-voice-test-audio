import test from 'node:test'
import assert from 'node:assert/strict'
import { createInventoryImageReader } from '../src/brick-inventory/inventory-image-request.mjs'

const available = { status: 'available', url: '/api/brick-catalog/image-file?id=2', cached: true }

test('selected Rebrickable color ID, including zero, is passed unchanged', async () => {
  const calls = []
  const read = createInventoryImageReader(async url => { calls.push(url); return available })
  const black = await read('3437', 0)
  const blue = await read('3437', 1)
  assert.equal(new URL(calls[0], 'http://local').searchParams.get('color_id'), '0')
  assert.equal(new URL(calls[1], 'http://local').searchParams.get('color_id'), '1')
  assert.equal(black.color_id, 0)
  assert.equal(blue.color_id, 1)
  assert.ok(calls.every(url => url.startsWith('/api/brick-catalog/color-image?')))
})

test('simultaneous requests share only the pending promise, not a second cache', async () => {
  let resolve, calls = 0
  const response = new Promise(done => { resolve = done })
  const read = createInventoryImageReader(async () => { calls++; return response })
  const first = read('3437', 1), second = read('3437', 1)
  assert.equal(first, second)
  resolve(available)
  await first
  assert.equal(calls, 1)
  await read('3437', 1)
  assert.equal(calls, 2, 'settled metadata is not retained in a new cache')
})

test('different colors have independent requests and resource identities', async () => {
  const read = createInventoryImageReader(async url => ({ ...available, url: '/api/brick-catalog/image-file?id=' + new URL(url, 'http://local').searchParams.get('color_id') }))
  const [yellow, blue] = await Promise.all([read('3437', 14), read('3437', 1)])
  assert.notEqual(yellow.url, blue.url)
  assert.equal(yellow.color_id, 14)
  assert.equal(blue.color_id, 1)
})

test('generic fallback uses existing images endpoint with null color identity', async () => {
  const calls = []
  const read = createInventoryImageReader(async url => {
    calls.push(url)
    return url.includes('/color-image?') ? { status: 'missing', url: null } : { images: { '3437': available } }
  })
  assert.equal((await read('3437', 1)).status, 'missing')
  const generic = await read('3437')
  assert.equal(generic.color_id, null)
  assert.equal(generic.url, available.url)
  assert.equal(calls[1], '/api/brick-catalog/images?part_nums=3437')
})

test('failures clear the pending request and never alter the saved inventory identity', async () => {
  const item = Object.freeze({ part_num: '3437', color_id: 1, quantity: 2 })
  let attempts = 0
  const read = createInventoryImageReader(async () => { attempts++; throw new Error('offline') })
  await assert.rejects(read(item.part_num, item.color_id), /offline/)
  await assert.rejects(read(item.part_num, item.color_id), /offline/)
  assert.equal(attempts, 2)
  assert.deepEqual(item, { part_num: '3437', color_id: 1, quantity: 2 })
})

test('malformed metadata or mismatched identities cannot masquerade as selected-color images', async () => {
  for (const response of [{ status: 'available' }, { ...available, part_num: '4066' }, { ...available, color_id: 14 }]) {
    const read = createInventoryImageReader(async () => response)
    await assert.rejects(read('3437', 1))
  }
})

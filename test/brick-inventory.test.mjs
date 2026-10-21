import test from 'node:test'
import assert from 'node:assert/strict'
import { addItem, itemKey, parseSession, setQuantity, validateItems } from '../src/brick-inventory/inventory.ts'
import { loadSessions, saveSession } from '../src/brick-inventory/storage.ts'
import { proxyBrickCatalog } from '../server/brick-catalog.mjs'

const red = { part_num: '3437', color_id: 4, quantity: 2 }
const blue = { part_num: '3437', color_id: 1, quantity: 1 }
const session = (id = '00000000-0000-4000-8000-000000000001') => ({
  schema_version: 1, id, name: '今天的积木', updated_at: '2026-10-21T00:00:00Z', items: [red, blue],
})
function memory() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }
}
test('same part/color merges, different colors remain distinct; edits do not mutate input', () => {
  const start = [red]
  const items = addItem(addItem(start, blue), { ...red, quantity: 3 })
  assert.deepEqual(items, [{ ...red, quantity: 5 }, blue])
  assert.deepEqual(start, [red])
  assert.deepEqual(setQuantity(items, itemKey(red), 0), [blue])
  assert.equal(setQuantity(items, itemKey(blue), 8)[1].quantity, 8)
})
test('reject invalid quantities, duplicate rows and the incompatible LDraw contract', () => {
  for (const quantity of [0, -1, 1.2, 1000, NaN, '2']) assert.throws(() => validateItems([{ ...red, quantity }]))
  assert.throws(() => addItem([{ ...red, quantity: 999 }], { ...red, quantity: 1 }))
  assert.throws(() => validateItems([red, red]))
  assert.throws(() => validateItems([{ part: '3437', color: '4', quantity: 1 }]))
  assert.throws(() => validateItems([{ ...red, color_id: -1 }]))
  assert.throws(() => validateItems([{ ...red, part_num: '../parts' }]))
})
test('save, reload and edit preserve canonical inventory and unrelated sessions', () => {
  const storage = memory()
  saveSession(storage, session())
  saveSession(storage, session('00000000-0000-4000-8000-000000000002'))
  saveSession(storage, { ...session(), items: [blue] })
  const loaded = loadSessions(storage)
  assert.equal(loaded.length, 2)
  assert.deepEqual(loaded[0].items, [blue])
  assert.deepEqual(loaded[1].items, [red, blue])
  assert.deepEqual(parseSession(JSON.parse(JSON.stringify(loaded[0]))), loaded[0])
})
test('corrupt saves and browser storage failures never report successful persistence', () => {
  const storage = memory()
  saveSession(storage, session())
  const key = [...storage.values.keys()][0]
  storage.setItem(key, 'not json')
  assert.throws(() => saveSession(storage, session()))
  assert.equal(storage.getItem(key), 'not json')
  assert.throws(() => saveSession({ getItem: () => null, setItem: () => { throw new Error('QuotaExceeded') } }, session()), /QuotaExceeded/)
  assert.throws(() => parseSession({ ...session(), name: '' }))
})
test('proxy permits only catalog GET routes and rejects foreign or malformed origins without fetching', async () => {
  for (const [method, headers, path, expected] of [
    ['POST', {}, 'parts', 405], ['GET', {}, 'other', 404],
    ['GET', { origin: 'https://foreign.example', host: 'localhost:5173' }, 'images', 403],
    ['GET', { origin: 'broken', host: 'localhost:5173' }, 'images', 403],
  ]) {
    const response = { status: 0, writeHead(status) { this.status = status }, end() {} }
    assert.equal(await proxyBrickCatalog({ method, headers }, response, new URL(`http://localhost/api/brick-catalog/${path}`)), true)
    assert.equal(response.status, expected)
  }
})

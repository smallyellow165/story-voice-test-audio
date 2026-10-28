import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createSourceImageStore } from '../server/brick-source-images.mjs'
import { createBrickReverse } from '../server/brick-reverse.mjs'
import { createBrickVision } from '../server/brick-vision.mjs'
import { originalFixture } from './source-image-fixture.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const wire = { mimeType: 'image/jpeg', imageBase64: Buffer.from([255,216,255]).toString('base64') }
async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'source-image-v1-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'images'), sourceImages = createSourceImageStore(directory)
  return { root, directory, sourceImages }
}
const geometry = {
  appearance: 'test', scale_evidence: 'unknown', unknowns: [], anchors: [], relations: [],
  observations: [{ id: 'one', color: 'Black', bbox: null, confidence: .5,
    dimensions: Object.fromEntries(['width_studs','depth_studs','height_brick_units'].map(k => [k, { value: null, status: 'unknown', confidence: .5, evidence: 'hidden', alternatives: [], anchor_ids: [] }])),
    orientation: { description: 'unknown', yaw_degrees: null, status: 'unknown', evidence: 'hidden' }, visible_studs: null,
    visible_seams: [], evidence: 'test', occlusion: 'unknown', unknowns: [], alternatives: [] }],
}

test('immutable canonical records deduplicate concurrent uploads by original bytes, independently of filename', async t => {
  const f = await setup(t)
  const records = await Promise.all(Array.from({ length: 8 }, (_, n) => f.sourceImages.put({ ...originalFixture, name: n + '.png' })))
  assert.equal(new Set(records.map(r => r.imageId)).size, 1)
  assert.equal((await readdir(f.directory)).length, 1)
  assert.equal(records[0].imageId, 'sha256:' + digest(Buffer.from(originalFixture.imageBase64, 'base64')))
  const restarted = await createSourceImageStore(f.directory).read(records[0].imageId)
  assert.deepEqual(restarted, records[0])
  const other = await f.sourceImages.put(wire)
  assert.notEqual(other.imageId, records[0].imageId)
  assert.equal(restarted.original.imageBase64, originalFixture.imageBase64)
  await assert.rejects(f.sourceImages.read('../outside'), /无效/)
})

test('canonical corruption, unsupported schema and mismatched Analysis original fail closed; put never repairs corruption', async t => {
  const f = await setup(t), r = await f.sourceImages.put(originalFixture)
  await assert.rejects(f.sourceImages.verifyAnalysis({ sourceImageId: r.imageId, originalImage: wire }), /不一致/)
  const file = path.join(f.directory, r.imageId.slice(7) + '.json')
  for (const corrupt of [{ ...r, schemaVersion: 2 }, { ...r, original: { ...r.original, byteLength: 9 } }, { ...r, original: { ...r.original, ...wire } }]) {
    const bytes = JSON.stringify(corrupt)
    await writeFile(file, bytes)
    await assert.rejects(f.sourceImages.read(r.imageId))
    await assert.rejects(f.sourceImages.put(originalFixture))
    assert.equal(await readFile(file, 'utf8'), bytes)
  }
})

for (const specimen of ['synthetic', 'Penguin']) test(specimen + ': two originals create independent successful Analysis IDs with one sourceImageId; model input remains compressed', async t => {
  const f = await setup(t)
  let bytes
  if (specimen === 'synthetic') bytes = Buffer.from(originalFixture.imageBase64, 'base64')
  else {
    try { bytes = await readFile(new URL('../public/test-images/Lego-Duplo-penguin.png', import.meta.url)) }
    catch (error) { if (error.code === 'ENOENT') return t.skip('Local Penguin image absent'); throw error }
  }
  const original = { mimeType: 'image/png', imageBase64: bytes.toString('base64'), name: 'penguin.png' }
  let calls = 0
  const deps = { sourceImages: f.sourceImages, getCatalog: async () => ({ colors: [] }), callModel: async ({ record, request }) => {
    calls++; assert.ok(JSON.stringify(request).includes(wire.imageBase64))
    record.rawOutput = JSON.stringify(geometry); record.finishReason = 'completed'; record.httpStatus = 200
  } }
  const dir = path.join(f.root, 'reverse'), service = createBrickReverse(dir, deps)
  const body = { requestId: randomUUID(), model: 'gpt-4.1', analysis_mode: 'geometry_only', originalImage: original, ...wire }
  const first = await service.analyze(body)
  const second = await service.analyze({ ...body, requestId: randomUUID(), originalImage: { ...original, name: 'renamed.png' } })
  assert.equal(first.status, 'complete'); assert.equal(second.status, 'complete')
  assert.notEqual(first.id, second.id); assert.equal(first.sourceImageId, second.sourceImageId)
  assert.equal(first.sourceImageId, 'sha256:' + digest(bytes))
  assert.notEqual(first.sourceImageId, 'sha256:' + first.image.sha256)
  assert.deepEqual(first.originalImage, original)
  const source = await f.sourceImages.read(first.sourceImageId)
  assert.deepEqual(Buffer.from(source.original.imageBase64, 'base64'), bytes)
  const restarted = createBrickReverse(dir, deps)
  assert.equal((await restarted.read(first.id)).sourceImageId, first.sourceImageId)
  const history = await restarted.history()
  assert.deepEqual(new Set(history.items.map(r => r.id)), new Set([first.id, second.id]))
  assert.ok(history.items.every(r => r.sourceImageId === source.imageId))
  await restarted.analyze(body); assert.equal(calls, 2)
  // Identical wire image is insufficient for retry identity when ORIGINAL bytes differ.
  await assert.rejects(service.analyze({ ...body, originalImage: wire }), /另一份输入/)
  await assert.rejects(service.analyze({ ...body, requestId: randomUUID(), originalImage: undefined }))
  assert.equal(calls, 2)
})

test('old Analysis without sourceImageId is reported, never inferred, repaired or sent to a provider', async t => {
  const f = await setup(t), id = randomUUID()
  const record = { id, kind: 'reverse-analysis', status: 'complete', originalImage: originalFixture, image: wire }
  const bytes = JSON.stringify(record), file = path.join(f.root, id + '.json')
  await writeFile(file, bytes)
  const service = createBrickReverse(f.root, { sourceImages: f.sourceImages, callModel: () => assert.fail('No model') })
  const history = await service.history()
  assert.equal(history.items.length, 0); assert.match(history.warnings[0], /独立数据修复/)
  await assert.rejects(service.read(id), /独立数据修复/)
  await assert.rejects(service.restore(id), /独立数据修复/)
  assert.equal(await readFile(file, 'utf8'), bytes)
  await assert.rejects(readdir(f.directory), { code: 'ENOENT' })
})

test('inventory recognition shares the canonical store and rejects changed originals on retries', async t => {
  const f = await setup(t), canonical = await f.sourceImages.put(originalFixture)
  let calls = 0
  const service = createBrickVision(path.join(f.root, 'vision'), { sourceImages: f.sourceImages,
    getMetadata: async () => ({ colors: [] }), requestOpenai: async () => { calls++; throw new Error('test provider failure') },
  })
  const body = { requestId: randomUUID(), model: 'gpt-4.1', mode: 'inventory', originalImage: originalFixture, ...wire }
  const record = await service.recognize(body)
  assert.equal(record.sourceImageId, canonical.imageId)
  assert.equal(record.status, 'failed')
  assert.equal((await service.recognize(body)).sourceImageId, canonical.imageId)
  assert.equal(calls, 1)
  await assert.rejects(service.recognize({ ...body, originalImage: wire }), /同一请求 ID/)
  await assert.rejects(service.recognize({ ...body, requestId: randomUUID(), originalImage: undefined }))
  assert.equal(calls, 1)
})

test('old inventory History records are explicitly reported without any write', async t => {
  const f = await setup(t), id = randomUUID()
  const bytes = JSON.stringify({ id, mode: 'inventory', status: 'complete', originalImage: originalFixture })
  const file = path.join(f.root, id + '.json'); await writeFile(file, bytes)
  const service = createBrickVision(f.root, { sourceImages: f.sourceImages })
  const history = await service.history()
  assert.equal(history.records.length, 0); assert.match(history.warnings[0], /独立数据修复/)
  await assert.rejects(service.historyRecord(id), /独立数据修复/)
  assert.equal(await readFile(file, 'utf8'), bytes)
  await assert.rejects(readdir(f.directory), { code: 'ENOENT' })
})

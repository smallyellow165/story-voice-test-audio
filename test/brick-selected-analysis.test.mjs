import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSelectedAnalysisStore } from '../server/brick-selected-analysis.mjs'
import { createSourceImageStore } from '../server/brick-source-images.mjs'
import { createBrickReverse } from '../server/brick-reverse.mjs'
import { createBrickVision } from '../server/brick-vision.mjs'
import { originalFixture } from './source-image-fixture.mjs'

const geometry = {
  appearance: 'test', scale_evidence: 'unknown', unknowns: [], anchors: [], relations: [],
  observations: [{ id: 'one', color: 'Black', bbox: null, confidence: .5,
    dimensions: Object.fromEntries(['width_studs','depth_studs','height_brick_units'].map(k => [k, { value: null, status: 'unknown', confidence: .5, evidence: 'hidden', alternatives: [], anchor_ids: [] }])),
    orientation: { description: 'unknown', yaw_degrees: null, status: 'unknown', evidence: 'hidden' }, visible_studs: null,
    visible_seams: [], evidence: 'test', occlusion: 'unknown', unknowns: [], alternatives: [] }],
}
async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'selected-analysis-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourceImages = createSourceImageStore(path.join(root, 'images'))
  const image = await sourceImages.put(originalFixture)
  const reverseDir = path.join(root, 'reverse'), visionDir = path.join(root, 'vision'), directory = path.join(root, 'images', 'selected-analysis')
  await mkdir(reverseDir); await mkdir(visionDir)
  const deps = { sourceImages, reverse: createBrickReverse(reverseDir, { sourceImages }), vision: createBrickVision(visionDir, { sourceImages }) }
  const make = () => createSelectedAnalysisStore(directory, deps)
  async function record(overrides = {}) {
    const r = { id: randomUUID(), kind: 'reverse-analysis', analysis_mode: 'geometry_only', source: { kind: 'full' }, status: 'complete', sourceImageId: image.imageId, originalImage: originalFixture, analysis: geometry, ...overrides }
    await writeFile(path.join(reverseDir, r.id + '.json'), JSON.stringify(r))
    return r
  }
  return { root, imageId: image.imageId, sourceImages, directory, reverseDir, visionDir, make, store: make(), record }
}
const input = (r, expectedRevision) => ({ analysisId: r.id, analysisKind: 'reverse', expectedRevision })

test('explicit select, switch and restart preserve immutable Analysis and Review; load does not select', async t => {
  const f = await setup(t), a = await f.record(), b = await f.record()
  const reviewPath = path.join(f.reverseDir, a.id + '.json.review')
  await writeFile(reviewPath, '{"unchanged":true}')
  const before = await Promise.all([a,b].map(r => readFile(path.join(f.reverseDir, r.id + '.json'), 'utf8')))
  assert.equal((await f.store.read(f.imageId)).selectedAnalysisId, null)
  await createBrickReverse(f.reverseDir, { sourceImages: f.sourceImages }).read(a.id)
  assert.equal((await f.store.read(f.imageId)).revision, 0)
  assert.equal((await f.store.select(f.imageId, input(a, 0))).selectedAnalysisId, a.id)
  assert.equal((await f.make().read(f.imageId)).selectedAnalysisId, a.id)
  assert.equal((await f.store.select(f.imageId, input(b, 1))).selectedAnalysisId, b.id)
  assert.equal((await f.make().read(f.imageId)).revision, 2)
  assert.deepEqual(await Promise.all([a,b].map(r => readFile(path.join(f.reverseDir, r.id + '.json'), 'utf8'))), before)
  assert.equal(await readFile(reviewPath, 'utf8'), '{"unchanged":true}')
})

test('missing, failed, malformed, wrong-image and missing-source records cannot be selected', async t => {
  const f = await setup(t)
  const other = await f.sourceImages.put({ mimeType: 'image/jpeg', imageBase64: '/9j/' })
  const bad = [await f.record({ status: 'failed' }), await f.record({ analysis: {} }), await f.record({ sourceImageId: other.imageId }), await f.record({ sourceImageId: undefined }), await f.record({ kind: 'reverse-design' }), { id: randomUUID() }]
  for (const r of bad) await assert.rejects(f.store.select(f.imageId, input(r, 0)))
  assert.equal((await f.store.read(f.imageId)).selectedAnalysisId, null)
  assert.deepEqual(await readdir(f.directory), [])
})

test('concurrent writers and stale pages cannot overwrite a newer explicit choice', async t => {
  const f = await setup(t), a = await f.record(), b = await f.record()
  const results = await Promise.allSettled([f.store.select(f.imageId, input(a, 0)), f.make().select(f.imageId, input(b, 0))])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, 409)
  const saved = await f.store.read(f.imageId)
  await assert.rejects(f.make().select(f.imageId, input(b, 0)), e => e.statusCode === 409)
  assert.deepEqual(await f.store.read(f.imageId), saved)
})

test('corrupt persisted choice or selected target fails closed without overwriting evidence', async t => {
  const f = await setup(t), a = await f.record()
  await f.store.select(f.imageId, input(a, 0))
  const file = path.join(f.directory, f.imageId.slice(7) + '.json')
  await writeFile(file, '{broken')
  await assert.rejects(f.store.read(f.imageId), /损坏/)
  await assert.rejects(f.store.select(f.imageId, input(a, 1)))
  assert.equal(await readFile(file, 'utf8'), '{broken')
})

test('Penguin: all four real analyses pass selection validators in isolated copies', async t => {
  const f = await setup(t)
  const ids = ['abf0baf5-f2f6-472b-af31-0c3c51231ef1','80a0ad1a-db21-4f5d-ba3b-96215e1aed83','1b9a8805-4228-43fb-9437-265cfb316606','ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68']
  let originals
  try { originals = await Promise.all(ids.map(id => readFile(new URL(`../generated/brick-reverse/${id}.json`, import.meta.url), 'utf8'))) }
  catch (e) { if (e.code === 'ENOENT') return t.skip('Local Penguin histories absent'); throw e }
  for (let i = 0; i < ids.length; i++) {
    const r = JSON.parse(originals[i])
    const source = await f.sourceImages.put(r.originalImage)
    assert.equal(source.imageId, r.sourceImageId)
    await writeFile(path.join(f.reverseDir, r.id + '.json'), originals[i])
    await f.store.select(source.imageId, input(r, i))
    assert.equal((await f.make().read(source.imageId)).selectedAnalysisId, r.id)
  }
  assert.deepEqual(await Promise.all(ids.map(id => readFile(path.join(f.reverseDir, id + '.json'), 'utf8'))), originals)
})

test('inventory and reverse share one per-image relationship, using explicit record kind', async t => {
  const f = await setup(t), a = await f.record()
  const r = { id: randomUUID(), mode: 'inventory', status: 'complete', sourceImageId: f.imageId, originalImage: originalFixture,
    recognition: { observations: [], evaluation: { verdict: 'uncertain', confidence: 0, reason: 'unknown', targetObservationId: '', placementMatches: false, groundVisible: false, uncertainties: [], observed: [], relations: [] } } }
  await writeFile(path.join(f.visionDir, r.id + '.json'), JSON.stringify(r))
  await f.store.select(f.imageId, input(a, 0))
  const selected = await f.store.select(f.imageId, { analysisId: r.id, analysisKind: 'inventory', expectedRevision: 1 })
  assert.equal(selected.selectedAnalysisId, r.id)
  assert.equal(selected.analysisKind, 'inventory')
  assert.equal((await readdir(f.directory)).length, 1)
  await assert.rejects(f.store.select(f.imageId, input(r, 2)))
  r.recognition = {}
  await writeFile(path.join(f.visionDir, r.id + '.json'), JSON.stringify(r))
  await assert.rejects(f.make().read(f.imageId), /格式错误/)
})

test('History selection control renders Load/Select distinction and cannot select before loading formal state', async () => {
  const ts = await import('typescript'), { createRequire } = await import('node:module'), require = createRequire(import.meta.url)
  const { renderToStaticMarkup } = await import('react-dom/server'), React = await import('react')
  const { pathToFileURL } = await import('node:url')
  const code = ts.transpileModule(await readFile(new URL('../src/brick-vision/SelectedAnalysis.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
    .replaceAll("'react'", JSON.stringify(pathToFileURL(require.resolve('react')).href))
  const { SelectedAnalysis } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const html = renderToStaticMarkup(React.createElement(SelectedAnalysis, { imageId: 'sha256:' + 'a'.repeat(64), analysisKind: 'reverse', complete: false, disabled: false }))
  assert.match(html, /先 Load 并检查结果，再 Select/)
  assert.match(html, /disabled="">Select/)
  assert.match(html, /刷新选择状态/)
  assert.equal(renderToStaticMarkup(React.createElement(SelectedAnalysis, { imageId: '', analysisKind: 'reverse', complete: false, disabled: false })), '')
})

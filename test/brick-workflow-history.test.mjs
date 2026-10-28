import {createPartsInputStore} from '../server/brick-parts-input.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createWorkflowHistory } from '../server/brick-workflow-history.mjs'
import { createSourceImageStore } from '../server/brick-source-images.mjs'
import { createBrickReverse } from '../server/brick-reverse.mjs'
import { createBuildOrderStore } from '../server/brick-build-order.mjs'
import { createSelectedAnalysisStore } from '../server/brick-selected-analysis.mjs'
import { createBrickVision } from '../server/brick-vision.mjs'
const imageId = 'sha256:957bfeec320e103ebccb1b05aafe44c49088a908961868b6af47f31d22965b09'
const analysisId = 'ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68', olderId = '80a0ad1a-db21-4f5d-ba3b-96215e1aed83'
const planId = 'f18759ed-d4e1-45cc-b257-4ad5d71d48a8', geometryId = 'c34c5c9a-b513-4ce5-b87b-47cbd96154f5'
const selectionId = '77d99b0e-9c62-4ba6-b655-bcf1a8db5828', buildId = '426f27c7-a9a9-4ee9-9965-39e1cd9e30f8'
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'workflow-lineage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  try {
    for (const folder of ['brick-parts-inputs','brick-source-images','brick-reverse','brick-spatial-traces','brick-spatial-geometry','brick-spatial-selections','brick-build-plans','brick-build-traces','brick-spatial-requests','brick-refinements']) {
      await cp(new URL('../generated/' + folder, import.meta.url), path.join(root, folder), { recursive: true })
    }
  } catch (e) { if (e.code === 'ENOENT') { t.skip('Local persisted Penguin evidence absent'); return null }; throw e }
  const sourceImages = createSourceImageStore(path.join(root, 'brick-source-images'))
  // Current Review restoration uses the existing reader with a deterministic,
  // non-network Catalog response. Confirmed search records remain canonical.
  const reverse = createBrickReverse(path.join(root, 'brick-reverse'), { sourceImages, getCatalog: async () => ({ colors: [] }) })
  const buildOrder = createBuildOrderStore(root)
  // Validate frozen Snapshot lineage without querying a live Catalog for current-match.
  const workflow = createWorkflowHistory(root, { sourceImages, reverse, buildOrder, partsInputs:createPartsInputStore(root) })
  const file = (folder, id) => path.join(root, folder, id + '.json')
  const edit = async (folder, id, fn) => { const f = file(folder, id), r = JSON.parse(await readFile(f, 'utf8')); fn(r); await writeFile(f, JSON.stringify(r)) }
  return { root, sourceImages, reverse, workflow, file, edit, read: () => workflow.read(imageId) }
}

test('real Penguin branches: exact reverse lineage, independent selections, failed runs and historical Review versions', async t => {
  const f = await fixture(t); if (!f) return
  const before = await readFile(f.file('brick-build-plans', buildId)), r = await f.read()
  const nodes = new Map(r.nodes.map(n => [n.key, n]))
  let node = nodes.get('Build Plan:' + buildId), stages = []
  while (node) { stages.push(node.stage); assert.equal(node.analysisId, analysisId); node = nodes.get(node.parent) }
  assert.deepEqual(stages, ['Build Plan','Layout Selection','Candidate','Geometry','Spatial','Mapping Review','Review input','Analysis'])
  assert.equal(nodes.get('Build Plan:' + buildId).status, 'draft · 11 步')
  assert.deepEqual(nodes.get('Build Plan:' + buildId).evidence.validation, { valid: true, complete: true, errors: [] })
  const savedSelections=await Promise.all((await readdir(path.join(f.root,'brick-spatial-selections'))).filter(n=>n.endsWith('.json')).map(n=>readFile(path.join(f.root,'brick-spatial-selections',n),'utf8').then(JSON.parse)))
  assert.deepEqual(r.nodes.filter(n=>n.stage==='Layout Selection').map(n=>n.id).sort(),savedSelections.filter(s=>s.geometryId===geometryId).map(s=>s.id).sort())
  assert.equal(nodes.get('Build Plan:'+buildId).parent,'Layout Selection:'+selectionId)
  for(const s of r.nodes.filter(n=>n.stage==='Layout Selection'&&n.id!==selectionId))assert.ok(!r.nodes.some(n=>n.stage==='Build Plan'&&n.parent===s.key))
  assert.ok(r.nodes.filter(n => n.stage === 'Layout Selection').every(n => n.parent === 'Candidate:' + geometryId + '/candidate-1'))
  assert.equal(r.nodes.filter(n => n.stage === 'Analysis').length, 4)
  const savedPlans=await Promise.all((await readdir(path.join(f.root,'brick-spatial-traces'))).filter(n=>n.endsWith('.json')).map(n=>readFile(path.join(f.root,'brick-spatial-traces',n),'utf8').then(JSON.parse)))
  assert.deepEqual(r.nodes.filter(n=>n.analysisId===analysisId&&n.stage==='Spatial').map(n=>n.id).sort(),savedPlans.filter(p=>p.task==='spatial-planning'&&p.requestInput?.provenance?.analysisId===analysisId).map(p=>p.id).sort())
  assert.equal(nodes.get('Spatial:'+planId).evidence.partsInputMatch.status,'Unknown')
  await f.sourceImages.verifyAnalysis(await f.reverse.read(analysisId))
  assert.equal(r.nodes.filter(n => n.analysisId === olderId && n.stage === 'Spatial').length, 3)
  assert.equal(r.nodes.filter(n => n.analysisId === olderId && n.stage === 'Build Plan').length, 0)
  assert.ok(r.nodes.some(n => n.stage === 'Geometry' && n.status.includes('no_solution')))
  assert.ok(r.nodes.some(n => n.stage === 'Request' && n.status.includes('failed')))
  const reviewUses = r.nodes.filter(n => n.stage === 'Review input' && n.analysisId === analysisId)
  const currentVersion=nodes.get('Current Review:'+analysisId).evidence.reviewVersion
  for(const use of reviewUses)assert.equal(use.evidence.matchesCurrentReview,use.evidence.reviewVersion===currentVersion)
  assert.equal(reviewUses.find(n=>n.evidence.spatialPlanId===planId).evidence.matchesCurrentReview,true)
  assert.ok(reviewUses.every(n => n.evidence.fullHistoricalReviewSnapshot === false))
  assert.equal(r.nodes.find(n => n.stage === 'Build Order Trace').evidence.savedPlanId, null)
  assert.deepEqual(await readFile(f.file('brick-build-plans', buildId)), before)
})

test('changing current Review cannot rewrite or impersonate historical Review inputs', async t => {
  const f = await fixture(t); if (!f) return
  const before = await f.read(), file = f.file('brick-reverse', analysisId) + '.review'
  const review = JSON.parse(await readFile(file)); review.updatedAt = '2030-01-01T00:00:00.000Z'; await writeFile(file, JSON.stringify(review))
  const after = await f.read()
  assert.ok(after.nodes.filter(n => n.stage === 'Review input' && n.analysisId === analysisId).every(n => !n.evidence.matchesCurrentReview))
  assert.deepEqual(after.nodes.filter(n => ['Spatial','Geometry','Build Plan'].includes(n.stage)), before.nodes.filter(n => ['Spatial','Geometry','Build Plan'].includes(n.stage)))
})

test('hash mismatch isolates Geometry and its descendants rather than trusting redundant Analysis IDs', async t => {
  const f = await fixture(t); if (!f) return
  await f.edit('brick-spatial-geometry', geometryId, r => { r.sourcePlanHash = '0'.repeat(64) })
  const r = await f.read()
  assert.ok(r.unassociated.some(n => n.id === geometryId && /hash/i.test(n.reason)))
  assert.ok(!r.nodes.some(n => n.stage === 'Layout Selection' || n.stage === 'Build Plan'))
  assert.ok(r.nodes.some(n => n.stage === 'Spatial' && n.id === planId))
})

test('missing Review evidence and missing Geometry never attach records by timestamp, name or success', async t => {
  const f = await fixture(t); if (!f) return
  await f.edit('brick-spatial-traces', planId, r => { r.sources[0].reviewVersion = 'f'.repeat(64) })
  await rm(f.file('brick-spatial-geometry', geometryId))
  const r = await f.read()
  assert.ok(r.unassociated.some(n => n.id === planId && /Review/.test(n.reason)))
  assert.ok(r.unassociated.some(n => n.stage === 'Layout Selection'))
  assert.ok(!r.nodes.some(n => n.stage === 'Build Plan'))
})

test('selection candidateHash mismatch quarantines only that selection and its Build Plan', async t => {
  const f = await fixture(t); if (!f) return
  const originalKeys=(await f.read()).nodes.filter(n=>n.stage==='Layout Selection'&&n.id!==selectionId).map(n=>n.key).sort()
  await f.edit('brick-spatial-selections', selectionId, r => { r.candidateHash = '0'.repeat(64) })
  const r = await f.read()
  assert.deepEqual(r.nodes.filter(n=>n.stage==='Layout Selection').map(n=>n.key).sort(),originalKeys)
  assert.ok(r.unassociated.some(n => n.id === selectionId))
  assert.ok(!r.nodes.some(n => n.stage === 'Build Plan'))
})

test('Selected Analysis changes independently of the entire read-only lineage projection', async t => {
  const f = await fixture(t); if (!f) return
  const selected = createSelectedAnalysisStore(path.join(f.root, 'brick-source-images', 'selected-analysis'), { sourceImages: f.sourceImages, reverse: f.reverse, vision: createBrickVision(path.join(f.root, 'brick-vision'), { sourceImages: f.sourceImages }) })
  const before = await f.read(), current = await selected.read(imageId)
  await selected.select(imageId, { analysisId: olderId, analysisKind: 'reverse', expectedRevision: current.revision })
  assert.deepEqual(await f.read(), before)
})

test('only an explicit output Build Plan ID can associate a Build Order Trace with a saved plan', async t => {
  const f = await fixture(t); if (!f) return
  const s = JSON.parse(await readFile(f.file('brick-spatial-selections', selectionId))), plan = JSON.parse(await readFile(f.file('brick-build-plans', buildId)))
  const id = randomUUID(), trace = { id, task: 'build-order', status: 'draft_ready', source: { selectionId, analysisId, geometryId, candidateId: s.candidateId, candidateHash: s.candidateHash }, plan }
  await writeFile(f.file('brick-build-traces', id), JSON.stringify(trace))
  let r = await f.read()
  assert.equal(r.nodes.find(n => n.id === id).evidence.savedPlanId, buildId)
  trace.plan = { ...plan, build_plan_id: randomUUID() }
  await writeFile(f.file('brick-build-traces', id), JSON.stringify(trace))
  r = await f.read(); assert.equal(r.nodes.find(n => n.id === id).evidence.savedPlanId, null)
})

test('malformed files and unsupported Revision lineage remain explicit, without normalizing them', async t => {
  const f = await fixture(t); if (!f) return
  const id = randomUUID(); await writeFile(f.file('brick-spatial-traces', id), '{broken')
  await f.edit('brick-spatial-geometry', geometryId, r => { r.revisionId = randomUUID() })
  const r = await f.read()
  assert.ok(r.unassociated.some(n => n.id === id + '.json'))
  assert.ok(r.unassociated.some(n => n.id === geometryId && /Revision/.test(n.reason)))
  assert.ok(!r.nodes.some(n => n.stage === 'Build Plan'))
})


test('Workflow branch UI exposes existing links and evidence, not downstream Select controls', async t => {
  const f = await fixture(t); if (!f) return
  const history = await f.read()
  const { uiModuleUrl } = await import('./ui-module.mjs')
  const React = await import('react'), { renderToStaticMarkup } = await import('react-dom/server')
  const { WorkflowHistoryBranch } = await import(await uiModuleUrl(new URL('../src/brick-vision/WorkflowHistory.tsx', import.meta.url)))
  const node = history.nodes.find(n => n.key === 'Review input:' + planId)
  const html = renderToStaticMarkup(React.createElement(WorkflowHistoryBranch, { node, history, disabled: false, onLoad: () => assert.fail('Rendering must not load or select') }))
  assert.match(html, /draft · 11 步/)
  assert.match(html, /workflow=build/)
  assert.match(html, new RegExp('buildPlanId=' + buildId))
  assert.match(html, /workflow=spatial/)
  assert.match(html, /provider_or_trace_failed/)
  assert.match(html, /candidateHash/)
  assert.match(html, /完整的历史 Parts Explorer Review/)
  assert.doesNotMatch(html, /<button[^>]*>Select<|<button[^>]*>Use This Layout/)
})

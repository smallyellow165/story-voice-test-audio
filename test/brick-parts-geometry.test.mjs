import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolvePartsGeometry, createPartsGeometryService, definitionId } from '../server/brick-parts-geometry.mjs'
import { spatialMapping } from '../server/brick-spatial-mapping.mjs'
import { loadBrickRules } from '../server/brick-rules.mjs'
import { inspectBrickModel } from '../server/brick-library.mjs'
import { prepareReviewedSource } from '../server/brick-spatial-workflow.mjs'
import { createBrickReverse } from '../server/brick-reverse.mjs'
import { createSourceImageStore } from '../server/brick-source-images.mjs'
const rules = await loadBrickRules()
const trace = JSON.parse(await readFile(new URL('../generated/brick-spatial-traces/f18759ed-d4e1-45cc-b257-4ad5d71d48a8.json', import.meta.url)))
const oldRows = trace.sources[0].mappingReview.mapping.rows
const parts = new Map(oldRows.map(r => [r.source.part_num, r.evidence.part]))
for (const r of oldRows) if (r.geometryBinding) parts.set(r.geometryBinding.basePartNum, r.geometryBinding.baseMapping)
const colors = new Map(oldRows.map(r => [String(r.source.color_id), r.evidence.color]))
const dependencies = { getMetadata: async (route, params) => {
 if (route === 'mapping-part') { assert.ok(parts.has(params.part_num)); return structuredClone(parts.get(params.part_num)) }
 if (route === 'mapping-color') { assert.ok(colors.has(params.color_id)); return structuredClone(colors.get(params.color_id)) }
 if (route === 'parts') { const binding = oldRows.find(r => r.source.part_num === params.search)?.geometryBinding; assert.ok(binding); return { items: [{ part_num: params.search, print_relationships: binding.relationships }] } }
 assert.fail('Unexpected Catalog request')
} }

test('real Penguin identities, colors and printed binding preserve the existing mapping behavior', async () => {
 const result = await resolvePartsGeometry(oldRows.map(r => r.source), rules, dependencies)
 assert.equal(result.valid, true); assert.equal(result.definitions.length, 9)
 for (let i = 0; i < oldRows.length; i++) {
  assert.deepEqual(result.rows[i].target, oldRows[i].target)
  assert.deepEqual(result.rows[i].geometryBinding, oldRows[i].geometryBinding)
  const d = result.definitions[i]; assert.equal(d.support.usable, true)
  const { id, ...body } = d.geometryDefinition; assert.equal(id, definitionId(body))
  assert.deepEqual(body.profile, rules.geometrySupport(d.partDefinition.ldrawPartId).geometry)
 }
})
test('independent service calls and different inventories share definitions without shared instance identity', async () => {
 const service = createPartsGeometryService({ loadRules: async () => rules, ...dependencies })
 const first = await service.resolve('11170', 0), second = await service.resolve('11170', 0)
 assert.equal(first.geometryDefinition.id, second.geometryDefinition.id)
 assert.equal(first.partDefinition.id, second.partDefinition.id)
 const a = await spatialMapping({ id: randomUUID(), items: [{ part_num: '11170', color_id: 0, quantity: 1 }] }, rules, dependencies)
 const b = await spatialMapping({ id: randomUUID(), items: [{ part_num: '11170', color_id: 0, quantity: 3 }] }, rules, dependencies)
 assert.notEqual(a.id, b.id); assert.deepEqual(a.mapping.rows[0].definitionReferences, b.mapping.rows[0].definitionReferences)
 assert.equal(b.mapping.rows[0].source.quantity, 3)
})
test('new planning input retains per-instance IDs and definition references, without writing Current Review', async () => {
 const sourceImages = createSourceImageStore('generated/brick-source-images')
 const reverse = createBrickReverse('generated/brick-reverse', { sourceImages, getCatalog: async () => ({ colors: [] }) })
 const saved = await reverse.restore(trace.requestInput.provenance.analysisId)
 const mapping = await spatialMapping({ id: randomUUID(), items: oldRows.map(r => r.source) }, rules, dependencies)
 const first = prepareReviewedSource(saved, mapping, rules)
 const secondAnalysis = { ...saved, analysis: { ...saved.analysis, id: randomUUID() } }
 const second = prepareReviewedSource(secondAnalysis, mapping, rules)
 const heads = first.input.observations.filter(o => o.confirmedPart.part_num === '11170')
 assert.equal(heads.length, 4); assert.equal(new Set(heads.map(o => o.id)).size, 4)
 assert.equal(new Set(heads.map(o => o.mapping.definitionReferences.geometryDefinitionId)).size, 1)
 assert.notEqual(first.input.provenance.analysisId, second.input.provenance.analysisId)
 assert.equal(first.input.observations[0].mapping.definitionReferences.geometryDefinitionId, second.input.observations[0].mapping.definitionReferences.geometryDefinitionId)
 assert.deepEqual(first.input.observations.map(o => o.geometry), trace.requestInput.observations.map(o => o.geometry))
})
test('geometry content/resource changes change identity; drift and absent profiles remain diagnosed', async () => {
 const normal = await resolvePartsGeometry([oldRows[1].source], rules, dependencies)
 const changedRules = { ...rules, geometrySupport: p => { const c = structuredClone(rules.geometrySupport(p)); c.geometry.evidence.push('explicit definition revision'); return c } }
 const changed = await resolvePartsGeometry([oldRows[1].source], changedRules, dependencies)
 assert.notEqual(normal.definitions[0].geometryDefinition.id, changed.definitions[0].geometryDefinition.id)
 const drift = await resolvePartsGeometry([oldRows[1].source], rules, { ...dependencies, inspect: async () => ({ available: true, errors: [], sourceFiles: [] }) })
 assert.equal(drift.definitions[0].support.usable, false); assert.ok(drift.rows[0].errors.some(e => e.includes('来源已变化')))
 const unknown = await resolvePartsGeometry([oldRows[0].source], { geometrySupport: () => ({ supported: false, geometry: null, reasons: ['test: missing profile'] }) }, dependencies)
 assert.equal(unknown.definitions[0].geometryDefinition, null); assert.equal(unknown.definitions[0].support.usable, false)
 assert.equal(unknown.rows[0].target.part, '11170', 'known mapping is distinct from geometry support')
})
test('invalid parameters and ambiguous official mappings fail explicitly', async () => {
 const service = createPartsGeometryService({ loadRules: async () => rules, ...dependencies })
 await assert.rejects(service.resolve('../invalid', 0), /有效/); await assert.rejects(service.resolve('11170', -1), /有效/)
 const result = await resolvePartsGeometry([oldRows[0].source], rules, { ...dependencies, getMetadata: async (route, params) => { const r = await dependencies.getMetadata(route, params); if (route === 'mapping-part') r.mappings.push({ part_num: '11170', ext_system: 'LD', ext_id: '9999', is_export_id: true }); return r } })
 assert.equal(result.valid, false); assert.equal(result.definitions[0].support.usable, false)
})
test('shared resolver keeps 2302 asymmetric connectors and Camel/Rooster profiles unchanged', async () => {
 const result = await createPartsGeometryService({ loadRules: async () => rules, ...dependencies }).resolve('2302', 25)
 assert.equal(result.geometryDefinition.profile.top.length, 4); assert.equal(result.geometryDefinition.profile.bottom.length, 6)
 assert.deepEqual(result.geometryDefinition.profile.ldraw.offsetLdu, { x: -20, y: 48, z: 0 })
 for (const id of ['f1f84e96-8269-4132-807a-61c41243229f','7415a066-d5e1-490d-a863-936a285a4597']) {
  const t = JSON.parse(await readFile(new URL('../generated/brick-spatial-traces/'+id+'.json', import.meta.url)))
  for (const o of t.requestInput.observations) {
   const local = await inspectBrickModel(o.part), support = rules.geometrySupport(o.part)
   assert.equal(local.available, true); assert.equal(support.supported, true)
   if (o.geometry) assert.deepEqual(support.geometry, o.geometry)
  }
 }
})

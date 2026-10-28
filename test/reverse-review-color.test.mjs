import { sourceImageFixture, originalFixture } from './source-image-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { geometryColorId, reverseFeatureEditor } from '../src/brick-vision/reverse-review.mjs'
import { readFeatureEditor, observationCatalogFields, catalogSearchParams } from '../src/brick-vision/catalog-features.mjs'
import { createBrickReverse } from '../server/brick-reverse.mjs'

// Independent fixtures, never real Catalog or history writes.
const palette = [{ id: 14, name: 'Yellow' }, { id: 4, name: 'Red' },
  { id: 155, name: 'Olive Green' }, { id: 226, name: 'Bright Light Yellow' }, { id: 0, name: 'Black' }]
const evidence = {
  head: 'Yellow, with an olive-yellow shaded left face',
  neck: 'Yellow with a darker left face',
  back: 'Bright yellow with shaded left face',
  upper_horizontal: 'Yellow', lower_horizontal: 'Yellow',
  left_leg: 'Yellow with a darker left side', right_leg: 'Yellow with a dark inward-facing side',
}
const dimension = value => ({ value, status: 'inferred', confidence: .9, evidence: 'visible body', alternatives: [], anchor_ids: [] })
const observation = (id, color) => ({ id, color, bbox: null, confidence: .9,
  dimensions: { width_studs: dimension(1), depth_studs: dimension(2), height_brick_units: dimension(2) },
  orientation: { description: 'upright', yaw_degrees: 0, status: 'inferred', evidence: 'visible' },
  visible_studs: null, visible_seams: [], evidence: 'visible', occlusion: '', unknowns: [], alternatives: [] })

test('all seven camel descriptions map body Yellow, not shaded olive tones', () => {
  for (const [id, color] of Object.entries(evidence)) {
    const original = observation(id, color)
    const before = structuredClone(original)
    const editor = reverseFeatureEditor(original, palette)
    assert.equal(editor.color, '14', id)
    assert.deepEqual(original, before)
    assert.deepEqual(catalogSearchParams(observationCatalogFields(readFeatureEditor(editor))),
      { color: '14', size: '1×2×2', require_ldraw: 'false' })
  }
})

test('canonical catalog names win; ambiguous or unsupported descriptions remain Unknown', () => {
  assert.equal(geometryColorId('Olive Green', palette), 155)
  assert.equal(geometryColorId('Bright Light Yellow', palette), 226)
  assert.equal(geometryColorId('Black', palette), 0)
  for (const value of ['Yellow or Olive Green', 'Maybe Yellow', 'Golden yellow', 'Yellow and red',
    'Yellow with red print', 'Yellow with dark red face', 'Yellow with blue face', 'Unknown', '']) {
    assert.equal(geometryColorId(value, palette), null, value)
  }
  assert.equal(geometryColorId('Yellow', []), null)
  assert.equal(geometryColorId('Yellow', [...palette, { id: 999, name: 'Yellow' }]), null)
  assert.equal(geometryColorId('Yellow', [{ id: 321, name: 'Yellow' }]), 321, 'IDs must come from Catalog')
})

test('existing structured color IDs are not replaced, including black ID zero', () => {
  assert.equal(reverseFeatureEditor({ color_id: 0, color: 'Yellow' }, palette).color, '0')
  assert.equal(reverseFeatureEditor({ color_id: 4, size: '2x2' }, palette).color, '4')
  assert.equal(reverseFeatureEditor({ color: 'Yellow' }, palette).color, '', 'Only geometry descriptions are mapped')
  const editor = reverseFeatureEditor(observation('neck', evidence.neck), palette)
  editor.color = '4'
  assert.equal(catalogSearchParams(observationCatalogFields(readFeatureEditor(editor))).color, '4')
})

test('history initializes colors but saved edits, deliberate Unknown and confirmations win', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'geometry-color-review-'))
  try {
    const id = randomUUID(), searchId = randomUUID()
    const record = { id, kind: 'reverse-analysis', ...await sourceImageFixture(directory), status: 'complete', analysis_mode: 'geometry_only',
      source: { kind: 'full' }, analysis: { appearance: 'fixture', scale_evidence: 'visible', anchors: [],
        unknowns: [], relations: [], observations: Object.entries(evidence).map(([id, color]) => observation(id, color)) } }
    const file = path.join(directory, id + '.json')
    await writeFile(file, JSON.stringify(record))
    const original = await readFile(file, 'utf8')
    const service = createBrickReverse(directory, {
      callModel: () => assert.fail('Must not call Vision'),
      getCatalog: async route => { assert.equal(route, 'filters'); return { colors: palette } },
    })
    const first = await service.restore(id)
    for (const row of Object.values(first.rows)) assert.equal(row.features.color, '14')
    first.rows.head.features.color = '4'
    first.rows.head.features.partNumber = 'fixture-part'
    first.rows.neck.features.color = ''
    await writeFile(path.join(directory, searchId + '.json'), JSON.stringify({ id: searchId, kind: 'reverse-search',
      analysisId: id, observationId: 'head', partNumber: 'fixture-part',
      rows: [{ sourceAllowed: true, source: { part_num: 'fixture-part', color_id: 4 } }] }))
    first.rows.head.searchId = searchId
    first.rows.head.index = 0
    await service.saveReview({ analysisId: id, rows: first.rows })
    const restored = await service.restore(id)
    assert.equal(restored.rows.head.features.color, '4')
    assert.equal(restored.rows.head.index, 0)
    assert.equal(restored.rows.head.search.id, searchId)
    assert.equal(restored.rows.neck.features.color, '')
    assert.equal(await readFile(file, 'utf8'), original)
    const offline = createBrickReverse(directory, { getCatalog: async () => { throw new Error('Catalog unavailable') } })
    const recovered = await offline.restore(id)
    assert.equal(recovered.rows.head.features.color, '4')
    assert.equal(recovered.rows.neck.features.color, '')
    assert.ok(recovered.warnings.some(w => w.includes('颜色列表')))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

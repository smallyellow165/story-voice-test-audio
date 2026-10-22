import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inspectBrickModel } from '../server/brick-library.mjs'
import { resolveInventoryMapping } from '../server/brick-mapping.mjs'

// Synthetic file/transport fixtures only; never a production inventory or mapping.
const face = '3 16 0 0 0 1 0 0 0 1 0\n'
const ref = name => `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${name}\n`
async function library(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'ldraw-candidates-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), text)
  }
  return root
}
function input(candidates) {
  const session = { items: [{ part_num: 'catalog-item', color_id: 99, quantity: 2 }] }
  const metadata = { parts: { 'catalog-item': { status: 'available', known_colors: [99], external_ids: { LDraw: candidates } } },
    colors: { 99: { status: 'available', external_ids: { LDraw: { ext_ids: ['4'] } } } } }
  const rules = { geometrySupport: part => ({ supported: ['a', 'b'].includes(part), reasons: ['a', 'b'].includes(part) ? [] : ['不支持的测试几何'], geometry: null }), PARTS: [{ id: 'a' }, { id: 'b' }], COLORS: [{ code: '4', label: '红色' }] }
  return { session, metadata, rules }
}

test('selects the only supported and locally complete official candidate regardless of order', async t => {
  const root = await library(t, { 'parts/a.dat': face, 'parts/alias.dat': ref('a.dat') })
  for (const candidates of [['alias', 'a'], ['a', 'alias'], ['alias', 'a', 'a']]) {
    const { session, metadata, rules } = input(candidates)
    const before = structuredClone(metadata)
    const result = await resolveInventoryMapping(session, metadata, rules, p => inspectBrickModel(p, root))
    assert.equal(result.valid, true)
    assert.equal(result.rows[0].target.part, 'a')
    assert.deepEqual(result.rows[0].partCandidates, [...new Set(candidates)])
    assert.deepEqual(result.rows[0].evidence.part.external_ids.LDraw, candidates)
    const excluded = result.rows[0].partCandidateChecks.find(c => c.part === 'alias')
    assert.equal(excluded.local.available, true)
    assert.equal(excluded.supported, false)
    assert.match(excluded.reasons.join(';'), /不支持/)
    assert.deepEqual(metadata, before)
    assert.deepEqual(result.inventory, [{ part: 'a', color: '4', quantity: 2 }])
  }
})

test('zero or multiple eligible candidates remain invalid without fallback', async t => {
  const root = await library(t, { 'parts/a.dat': face, 'parts/b.dat': face, 'parts/alias.dat': ref('a.dat') })
  for (const candidates of [[], ['missing'], ['alias'], ['a', 'b']]) {
    const { session, metadata, rules } = input(candidates)
    const result = await resolveInventoryMapping(session, metadata, rules, p => inspectBrickModel(p, root))
    assert.equal(result.valid, false)
    assert.equal(result.rows[0].target, null)
    assert.deepEqual(result.inventory, [])
    assert.match(result.rows[0].errors.join(';'), candidates.length === 2 ? /多个有效/ : /没有有效/)
  }
})

test('missing nested dependency excludes a supported candidate', async t => {
  const root = await library(t, { 'parts/a.dat': face, 'parts/b.dat': ref('s\\missing.dat') })
  const { session, metadata, rules } = input(['b', 'a'])
  const result = await resolveInventoryMapping(session, metadata, rules, p => inspectBrickModel(p, root))
  assert.equal(result.rows[0].target.part, 'a')
  const b = result.rows[0].partCandidateChecks[0]
  assert.equal(b.local.entryAvailable, true)
  assert.equal(b.local.available, false)
  assert.match(b.reasons.join(';'), /missing.dat/)
})

test('color ambiguity and unknown part-color combinations still invalidate all inventory', async t => {
  const root = await library(t, { 'parts/a.dat': face })
  for (const damage of [
    m => { m.colors[99].external_ids.LDraw.ext_ids.push('1') },
    m => { m.parts['catalog-item'].known_colors = [] },
    m => { m.parts['catalog-item'].status = 'not_configured' },
  ]) {
    const { session, metadata, rules } = input(['a'])
    damage(metadata)
    const result = await resolveInventoryMapping(session, metadata, rules, p => inspectBrickModel(p, root))
    assert.equal(result.valid, false)
    assert.deepEqual(result.inventory, [])
  }
})

test('dependency inspection supports case, backslashes, primitives and shared references', async t => {
  const root = await library(t, { 'parts/A.dat': ref('s\\BODY.dat') + ref('s\\BODY.dat'),
    'parts/s/body.dat': ref('primitive.dat'), 'p/primitive.dat': face })
  const result = await inspectBrickModel('a', root)
  assert.equal(result.available, true)
  assert.equal(result.checkedFiles, 3)
})

test('cycles, empty geometry and traversal cannot qualify as available', async t => {
  const root = await library(t, { 'parts/a.dat': ref('b.dat'), 'parts/b.dat': ref('a.dat'),
    'parts/empty.dat': '0 No geometry\n', 'parts/escape.dat': ref('../outside.dat') })
  for (const part of ['a', 'empty', 'escape', '../outside']) {
    const result = await inspectBrickModel(part, root)
    assert.equal(result.available, false)
    assert.ok(result.errors.length)
  }
})

test('symlinks outside the library are rejected and checks are fresh on later reviews', async t => {
  const outside = await library(t, { 'external.dat': face })
  const root = await library(t, { 'parts/a.dat': ref('dep.dat'), 'parts/dep.dat': face })
  await symlink(path.join(outside, 'external.dat'), path.join(root, 'parts', 'escape.dat'))
  assert.equal((await inspectBrickModel('escape', root)).available, false)
  assert.equal((await inspectBrickModel('a', root)).available, true)
  await rm(path.join(root, 'parts/dep.dat'))
  assert.equal((await inspectBrickModel('a', root)).available, false)
})

test('entry alias matrices are retained; snap metadata is never treated as verified connectivity', async t => {
  const root = await library(t, { 'parts/a.dat': '0 !LDCAD SNAP_CLEAR\n1 16 0 0 0 0 0 1 0 1 0 -1 0 0 b.dat\n', 'parts/b.dat': face })
  const inspected = await inspectBrickModel('a', root)
  assert.deepEqual(inspected.entryReferences[0].matrix, [0, 0, 1, 0, 1, 0, -1, 0, 0])
  assert.deepEqual(inspected.connectionMetadata, { files: ['a.dat'], interpreted: false })
})

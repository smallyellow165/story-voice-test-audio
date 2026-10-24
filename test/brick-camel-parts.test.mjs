import test from 'node:test'
import assert from 'node:assert/strict'
import { PARTS, COLORS, geometrySupport } from '../src/brick-test/catalog.ts'
import { validPosition } from '../src/brick-test/part-geometry.ts'
import * as assembly from '../src/brick-test/assembly.ts'
import { validateBrickDesign, designHeightLimits } from '../src/brick-design-validation.mjs'
import { designSchema, buildDesignPrompt, validateGeneratorInput } from '../server/brick-generator.mjs'
import { resolveInventoryMapping } from '../server/brick-mapping.mjs'
const rules = { ...assembly, PARTS, COLORS, geometrySupport, validPosition }
const inventory = [{ part: '3437', color: '14', quantity: 2 }, { part: '4066a', color: '14', quantity: 3 }, { part: '40666', color: '14', quantity: 2 }]
const brick = (id, part, layer = 0, x = 0, z = 0, rotation = 0) => ({ id, part, color: '14', x, z, layer, rotation })
// Validator fixture only, not a template supplied to generation and not a camel reconstruction.
const seven = () => [brick('base', '40666'), brick('plate', '40666', 0.5),
  brick('left', '4066a', 1, -1, -0.5), brick('right', '4066a', 1, 1, -0.5),
  brick('left_cap', '3437', 3, -1), brick('right_cap', '3437', 3, 1), brick('upper', '4066a', 4, -1, -0.5)]
const design = bricks => ({ name: 'mixed-height fixture', bricks, steps: bricks.map(b => ({ brickId: b.id, instruction: '放置积木' })) })

test('mixed height profiles share the standard interface and coordinate transform', () => {
  for (const [id, size, count] of [['4066a', { x: 80, y: 96, z: 40 }, 2], ['40666', { x: 160, y: 24, z: 80 }, 8]]) {
    const g = geometrySupport(id)
    assert.equal(g.supported, true)
    assert.deepEqual(g.geometry.bodySizeLdu, size)
    assert.equal(g.geometry.top.length, count)
    assert.equal(g.geometry.bottom.length, count)
    assert.equal(g.geometry.ldraw.offsetLdu.y, size.y)
    assert.ok(g.geometry.sourceFiles.length)
    for (const rotation of [0, 90, 180, 270]) {
      const pair = [brick('a', id, 0, 0, 0, rotation), brick('b', id, size.y / 48, 0, 0, rotation)]
      assert.equal(assembly.validateAssembly(pair).valid, true)
      assert.equal(assembly.connectionCandidates([pair[0]], pair[1]).some(c => c.brick.layer === size.y / 48), true)
    }
  }
})

test('all seven yellow pieces pass the existing assembly, prefix and inventory checks', () => {
  const input = validateGeneratorInput({ description: 'test', inventory }, rules)
  assert.deepEqual(input.inventory, inventory)
  const result = validateBrickDesign(design(seven()), inventory, rules)
  assert.equal(result.valid, true, JSON.stringify(result.issues))
  assert.equal(result.steps.length, 7)
  assert.equal(result.usage.reduce((n, row) => n + row.used, 0), 7)
  assert.equal(result.usage.every(row => row.remaining === 0), true)
})

test('body penetration, unpaired studs, floating parts and excess inventory remain rejected', () => {
  assert.equal(assembly.validateAssembly([brick('a', '4066a'), brick('b', '40666', 1)]).code, 'COLLISION')
  assert.equal(assembly.validateAssembly([brick('a', '40666'), brick('b', '4066a', 0.5, 0.5, -0.5)]).code, 'COLLISION')
  assert.equal(assembly.validateAssembly([brick('floating', '4066a', 0.5)]).code, 'UNSUPPORTED')
  assert.equal(assembly.validateAssembly([brick('a', '40666'), brick('gap', '4066a', 1)]).code, 'UNSUPPORTED')
  const short = inventory.map(r => r.part === '4066a' ? { ...r, quantity: 2 } : r)
  assert.ok(validateBrickDesign(design(seven()), short, rules).issues.some(i => i.code === 'INVENTORY_EXCEEDED'))
  const wrongOrder = design(seven()); wrongOrder.steps.reverse()
  assert.ok(validateBrickDesign(wrongOrder, inventory, rules).issues.some(i => i.code === 'BUILD_ORDER'))
})

test('height budget is shared by schema, prompt and validator and stays bounded', () => {
  assert.deepEqual(designHeightLimits([{ part: '3437', quantity: 2 }], rules), { maxLayer: 3, maxTop: 4 })
  assert.deepEqual(designHeightLimits([{ part: '40666', quantity: 2 }], rules), { maxLayer: 3, maxTop: 4 })
  assert.deepEqual(designHeightLimits(inventory, rules), { maxLayer: 5, maxTop: 6 })
  assert.equal(designSchema(rules, inventory).properties.bricks.items.properties.layer.maximum, 5)
  assert.ok(buildDesignPrompt(rules, inventory).includes('"maxTop":6'))
  const high = seven(); high[6].layer = 5
  assert.ok(validateBrickDesign(design(high), inventory, rules).issues.some(i => i.code === 'CHILD_LIMIT'))
  const fakeRules = { PARTS: [{ id: 'test-tall', geometry: { status: 'reviewed', bodySizeLdu: { y: 960 } } }] }
  assert.deepEqual(designHeightLimits([{ part: 'test-tall', quantity: 1 }], fakeRules), { maxLayer: 7, maxTop: 8 })
})

test('official one-to-many identities are retained; only reviewed available variants qualify', async () => {
  const session = { items: [{ part_num: '3437', color_id: 14, quantity: 2 }, { part_num: '4066', color_id: 14, quantity: 3 }, { part_num: '40666', color_id: 14, quantity: 2 }] }
  // Isolated metadata fixture matching inspected official CSV; not a production mapping.
  const ids = { '3437': ['3437', '31460'], '4066': ['4066a', '4066b', '42657'], '40666': ['40666'] }
  const metadata = { parts: Object.fromEntries(Object.entries(ids).map(([id, candidates]) => [id, { status: 'available', known_colors: [14], external_ids: { LDraw: candidates } }])), colors: { 14: { status: 'available', external_ids: { LDraw: { ext_ids: ['14'] } } } } }
  const inspect = async part => ({ available: true, errors: [], sourceFiles: geometrySupport(part).geometry?.sourceFiles || [] })
  const result = await resolveInventoryMapping(session, metadata, rules, inspect)
  assert.equal(result.valid, true)
  assert.deepEqual(result.inventory, inventory)
  assert.deepEqual(result.rows[1].partCandidates, ids['4066'])
  assert.equal(result.rows[1].target.part, '4066a')
  const missing = await resolveInventoryMapping(session, metadata, rules, async part => part === '4066a' ? { available: false, errors: ['missing file'], sourceFiles: [] } : inspect(part))
  assert.equal(missing.rows[1].target, null)
  const changed = await resolveInventoryMapping(session, metadata, rules, async part => ({ ...(await inspect(part)), sourceFiles: [] }))
  assert.equal(changed.rows[1].target, null)
  assert.equal(changed.rows[2].target, null)
})

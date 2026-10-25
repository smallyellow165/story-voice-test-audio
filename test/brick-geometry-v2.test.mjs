import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssemblyRules, validateAssembly } from '../src/brick-test/assembly.ts'
import { rectangularGeometry, geometryIssues, validPosition } from '../src/brick-test/part-geometry.ts'
import { PARTS, COLORS, geometrySupport, exampleBricks } from '../src/brick-test/catalog.ts'
import { validateBrickDesign } from '../src/brick-design-validation.mjs'

// Abstract geometry fixtures only: not real Catalog IDs, never registered in production.
const profile = (id, width, depth, height) => ({ id, label: id, length: width, depth,
  geometry: rectangularGeometry(width, depth, height, ['isolated test profile']) })
const brick = (id, part, changes = {}) => ({ id, part, color: '4', x: 0, z: 0, layer: 0, rotation: 0, ...changes })

test('non-2 width/depth, odd sizes and non-unit heights use the same connector engine', () => {
  const parts = [profile('wide', 4, 3, 72), profile('small', 1, 1, 16)]
  const rules = createAssemblyRules(parts), lower = brick('lower', 'wide')
  const upper = brick('upper', 'small', { x: -0.5, layer: 1.5 })
  assert.deepEqual(rules.dimensions('wide', 90), { width: 3, depth: 4 })
  assert.equal(rules.validateAssembly([lower, upper]).valid, true)
  const candidates = rules.connectionCandidates([lower], brick('draft', 'small'))
  assert.equal(candidates.length, 12)
  assert.ok(candidates.every(c => c.brick.layer === 1.5 && c.contactCount === 1))
  assert.equal(rules.validateAssembly([lower, { ...upper, layer: 1 }]).code, 'COLLISION')
  assert.equal(rules.validateAssembly([lower, { ...upper, layer: 2 }]).code, 'UNSUPPORTED')
  const report = validateBrickDesign({ name: 'geometry test', bricks: [lower, upper], steps: [lower, upper].map(b => ({ brickId: b.id, instruction: 'place' })) },
    [{ part: 'wide', color: '4', quantity: 1 }, { part: 'small', color: '4', quantity: 1 }], { ...rules, PARTS: parts, COLORS, validPosition })
  assert.equal(report.valid, true)
})
test('sparse top interfaces never turn the full body footprint into studs', () => {
  const base = profile('sparse', 4, 2, 48), cap = profile('cap', 2, 2, 48)
  base.geometry.family = 'explicit-duplo'
  base.geometry.top = base.geometry.top.filter(p => Math.abs(p.x) === 20)
  const rules = createAssemblyRules([base, cap]), lower = brick('lower', 'sparse')
  assert.equal(rules.connectors(lower, 'top').length, 4)
  assert.equal(rules.footprint(lower).length, 8)
  assert.equal(rules.validateAssembly([lower, brick('cap', 'cap', { layer: 1 })]).valid, true)
  assert.equal(rules.validateAssembly([lower, brick('cap', 'cap', { layer: 1, x: 2 })]).code, 'UNSUPPORTED')
})
test('unmatched studs cannot penetrate a solid body even when another connector mates', () => {
  const base = profile('base', 2, 2, 48), cap = profile('cap', 2, 2, 48)
  cap.geometry.bottom.pop()
  const rules = createAssemblyRules([base, cap])
  assert.equal(rules.validateAssembly([brick('base', 'base'), brick('cap', 'cap', { layer: 1 })]).code, 'COLLISION')
})
test('quarter-turn transforms apply to connector coordinates, not just dimensions', () => {
  const p = profile('wide', 4, 3, 72), rules = createAssemblyRules([p])
  const original = rules.connectors(brick('a', 'wide'), 'top')
  const rotated = rules.connectors(brick('a', 'wide', { rotation: 90 }), 'top')
  assert.deepEqual(rotated.map(p => [p.x, p.y, p.z]), original.map(p => [p.z, p.y, -p.x]))
})
test('unknown or invalid capability data cannot enable assembly', () => {
  const p = profile('unknown', 2, 2, 48)
  p.geometry.status = 'unknown'
  assert.equal(createAssemblyRules([p]).validateAssembly([brick('a', 'unknown')]).code, 'PART')
  p.geometry.status = 'reviewed'; p.geometry.top[0].y = 999
  assert.ok(geometryIssues(p.geometry).length)
  assert.equal(createAssemblyRules([p]).validateAssembly([brick('a', 'unknown')]).code, 'PART')
  assert.equal(geometrySupport('98223b').supported, false)
})
test('existing profiles preserve body transforms and the original staircase', () => {
  assert.equal(validateAssembly(exampleBricks()).valid, true)
  for (const p of PARTS.filter(p => ['3437', '3011', '2300', '87084'].includes(p.id))) {
    assert.equal(p.geometry.bodySizeLdu.y, 48)
    assert.deepEqual(p.geometry.ldraw.offsetLdu, { x: 0, y: 48, z: 0 })
    assert.equal(p.geometry.top.length, p.length * p.depth)
    assert.equal(geometryIssues(p.geometry).length, 0)
  }
})
test('half-grid placement is not permission for half-grid mating', () => {
  const rules = createAssemblyRules(PARTS)
  assert.equal(rules.validateAssembly([brick('ground', PARTS[0].id, { x: 0.5 })]).valid, true)
  assert.equal(rules.validateAssembly([brick('base', PARTS[0].id), brick('shifted', PARTS[0].id, { x: 0.5, layer: 1 })]).valid, false)
})

// Real newly registered dimensions; inventory is still supplied by each caller.
test('87084 has six interfaces and uses half-stud alignment with even-length bricks', () => {
  const rules = createAssemblyRules(PARTS), g = geometrySupport('87084')
  assert.equal(g.supported, true)
  assert.deepEqual(g.geometry.bodySizeLdu, { x: 120, y: 48, z: 80 })
  assert.equal(g.geometry.top.length, 6)
  assert.equal(g.geometry.bottom.length, 6)
  const base = brick('base', '3437')
  const upper = brick('upper', '87084', { x: 0.5, layer: 1 })
  assert.equal(rules.validateAssembly([base, upper]).valid, true)
  assert.equal(rules.validateAssembly([base, { ...upper, x: 0 }]).valid, false)
  assert.equal(rules.validateAssembly([base, { ...upper, layer: 0 }]).code, 'COLLISION')
  assert.equal(rules.validateAssembly([base, { ...upper, layer: 2 }]).code, 'UNSUPPORTED')
  assert.deepEqual(rules.dimensions('87084', 90), { width: 2, depth: 3 })
  const design = { name: 'reviewed geometry', bricks: [base, upper],
    steps: [base, upper].map(b => ({ brickId: b.id, instruction: 'place' })) }
  const inventory = [{ part: '3437', color: '4', quantity: 1 }, { part: '87084', color: '4', quantity: 1 }]
  assert.equal(validateBrickDesign(design, inventory, { ...rules, PARTS, COLORS, validPosition }).valid, true)
  assert.equal(validateBrickDesign(design, inventory.slice(0, 1), { ...rules, PARTS, COLORS, validPosition }).valid, false)
  assert.equal(geometrySupport('98223').supported, true)
  assert.equal(geometrySupport('98223b').supported, false)
})

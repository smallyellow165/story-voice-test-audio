import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { connectionCandidates, dimensions, footprint, validateAssembly, validatePlacement } from '../src/brick-test/assembly.ts'
import { BODY_LDU, MM_PER_LDU, PARTS, STUD_LDU, exampleBricks } from '../src/brick-test/catalog.ts'

const brick = (id, overrides = {}) => ({ id, part: '3437', color: '4', x: 0, z: 0, layer: 0, rotation: 0, ...overrides })
const base = brick('base')
const code = (bricks) => validateAssembly(bricks).code

test('empty scene and a single ground brick are valid', () => {
  assert.equal(code([]), 'VALID')
  assert.equal(code([base]), 'VALID')
  assert.equal(validateAssembly([base]).connections.length, 0)
})

test('part dimensions and quarter turns map to the correct stud footprint', () => {
  for (const part of PARTS) for (const rotation of [0, 90, 180, 270]) {
    const rotated = rotation % 180 !== 0
    assert.deepEqual(dimensions(part.id, rotation), { width: rotated ? 2 : part.length, depth: rotated ? part.length : 2 })
    const cells = footprint(brick('a', { part: part.id, rotation, x: -3, z: 4 }))
    assert.equal(cells.length, part.length * 2)
    assert.equal(new Set(cells.map(({ x, z }) => `${x},${z}`)).size, cells.length)
  }
})

test('a centered 2x2 stack has four explicit matched connector positions', () => {
  const result = validatePlacement([base], brick('top', { layer: 1 }))
  assert.equal(result.valid, true)
  assert.deepEqual(result.connections, [{ lowerId: 'base', upperId: 'top', points: [
    { x: -0.5, z: -0.5 }, { x: -0.5, z: 0.5 }, { x: 0.5, z: -0.5 }, { x: 0.5, z: 0.5 },
  ] }])
})

test('single-stud overhang is geometrically allowed, without promising stability', () => {
  const result = validatePlacement([base], brick('overhang', { layer: 1, x: 1, z: 1 }))
  assert.equal(result.valid, true)
  assert.equal(result.connections[0].points.length, 1)
  assert.match(result.reason, /未评估物理稳定性/)
})

test('mere side, edge, corner or floor contact does not create a connection', () => {
  assert.equal(code([base, brick('side', { x: 2 })]), 'DISCONNECTED')
  assert.equal(code([base, brick('corner', { x: 2, z: 2 })]), 'DISCONNECTED')
  assert.equal(code([base, brick('far', { x: 10 })]), 'DISCONNECTED')
  assert.equal(code([base, brick('above-edge', { x: 2, layer: 1 })]), 'UNSUPPORTED')
  assert.equal(code([base, brick('above-corner', { x: 2, z: 2, layer: 1 })]), 'UNSUPPORTED')
})

test('half-stud positions, arbitrary angles, fractional layers and negative height are rejected', () => {
  for (const patch of [{ x: 0.5 }, { z: -0.5 }, { layer: 1.5 }, { layer: -1 }, { x: NaN }, { z: Infinity }, { x: 1_000_001 }]) {
    assert.equal(code([brick('invalid', patch)]), 'GRID')
  }
  for (const rotation of [45, -90, 360, NaN]) assert.equal(code([brick('invalid', { rotation })]), 'ROTATION')
  assert.equal(code([brick('unknown', { part: '3001' })]), 'PART')
  assert.equal(code([brick('')]), 'INPUT')
  assert.equal(validateAssembly(null).code, 'INPUT')
  assert.equal(validatePlacement(null, base).code, 'INPUT')
  assert.equal(validateAssembly([null]).code, 'INPUT')
})

test('duplicates and nominal body intersections are rejected before support checks', () => {
  assert.equal(code([base, { ...base, layer: 1 }]), 'DUPLICATE_ID')
  assert.equal(code([base, brick('same')]), 'COLLISION')
  assert.equal(code([base, brick('partial', { x: 1 })]), 'COLLISION')
  const result = validateAssembly([brick('long', { part: '2300' }), brick('crossing', { part: '3011', rotation: 90 })])
  assert.equal(result.code, 'COLLISION')
  assert.deepEqual(result.brickIds, ['long', 'crossing'])
})

test('elevated bricks need lower-layer support, including after deletion', () => {
  const top = brick('top', { layer: 1 })
  assert.equal(code([top]), 'UNSUPPORTED')
  assert.equal(code([base, brick('gap', { layer: 2 })]), 'UNSUPPORTED')
  const tower = [base, top, brick('third', { layer: 2 })]
  assert.equal(code(tower), 'VALID')
  assert.equal(code(tower.filter((item) => item.id !== 'top')), 'UNSUPPORTED')
  assert.equal(code(tower.filter((item) => item.id !== 'third')), 'VALID')
})

test('a bridge may connect two floor bricks and can retain support after removing one', () => {
  const left = brick('left', { x: -2 })
  const right = brick('right', { x: 2 })
  const bridge = brick('bridge', { part: '2300', layer: 1 })
  assert.equal(code([left, right]), 'DISCONNECTED')
  const result = validateAssembly([left, right, bridge])
  assert.equal(result.valid, true)
  assert.equal(result.connections.length, 2)
  assert.equal(result.connections.reduce((sum, link) => sum + link.points.length, 0), 8)
  assert.equal(code([left, bridge]), 'VALID')
})

test('the existing staircase is valid regardless of array order', () => {
  const example = exampleBricks()
  assert.equal(code(example), 'VALID')
  assert.equal(code([...example].reverse()), 'VALID')
  assert.equal(validateAssembly(example).connections.reduce((sum, link) => sum + link.points.length, 0), 16)
})

test('candidate generation seeds an empty ground and yields nine translations above a 2x2', () => {
  const draft = brick('draft')
  assert.deepEqual(connectionCandidates([], draft), [{ key: '0,0,0', brick: draft, contactCount: 0 }])
  const candidates = connectionCandidates([base], draft)
  assert.equal(candidates.length, 9)
  assert.equal(candidates[0].key, '0,0,1')
  assert.equal(candidates[0].contactCount, 4)
  assert.equal(new Set(candidates.map((candidate) => candidate.key)).size, 9)
  for (const candidate of candidates) assert.equal(validatePlacement([base], candidate.brick).valid, true)
})

test('occupied connectors do not produce same-layer collisions; exposed upper studs remain available', () => {
  const tower = [base, brick('top', { layer: 1 })]
  const candidates = connectionCandidates(tower, brick('draft'))
  assert.ok(candidates.length > 0)
  assert.ok(candidates.every((candidate) => candidate.brick.layer === 2))
  for (const candidate of candidates) assert.equal(validatePlacement(tower, candidate.brick).valid, true)
  assert.deepEqual(connectionCandidates([brick('floating', { layer: 3 })], brick('draft')), [])
  assert.deepEqual(connectionCandidates([base], brick('base')), [])
  assert.deepEqual(connectionCandidates([base], brick('bad', { rotation: 45 })), [])
})

test('generated candidates equal exhaustive legal upward placements for every supported orientation', () => {
  const scenes = [[base], [brick('wide', { part: '2300' }), brick('cap', { x: -2, layer: 1 })], exampleBricks()]
  for (const scene of scenes) for (const part of PARTS) for (const rotation of [0, 90, 180, 270]) {
    const draft = brick('draft', { part: part.id, rotation })
    const actual = connectionCandidates(scene, draft).map((candidate) => candidate.key).sort()
    const expected = []
    const maxLayer = Math.max(...scene.map((item) => item.layer)) + 1
    // All scene extents plus the maximum candidate half-width fit this domain.
    for (let layer = 1; layer <= maxLayer; layer++) for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
      if (validatePlacement(scene, { ...draft, x, z, layer }).valid) expected.push(`${x},${z},${layer}`)
    }
    assert.deepEqual(actual, expected.sort(), `${part.id} / ${rotation}`)
  }
})

test('whole-batch validation catches a later collision even if the first placement is legal', () => {
  const scene = [brick('wide', { part: '2300' }), brick('support', { x: -2, layer: 1 }), brick('roof', { part: '2300', layer: 2 })]
  const first = brick('first', { x: 2, layer: 1 })
  assert.equal(validatePlacement(scene, first).valid, true)
  assert.equal(code([...scene, first, brick('second', { x: 2, layer: 2 })]), 'COLLISION')
})

test('a stale candidate is rejected after another brick consumes its position', () => {
  const candidate = connectionCandidates([base], brick('draft'))[0]
  const changed = [base, { ...candidate.brick, id: 'occupied-now' }]
  assert.equal(validatePlacement(changed, candidate.brick).code, 'COLLISION')
  assert.ok(connectionCandidates(changed, brick('new-draft')).every((item) => item.key !== candidate.key))
})

test('deleting a connecting bridge can disconnect two independently grounded components', () => {
  const left = brick('left', { x: -2 })
  const right = brick('right', { x: 2 })
  const bridge = brick('bridge', { part: '2300', layer: 1 })
  assert.equal(code([left, right, bridge]), 'VALID')
  assert.equal(code([left, right]), 'DISCONNECTED')
})

test('pure functions neither mutate frozen inputs nor depend on color', () => {
  const scene = Object.freeze([Object.freeze(base)])
  const draft = Object.freeze(brick('draft', { color: '15' }))
  const before = JSON.stringify({ scene, draft })
  connectionCandidates(scene, draft)
  validatePlacement(scene, { ...draft, layer: 1 })
  assert.equal(JSON.stringify({ scene, draft }), before)
  assert.deepEqual(connectionCandidates(scene, draft).map((item) => item.key), connectionCandidates(scene, { ...draft, color: '1' }).map((item) => item.key))
})

// Optional integration with the user's real library. This is a source-data
// cross-check, not a claim to have measured clutch force or physical stability.
test('official local models agree with catalog dimensions and stud centers', async (t) => {
  const library = process.env.LDRAW_LIBRARY_PATH || '/home/umi/Documents/pg/gaming/lego-brick/complete/ldraw'
  let source3437
  try { source3437 = await readFile(path.join(library, 'parts/3437.dat'), 'utf8') }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Local LDraw library unavailable'); return } throw error }
  assert.equal(STUD_LDU, 40)
  assert.equal(BODY_LDU, 48)
  assert.equal(STUD_LDU * MM_PER_LDU, 16)
  assert.ok(Math.abs(BODY_LDU * MM_PER_LDU - 19.2) < 1e-10)
  const group = await readFile(path.join(library, 'p/stug7-2x2.dat'), 'utf8')
  const references = (text) => text.split(/\r?\n/).filter((line) => /^1\s/.test(line)).map((line) => {
    const fields = line.trim().split(/\s+/)
    return { position: fields.slice(2, 5).map(Number), matrix: fields.slice(5, 14).map(Number), file: fields.slice(14).join(' ').replaceAll('\\', '/') }
  })
  const transform = (point, reference) => [0, 1, 2].map((row) => reference.position[row] + point.reduce((sum, value, col) => sum + value * reference.matrix[row * 3 + col], 0))
  for (const part of PARTS) {
    const source = part.id === '3437' ? source3437 : await readFile(path.join(library, `parts/${part.id}.dat`), 'utf8')
    assert.match(source, new RegExp(`Duplo Brick\\s+2 x\\s+${part.length}`))
    const subfile = references(source).find((reference) => reference.file === `s/${part.id}s01.dat`)
    if (subfile) {
      assert.deepEqual(subfile.position, [0, 0, 0])
      assert.deepEqual(subfile.matrix, [1, 0, 0, 0, 1, 0, 0, 0, 1])
    }
    const detail = subfile ? await readFile(path.join(library, `parts/${subfile.file}`), 'utf8') : source
    const studs = []
    for (const reference of references(detail)) {
      if (reference.file === 'stud7.dat') studs.push(reference.position)
      if (reference.file === 'stug7-2x2.dat') for (const child of references(group)) {
        assert.equal(child.file, 'stud7.dat')
        studs.push(transform(child.position, reference))
      }
    }
    const expected = footprint(brick('source', { part: part.id })).map((cell) => [(cell.x + 0.5) * STUD_LDU, 0, (cell.z + 0.5) * STUD_LDU].join(','))
    assert.deepEqual(studs.map((point) => point.join(',')).sort(), expected.sort())
    // Each root file contains outer body face quads; exclude the below-top studs.
    const vertices = source.split(/\r?\n/).filter((line) => /^4\s/.test(line)).flatMap((line) => {
      const values = line.trim().split(/\s+/).slice(2).map(Number)
      return Array.from({ length: values.length / 3 }, (_, i) => values.slice(i * 3, i * 3 + 3))
    })
    assert.equal(Math.min(...vertices.map((point) => point[0])), -part.length * STUD_LDU / 2)
    assert.equal(Math.max(...vertices.map((point) => point[0])), part.length * STUD_LDU / 2)
    assert.equal(Math.min(...vertices.map((point) => point[2])), -STUD_LDU)
    assert.equal(Math.max(...vertices.map((point) => point[2])), STUD_LDU)
    assert.equal(Math.max(...vertices.map((point) => point[1])), BODY_LDU)
  }
})

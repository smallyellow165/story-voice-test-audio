import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { computeAllConnectionResiduals, computeTransformFromConnection, solveConnections } from '../../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
import { validatePhysicalModel } from '../../src/magnetic-tiles/three-d/vendor/engine/validator.ts'
import { semicircleShape, sectorShape, squareShape } from '../../src/magnetic-tiles/three-d/vendor/engine/shapes.ts'
import { shapeOutline } from '../../src/magnetic-tiles/three-d/vendor/engine/outline.ts'
import { cubeFixture, model, pose } from './fixtures.ts'
import type { Connection, ShapeDef } from '../../src/magnetic-tiles/three-d/vendor/engine/types.ts'

const square = () => squareShape
const geometryOnly = { checkGround: false, checkStability: false, checkSemantics: false, checkSteps: false }
describe('connection geometry regressions', () => {
  for (const flip of [false, true]) for (const angle of [-180, -135, -90, -30, 0, 30, 90, 135, 180]) {
    it(`reverses traversal exactly: flip=${flip}, angle=${angle}`, () => {
      const conn: Connection = { pieceA: 'a', pieceB: 'b', portA: 'e1-p0', portB: 'e0-p0', dihedralDeg: angle, flip }
      const m = model(['a', 'b'], [conn]), root = pose(2, 3, 4)
      root.quaternion.setFromAxisAngle(new Vector3(1, 2, 3).normalize(), .72)
      const forward = solveConnections({ pieces: m.pieces, connections: m.connections, rootPieceId: 'a', rootTransform: root, groundLock: false, getShapeForPiece: square })
      const reverse = solveConnections({ pieces: m.pieces, connections: m.connections, rootPieceId: 'b', rootTransform: forward.transforms.b, groundLock: false, getShapeForPiece: square })
      expect(reverse.transforms.a.position.distanceTo(root.position)).toBeLessThan(1e-10)
      expect(1 - Math.abs(reverse.transforms.a.quaternion.dot(root.quaternion))).toBeLessThan(1e-10)
      for (const r of reverse.loopResiduals) { expect(r.positionError).toBeLessThan(1e-10); expect(r.dihedralError).toBeLessThan(1e-8) }
    })
  }
  for (const flip of [false, true]) it(`rejects opposite signed angle even on a tree edge: flip=${flip}`, () => {
    const c: Connection = { pieceA: 'a', pieceB: 'b', portA: 'e0-p0', portB: 'e0-p0', dihedralDeg: 90, flip }
    const wrong = computeTransformFromConnection(pose(), squareShape, c.portA, squareShape, c.portB, -90, flip)!
    const transforms = { a: pose(), b: wrong }
    expect(computeAllConnectionResiduals([c], transforms, square)[0].dihedralError).toBeCloseTo(180)
    const validation = validatePhysicalModel(model(['a', 'b'], [c]), square, { ...geometryOnly, transforms })
    expect(validation.valid).toBe(false)
    expect(validation.issues.some(i => i.code === 'loop-dihedral-error')).toBe(true)
  })
  it('closes all twelve edges of a six-face cube from every root and connection order', () => {
    const fixture = cubeFixture()
    expect(fixture.model.connections).toHaveLength(12)
    for (const root of fixture.model.pieces) for (const reverse of [false, true]) {
      const cs = reverse ? [...fixture.model.connections].reverse() : fixture.model.connections
      const result = solveConnections({ pieces: fixture.model.pieces, connections: cs, rootPieceId: root.id,
        rootTransform: fixture.transforms[root.id], groundLock: false, getShapeForPiece: square })
      expect(result.error).toBeUndefined()
      expect(Object.keys(result.transforms)).toHaveLength(6)
      expect(result.loopResiduals).toHaveLength(12)
      for (const p of fixture.model.pieces) {
        expect(result.transforms[p.id].position.distanceTo(fixture.transforms[p.id].position)).toBeLessThan(1e-10)
        expect(1 - Math.abs(result.transforms[p.id].quaternion.dot(fixture.transforms[p.id].quaternion))).toBeLessThan(1e-10)
      }
      for (const r of result.loopResiduals) { expect(r.positionError).toBeLessThan(1e-10); expect(r.dihedralError).toBeLessThan(1e-8) }
      expect(validatePhysicalModel(fixture.model, square, { ...geometryOnly, transforms: result.transforms }).valid).toBe(true)
    }
  })
  it('reports wrong non-tree cube angle and positional closure errors', () => {
    const fixture = cubeFixture(), cs = fixture.model.connections
    const solved = solveConnections({ pieces: fixture.model.pieces, connections: cs, rootPieceId: 'bottom', groundLock: false, getShapeForPiece: square })
    const nonTree = cs.findIndex((_, i) => !solved.spanningTreeConnectionIndices.has(i))
    const broken = structuredClone(fixture.model); broken.connections[nonTree].dihedralDeg = 0
    expect(validatePhysicalModel(broken, square, geometryOnly).issues.some(i => i.code === 'loop-dihedral-error')).toBe(true)
    fixture.transforms.top.position.z += .1
    const invalid = validatePhysicalModel(fixture.model, square, { ...geometryOnly, transforms: fixture.transforms })
    expect(invalid.issues.some(i => i.code === 'loop-position-error')).toBe(true)
  })
  it('detects both total overlap and thin partial penetration in free poses', () => {
    const thin: ShapeDef = { ...squareShape, thickness: .002 }
    for (const x of [0, .3]) {
      const r = validatePhysicalModel(model(['a', 'b'], []), () => thin,
        { ...geometryOnly, requireConnected: false, transforms: { a: pose(), b: pose(x, 0, .0005) } })
      expect(r.issues.some(i => i.code === 'intersection')).toBe(true)
    }
  })
  it('detects a genuinely spatial crossing while allowing separated perpendicular faces', () => {
    const b = pose(); b.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
    const m = model(['a', 'b'], [])
    expect(validatePhysicalModel(m, square, { ...geometryOnly, requireConnected: false,
      transforms: { a: pose(), b } }).issues.some(i => i.code === 'intersection')).toBe(true)
    b.position.x = 2
    expect(validatePhysicalModel(m, square, { ...geometryOnly, requireConnected: false,
      transforms: { a: pose(), b } }).valid).toBe(true)
  })
  it('samples the semicircle and rejects overlap in its curved region without crashing', () => {
    expect(shapeOutline(semicircleShape).length).toBeGreaterThan(30)
    const r = validatePhysicalModel(model(['a', 'b'], []), () => semicircleShape,
      { ...geometryOnly, requireConnected: false, transforms: { a: pose(), b: pose(.1, .1, 0) } })
    expect(r.issues.some(i => i.code === 'intersection')).toBe(true)
    const apart = validatePhysicalModel(model(['a', 'b'], []), () => semicircleShape,
      { ...geometryOnly, requireConnected: false, transforms: { a: pose(), b: pose(0, 2, 0) } })
    expect(apart.valid).toBe(true)
    expect(semicircleShape.area).toBeCloseTo(Math.PI / 8)
    expect(sectorShape.area).toBeCloseTo(Math.PI / 16)
    const outline = shapeOutline(sectorShape)
    expect(outline.every(p => p.x >= -1e-10 && p.y >= -1e-10 && Math.hypot(p.x, p.y) <= .5 + 1e-10)).toBe(true)
  })
  it('uses sampled arc extrema for grounding', () => {
    const m = model(['a'], [])
    const root = pose(); root.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI)
    const s = solveConnections({ pieces: m.pieces, connections: [], rootPieceId: 'a', rootTransform: root, getShapeForPiece: () => semicircleShape })
    expect(s.transforms.a.position.y).toBeCloseTo(.5)
  })
  it('treats +180 and -180 as the same orientation', () => {
    const b = { position: new Vector3(0, -1, 0), quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI) }
    for (const angle of [-180, 180]) {
      const c: Connection = { pieceA: 'a', pieceB: 'b', portA: 'e0-p0', portB: 'e0-p0', dihedralDeg: angle }
      expect(computeAllConnectionResiduals([c], { a: pose(), b }, square)[0].dihedralError).toBeLessThan(1e-8)
    }
  })
  it('rejects non-finite/out-of-range angles before producing transforms', () => {
    for (const angle of [NaN, Infinity, -181, 181, 720]) {
      const c: Connection = { pieceA: 'a', pieceB: 'b', portA: 'e0-p0', portB: 'e0-p0', dihedralDeg: angle }
      const m = model(['a', 'b'], [c])
      expect(solveConnections({ pieces: m.pieces, connections: m.connections, rootPieceId: 'a', getShapeForPiece: square }).error).toBeDefined()
      expect(validatePhysicalModel(m, square).issues.some(i => i.code === 'dihedral-invalid')).toBe(true)
      expect(computeTransformFromConnection(pose(), squareShape, c.portA, squareShape, c.portB, angle, false)).toBeNull()
    }
  })
  it('rejects incomplete or invalid explicit pose snapshots', () => {
    const m = model(['a', 'b'], [])
    expect(validatePhysicalModel(m, square, { ...geometryOnly, transforms: { a: pose() } }).valid).toBe(false)
    const bad = pose(); bad.position.x = NaN
    expect(validatePhysicalModel(m, square, { ...geometryOnly, transforms: { a: pose(), b: bad } }).valid).toBe(false)
    expect(solveConnections({ pieces: m.pieces, connections: [], rootPieceId: 'a', rootTransform: bad, getShapeForPiece: square }).error).toBeDefined()
    expect(solveConnections({ pieces: m.pieces, connections: [], rootPieceId: 'missing', getShapeForPiece: square }).error).toBeDefined()
  })
})

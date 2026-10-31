import { describe, expect, it } from 'vitest'
import { assertAssembly3D, parseAssembly3D, serializeAssembly3D } from '../../src/magnetic-tiles/three-d/assembly.ts'
import { solveAssembly3D, validateAssembly3D } from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import { assemblyFixture, identityPose } from './fixtures.ts'

describe('authoritative 3D pose and persistence', () => {
  it('restores root, free poses, quaternion signs and Profile snapshots exactly; load never solves', () => {
    const a = assemblyFixture()
    a.pieces[0].pose = { position: [10.1234567890123, -2.5, 30], quaternion: [0, 0, 0, -1] }
    a.pieces[2].pose = { position: [-5, 8, 13], quaternion: [.5, -.5, .5, -.5] }
    const serialized = serializeAssembly3D(a), restored = parseAssembly3D(serialized)
    expect(restored).toEqual(a)
    expect(serializeAssembly3D(restored)).toBe(serialized)
    restored.profiles[0].profile.vertices[0][0] = 80
    expect(a.profiles[0].profile.vertices[0][0]).toBe(0)
    expect(validateAssembly3D(a).valid).toBe(false) // saved inconsistent constraints remain visible
  })
  it('solves explicitly while preserving root/free poses, input and revision', () => {
    const a = assemblyFixture(), before = structuredClone(a), solved = solveAssembly3D(a, ['a'])
    expect(a).toEqual(before)
    expect(solved.revision).toBe(a.revision)
    expect(solved.pieces[0].pose).toEqual(a.pieces[0].pose)
    expect(solved.pieces[2].pose).toEqual(a.pieces[2].pose)
    expect(solved.pieces[1].pose).not.toEqual(a.pieces[1].pose)
    expect(validateAssembly3D(solved)).toEqual({ valid: true, issues: [] })
    expect(parseAssembly3D(serializeAssembly3D(solved))).toEqual(solved)
    const fromB = solveAssembly3D(solved, ['b'])
    fromB.pieces.forEach((p, i) => {
      p.pose.position.forEach((n, j) => expect(n).toBeCloseTo(solved.pieces[i].pose.position[j], 10))
    })
  })
  it('preserves independent connected components and validates cross-component collisions', () => {
    const a = assemblyFixture(); a.connections = []
    expect(solveAssembly3D(a)).toEqual(a)
    expect(validateAssembly3D(a).valid).toBe(true)
    expect(validateAssembly3D(a, { requireConnected: true }).valid).toBe(false)
    a.pieces[1].pose = structuredClone(a.pieces[0].pose)
    expect(validateAssembly3D(a).issues.some(i => i.code === 'intersection')).toBe(true)
  })
  it('checks actual saved world height without silently grounding', () => {
    const a = assemblyFixture(); a.pieces = [a.pieces[0]]; a.connections = []
    a.pieces[0].pose.position[1] = -3
    expect(validateAssembly3D(a).valid).toBe(true)
    expect(validateAssembly3D(a, { checkGround: true }).issues.some(i => i.code === 'ground')).toBe(true)
    expect(solveAssembly3D(a)).toEqual(a)
  })
  it('retains a separate root pose for each multi-piece component', () => {
    const a = assemblyFixture(); a.pieces.pop()
    a.pieces.push(...['c', 'd'].map(id => ({ id, profileId: 'square', profileVersion: 1,
      pose: { position: [50, 40, 30] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number] } })))
    a.connections.push({ pieceA: 'c', pieceB: 'd', portA: 'e1-p0', portB: 'e3-p0', dihedralDeg: -90, flip: true })
    const solved = solveAssembly3D(a, ['a', 'c'])
    expect(solved.pieces.find(p => p.id === 'c')!.pose).toEqual(a.pieces.find(p => p.id === 'c')!.pose)
    expect(validateAssembly3D(solved).valid).toBe(true)
    expect(parseAssembly3D(serializeAssembly3D(solved))).toEqual(solved)
    expect(() => solveAssembly3D(a, ['a', 'b'])).toThrow(/one solver root/)
    expect(() => solveAssembly3D(a, ['missing'])).toThrow(/root selection/)
  })
  it('rejects malformed and unsupported snapshots without rewriting them', () => {
    expect(() => parseAssembly3D('{')).toThrow()
    for (const mutate of [
      (a: any) => { a.schemaVersion = 2 }, (a: any) => { a.kind = '2d' },
      (a: any) => { a.pieces[0].pose.quaternion = [0, 0, 0, 0] },
      (a: any) => { a.pieces[0].pose.position = [0, 0, Infinity] },
      (a: any) => { a.pieces[0].profileVersion = '1' },
      (a: any) => { a.pieces[0].profileVersion = 99 },
      (a: any) => { a.pieces[0].id = '__proto__' },
      (a: any) => { a.pieces[1].id = 'a' },
      (a: any) => { a.connections[0].pieceB = 'missing' },
      (a: any) => { a.connections[0].portA = 'absent' },
      (a: any) => { a.connections[0].dihedralDeg = NaN },
      (a: any) => { a.connections[0].dihedralDeg = 181 },
      (a: any) => { a.connections[0].flip = 1 },
      (a: any) => { a.profiles.push(a.profiles[0]) },
      (a: any) => { a.revision = -1 }, (a: any) => { a.extra = true },
    ]) {
      const a = assemblyFixture(); mutate(a)
      expect(() => assertAssembly3D(a)).toThrow()
      expect(() => serializeAssembly3D(a)).toThrow()
    }
    const a = assemblyFixture(); a.connections = []; a.pieces = []
    expect(parseAssembly3D(serializeAssembly3D(a)).pieces).toEqual([])
    expect(validateAssembly3D(a).valid).toBe(false)
    expect(identityPose().quaternion).toEqual([0, 0, 0, 1])
  })
})

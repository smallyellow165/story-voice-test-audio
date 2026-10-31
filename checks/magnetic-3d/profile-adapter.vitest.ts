import { describe, expect, it } from 'vitest'
import { adaptProfile, createShapeCatalog } from '../../src/magnetic-tiles/three-d/profile-adapter.ts'
import { profiles } from '../../src/magnetic-tiles/profiles.ts'
import { parametricProfile } from '../../src/magnetic-tiles/parametric-profile.ts'
import type { Profile } from '../../src/magnetic-tiles/geometry.ts'
import { solveAssembly3D, validateAssembly3D } from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import { identityPose } from './fixtures.ts'
import type { Assembly3D } from '../../src/magnetic-tiles/three-d/assembly.ts'

const square = structuredClone(profiles[0])
const rectangle = (version: number, width = 2, height = 1) => parametricProfile({ id: 'custom', name: 'custom geometry',
  parameters: { shape: 'rectangle', dimensions: { width, height } }, connectableEdges: ['e0', 'e1', 'e2', 'e3'], estimated: false, source: 'test dimensions' }, version)

describe('versioned Profile → upstream geometry', () => {
  it('converts every shipped Profile without mutation or name matching', () => {
    const before = structuredClone(profiles)
    for (const p of profiles) {
      const adapted = adaptProfile({ profile: p, thickness: .05 })
      expect(adapted.shape.id).toBe(`${p.id}@${p.version}`)
      expect(adapted.shape.edges).toHaveLength(p.vertices.length)
      for (const [i, edge] of adapted.shape.edges.entries()) {
        const a = p.vertices[i], b = p.vertices[(i + 1) % p.vertices.length]
        expect(edge.edgeId).toBe(`e${i}`)
        expect(edge.length).toBeCloseTo(Math.hypot(b[0] - a[0], b[1] - a[1]), 12)
      }
    }
    expect(profiles).toEqual(before)
  })
  it('retains distinct versions, exact dimensions and an area centroid origin', () => {
    const a = rectangle(1), b = rectangle(2, 3, .7)
    a.name = b.name = 'square' // misleading display name must have no geometric effect
    const catalog = createShapeCatalog([{ profile: a, thickness: .04 }, { profile: b, thickness: .06 }])
    expect([...catalog.keys()]).toEqual(['custom@1', 'custom@2'])
    expect(catalog.get('custom@1')!.shape.edges[0].length).toBe(2)
    expect(catalog.get('custom@2')!.shape.edges[0].length).toBe(3)
    expect(catalog.get('custom@2')!.shape.edges[1].length).toBeCloseTo(.7)
    expect(catalog.get('custom@1')!.origin).toEqual([1, .5])
    const triangle: Profile = { id: 'arbitrary', version: 7, name: 'square', vertices: [[8, 10], [11, 10], [8, 12]], connectableEdges: ['e0'] }
    const tri = adaptProfile({ profile: triangle, thickness: .02, scale: 2 })
    expect(tri.origin[0]).toBeCloseTo(9); expect(tri.origin[1]).toBeCloseTo(10 + 2 / 3)
    expect(tri.shape.area).toBeCloseTo(12); expect(tri.shape.thickness).toBe(.04)
    expect(tri.shape.ports.map(p => p.portId)).toEqual(['e0-p0'])
  })
  it('reuses upstream ports for exact unequal sub-edge intervals', () => {
    const a = adaptProfile({ profile: rectangle(1), thickness: .05, ports: [{ edgeId: 'e0', ranges: [[0, .25], [.5, 1]] }] })
    const ports = a.shape.ports.filter(p => p.edgeId === 'e0')
    expect(ports.map(p => [p.portId, p.t0, p.t1, p.length])).toEqual([['e0-p0', 0, .25, .5], ['e0-p1', .5, 1, 1]])
    expect(ports[0].p0).toEqual({ x: -1, y: -.5 }); expect(ports[0].p1).toEqual({ x: -.5, y: -.5 })
    expect(ports[0].dir).toEqual({ x: 1, y: 0 })
  })
  it('does not use shared mutable catalog state', () => {
    const a = adaptProfile({ profile: square, thickness: .05 }); a.shape.vertices[0].x = 999
    expect(adaptProfile({ profile: square, thickness: .05 }).shape.vertices[0].x).toBe(-.5)
    expect(square.vertices[0]).toEqual([0, 0])
    expect(() => createShapeCatalog([{ profile: square, thickness: .05 }, { profile: square, thickness: .1 }])).toThrow(/Duplicate/)
  })
  for (const intervals of [[[.5, .7], [.6, 1]], [[-.1, .5]], [[0, 1.1]], [[.4, .4]], [[NaN, .5]]]) {
    it(`rejects invalid port ranges ${JSON.stringify(intervals)}`, () => {
      expect(() => adaptProfile({ profile: square, thickness: .05, ports: [{ edgeId: 'e0', ranges: intervals as [number, number][] }] })).toThrow()
    })
  }
  it('rejects disabled edges, malformed geometry, invalid scale/thickness and overflow', () => {
    const p = { ...square, connectableEdges: ['e0'] }
    expect(() => adaptProfile({ profile: p, thickness: .05, ports: [{ edgeId: 'e1', ranges: [[0, 1]] }] })).toThrow()
    expect(() => adaptProfile({ profile: { ...p, vertices: [[0, 0], [0, 1], [1, 0]] }, thickness: .05 })).toThrow()
    for (const n of [0, -1, Infinity, NaN]) {
      expect(() => adaptProfile({ profile: p, thickness: n })).toThrow()
      expect(() => adaptProfile({ profile: p, thickness: .05, scale: n })).toThrow()
    }
    expect(() => adaptProfile({ profile: p, thickness: .05, scale: 1e300 })).toThrow(/overflow/)
  })
  it('connects actual square and triangle Profile geometry in 3D', () => {
    const a: Assembly3D = { kind: 'magnetic-assembly-3d', schemaVersion: 1, id: 'mixed', revision: 0,
      profiles: [square, profiles.find(p => p.id === 'right-triangle')!].map(profile => ({ profile: structuredClone(profile), thickness: .05 })),
      pieces: [{ id: 'a', profileId: 'square', profileVersion: 1, pose: identityPose() },
        { id: 'b', profileId: 'right-triangle', profileVersion: 1, pose: identityPose() }],
      connections: [{ pieceA: 'a', portA: 'e0-p0', pieceB: 'b', portB: 'e0-p0', dihedralDeg: 90 }] }
    const solved = solveAssembly3D(a)
    expect(validateAssembly3D(solved)).toEqual({ valid: true, issues: [] })
    const nested = structuredClone(a); nested.connections[0].dihedralDeg = 0
    // Different centroids: upstream's "complete overlap" shortcut misses this;
    // the general connected-seam exemption must not hide coplanar nesting.
    expect(validateAssembly3D(solveAssembly3D(nested)).issues.some(i => i.code === 'intersection')).toBe(true)
    // Same shape label at version 2 but incompatible actual edge length must fail.
    const larger = { ...square, version: 2, vertices: square.vertices.map(v => [v[0] * 2, v[1] * 2]) as [number, number][] }
    a.profiles.push({ profile: larger, thickness: .05 }); a.pieces[0].profileVersion = 2
    expect(validateAssembly3D(solveAssembly3D(a)).issues.some(i => i.code === 'port-length')).toBe(true)
  })
  it('connects two short pieces to two disjoint ports on a long edge', () => {
    const a: Assembly3D = { kind: 'magnetic-assembly-3d', schemaVersion: 1, id: 'ports', revision: 0,
      profiles: [{ profile: rectangle(1), thickness: .05, ports: [{ edgeId: 'e0', ranges: [[0, .5], [.5, 1]] }] }, { profile: square, thickness: .05 }],
      pieces: [{ id: 'root', profileId: 'custom', profileVersion: 1, pose: identityPose() },
        ...['a', 'b'].map(id => ({ id, profileId: 'square', profileVersion: 1, pose: identityPose() }))],
      connections: ['a', 'b'].map((id, i) => ({ pieceA: 'root', portA: `e0-p${i}`, pieceB: id, portB: 'e2-p0', dihedralDeg: 0, flip: true })) }
    expect(validateAssembly3D(solveAssembly3D(a, ['root']))).toEqual({ valid: true, issues: [] })
  })
})

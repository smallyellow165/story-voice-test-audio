import { profileIssues } from '../geometry.ts'
import type { Profile, Vec } from '../geometry.ts'
import { makeShape } from './vendor/engine/shapes.ts'
import type { ShapeDef } from './vendor/engine/types.ts'

export type PortLayout = { edgeId: string; ranges: [number, number][] }
/** All dimensions, including thickness, are in Profile units before scale. */
export type ProfileSnapshot3D = { profile: Profile; thickness: number; scale?: number; ports?: PortLayout[] }
export type AdaptedProfile = { key: string; shape: ShapeDef; origin: Vec; scale: number }
export const profileKey3D = (p: Pick<Profile, 'id' | 'version'>) => `${p.id}@${p.version}`

/** Does not match shape names, mutate the registry, or register global shapes. */
export function adaptProfile(snapshot: ProfileSnapshot3D): AdaptedProfile {
  const p = snapshot?.profile
  if (profileIssues(p).length) throw Error('Invalid 3D Profile geometry or version')
  const scale = snapshot.scale === undefined ? 1 : snapshot.scale
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(snapshot.thickness) || snapshot.thickness <= 0) {
    throw Error('3D scale and thickness must be finite positive numbers')
  }
  // Polygon area centroid; the upstream stability heuristic treats local origin as COM.
  let twiceArea = 0, cx = 0, cy = 0
  p.vertices.forEach((a, i) => {
    const b = p.vertices[(i + 1) % p.vertices.length], cross = a[0] * b[1] - b[0] * a[1]
    twiceArea += cross; cx += (a[0] + b[0]) * cross; cy += (a[1] + b[1]) * cross
  })
  const origin: Vec = [cx / (3 * twiceArea), cy / (3 * twiceArea)]
  const portRanges: Record<string, readonly [number, number][]> = Object.create(null)
  if (snapshot.ports !== undefined && !Array.isArray(snapshot.ports)) throw Error('Invalid 3D port layout')
  for (const layout of snapshot.ports ?? []) {
    if (!layout || !p.connectableEdges.includes(layout.edgeId) || Object.hasOwn(portRanges, layout.edgeId) || !Array.isArray(layout.ranges)) {
      throw Error('Duplicate or non-connectable 3D port edge')
    }
    let end = 0
    for (const r of layout.ranges) {
      if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite) || r[0] < end || r[1] > 1 || r[1] <= r[0]) {
        throw Error('Port intervals must be ordered, disjoint and within [0,1]')
      }
      end = r[1]
    }
    portRanges[layout.edgeId] = structuredClone(layout.ranges)
  }
  const key = profileKey3D(p)
  const shape = makeShape(key, p.vertices.map(v => ({ x: (v[0] - origin[0]) * scale, y: (v[1] - origin[1]) * scale })),
    snapshot.thickness * scale, Math.max(...p.vertices.map((a, i) => {
      const b = p.vertices[(i + 1) % p.vertices.length]
      return Math.hypot(a[0] - b[0], a[1] - b[1]) * scale
    })), { portRanges })
  shape.ports = shape.ports.filter(port => p.connectableEdges.includes(port.edgeId))
  if (![shape.area, shape.thickness, shape.defaultSize, ...shape.vertices.flatMap(v => [v.x, v.y])].every(Number.isFinite) || shape.area <= 0) {
    throw Error('3D Profile dimensions overflow')
  }
  return { key, shape, origin, scale }
}

export function createShapeCatalog(snapshots: readonly ProfileSnapshot3D[]): ReadonlyMap<string, AdaptedProfile> {
  const result = new Map<string, AdaptedProfile>()
  for (const snapshot of snapshots) {
    const adapted = adaptProfile(snapshot)
    if (result.has(adapted.key)) throw Error(`Duplicate 3D Profile ${adapted.key}`)
    result.set(adapted.key, adapted)
  }
  return result
}

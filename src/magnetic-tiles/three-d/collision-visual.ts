import { Box3, Vector3 } from 'three'
import { ConvexHull } from 'three/addons/math/ConvexHull.js'
import type { inspectAssemblyCollisions } from './engine-adapter.ts'

export type CollisionEvidence = ReturnType<typeof inspectAssemblyCollisions>[number]
type Point = [number, number, number]
export type CollisionVisual = {
  key: string; sourceKey: string; evidence: CollisionEvidence
  kind: 'volume' | 'approximate' | 'unavailable'; reason: string
  origin: Point; positions: number[]; vertices: Point[]; volume: number
  center: Point | null; bounds: { min: Point; max: Point } | null
}
export const collisionPairKey = (ids: readonly string[]) => JSON.stringify([...ids].sort())
export const collisionLocality = (value: string) => ({
  'near-shared-vertex': '公共顶点附近交叠', 'near-shared-edge': '公共边附近交叠',
  'non-contact-penetration': '非接合区域实体穿透', unresolved: '接点关系未确定',
}[value] ?? value)

/** Presentation only: hull of the EXISTING exact convex-prism intersection vertices.
 * No SAT, tolerance, connection exemption, Pose or validation result is changed.
 * Every convex-polytope intersection vertex is an included original vertex or
 * edge/face crossing, already enumerated by inspectCollisionPair.
 */
export function collisionVisual(evidence: CollisionEvidence, sourceKey: string): CollisionVisual {
  const points = evidence.intersectionVertices.filter(p => p.length === 3 && p.every(Number.isFinite)).map(p => new Vector3(...p as Point))
  const region = evidence.region
  const box = points.length ? new Box3().setFromPoints(points) : region && [...region.min, ...region.max].every(Number.isFinite)
    ? new Box3(new Vector3(...region.min as Point), new Vector3(...region.max as Point)) : null
  const origin = box?.getCenter(new Vector3()) ?? new Vector3()
  const base: CollisionVisual = {
    key: collisionPairKey(evidence.pieceIds), sourceKey, evidence,
    kind: box ? 'approximate' : 'unavailable', reason: box ? 'Approximate：仅显示交集顶点的包围范围，未构成可靠体积。' : '没有可靠的交集空间坐标。',
    origin: origin.toArray(), positions: [], vertices: points.map(p => p.toArray()), volume: 0,
    center: box ? origin.toArray() : null, bounds: box ? { min: box.min.toArray(), max: box.max.toArray() } : null,
  }
  if (!box || points.length < 4) return base
  const local = points.map(p => p.clone().sub(origin)), scale = box.getSize(new Vector3()).length()
  // Rank checks keep zero-volume / ill-conditioned evidence out of QuickHull.
  const a = local[0], b = local.reduce((p, q) => q.distanceToSquared(a) > p.distanceToSquared(a) ? q : p)
  const edge = b.clone().sub(a)
  const c = local.reduce((p, q) => q.clone().sub(a).cross(edge).lengthSq() > p.clone().sub(a).cross(edge).lengthSq() ? q : p)
  const normal = edge.clone().cross(c.clone().sub(a))
  if (normal.length() <= scale * scale * 1e-10) return base
  normal.normalize()
  if (Math.max(...local.map(p => Math.abs(p.clone().sub(a).dot(normal)))) <= scale * 1e-10) return base
  try {
    const hull = new ConvexHull().setFromPoints(local), positions: number[] = []
    let volume = 0
    const centroid = new Vector3()
    for (const face of hull.faces) {
      const vertices: Vector3[] = [], first = face.edge
      let e = first
      do { vertices.push(e.head().point); e = e.next } while (e !== first)
      for (let i = 1; i + 1 < vertices.length; i++) {
        const [p, q, r] = [vertices[0], vertices[i], vertices[i + 1]]
        positions.push(...p.toArray(), ...q.toArray(), ...r.toArray())
        const v = p.dot(q.clone().cross(r)) / 6
        volume += v; centroid.add(p.clone().add(q).add(r).multiplyScalar(v / 4))
      }
    }
    if (!Number.isFinite(volume) || volume <= Math.pow(scale, 3) * 1e-12) return base
    return { ...base, kind: 'volume', reason: 'Collision Geometry：当前完整厚度凸棱柱的真实交集；透视显示，不是 Viewer 装饰网格。',
      positions, volume, center: centroid.divideScalar(volume).add(origin).toArray() }
  } catch { return base }
}

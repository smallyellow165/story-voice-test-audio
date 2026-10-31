// Local patch to the MIT upstream engine; see third_party/3D_Magnetic_Pieces/PATCHES.md.
import type { ShapeDef, Vec2 } from './types.ts'

/** Inscribed polygon approximation, at most pi/32 radians per arc segment.
 * Shared by SAT and ground/planarity checks; straight polygons remain exact.
 */
export function shapeOutline(shape: ShapeDef): Vec2[] {
  if (!shape.edges.some(e => e.isCurved)) return shape.vertices
  const points: Vec2[] = []
  for (const e of shape.edges) {
    points.push(e.v0)
    if (!e.isCurved) continue
    if (!e.center || !Number.isFinite(e.radius) || e.radius! <= 0 ||
        !Number.isFinite(e.startAngle) || !Number.isFinite(e.endAngle)) {
      throw Error(`Invalid arc in ${shape.id}:${e.edgeId}`)
    }
    const delta = e.endAngle! - e.startAngle!
    const count = Math.ceil(Math.abs(delta) / (Math.PI / 32))
    for (let i = 1; i < count; i++) {
      const a = e.startAngle! + delta * i / count
      points.push({ x: e.center.x + e.radius! * Math.cos(a), y: e.center.y + e.radius! * Math.sin(a) })
    }
  }
  return points
}

// LDraw units throughout. Local origin is the body bottom centre, +Y up.
// Collision envelopes exclude mating studs/cavities and are conservative, not mesh solids.
export const STUD_LDU = 40
export const BODY_LDU = 48 // coordinate unit, NOT every part's height
export const MM_PER_LDU = 0.4
export const ROTATIONS: readonly number[] = [0, 90, 180, 270]
export type Point3 = { x: number; y: number; z: number }
export type Box3 = { min: Point3; max: Point3 }
export type Connector = Point3 & { type: 'duplo-stud'; direction: 'up' | 'down'; radiusLdu: number; depthLdu: number }
export type PartGeometry = {
  family: 'rectangular-duplo' | 'explicit-duplo'
  status: 'reviewed' | 'unknown'
  bodySizeLdu: Point3
  outerBoundsLdu: Box3 | null // mesh envelope incl. studs; never inferred from footprint
  collision: { kind: 'conservative-boxes'; boxes: Box3[] }
  top: Connector[]; bottom: Connector[]
  rotations: readonly number[]
  placement: 'upright'
  // Apply Rx(PI), then this translation, to the original referenced LDraw entry.
  ldraw: { rotationX: number; offsetLdu: Point3 }
  evidence: string[]
  unknown: string[]
}
export type PartDefinition = { id: string; label: string; length: number; depth: number; geometry: PartGeometry }

// Only use for a reviewed ordinary brick with a full rectangular interface.
// Calling this is an explicit capability declaration, never automatic DAT/name inference.
export function rectangularGeometry(width: number, depth: number, heightLdu: number, evidence: string[]): PartGeometry {
  if (![width, depth, heightLdu].every(n => Number.isSafeInteger(n) && n > 0)
    || heightLdu < 11 || width > 32 || depth > 32 || heightLdu > 1024 || !evidence.length) throw new Error('Invalid reviewed rectangular profile')
  const top: Connector[] = [], bottom: Connector[] = []
  for (let i = 0; i < width; i++) for (let j = 0; j < depth; j++) {
    const x = (i - (width - 1) / 2) * STUD_LDU, z = (j - (depth - 1) / 2) * STUD_LDU
    top.push({ x, y: heightLdu, z, type: 'duplo-stud', direction: 'up', radiusLdu: 12, depthLdu: 11 })
    bottom.push({ x, y: 0, z, type: 'duplo-stud', direction: 'down', radiusLdu: 12, depthLdu: 11 })
  }
  return { family: 'rectangular-duplo', status: 'reviewed', bodySizeLdu: { x: width * STUD_LDU, y: heightLdu, z: depth * STUD_LDU },
    outerBoundsLdu: null, collision: { kind: 'conservative-boxes', boxes: [{ min: { x: -width * STUD_LDU / 2, y: 0, z: -depth * STUD_LDU / 2 },
      max: { x: width * STUD_LDU / 2, y: heightLdu, z: depth * STUD_LDU / 2 } }] },
    top, bottom, rotations: ROTATIONS, placement: 'upright',
    ldraw: { rotationX: Math.PI, offsetLdu: { x: 0, y: heightLdu, z: 0 } },
    evidence: [...evidence, 'p/stud7.dat: radius 12, height 4 scaled by 2.75 = 11 LDU; nominal standard DUPLO mating clearance contract'],
    unknown: ['Physical stability, clutch force and safety are not certified', 'Outer mesh bounds are not connector bounds'] }
}

export function geometryIssues(g: PartGeometry): string[] {
  const errors: string[] = []
  const finite = (p: Point3) => p && [p.x, p.y, p.z].every(n => Number.isFinite(n) && Math.abs(n) <= 100000)
  if (!['rectangular-duplo', 'explicit-duplo'].includes(g.family)) errors.push('未知几何族')
  if (g.status !== 'reviewed' || !g.evidence.length) errors.push('几何/连接能力未经审核')
  if (!Number.isSafeInteger(g.bodySizeLdu.y) || !finite(g.bodySizeLdu) || [g.bodySizeLdu.x, g.bodySizeLdu.y, g.bodySizeLdu.z].some(n => n <= 0)) errors.push('零件尺寸无效')
  if (g.placement !== 'upright' || !g.rotations.length || g.rotations.some(r => !ROTATIONS.includes(r))) errors.push('仅支持已声明的直立直角旋转')
  if (!g.collision.boxes.length || g.collision.boxes.some(b => !finite(b.min) || !finite(b.max)
    || b.max.x <= b.min.x || b.max.y <= b.min.y || b.max.z <= b.min.z || b.min.y < 0 || b.max.y > g.bodySizeLdu.y)) errors.push('碰撞包络无效')
  // V2 only supports planar, vertical mating interfaces; other families stay unknown.
  for (const [points, direction, y] of [[g.top, 'up', g.bodySizeLdu.y], [g.bottom, 'down', 0]] as const) {
    const seen = new Set<string>()
    for (const p of points) {
      const key = [p.x, p.y, p.z].join(',')
      if (!Number.isInteger(p.x / (STUD_LDU / 2)) || !Number.isInteger(p.z / (STUD_LDU / 2)) || !Number.isInteger(p.y)
        || !Number.isFinite(p.radiusLdu) || p.radiusLdu <= 0 || !Number.isFinite(p.depthLdu) || p.depthLdu <= 0
        || (direction === 'down' && p.depthLdu > g.bodySizeLdu.y) || !finite(p) || p.type !== 'duplo-stud' || p.direction !== direction || p.y !== y || seen.has(key)
        || Math.abs(p.x) > g.bodySizeLdu.x / 2 || Math.abs(p.z) > g.bodySizeLdu.z / 2) errors.push('连接点位置、方向、类型或重复点无效')
      if (!g.collision.boxes.some(b => p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z
        && (direction === 'up' ? b.max.y === p.y : b.min.y === p.y))) errors.push('连接点没有相应的实体接触面')
      seen.add(key)
    }
  }
  if (!g.bottom.length) errors.push('底部连接能力未知')
  if (!finite(g.ldraw.offsetLdu) || g.ldraw.rotationX !== Math.PI) errors.push('LDraw 局部坐标变换未支持')
  return errors
}
export function onGrid(value: number, units: number) {
  return Number.isFinite(value) && Math.abs(value) <= 1_000_000 && Math.abs(value * units - Math.round(value * units)) < 1e-7
}
export function validPosition(b: { x: number; z: number; layer: number }) {
  return onGrid(b.x, 2) && onGrid(b.z, 2) && onGrid(b.layer, BODY_LDU) && b.layer >= 0
}

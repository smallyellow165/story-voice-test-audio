import { rectangularGeometry, geometryIssues } from './part-geometry.ts'
import type { PartDefinition } from './part-geometry.ts'
export { STUD_LDU, BODY_LDU, MM_PER_LDU, ROTATIONS, validPosition } from './part-geometry.ts'

// Reviewed data profiles, not per-part assembly algorithms. Unknown parts stay excluded.
export const PARTS: readonly PartDefinition[] = [
  { id: '3437', label: '2 × 2', length: 2, depth: 2, geometry: rectangularGeometry(2, 2, 48,
    ['parts/3437.dat: body +/-40, y=0..48', 'parts/s/3437s01.dat: stug7-2x2, underside tube/ribs; existing standard DUPLO interface contract']) },
  { id: '3011', label: '2 × 4', length: 4, depth: 2, geometry: rectangularGeometry(4, 2, 48,
    ['parts/3011.dat: body +/-80, +/-40, y=0..48', 'parts/s/3011s01.dat: two stug7-2x2 at x=+/-40; existing standard DUPLO interface contract']) },
  { id: '2300', label: '2 × 6', length: 6, depth: 2, geometry: rectangularGeometry(6, 2, 48,
    ['parts/2300.dat: body +/-120, +/-40, y=0..48; twelve stud7 placements; underside tubes/ribs; existing standard DUPLO interface contract']) },
]
export function geometrySupport(part: string) {
  const definition = PARTS.find(p => p.id === part)
  const reasons = definition ? geometryIssues(definition.geometry) : ['缺少经审核的几何、碰撞包络和连接点描述；LDraw 文件存在不代表拼装能力已知']
  return { supported: reasons.length === 0, reasons, geometry: definition?.geometry || null }
}

// Standard LDraw codes; the actual materials come from LDConfig.ldr.
export const COLORS = [
  { code: '4', label: '红色' },
  { code: '1', label: '蓝色' },
  { code: '14', label: '黄色' },
  { code: '2', label: '绿色' },
  { code: '15', label: '白色' },
  { code: '0', label: '黑色' },
] as const

export type Brick = {
  id: string
  part: string
  color: string
  x: number // DUPLO stud pitches; position is the brick body's center in X/Z.
  z: number
  layer: number // Bottom elevation in 48 LDU units; V2 accepts integral LDU heights.
  rotation: number // Degrees about world +Y.
}


export function exampleBricks(): Brick[] {
  return [
    { id: crypto.randomUUID(), part: '2300', color: '1', x: 0, z: 0, layer: 0, rotation: 0 },
    { id: crypto.randomUUID(), part: '3011', color: '14', x: -1, z: 0, layer: 1, rotation: 0 },
    { id: crypto.randomUUID(), part: '3437', color: '4', x: 2, z: 0, layer: 1, rotation: 0 },
    { id: crypto.randomUUID(), part: '3437', color: '2', x: -2, z: 0, layer: 2, rotation: 0 },
  ]
}

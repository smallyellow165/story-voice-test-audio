import { rectangularGeometry, reviewedRectangularPart, geometryIssues } from './part-geometry.ts'
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
  reviewedRectangularPart({
    id: '87084', label: '2 × 3', width: 3, depth: 2, heightLdu: 48,
    evidence: [
      'parts/87084.dat: outer box5 at (0,48,0), scale (60,-48,40); body 120×48×80 LDU',
      'Top: stug7-2x2 at x=20 plus stud7 at (-40,0,+/-20); six studs at x=-40,0,40 and z=+/-20, y scale=2.75',
      'Bottom: inverted inner box5 (56,-44,36), tubes stud8 at x=+/-20, y=4, y scale=-10, plus perimeter ribs; reviewed full standard rectangular mating interface',
      'Source-reviewed nominal standard interface; conservative solid body envelope, not a mesh-solid collision model',
    ],
    sourceFiles: [
      { path: 'parts/87084.dat', sha256: '6d71b352e8e296b0b2d306955174306e3c75675631fd9edc97d0af5050d73d00' },
      { path: 'p/stud7.dat', sha256: '250111864bb2492a8722544d1f09b5e45672ba3f8e93be769b77499e7ea3fb1a' },
      { path: 'p/stug7-2x2.dat', sha256: '409fe27186afedd30d6b65e83063fba99380218d4067a4b0359e4250911726ca' },
      { path: 'p/stud8.dat', sha256: '1a3202bf2d8dd8f58f59d09e220cb62f3411db762f88333a82503ab395f9d115' },
      { path: 'p/box5.dat', sha256: 'ccb7b8a1d36692335b10ea6aa196849afcad4b15331683ed8112a10b50977318' },
    ],
  }),
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

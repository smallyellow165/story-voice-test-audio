import { rectangularGeometry, reviewedRectangularPart, geometryIssues } from './part-geometry.ts'
import type { PartDefinition } from './part-geometry.ts'
export { STUD_LDU, BODY_LDU, MM_PER_LDU, ROTATIONS, validPosition } from './part-geometry.ts'

// Reviewed 2302 entry includes the official MOVED transform to 2302b.
// Coordinates below are in body-bottom-centred space, not 2302b's origin.
const curve2302 = [[20,48], ...[
  [.2588,.9659],[.3827,.9239],[.5,.866],[.6088,.7934],[.7071,.7071],
  [.7934,.6088],[.866,.5],[.9239,.3827],[.9659,.2588],[.9914,.1305],[1,0],
].map(([cos,sin]) => [12+48*cos,48.8*sin])]
const curved2302: PartDefinition = {
  id:'2302', label:'2 × 3 · 弧形顶', length:3, depth:2,
  geometry:{
    family:'explicit-duplo',status:'reviewed',bodySizeLdu:{x:120,y:48,z:80},
    outerBoundsLdu:{min:{x:-60,y:0,z:-40},max:{x:60,y:59,z:40}},
    collision:{kind:'conservative-boxes',boxes:[
      {min:{x:-60,y:0,z:-40},max:{x:20,y:48,z:40}},
      ...curve2302.slice(0,-1).map(([x,y],i)=>({min:{x,y:0,z:-40},max:{x:curve2302[i+1][0],y:Math.min(48,y+0.001),z:40}})),
    ]},
    top:[-40,0].flatMap(x=>[-20,20].map(z=>({x,y:48,z,type:'duplo-stud' as const,direction:'up' as const,radiusLdu:12,depthLdu:11}))),
    bottom:[-40,0,40].flatMap(x=>[-20,20].map(z=>({x,y:0,z,type:'duplo-stud' as const,direction:'down' as const,radiusLdu:12,depthLdu:11}))),
    rotations:[0,90,180,270],placement:'upright',ldraw:{rotationX:Math.PI,offsetLdu:{x:-20,y:48,z:0}},
    sourceFiles: [
      {
            "path": "parts/2302.dat",
            "sha256": "55bb72e90e277c9a266429703722e100f1fe3a52c0dfb68e46b12140dd6d32fa"
      },
      {
            "path": "parts/2302b.dat",
            "sha256": "91d7d0849a274a941ced1dae11e484baa06c2228ba369c292fb9999f28959ffa"
      },
      {
            "path": "parts/s/2302s01.dat",
            "sha256": "49adedd781138cf39c7d78e5eb30c6d470f48251dc294a0449314970e39e6c64"
      },
      {
            "path": "p/48/5-24cyli.dat",
            "sha256": "32b15a6570d6f5534a620e667a26b86298596ed9d064a0a9b1886d413c345658"
      },
      {
            "path": "p/stug7-2x2.dat",
            "sha256": "409fe27186afedd30d6b65e83063fba99380218d4067a4b0359e4250911726ca"
      },
      {
            "path": "p/stud7.dat",
            "sha256": "250111864bb2492a8722544d1f09b5e45672ba3f8e93be769b77499e7ea3fb1a"
      },
      {
            "path": "p/stud8.dat",
            "sha256": "1a3202bf2d8dd8f58f59d09e220cb62f3411db762f88333a82503ab395f9d115"
      },
      {
            "path": "p/stud8a.dat",
            "sha256": "291cbfdb54441d6457a3e17155a8741cc8424a01f8e9b99a7c9a015085aacfb9"
      }
],
    evidence:[
      '2302.dat maps to 2302b using (x,y,z)=(-z_b,y_b,x_b). Entry body x=-40..80; shift x=-20 after Rx(PI) to centre its bottom footprint.',
      '2302b outer curve: x=12+48*cos(theta), y=48.8*sin(theta), theta=0..75 degrees; exact rounded vertices of 48/5-24cyli plus flat join (20,48). Each interval uses its maximum height, conservatively enclosing the actual facets, with 0.001 LDU allowance for rounded side-face vertices.',
      '2302s01: stug7-2x2 gives four top studs at x=-40,0/z=+/-20. Two underside tubes stud8/stud8a and six perimeter rib positions define six nominal sockets x=-40,0,40/z=+/-20; no studs on the curved nose.',
    ],
    unknown:['Conservative stair envelopes may reject near-curve clearance; no mesh-solid collision or physical stability certification.'],
  },
}
if (geometryIssues(curved2302.geometry).length) throw new Error('Invalid 2302 profile')

// Reviewed data profiles, not per-part assembly algorithms. Unknown parts stay excluded.
export const PARTS: readonly PartDefinition[] = [
  curved2302,
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
  // The official RB mapping supplies this ID; no RB identity is inferred here.
  // Type 2 / Type 3 retain their mappings but are not declared interchangeable profiles.
  reviewedRectangularPart({
    "id": "4066a",
    "label": "2 × 1 × 2 · 高砖 Type 1",
    "width": 2,
    "depth": 1,
    "heightLdu": 96,
    "evidence": [
      "parts/4066a.dat front face: x=-40..40, z=-20, y=0..96; subpart outer side faces at z=+20. Body 80×96×40 LDU, not stud-inclusive mesh bounds.",
      "parts/s/4066as01.dat: stud7 at x=+/-20,z=0 scaled y=2.75; two top interfaces. Inverted inner box at y=96 with half extents36,16 and depth92; perimeter ribs at x=+/-20,z=+/-14 and x=+/-34,z=0 define the standard two bottom mating positions.",
      "Central web separates the two sockets; nominal upright rectangular DUPLO interface only. LDraw y down becomes body-bottom-centred y up via Rx(PI) and +96 LDU."
    ],
    "sourceFiles": [
      {
        "path": "parts/4066a.dat",
        "sha256": "8b17100233c383e8ddb401581a6de2e71fc6385cc2641e79c3254685325e0eea"
      },
      {
        "path": "parts/s/4066as01.dat",
        "sha256": "79424087f5ef65608ab56995a6cb2f21f254214074f80410d54d7abdb610dc86"
      },
      {
        "path": "p/stud7.dat",
        "sha256": "250111864bb2492a8722544d1f09b5e45672ba3f8e93be769b77499e7ea3fb1a"
      },
      {
        "path": "p/box5.dat",
        "sha256": "ccb7b8a1d36692335b10ea6aa196849afcad4b15331683ed8112a10b50977318"
      },
      {
        "path": "p/box4-1.dat",
        "sha256": "2ed58df5da841827dfc5f9ac11c0bd7ffd8a455e46f166638e635f61a014b44d"
      },
      {
        "path": "p/rect.dat",
        "sha256": "ffeb2dd3d9b83c38841f18f1f74800fbba9e90c5fb6badfff2a795f08a96cb71"
      }
    ]
  }),
  reviewedRectangularPart({
    "id": "40666",
    "label": "4 × 2 × 0.5 · 薄件",
    "width": 4,
    "depth": 2,
    "heightLdu": 24,
    "evidence": [
      "parts/40666.dat: outer box5 at (0,24,0), scale(80,-24,40); body160×24×80 LDU. Inverted cavity scale(76,-20,36), leaving4 LDU roof.",
      "Eight stud7 placements at x=-60,-20,20,60 and z=+/-20, scale y=2.75. Three underside stud8 tubes at x=-40,0,40,y=4,scale y=-4 plus perimeter ribs; nominal full eight-position rectangular mating interface.",
      "Plate height is 24/48=0.5 brick units. Same 11 LDU stud engagement contract; no LEGO System plate conversion."
    ],
    "sourceFiles": [
      {
        "path": "parts/40666.dat",
        "sha256": "e0e7ca7963e4ca161bb180e6345761f726d526e38f9f1fc7505541a557e34be5"
      },
      {
        "path": "p/stud7.dat",
        "sha256": "250111864bb2492a8722544d1f09b5e45672ba3f8e93be769b77499e7ea3fb1a"
      },
      {
        "path": "p/stud8.dat",
        "sha256": "1a3202bf2d8dd8f58f59d09e220cb62f3411db762f88333a82503ab395f9d115"
      },
      {
        "path": "p/box5.dat",
        "sha256": "ccb7b8a1d36692335b10ea6aa196849afcad4b15331683ed8112a10b50977318"
      },
      {
        "path": "p/box4-1.dat",
        "sha256": "2ed58df5da841827dfc5f9ac11c0bd7ffd8a455e46f166638e635f61a014b44d"
      }
    ]
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

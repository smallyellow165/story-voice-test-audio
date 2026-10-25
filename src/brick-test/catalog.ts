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

// 98224: retain the official entry and its MOVED rotation. The full top and central
// planar 2x2 bottom interfaces are certified; recessed end cavities are not sockets.
// Outer curve vertices are from 98224b/s98252bs01, transformed to +Y-up.
const curve98224 = [[40,0], [45.1636,48-46.653], [50.9869,48-44.6244],
  [56.5,48-41.8278], [61.6136,48-38.3212], [66.2337,48-34.1529],
  ...[[.7934,.6088],[.866,.5],[.9239,.3827],[.9659,.2588],[.9914,.1305],[1,0]]
    .map(([cos,sin])=>[33+47*cos,48-48.3*sin])]
const curved98224: PartDefinition = {
  id:'98224',label:'2 × 4 · 弧形底（底部中央 2×2 接口）',length:4,depth:2,
  geometry:{
    family:'explicit-duplo',status:'reviewed',bodySizeLdu:{x:160,y:48,z:80},
    outerBoundsLdu:{min:{x:-80,y:0,z:-40},max:{x:80,y:59,z:40}},
    collision:{kind:'conservative-boxes',boxes:[
      {min:{x:-40,y:0,z:-40},max:{x:40,y:48,z:40}},
      ...curve98224.slice(0,-1).flatMap(([x,y],i)=>{
        const next=curve98224[i+1][0],floor=Math.max(0,y-0.001)
        return [{min:{x,y:floor,z:-40},max:{x:next,y:48,z:40}},
          {min:{x:-next,y:floor,z:-40},max:{x:-x,y:48,z:40}}]
      }),
    ]},
    top:[-60,-20,20,60].flatMap(x=>[-20,20].map(z=>({x,y:48,z,type:'duplo-stud' as const,direction:'up' as const,radiusLdu:12,depthLdu:11}))),
    bottom:[-20,20].flatMap(x=>[-20,20].map(z=>({x,y:0,z,type:'duplo-stud' as const,direction:'down' as const,radiusLdu:12,depthLdu:11}))),
    rotations:[0,90,180,270],placement:'upright',ldraw:{rotationX:Math.PI,offsetLdu:{x:0,y:48,z:0}},
    sourceFiles:[
      {
            "path": "parts/98224.dat",
            "sha256": "5db274e006b237ddbe426cf1105d04c06bb2c06789ef67642308fcf34a6f39ef"
      },
      {
            "path": "parts/98224b.dat",
            "sha256": "dec35e6f86a5acd25a877a9f7dd4a170a59949a0c1e24ede1f18be265941d274"
      },
      {
            "path": "parts/s/98224s01.dat",
            "sha256": "23ef20d697066a82df21a28d7f8a387394ef8f8542f2fa851a042076715ad797"
      },
      {
            "path": "parts/s/98252bs01.dat",
            "sha256": "e106b4d76180e3358b5b4d28fa4a2760c03cb63a3bb5e24cb95548e4f48157fa"
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
            "path": "p/box5.dat",
            "sha256": "ccb7b8a1d36692335b10ea6aa196849afcad4b15331683ed8112a10b50977318"
      },
      {
            "path": "p/box4-1.dat",
            "sha256": "2ed58df5da841827dfc5f9ac11c0bd7ffd8a455e46f166638e635f61a014b44d"
      },
      {
            "path": "p/48/1-8cylo.dat",
            "sha256": "bc5df94184d568c4b032959d7ec8fb138adc17acf14d8f9b4d41b69e96bc9f5f"
      },
      {
            "path": "p/48/1-8cyli.dat",
            "sha256": "494069ca353e41885bf8f5b6b3ddc9b62aabeca3eedfe6aa5597ac8f12ca12b9"
      },
      {
            "path": "p/48/1-8chrd.dat",
            "sha256": "282b0d7dd4e73d273b9cbcce88e30889cce3b44aa8574a25382fe526248d5426"
      }
],
    evidence:[
      '98224.dat MOVED: (x,y,z)=(z_b,y_b,-x_b); Viewer Rx(PI)+[0,48,0] gives (z_b,48-y_b,x_b). Body 160x48x80 LDU, curve at both X ends.',
      '98224s01 stug7-2x2 scaled Y=2.75: four top stud7 at +/-20, y=0 in LDraw; top contact y=48, stud height=11 in assembly.',
      '98252bs01 stud7a at b x=+/-20,z=-60,y=25, scale Y=9: primitive rim y=-4 maps to y=-11. Mirrored end gives four additional top studs at entry x=+/-60,z=+/-20. Their extended shafts descend inside the body; nominal exposed mating height remains 11 LDU.',
      'Central inverted box5 at y=48, extent +/-36, depth44; stud8 tube and eight perimeter ribs at +/-34 confirm central four standard bottom mating cells at x/z=+/-20. These are socket engagement cells, not four separate tube primitives.',
      'Curve enclosure uses maximum solid extent per official facet interval on both ends, rounded outward 0.001 LDU. It excludes the large empty volume below each raised end; no ordinary 2x4 box substitution.',
    ],
    unknown:[
      'Recessed end structures at b z=+/-60 are not certified mating interfaces; no off-plane connections are exposed.',
      'Conservative facet-step envelopes can reject close curve clearances and recessed-cavity insertions; not exact mesh-solid collision.',
      'Nominal DUPLO connector contract only; physical stability, clutch force and manufacturing clearance are not certified.',
    ],
  },
}
if (geometryIssues(curved98224.geometry).length) throw new Error('Invalid 98224 profile')

// 11170 official entry has an offset footprint and only TWO top studs.
// The reviewed facet steps enclose its curved front; they are not a box substitute.
const front11170 = [[0,72], ...[
  [.6088,.7934],[.7071,.7071],[.7934,.6088],[.866,.5],
  [.9239,.3827],[.9659,.2588],[.9914,.1305],[1,0],
].map(([cos,sin])=>[80*cos-40,2.72+80*sin])]
const curved11170: PartDefinition = {
  id:'11170',label:'2 × 2 × 1.5 · 弧形前面（顶部 2 凸点）',length:2,depth:2,
  geometry:{
    family:'explicit-duplo',status:'reviewed',bodySizeLdu:{x:80,y:72,z:80},
    outerBoundsLdu:{min:{x:-40,y:0,z:-40},max:{x:40,y:83,z:40}},
    collision:{kind:'conservative-boxes',boxes:[
      {min:{x:-40,y:0,z:-40},max:{x:40,y:72,z:0.003}},
      ...front11170.slice(0,-1).map(([z,h],i)=>({min:{x:-40,y:0,z:Math.max(0,z-0.003)},
        max:{x:40,y:Math.min(72,h+0.003),z:Math.min(40,front11170[i+1][0]+0.003)}})),
    ]},
    top:[-20,20].map(x=>({x,y:72,z:-20,type:'duplo-stud' as const,direction:'up' as const,radiusLdu:12,depthLdu:11})),
    bottom:[-20,20].flatMap(x=>[-20,20].map(z=>({x,y:0,z,type:'duplo-stud' as const,direction:'down' as const,radiusLdu:12,depthLdu:11}))),
    rotations:[0,90,180,270],placement:'upright',ldraw:{rotationX:Math.PI,offsetLdu:{x:0,y:72,z:-20}},
    sourceFiles:[
      {"path":"parts/11170.dat","sha256":"c6d4b41ff27a20b31aa79649b75c125c1768e95b76bcbc9ace64c25408971f98"},
      {"path":"p/48/1-6cyli.dat","sha256":"e6acc0794a9b5e6bd2a0e59fa408903077d97179e8bb5dbd7f57c2dc30042e9c"},
      {"path":"parts/s/11170s01.dat","sha256":"69379e8bf066cd80266391dad18dab3e099e040457086a2f48a43bc2eda67068"},
      {"path":"p/stug7-1x2.dat","sha256":"7c6e66e0625b1ea764d4e04f20f9113d23b9fcae3c17d586482b7180a8cefe23"},
      {"path":"p/stud7.dat","sha256":"250111864bb2492a8722544d1f09b5e45672ba3f8e93be769b77499e7ea3fb1a"},
      {"path":"p/4-4ring3.dat","sha256":"1f2835ac308154edc2d6f479d8e742a55be981f6167b20bfa100c195bc0731dd"},
      {"path":"p/4-4cylo.dat","sha256":"d6ca97ee2e75918b3309a5c88aafcd2455b3a316f7cef8963517c19f1d86b38f"},
      {"path":"p/4-4edge.dat","sha256":"54a52196e421fd1717d291ff52ea57553b1fb238907c1678cc1f1a84c698b1da"},
      {"path":"p/4-4cyli.dat","sha256":"4a742c2765b6ebf98245baaf8a160a4ff587fc93d36c8ee2b9074712a2f968c4"},
      {"path":"p/recte3.dat","sha256":"e7f5ccbb040191aaa4cd469a25b086299cba4a3eaa8d3b0fbf71240e3de0359a"},
      {"path":"p/box2-5.dat","sha256":"8f297b754f87da1dbe19eec8704a5ce03a23b794ccd7cd015508e3758a206174"},
      {"path":"p/48/1-24chrd.dat","sha256":"9c1442d69aa0acfe4de87e4b9cdce8b164c88289640c9aa980afafb7b4aabd74"},
      {"path":"p/48/1-6edge.dat","sha256":"91d8e78d97ae0ae1e0a21d7b1c7d2e50ee931d9eee798b3f9d0cff5034369ab9"},
      {"path":"p/recte4.dat","sha256":"183b28b7586ffce3049e9248301668b4e16a84671b0f423efd792fb84a969dfe"},
      {"path":"p/1-8cylo.dat","sha256":"870bbbf6052e075598de7dce7efe7a139ea5189820e7a296442fe2b3318c18bf"},
      {"path":"p/1-8edge.dat","sha256":"50436a0bce461198c342dccbccb658a1bffae13e44b7c48689b158c946c2c2ab"},
      {"path":"p/1-8cyli.dat","sha256":"46def63dc8293ad9a2dd1d1a5cb720b9ba883850e65d3280d2093c664a6140c4"},
      {"path":"p/rect2p.dat","sha256":"faac2b36241a9de0c0108471e59c45734df6c79813332d9cacf97f6391886acc"},
      {"path":"p/rect.dat","sha256":"ffeb2dd3d9b83c38841f18f1f74800fbba9e90c5fb6badfff2a795f08a96cb71"},
      {"path":"p/1-8chrd.dat","sha256":"7694157b725563188a6efd69b3f558b00533b375b8a4e82f469497a03e471e74"},
      {"path":"p/stud8a.dat","sha256":"291cbfdb54441d6457a3e17155a8741cc8424a01f8e9b99a7c9a015085aacfb9"},
      {"path":"p/4-4ring7.dat","sha256":"67b27c082eec7286888ac427f11db06c5eca6c9bcec76c7e2b2014841afa83f3"},
      {"path":"p/2-4cyli.dat","sha256":"d486780f0f84893899d9eadcd13150f13a42e15e77a3cda38cdf24ded98862c6"},
      {"path":"p/1-4cyls.dat","sha256":"aaee6ffe6e4a191d6cad4496677132eb0349303d6e48c13c7a2240dcea1db621"},
      {"path":"p/2-4edge.dat","sha256":"665400f76566b161c28303cdadce40d17d979a8ff9a8a133675af2d17fbe6763"},
      {"path":"p/3-8edge.dat","sha256":"a590f230678d592d514a9c5e307c6a30945e50e4c529fc06accf37530d0e0ed5"},
      {"path":"p/box4-1.dat","sha256":"2ed58df5da841827dfc5f9ac11c0bd7ffd8a455e46f166638e635f61a014b44d"},
      {"path":"p/box4-4a.dat","sha256":"58c69e00462c0a74c1bd6d75d757d826ae13e98bd3928b0e685209003bfbee54"},
      {"path":"p/box3u5p.dat","sha256":"0f52d5c372a303f508113ace2c7cba6d52b46171052e76a88266679a74f17ea5"},
    ],
    evidence:[
      '11170.dat body x=-40..40,y=0..72,z=-60..20. Rx(PI)+[0,72,-20] makes bottom-centred assembly (x,72-y,-z-20); curved front is local +Z, flat high rear is -Z.',
      '11170s01 stug7-1x2 at y=0, Y scale 2.75 gives two top studs x=+/-20,z=-20 after transform, contact y=72, exposed height11. There are no studs on the curved front half.',
      'Underside rectangular rim x=+/-40,z=-60..20 (inner x=+/-36,z=-56..16), central stud8a at (0,19,-20), Y scale -12.25 ending y=68, and ribs at x=+/-20 and side z=0,-40 establish four standard bottom mating cells. Assembly x/z=+/-20; socket cells are not tube counts.',
      'Official 48/1-6cyli front: assembly z=80*cos(theta)-40, y=2.72+80*sin(theta), theta=0..60 degrees. Facet steps use the maximum height per interval and outward 0.003 LDU rounding (side/chord vertices differ by up to 0.0021 LDU from cylinder-rounded samples). Final vertical nose reaches y=2.72 at z=40.',
    ],
    unknown:['Conservative facet-step envelope may reject close surface clearances; cavities follow nominal DUPLO mating exemptions, not arbitrary insertions.','No physical stability or clutch-force certification.'],
  },
}
if(geometryIssues(curved11170.geometry).length)throw new Error('Invalid 11170 profile')

// 98223 MOVED rotation and its subpart rotation cancel: entry long axis is X.
const crown98223 = [[40,48], ...[
  [.2588,.9659],[.3827,.9239],[.5,.866],[.6088,.7934],[.7071,.7071],
  [.7934,.6088],[.866,.5],[.9239,.3827],[.9659,.2588],[.9914,.1305],[1,0],
].map(([cos,sin])=>[32+48*cos,48.8*sin])]
const curved98223: PartDefinition = {
  id:'98223',label:'2 × 4 · 双端弧形顶（顶部中央 2×2）',length:4,depth:2,
  geometry:{
    family:'explicit-duplo',status:'reviewed',bodySizeLdu:{x:160,y:48,z:80},
    outerBoundsLdu:{min:{x:-80,y:0,z:-40},max:{x:80,y:59,z:40}},
    collision:{kind:'conservative-boxes',boxes:[
      {min:{x:-40,y:0,z:-40},max:{x:40,y:48,z:40}},
      ...crown98223.slice(0,-1).flatMap(([x,h],i)=>{
        const end=Math.min(80,crown98223[i+1][0]+0.001),start=Math.max(40,x-0.001),height=Math.min(48,h+0.001)
        return [{min:{x:start,y:0,z:-40},max:{x:end,y:height,z:40}},
          {min:{x:-end,y:0,z:-40},max:{x:-start,y:height,z:40}}]
      }),
    ]},
    top:[-20,20].flatMap(x=>[-20,20].map(z=>({x,y:48,z,type:'duplo-stud' as const,direction:'up' as const,radiusLdu:12,depthLdu:11}))),
    bottom:[-60,-20,20,60].flatMap(x=>[-20,20].map(z=>({x,y:0,z,type:'duplo-stud' as const,direction:'down' as const,radiusLdu:12,depthLdu:11}))),
    rotations:[0,90,180,270],placement:'upright',ldraw:{rotationX:Math.PI,offsetLdu:{x:0,y:48,z:0}},
    sourceFiles:[
      {"path":"parts/98223.dat","sha256":"fe875349699b0c0078284fecf0b919dd7aa75757105949a7fdf3db8228ea1d32"},
      {"path":"parts/98223b.dat","sha256":"cf2f8aae45be5e41354ede552b04a4f92dd28e327402b17146cf4469f3ca048b"},
      {"path":"parts/s/98223s01.dat","sha256":"ae002ac0d16b7e01afb96ba5b8d6511cfc318baf32d2dcbd3ce893680df348ef"},
      {"path":"p/stug7-2x2.dat","sha256":"409fe27186afedd30d6b65e83063fba99380218d4067a4b0359e4250911726ca"},
      {"path":"p/stud7.dat","sha256":"250111864bb2492a8722544d1f09b5e45672ba3f8e93be769b77499e7ea3fb1a"},
      {"path":"p/4-4ring3.dat","sha256":"1f2835ac308154edc2d6f479d8e742a55be981f6167b20bfa100c195bc0731dd"},
      {"path":"p/4-4cylo.dat","sha256":"d6ca97ee2e75918b3309a5c88aafcd2455b3a316f7cef8963517c19f1d86b38f"},
      {"path":"p/4-4edge.dat","sha256":"54a52196e421fd1717d291ff52ea57553b1fb238907c1678cc1f1a84c698b1da"},
      {"path":"p/4-4cyli.dat","sha256":"4a742c2765b6ebf98245baaf8a160a4ff587fc93d36c8ee2b9074712a2f968c4"},
      {"path":"p/stud8.dat","sha256":"1a3202bf2d8dd8f58f59d09e220cb62f3411db762f88333a82503ab395f9d115"},
      {"path":"p/4-4ring7.dat","sha256":"67b27c082eec7286888ac427f11db06c5eca6c9bcec76c7e2b2014841afa83f3"},
      {"path":"p/stud8a.dat","sha256":"291cbfdb54441d6457a3e17155a8741cc8424a01f8e9b99a7c9a015085aacfb9"},
      {"path":"p/2-4cyli.dat","sha256":"d486780f0f84893899d9eadcd13150f13a42e15e77a3cda38cdf24ded98862c6"},
      {"path":"p/2-4edge.dat","sha256":"665400f76566b161c28303cdadce40d17d979a8ff9a8a133675af2d17fbe6763"},
      {"path":"p/rect.dat","sha256":"ffeb2dd3d9b83c38841f18f1f74800fbba9e90c5fb6badfff2a795f08a96cb71"},
      {"path":"p/48/5-24edge.dat","sha256":"98f6635f6593350b1a5987341291fc1cf17674c28ced8a421a69d1ec17b39575"},
      {"path":"p/1-4chrd.dat","sha256":"ccba3a97b5cc358754e476b78b4ce61cce5f404cd15e37471b73df3e81784aec"},
      {"path":"p/1-4cyli.dat","sha256":"5a7168952a5a3570327873b9a5802fa7b3be40967ab78c03b6a2bfd4419a1f10"},
      {"path":"p/rect2p.dat","sha256":"faac2b36241a9de0c0108471e59c45734df6c79813332d9cacf97f6391886acc"},
      {"path":"p/1-4edge.dat","sha256":"9ce2de7e67bbac575d52cfdc771b9d00856efc9b88002d97db8e665e50f4d467"},
      {"path":"p/box4-1.dat","sha256":"2ed58df5da841827dfc5f9ac11c0bd7ffd8a455e46f166638e635f61a014b44d"},
      {"path":"p/rect3.dat","sha256":"07ac46908b6668d993b6de0fb001a34cd996542106b80ebc7de63317d8dde865"},
      {"path":"p/48/5-24chrd.dat","sha256":"1d95e3c2613cb23c7ee2731d8157ba2ac850641fe8ac890eb98f1d9da4a6f936"},
      {"path":"p/48/5-24cyli.dat","sha256":"32b15a6570d6f5534a620e667a26b86298596ed9d064a0a9b1886d413c345658"},
    ],
    evidence:[
      '98223.dat MOVED maps (x,y,z)=(z_b,y_b,-x_b); 98223b subpart rotation cancels this. Entry body +/-80 X, +/-40 Z, y=0..48. Viewer Rx(PI)+[0,48,0] preserves X long axis.',
      '98223s01 stug7-2x2 at y=0 with Y scale2.75 yields four central top studs x/z=+/-20, contact y=48. Curved ends have no top studs.',
      'Full underside rim x=+/-80,z=+/-40 at y=48, central stud8 ending y=44, stud8a at x=+/-40 ending y=44, and perimeter ribs at x=+/-20,+/-60 plus end x=+/-72,z=+/-20 establish eight standard bottom mating cells, x=-60,-20,20,60 and z=+/-20.',
      'Both official 48/5-24cyli curves have |x|=32+48*cos(theta), assembly y=48.8*sin(theta), theta=0..75 degrees, plus flat join at (40,48). Conservative steps use facet maxima and 0.001 LDU outward rounding.',
    ],
    unknown:['Conservative facet-step envelope may reject very close curved-surface clearance.','Nominal socket cells do not certify physical stability or clutch force.'],
  },
}
if(geometryIssues(curved98223.geometry).length)throw new Error('Invalid 98223 profile')

// Reviewed data profiles, not per-part assembly algorithms. Unknown parts stay excluded.
export const PARTS: readonly PartDefinition[] = [
  curved2302, curved98224, curved11170, curved98223,
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

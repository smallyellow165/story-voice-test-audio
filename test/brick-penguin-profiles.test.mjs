import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {inspectBrickModel} from '../server/brick-library.mjs'
import {prepareGeometryInput} from '../server/brick-geometry-input.mjs'
import {executePlan} from '../experiments/geometry-execution/execute.mjs'
import {penguinProfileFixture} from '../experiments/geometry-execution/fixtures/penguin-profiles.mjs'
const rules=await loadBrickRules()
const mesh={};for(const p of ['11170','98223','98223b'])mesh[p]=await inspectBrickModel(p,undefined,{extractGeometry:true,includeFaces:true})
const brick=(id,part,x,z,layer,rotation=0)=>({id,part,color:'0',x,z,layer,rotation})
const transform=(p,g)=>({x:p[0]+g.ldraw.offsetLdu.x,y:g.ldraw.offsetLdu.y-p[1],z:-p[2]+g.ldraw.offsetLdu.z})
const key=p=>[p.x,p.y,p.z].map(n=>n.toFixed(5)).join(',')
test('11170 real offset origin, two studs and four bottom socket cells',()=>{
 const m=mesh['11170'],g=rules.geometrySupport('11170').geometry
 assert.equal(m.available,true);assert.equal(rules.geometrySupport('11170').supported,true)
 assert.deepEqual(m.extraction.meshBounds,{min:[-40,-11,-60],max:[40,72,20]})
 assert.deepEqual(g.bodySizeLdu,{x:80,y:72,z:80});assert.deepEqual(g.ldraw.offsetLdu,{x:0,y:72,z:-20})
 assert.deepEqual(m.extraction.primitives.filter(p=>p.file==='p/stud7.dat').map(p=>key(transform(p.origin,g))).sort(),g.top.map(key).sort())
 assert.equal(g.top.length,2);assert.ok(g.top.every(p=>p.z===-20&&p.y===72))
 assert.equal(g.bottom.length,4);assert.ok(g.bottom.every(p=>p.y===0&&Math.abs(p.x)===20&&Math.abs(p.z)===20))
 // Tube centre belongs between the four cells, not a fifth socket.
 assert.deepEqual(transform(m.extraction.primitives.find(p=>p.file==='p/stud8a.dat').origin,g),{x:0,y:53,z:0})
})
test('98223 MOVED transform reproduces official b model, top four and underside eight cells',()=>{
 const a=mesh['98223'],b=mesh['98223b'],g=rules.geometrySupport('98223').geometry
 assert.deepEqual(a.entryReferences[0].matrix,[0,0,1,0,1,0,-1,0,0])
 assert.deepEqual(a.extraction.meshBounds,{min:[-80,-11,-40],max:[80,48,40]})
 assert.deepEqual(b.extraction.meshBounds,{min:[-40,-11,-80],max:[40,48,80]})
 const unique=xs=>[...new Set(xs)].sort()
 assert.deepEqual(unique(a.extraction.surfaceFaces.flat().map(p=>key(transform(p,g)))),unique(b.extraction.surfaceFaces.flat().map(p=>key({x:p[2],y:48-p[1],z:p[0]}))))
 assert.deepEqual(a.extraction.primitives.filter(p=>p.file==='p/stud7.dat').map(p=>key(transform(p.origin,g))).sort(),g.top.map(key).sort())
 assert.equal(g.top.length,4);assert.equal(g.bottom.length,8)
 assert.deepEqual(a.extraction.primitives.filter(p=>/\/stud8a?\.dat$/.test(p.file)).map(p=>p.origin[0]).sort((a,b)=>a-b),[-40,0,40])
 assert.ok(g.bottom.every(p=>p.y===0&&[20,60].includes(Math.abs(p.x))&&Math.abs(p.z)===20))
})
for(const part of ['11170','98223']){
 test(part+' conservative curve contains official body surface samples; audited hashes match',()=>{
  const g=rules.geometrySupport(part).geometry,m=mesh[part];let count=0
  for(const f of g.sourceFiles)assert.ok(m.sourceFiles.some(s=>s.path===f.path&&s.sha256===f.sha256),f.path)
  // Sample triangle fans over every official polygon, including side faces,
  // cavity ribs and rounded high-resolution curve facets. Studs above body are separate.
  for(const f of m.extraction.surfaceFaces)for(let i=1;i<f.length-1;i++)for(let a=0;a<=6;a++)for(let b=0;b<=6-a;b++){
   const p=transform(f[0].map((_,k)=>(a*f[0][k]+b*f[i][k]+(6-a-b)*f[i+1][k])/6),g)
   if(p.y>g.bodySizeLdu.y+1e-7)continue
   count++;assert.ok(g.collision.boxes.some(box=>['x','y','z'].every(k=>p[k]>=box.min[k]-1e-7&&p[k]<=box.max[k]+1e-7)),JSON.stringify({part,p}))
  }
  assert.ok(count>8000)
 })
 test(part+' genuine upper/lower interfaces for all upright yaws; side contact and misalignment rejected',async()=>{
  const h=rules.geometrySupport(part).geometry.bodySizeLdu.y/48,lower=part==='11170'?'3437':'3011'
  for(const yaw of [0,90,180,270]){
   const r=rules.validateFinalAssembly([brick('lower',lower,0,0,0,yaw),brick('subject',part,0,0,1,yaw),brick('cap','3437',0,0,1+h)])
   assert.equal(r.valid,true,JSON.stringify(r));assert.deepEqual(r.connections.map(c=>c.points.length),part==='11170'?[4,2]:[8,4])
  }
  assert.equal(rules.validateFinalAssembly([brick('a',part,0,0,0,45)]).valid,false)
  const {input,plan}=penguinProfileFixture(part),prepared=await prepareGeometryInput(input,rules)
  assert.deepEqual(prepared.issues,[]);assert.equal(executePlan(plan,prepared.input,rules).status,'candidates_found')
  const bad=structuredClone(plan);bad.parts[1].pose.offsetLdu.x={min:20,max:20}
  assert.equal(executePlan(bad,prepared.input,rules).status,'no_solution')
  assert.equal(rules.validateFinalAssembly([brick('a',part,0,0,0),brick('side','3437',part==='11170'?2:3,0,0)]).valid,false)
 })
 test(part+' curve clearance is retained while true body/stud overlap fails',()=>{
  const subject=brick('curve',part,0,0,0),x=part==='11170'?0:2.5,z=part==='11170'?1.5:0
  const clear=rules.validateFinalAssembly([subject,brick('probe','3437',x,z,part==='11170'?60/48:44/48)])
  assert.equal(clear.valid,false);assert.notEqual(clear.code,'COLLISION','no full rectangular body substitution')
  assert.equal(rules.validateFinalAssembly([subject,brick('probe','3437',x,z,part==='11170'?48/48:32/48)]).code,'COLLISION')
  assert.equal(rules.validateFinalAssembly([subject,brick('body','3437',0,0,0)]).code,'COLLISION')
  const height=rules.geometrySupport(part).geometry.bodySizeLdu.y
  assert.equal(rules.validateFinalAssembly([subject,brick('stud','3437',.5,0,height/48)]).code,'COLLISION')
 })
}
test('saved ten-part penguin gains four profiles without source mutation; original conflicts remain invalid',async()=>{
 const trace=JSON.parse(await readFile(new URL('../generated/brick-spatial-traces/b052f246-bce4-4a43-93aa-69de7572c0fe.json',import.meta.url))),before=JSON.stringify(trace)
 const p=await prepareGeometryInput(trace.requestInput,rules)
 assert.deepEqual(p.issues,[]);assert.deepEqual(p.enrichments.map(e=>e.id),['head_front','head_rear','wing_upper','orange_foot'])
 const r=executePlan(trace.plan,p.input,rules)
 assert.equal(r.status,'no_solution');assert.equal(r.completeSearch,true);assert.equal(r.originalCombinationCount,32);assert.equal(r.combinationCount,0);assert.equal(r.candidates.length,0)
 assert.equal(r.attempts.length,0);assert.equal(r.diagnostics[0].kind,'mates');assert.equal(r.diagnosticAssembly,undefined);assert.equal(r.diagnosticCandidates.length,0);assert.ok(r.diagnostics.some(d=>d.code==='NO_DIAGNOSTIC_DOMAIN'))
 assert.equal(r.domains.length,10)
 assert.equal(JSON.stringify(trace),before)
})

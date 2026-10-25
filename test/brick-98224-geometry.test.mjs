import test from 'node:test'
import {Vector3,Matrix4} from 'three'
import assert from 'node:assert/strict'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {inspectBrickModel} from '../server/brick-library.mjs'
import {prepareGeometryInput} from '../server/brick-geometry-input.mjs'
import {executePlan} from '../experiments/geometry-execution/execute.mjs'
import {curvedBottomFixture} from '../experiments/geometry-execution/fixtures/98224.mjs'
const rules=await loadBrickRules()
const brick=(id,part,x,layer,rotation=0,z=0)=>({id,part,color:'15',x,z,layer,rotation})
test('98224 original MOVED entry agrees with official mesh and central stud coordinates',async()=>{
 const a=await inspectBrickModel('98224',undefined,{extractGeometry:true})
 const b=await inspectBrickModel('98224b',undefined,{extractGeometry:true})
 assert.equal(a.available,true);assert.equal(b.available,true)
 assert.deepEqual(a.entryReferences[0].matrix,[0,0,1,0,1,0,-1,0,0])
 assert.deepEqual(a.extraction.meshBounds,{min:[-80,-11,-40],max:[80,48,40]})
 assert.deepEqual(b.extraction.meshBounds,{min:[-40,-11,-80],max:[40,48,80]})
 const g=rules.geometrySupport('98224').geometry
 assert.equal(rules.geometrySupport('98224').supported,true)
 assert.deepEqual(g.bodySizeLdu,{x:160,y:48,z:80})
 const key=p=>[p.x,p.y,p.z].join(',')
 const studs=a.extraction.primitives.filter(p=>p.file==='p/stud7.dat')
 assert.equal(studs.length,4)
 assert.deepEqual(studs.map(p=>key({x:p.origin[0],y:48-p.origin[1],z:-p.origin[2]})).sort(),g.top.filter(p=>Math.abs(p.x)===20).map(key).sort())
 assert.deepEqual(b.extraction.primitives.filter(p=>p.file==='p/stud7.dat').map(p=>key({x:p.origin[2],y:48-p.origin[1],z:p.origin[0]})).sort(),g.top.filter(p=>Math.abs(p.x)===20).map(key).sort())
 const endStuds=a.extraction.primitives.filter(p=>p.file==='p/stud7a.dat')
 assert.equal(endStuds.length,4)
 const tips=endStuds.map(p=>new Vector3(0,-4,0).applyMatrix4(new Matrix4().fromArray(p.matrix)))
 assert.ok(tips.every(p=>p.y===-11))
 assert.deepEqual(tips.map(p=>key({x:p.x,y:48,z:-p.z})).sort(),g.top.filter(p=>Math.abs(p.x)===60).map(key).sort())
 assert.equal(g.top.length,8)
 assert.equal(g.bottom.length,4);assert.ok(g.bottom.every(p=>p.y===0&&Math.abs(p.x)===20&&Math.abs(p.z)===20))
 for(const f of g.sourceFiles)assert.ok(a.sourceFiles.some(s=>s.path===f.path&&s.sha256===f.sha256),f.path)
})
test('central sockets and studs mate at both faces for all upright yaw choices',()=>{
 for(const yaw of [0,90,180,270]){
  const assembly=[brick('lower','3437',0,0),brick('curved','98224',0,1,yaw),brick('upper','3437',0,2)]
  const r=rules.validateFinalAssembly(assembly)
  assert.equal(r.valid,true,JSON.stringify(r));assert.equal(r.connections.length,2)
  assert.ok(r.connections.every(c=>c.points.length===4))
 }
 const end=rules.validateFinalAssembly([brick('base','98224',0,0),brick('end','3437',1,1)])
 assert.equal(end.valid,true);assert.equal(end.connections[0].points.length,4)
 assert.equal(rules.validateFinalAssembly([brick('bad','98224',0,0,45)]).valid,false)
 assert.equal(rules.validateFinalAssembly([brick('bottom','3437',0,0),brick('shifted','98224',.5,1)]).valid,false)
 assert.equal(rules.validateFinalAssembly([brick('base','98224',0,0),brick('nose','3437',3,1)]).valid,false,'no invented studs beyond the footprint')
})
test('raised curved ends leave clearance; actual body and stud collisions still fail',()=>{
 const c=brick('curve','98224',0,1)
 // Probe x=60..140, y=1..49 overlaps the full box y=48..96,
 // but lies below the official curved underside (at least y=54.8471 here).
 const clear=rules.validateFinalAssembly([c,brick('probe','3437',2.5,1/48)])
 assert.equal(clear.valid,false,'clearance alone does not establish connection')
 assert.notEqual(clear.code,'COLLISION')
 assert.equal(rules.validateFinalAssembly([c,brick('probe','3437',2.5,18/48)]).code,'COLLISION')
 assert.equal(rules.validateFinalAssembly([c,brick('hit','3437',1,1)]).code,'COLLISION')
 const rotated=rules.validateFinalAssembly([brick('curve','98224',0,1,90),brick('hit','3437',0,1,0,1)])
 assert.equal(rotated.code,'COLLISION')
})
test('strict Geometry Execution enriches unknown profile independently and accepts two mating intents',async()=>{
 const {input,plan}=curvedBottomFixture(),before=JSON.stringify(input)
 const p=await prepareGeometryInput(input,rules)
 assert.deepEqual(p.issues,[]);assert.equal(JSON.stringify(input),before)
 const r=executePlan(plan,p.input,rules)
 assert.equal(r.status,'candidates_found',JSON.stringify(r.diagnostics))
 assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].geometry.valid,true)
 const bad=structuredClone(plan);bad.parts[1].pose.offsetLdu.x={min:20,max:20}
 assert.equal(executePlan(bad,p.input,rules).status,'no_solution')
 const drift=structuredClone(p.input);drift.observations[1].geometry.bottom.push({...drift.observations[1].geometry.bottom[0],x:60})
 assert.equal(executePlan(plan,drift,rules).status,'invalid_input')
})

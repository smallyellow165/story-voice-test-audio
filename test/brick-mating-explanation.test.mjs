import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {explainMating} from '../src/brick-test/mating-explanation.mjs'
const rules=await loadBrickRules(),record=JSON.parse(await readFile(new URL('../generated/brick-spatial-geometry/69c33742-bc26-4d07-8c1f-ab0968c30db1.json',import.meta.url)))
const lower={id:'lower',part:'40666',color:'15',x:0,z:0,layer:0,rotation:0},upper={id:'upper',part:'3437',color:'0',x:0,z:0,layer:.5,rotation:0}
const intent={ownSurface:'bottom',otherSurface:'top',ownConnector:null,otherConnector:null}
test('real 3437/40666: all four yaws and three full-footprint mounting positions',()=>{
 for(const yaw of [0,90,180,270])for(const rotation of [0,90,180,270])for(const offset of [-1,0,1]){
  const x=yaw%180===0?offset:0,z=yaw%180===0?0:offset
  const r=rules.validateFinalAssembly([{...lower,rotation:yaw},{...upper,x,z,rotation}]);assert.equal(r.valid,true);assert.equal(r.connections[0].points.length,4)
 }
})
test('real interfaces reject half-stud offset, gap, body collision and unsupported yaw',()=>{
 for(const patch of [{x:.5},{layer:25/48},{layer:23/48},{rotation:45}])assert.equal(rules.validateFinalAssembly([lower,{...upper,...patch}]).valid,false)
})
test('saved penguin is a specified index mismatch; four other pairs are valid at unchanged poses',()=>{
 const bs=record.diagnosticAssembly.bricks,a=bs.find(b=>b.id==='eye_block'),b=bs.find(b=>b.id==='white_strip'),c=record.sourcePlan.parts.find(p=>p.id===a.id).connections.find(c=>c.other===b.id)
 const before=JSON.stringify(record),e=explainMating(a,b,c,rules)
 assert.equal(e.classification,'Connector Pair Mismatch');assert.equal(e.current.valid,true);assert.equal(e.specifiedSatisfied,false)
 assert.deepEqual(e.alternatives.map(p=>[p.ownConnector,p.otherConnector]),[[0,4],[1,5],[2,6],[3,7]])
 assert.equal(e.specified.own.x-e.specified.other.x,40)
 assert.equal(explainMating(a,b,{...c,ownConnector:null,otherConnector:null},rules).specifiedSatisfied,true)
 assert.equal(JSON.stringify(record),before)
})
test('pose conflict requires a shared-validator witness; unsupported is model support, not physical impossibility',()=>{
 const e=explainMating({...upper,layer:1},lower,intent,rules)
 assert.equal(e.classification,'Pose Constraint Conflict');assert.equal(rules.validateFinalAssembly(e.witness.bricks).valid,true)
 assert.equal(explainMating({...upper,layer:0},lower,intent,rules).classification,'Geometry Collision')
 assert.equal(explainMating({...upper,part:'not-registered'},lower,intent,rules).classification,'Physical Interface Unsupported')
 assert.equal(explainMating(upper,lower,{...intent,ownSurface:'side'},rules).classification,'Unknown')
 assert.equal(explainMating({...upper,rotation:45},lower,intent,rules).classification,'Unknown')
})

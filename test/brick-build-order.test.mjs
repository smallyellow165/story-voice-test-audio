import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createBuildPlan,withSteps,inspectBuildPlan,stepScene} from '../src/brick-build/plan.mjs'
// Isolated data only; no runtime fixture or production write.
const bricks=['a','b','c','d'].map((id,i)=>({id,part:'3437',color:'14',x:i,z:0,layer:0,rotation:0}))
const source={id:'selection',geometryId:'geometry',candidateId:'candidate',candidateHash:'hash',assembly:{bricks}}
const draft=()=>createBuildPlan(source,'plan','2026-10-26T00:00:00.000Z')
const step=(id,moving,target,result)=>({stepId:id,movingNodeId:moving,targetNodeId:target,resultNodeId:result,description:''})
const steps=[step('s1','part:b','part:a','ab'),step('s2','part:d','part:c','cd'),step('s3','cd','ab','root')]
const edges=[{lowerId:'a',upperId:'b'},{lowerId:'c',upperId:'d'},{lowerId:'b',upperId:'c'}]
test('incomplete draft is saveable but cannot play or be reviewed',()=>{
 const p=draft();assert.equal(inspectBuildPlan(p).valid,true);assert.equal(inspectBuildPlan(p).complete,false)
 assert.throws(()=>stepScene(p,bricks,0));assert.equal(inspectBuildPlan({...p,status:'reviewed'}).valid,false)
})
test('independent subassemblies can be reordered; final membership and repeated part identities remain exact',()=>{
 for(const sequence of [steps,[steps[1],steps[0],steps[2]]]){
  const p=withSteps(draft(),sequence),v=inspectBuildPlan(p,bricks.map(b=>b.id),edges)
  assert.equal(v.valid,true);assert.equal(v.complete,true);assert.equal(v.members.root.length,4)
  const scene=stepScene(p,bricks,2);assert.deepEqual(scene.result,bricks);assert.equal(scene.moving.length,2)
  scene.result[0].x=999;assert.equal(bricks[0].x,0)
 }
})
test('consumed instances, forward references, cycles and duplicate nodes are rejected',()=>{
 for(const sequence of [[steps[0],step('s2','part:b','part:c','bc')],[steps[2],steps[0],steps[1]],[step('cycle','loop','part:a','loop')]])
  assert.equal(inspectBuildPlan(withSteps(draft(),sequence)).valid,false)
 const p=withSteps(draft(),steps);p.assemblyNodes.push(p.assemblyNodes[0]);assert.equal(inspectBuildPlan(p).valid,false)
})
test('no cross-component mating evidence cannot be presented as a built subassembly',()=>{
 const p=withSteps(draft(),steps);assert.equal(inspectBuildPlan(p,bricks.map(b=>b.id),edges.slice(0,2)).valid,false)
})
test('final poses cannot be injected through nodes or steps; source membership cannot change',()=>{
 const p=withSteps(draft(),steps);p.assemblyNodes[0].x=88;assert.equal(inspectBuildPlan(p).valid,false)
 const q=withSteps(draft(),steps);q.steps[0].finalPose={x:88};assert.equal(inspectBuildPlan(q).valid,false)
 assert.equal(inspectBuildPlan(draft(),['a','b']).valid,false)
})
test('penguin example is a full 12-instance tree; fixture is separate from runtime algorithms',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../examples/build-order/penguin-v1.json',import.meta.url),'utf8'))
 const ids=['head_front','head_rear','beak','eye_block','white_strip','white_belly','white_lower','back_body','wing_upper','wing_lower','orange_foot','wing_opposite']
 const p=createBuildPlan({...source,assembly:{bricks:ids.map(id=>({id}))}},'example','now')
 const result=inspectBuildPlan(withSteps(p,fixture.steps),ids)
 assert.equal(result.valid,true);assert.equal(result.complete,true);assert.equal(result.members['assembly:penguin'].length,12)
})

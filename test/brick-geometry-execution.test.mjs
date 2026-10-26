import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadBrickRules } from '../server/brick-rules.mjs'
import { executePlan } from '../experiments/geometry-execution/execute.mjs'
const trace=JSON.parse(await readFile(new URL('../generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.json',import.meta.url),'utf8'))
const rules=await loadBrickRules()
const get=()=>({plan:structuredClone(trace.plan),input:structuredClone(trace.requestInput)})
const single=p=>{for(const b of p.parts)b.pose.yawCandidates=[b.pose.yawCandidates[0]];return p}
const exact=v=>({min:v,max:v})
test('fixed real camel: exhaustive 512 yaw variants, one layout, six edges and 18 mates, no source mutation',()=>{
 const {plan,input}=get(),before=JSON.stringify({plan,input})
 const r=executePlan(plan,input,rules)
 assert.equal(r.status,'candidates_found');assert.equal(r.completeSearch,true)
 assert.equal(r.validLayoutCount,512);assert.equal(r.attempts.length,512);assert.equal(r.candidates.length,5);assert.equal(r.groups.length,1)
 for(const c of r.candidates){assert.equal(c.geometry.valid,true);assert.equal(c.geometry.connections.length,6);assert.equal(c.geometry.connections.reduce((n,g)=>n+g.points.length,0),18);assert.equal(c.collision.status,'clear');assert.ok(c.intents.every(i=>i.satisfied));assert.ok(c.ranges.every(i=>i.satisfied));assert.ok(c.relations.every(i=>i.satisfied));assert.equal(c.assembly.steps,undefined)}
 const by=Object.fromEntries(r.candidates[0].assembly.bricks.map(b=>[b.id,b]))
 assert.equal(by.upper_horizontal.layer-by.lower_horizontal.layer,.5)
 assert.equal(by.upper_horizontal.x-by.lower_horizontal.x,1)
 assert.equal(by.right_leg.x-by.left_leg.x,2)
 assert.equal(by.left_leg.layer,0);assert.equal(by.right_leg.layer,0)
 assert.equal(JSON.stringify({plan,input}),before)
})
test('infeasible subgrid interval is never rounded or repaired',()=>{
 const {plan,input}=get();plan.parts.find(p=>p.id==='head').pose.offsetLdu.x=exact(-13)
 const r=executePlan(plan,input,rules);assert.equal(r.status,'no_solution');assert.equal(r.candidates.length,0)
})
test('collision reports the actual conflicting bricks instead of changing layout',()=>{
 const {plan,input}=get();single(plan);plan.parts.find(p=>p.id==='neck').pose.offsetLdu.x=exact(0);plan.parts.forEach(p=>p.connections=[]);plan.relations=[]
 const r=executePlan(plan,input,rules)
 assert.equal(r.status,'no_solution');assert.equal(r.diagnosticAssembly.geometry.code,'COLLISION');assert.ok(r.diagnosticAssembly.geometry.brickIds.includes('neck'))
})
test('explicit hidden connector selection is enforced, not silently reassigned',()=>{
 const {plan,input}=get();single(plan)
 plan.parts.find(p=>p.id==='head').connections[0].ownConnector=0
 const r=executePlan(plan,input,rules)
 assert.equal(r.status,'no_solution');assert.equal(r.diagnostics[0].kind,'mates');assert.equal(r.attempts.length,0)
})
test('hard visual relations override otherwise valid geometry',()=>{
 const {plan,input}=get();single(plan)
 plan.relations.push({from:'right_leg',to:'left_leg',kind:'left',evidence:'deliberately contradictory test constraint'})
 const r=executePlan(plan,input,rules)
 assert.equal(r.status,'no_solution');assert.equal(r.diagnosticAssembly.geometry.valid,true);assert.equal(r.diagnostics[0].kind,'left');assert.equal(r.candidates.length,0)
})
test('multiple legal translations are retained rather than selecting a preferred answer',()=>{
 const {plan,input}=get();single(plan);plan.parts.find(p=>p.id==='back').pose.offsetLdu.x={min:-40,max:40}
 const r=executePlan(plan,input,rules)
 assert.equal(r.groups.length,3);assert.equal(r.candidates.length,3)
 assert.deepEqual(r.candidates.map(c=>c.assembly.bricks.find(b=>b.id==='back').x),[1,0,2])
})
test('relative intervals remain hard constraints after cumulative world interval enumeration',()=>{
 const {plan,input}=get();single(plan)
 plan.parts.find(p=>p.id==='neck').pose.offsetLdu.x={min:-60,max:-40}
 plan.parts.find(p=>p.id==='head').pose.offsetLdu.x=exact(-20)
 const r=executePlan(plan,input,rules)
 assert.ok(r.pruning.removals.length>0);assert.ok(r.pruning.constraints.some(c=>c.kind==='relative_interval'&&c.compatiblePairs<c.pairs))
 assert.ok(r.candidates.every(c=>c.ranges.every(x=>x.satisfied)))
})
test('unknown depth, geometry drift and search caps do not become false no-solution proofs',()=>{
 const {plan,input}=get();plan.parts.find(p=>p.id==='head').pose.offsetLdu.z=null
 assert.equal(executePlan(plan,input,rules).status,'insufficient_information')
 const original=get();original.input.observations[0].geometry.bodySizeLdu.x++
 assert.equal(executePlan(original.plan,original.input,rules).status,'invalid_input')
 const capped=get(),r=executePlan(capped.plan,capped.input,rules,{maxCombinations:1})
 assert.equal(r.status,'budget_exceeded');assert.equal(r.completeSearch,false)
})
test('projection constraints are retained as unverified, never claimed satisfied',()=>{
 const {plan,input}=get();single(plan);plan.relations.push({from:'head',to:'neck',kind:'occludes',evidence:'needs calibrated view'})
 const r=executePlan(plan,input,rules)
 assert.equal(r.status,'candidates_with_unverified_constraints');assert.equal(r.candidates[0].unverifiedConstraints.length,1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {prepareGeometryInput} from '../server/brick-geometry-input.mjs'
import {executePlan} from '../experiments/geometry-execution/execute.mjs'
import {createSpatialWorkflow} from '../server/brick-spatial-workflow.mjs'
import {spatialStatus} from '../src/brick-test/spatial-status.mjs'
const rules=await loadBrickRules()
const trace=JSON.parse(await readFile(new URL('../generated/brick-spatial-traces/7415a066-d5e1-490d-a863-936a285a4597.json',import.meta.url)))
const brick=(id,part,x,layer,rotation=0)=>({id,part,color:'25',x,z:0,layer,rotation})
test('2302 asymmetric top and six underside sockets use the transformed official entry, not a box',()=>{
 const g=rules.geometrySupport('2302');assert.equal(g.supported,true)
 assert.deepEqual(g.geometry.ldraw.offsetLdu,{x:-20,y:48,z:0})
 assert.equal(g.geometry.top.length,4);assert.equal(g.geometry.bottom.length,6)
 const base=brick('base','2302',0,0),upper=brick('upper','3437',-.5,1)
 const valid=rules.validateAssembly([base,upper]);assert.equal(valid.valid,true);assert.equal(valid.connections[0].points.length,4)
 assert.equal(rules.validateAssembly([base,{...upper,x:0}]).valid,false,'20 LDU grid phase is incompatible')
 // A 2x1 tall brick overlapping only the empty space above the curved nose:
 // full 120x48x80 bounding box would falsely collide here. It is unsupported,
 // which is distinct from a body collision.
 const clear=rules.validateAssembly([base,brick('probe','4066a',1.5,44/48,90)])
 assert.equal(clear.code,'UNSUPPORTED')
 const hit=rules.validateAssembly([base,brick('probe','4066a',1.5,20/48,90)])
 assert.equal(hit.code,'COLLISION')
 const rotated=rules.validateAssembly([brick('base','2302',0,0,180),brick('upper','3437',.5,1)])
 assert.equal(rotated.valid,true)
 assert.deepEqual(rules.connectors({...base,rotation:90},'top').map(p=>p.z).sort((a,b)=>a-b),[0,0,40,40])
})
test('official 70/25 appearance accepted; missing geometry enriched explicitly without changing trace, colors or positions',async()=>{
 const before=JSON.stringify(trace),p=await prepareGeometryInput(trace.requestInput,rules)
 assert.deepEqual(p.issues,[]);assert.deepEqual(p.enrichments.map(e=>e.id),['orange_base'])
 assert.equal(trace.requestInput.observations.find(o=>o.id==='orange_base').geometry,null)
 assert.deepEqual(p.input.observations.map(({id,part,color})=>({id,part,color})),trace.requestInput.observations.map(({id,part,color})=>({id,part,color})))
 const result=executePlan(trace.plan,p.input,rules)
 assert.equal(result.status,'no_solution');assert.equal(result.candidates.length,0);assert.equal(result.combinationCount,65536)
 assert.ok(result.pairChecks.some(c=>!c.possible&&c.id==='brown_upright'&&c.other==='dark_lower'))
 assert.ok(result.pairChecks.some(c=>!c.possible&&c.id==='dark_lower'&&c.other==='orange_base'))
 assert.equal(result.diagnosticAssembly.bricks.length,9);assert.equal(result.diagnosticAssembly.geometry.code,'COLLISION')
 assert.equal(JSON.stringify(trace),before)
 const altered=structuredClone(p.input);altered.observations[0].geometry.bodySizeLdu.x++
 assert.equal(executePlan(trace.plan,altered,rules).status,'invalid_input','known geometry drift must not be migrated')
})
test('unknown official colors and changed LDraw source bindings fail explicitly',async()=>{
 const changed=structuredClone(trace.requestInput);changed.observations[0].color='999999'
 assert.ok((await prepareGeometryInput(changed,rules)).issues.some(i=>i.includes('999999')))
 const result=await prepareGeometryInput(trace.requestInput,rules,{inspect:async()=>({available:true,errors:[],sourceFiles:[]})})
 assert.ok(result.issues.some(i=>i.includes('来源已变化')))
 assert.equal(result.input.observations.find(o=>o.id==='orange_base').geometry,null)
})
test('real rooster failure persists through service restart, exposes diagnostic only, not a successful candidate',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rooster-geometry-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 await mkdir(path.join(dir,'brick-spatial-traces'));await writeFile(path.join(dir,'brick-spatial-traces',trace.id+'.json'),JSON.stringify(trace))
 const service=createSpatialWorkflow(dir,{runPlanning:()=>assert.fail('No paid inference')})
 const op=await service.dispatch('POST','execute',{requestId:randomUUID(),planId:trace.id})
 assert.equal(op.resultStatus,'no_solution')
 const restarted=createSpatialWorkflow(dir),r=await restarted.dispatch('GET','geometry/'+op.geometryId)
 assert.equal(spatialStatus('geometry',r).tone,'failed');assert.equal(r.diagnosticAvailable,true)
 const report=await restarted.dispatch('GET','geometry/'+op.geometryId+'/report')
 assert.deepEqual(report.sourceInput,trace.requestInput);assert.deepEqual(report.sourcePlan,trace.plan)
 assert.equal(report.enrichments.length,1)
 const index=await restarted.dispatch('GET','geometry/'+op.geometryId+'/viewer')
 assert.equal(index.candidates.length,0);assert.equal(index.diagnosticAssembly.bricks.length,9)
 await assert.rejects(restarted.dispatch('GET','geometry/'+op.geometryId+'/candidates/candidate-1'),/没有可用候选/)
})
test('stage status never treats complete/invalid_input or zero candidates as success',()=>{
 for(const status of ['invalid_input','no_solution','execution_failed','candidates_found'])assert.equal(spatialStatus('geometry',{state:'complete',status,candidates:[],diagnostics:['具体错误']}).tone,'failed')
 assert.equal(spatialStatus('geometry',null).tone,'idle')
 assert.equal(spatialStatus('geometry',null,{running:true}).tone,'running')
 assert.equal(spatialStatus('geometry',null,{error:'network'}).tone,'failed')
 assert.equal(spatialStatus('geometry',{state:'complete',status:'insufficient_information'}).tone,'review')
 assert.equal(spatialStatus('geometry',{state:'complete',status:'candidates_found',completeSearch:true,candidates:[{}]}).tone,'success')
 assert.equal(spatialStatus('planning',{usable:true}).tone,'success')
 assert.equal(spatialStatus('planning',{status:'prepared'}).tone,'idle')
 assert.equal(spatialStatus('planning',{status:'invalid_json'}).tone,'failed')
})

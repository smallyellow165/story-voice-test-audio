import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createSpatialWorkflow,reviewedSource,prepareReviewedSource,geometryView} from '../server/brick-spatial-workflow.mjs'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {executePlan} from '../experiments/geometry-execution/execute.mjs'
const trace=JSON.parse(await readFile(new URL('../generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.json',import.meta.url)))
const rules=await loadBrickRules()
async function fixture(t,patch={}){const dir=await mkdtemp(path.join(tmpdir(),'spatial-workflow-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'brick-spatial-traces'));await writeFile(path.join(dir,'brick-spatial-traces',trace.id+'.json'),JSON.stringify({...trace,...patch}));return dir}
test('saved camel runs without LLM, survives service restart, protects duplicate requests and candidate pairing',async t=>{
 const dir=await fixture(t);let calls=0
 const dependencies={loadRules:async()=>rules,runPlanning:()=>assert.fail('no LLM'),execute:(...a)=>{calls++;return executePlan(...a)}}
 const service=createSpatialWorkflow(dir,dependencies),body={requestId:randomUUID(),planId:trace.id}
 assert.equal((await service.dispatch('GET','plans/'+trace.id)).usable,true)
 const op=await service.dispatch('POST','execute',body)
 assert.equal(op.state,'complete');assert.equal(calls,1)
 assert.deepEqual(await service.dispatch('POST','execute',body),op);assert.equal(calls,1)
 await assert.rejects(service.dispatch('POST','execute',{...body,analysisId:randomUUID()}),/不同输入/)
 const restarted=createSpatialWorkflow(dir,dependencies),result=await restarted.dispatch('GET','geometry/'+op.geometryId)
 assert.equal(result.candidates.length,512);assert.equal(result.groups.length,1)
 const c=await restarted.dispatch('GET','geometry/'+op.geometryId+'/candidates/candidate-1')
 const old=JSON.parse(await readFile(new URL('../output/geometry-execution/a41d93d1-dd36-4741-a374-1cab4505fb00/candidate-1.json',import.meta.url)))
 assert.deepEqual(c.assembly.bricks,old.assembly?.bricks||old.bricks)
 assert.equal(c.currentGeometry.valid,true);assert.equal(c.geometry.connections.length,6)
 assert.equal(c.geometry.connections.reduce((n,x)=>n+x.points.length,0),18)
 await assert.rejects(restarted.dispatch('GET','geometry/'+op.geometryId+'/candidates/missing'),/不存在/)
 assert.deepEqual(await restarted.dispatch('POST','execute',body),op);assert.equal(calls,1)
})
test('failed, prepared, incomplete and invalid plans never execute',async t=>{
 for(const patch of [{status:'provider_or_trace_failed'},{status:'prepared'},{finishReason:'incomplete'},{parseStatus:'invalid_json'},{validation:{valid:false}},{plan:{}}]){
  const service=createSpatialWorkflow(await fixture(t,patch),{execute:()=>assert.fail('must not execute')})
  assert.equal((await service.dispatch('GET','plans/'+trace.id)).usable,false)
  const op=await service.dispatch('POST','execute',{requestId:randomUUID(),planId:trace.id})
  assert.equal(op.state,'failed');assert.match(op.error,/禁止执行/)
 }
})
test('impossible layout persists failure evidence without candidates',async t=>{
 const plan=structuredClone(trace.plan);plan.parts.find(x=>x.id==='head').pose.offsetLdu.x={min:-13,max:-13}
 const dir=await fixture(t,{plan,rawOutput:JSON.stringify(plan)}),s=createSpatialWorkflow(dir,{loadRules:async()=>rules})
 const op=await s.dispatch('POST','execute',{requestId:randomUUID(),planId:trace.id})
 const r=await s.dispatch('GET','geometry/'+op.geometryId)
 assert.equal(r.status,'no_solution');assert.deepEqual(r.candidates,[])
 await assert.rejects(s.dispatch('GET','geometry/'+op.geometryId+'/candidates/candidate-1'),/没有可用候选/)
})
test('exceptions remain failed after restart and never automatically retry',async t=>{
 const dir=await fixture(t),s=createSpatialWorkflow(dir,{loadRules:async()=>rules,execute:()=>{throw Error('deliberate')}})
 const body={requestId:randomUUID(),planId:trace.id},op=await s.dispatch('POST','execute',body)
 const restarted=createSpatialWorkflow(dir,{execute:()=>assert.fail('no retry')})
 const result=await restarted.dispatch('GET','geometry/'+op.geometryId)
 assert.equal(result.state,'failed');assert.equal(result.error,'deliberate');assert.deepEqual(result.candidates,[])
 assert.deepEqual(await restarted.dispatch('POST','execute',body),op)
})
test('running, invalid and capped geometry cannot expose successful candidates',()=>{
 for(const r of [{state:'running',status:'candidates_found'},{state:'failed',status:'candidates_found'},{state:'complete',status:'budget_exceeded'}])assert.deepEqual(geometryView({...r,candidates:[{geometry:{valid:true}}]}).candidates,[])
})
test('only saved, individually reviewed observations can trigger planning',()=>{
 const saved={analysis:{id:randomUUID(),status:'complete',analysis:{observations:[{id:'a'}]}},updatedAt:'2026-01-01',rows:{a:{quantity:'1',index:0,search:{rows:[{sourceAllowed:true,source:{part_num:'3437',color_id:14}}]}}}}
 assert.equal(reviewedSource(saved).ready,true)
 saved.rows.a.quantity='2';assert.equal(reviewedSource(saved).ready,false)
 saved.rows.a.quantity='1';saved.updatedAt=null;assert.equal(reviewedSource(saved).ready,false)
})
test('saved Part Explorer review prepares original photo, official mapping and seven identities without mutation',async t=>{
 const analysis=JSON.parse(await readFile(new URL('../generated/brick-reverse/0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa.json',import.meta.url)))
 const previous=JSON.parse(await readFile(new URL('../generated/brick-design-traces/0faf5079-d553-430f-9f12-fc95d190b769.json',import.meta.url)))
 const rows=Object.fromEntries(Object.entries(previous.reference.review).map(([id,r])=>[id,{...r,quantity:'1',index:0,search:{rows:[{sourceAllowed:true,source:r.confirmedPart}]}}]))
 const saved={analysis,rows,updatedAt:'2026-10-24T08:43:10.736Z'},mapping={id:previous.inventorySource.reviewId,mapping:{rows:previous.inventorySource.mapping}}
 const before=JSON.stringify({saved,mapping}),p=prepareReviewedSource(saved,mapping,rules)
 assert.equal(p.input.observations.length,7);assert.equal(p.input.relations.length,13)
 assert.equal(p.image.imageBase64,analysis.originalImage.imageBase64)
 assert.deepEqual(p.input.observations.map(o=>[o.id,o.part,o.color]),trace.requestInput.observations.map(o=>[o.id,o.part,o.color]))
 assert.equal(JSON.stringify({saved,mapping}),before)
 const dir=await fixture(t);let called=0
 const s=createSpatialWorkflow(dir,{reverse:{restore:async()=>saved},games:{review:async()=>mapping},loadRules:async()=>rules,runPlanning:async(input,options)=>{called++;assert.equal(input.input.observations.length,7);assert.equal(options.execute,true);return trace}})
 const body={requestId:randomUUID(),analysisId:analysis.id,reviewVersion:reviewedSource(saved).reviewVersion,model:'gpt-6.1-sol',includeEvidence:true}
 const op=await s.dispatch('POST','plan',body);assert.equal(op.state,'complete');assert.equal(called,1)
 assert.deepEqual(await s.dispatch('POST','plan',body),op);assert.equal(called,1)
 const changed=await s.dispatch('POST','plan',{...body,requestId:randomUUID(),reviewVersion:'stale'})
 assert.equal(changed.state,'failed');assert.equal(called,1)
})
test('trace download includes exact saved HTTP bodies; altered plan cannot be executed',async t=>{
 const dir=await fixture(t),s=createSpatialWorkflow(dir)
 const request='{"input":"JSON"}',response='{"output":[]}\n'
 await writeFile(path.join(dir,'brick-spatial-traces',trace.id+'.request.json'),request)
 await writeFile(path.join(dir,'brick-spatial-traces',trace.id+'.response.txt'),response)
 const full=await s.dispatch('GET','plans/'+trace.id+'/trace')
 assert.equal(full.rawRequest,request);assert.equal(full.rawResponse,response)
 const changed=structuredClone(trace.plan);changed.scene.cameraEvidence+=' changed'
 const bad=createSpatialWorkflow(await fixture(t,{plan:changed}))
 assert.equal((await bad.dispatch('GET','plans/'+trace.id)).usable,false)
})
test('in-flight planning request remains locked across service restart',async t=>{
 const dir=await fixture(t);let release
 const waiting=new Promise(resolve=>{release=resolve})
 const s=createSpatialWorkflow(dir,{reverse:{restore:async()=>{await waiting;throw Object.assign(Error('test stop'),{statusCode:422})}}})
 const body={requestId:randomUUID(),analysisId:randomUUID(),model:'gpt-6.1-sol',reviewVersion:'test',includeEvidence:true}
 const pending=s.dispatch('POST','plan',body)
 const file=path.join(dir,'brick-spatial-requests',body.requestId+'.json')
 // Wait only for the durable request record, not for any external service.
 for(let n=0;n<100;n++){try{JSON.parse(await readFile(file));break}catch{await new Promise(r=>setTimeout(r,5))}}
 const restarted=createSpatialWorkflow(dir,{reverse:{restore:()=>assert.fail('must not resubmit')}})
 assert.equal((await restarted.dispatch('POST','plan',body)).state,'running')
 release();assert.equal((await pending).state,'failed')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {selectedProject} from './magnetic-selected-project-fixture.mjs'
import {selectFixture} from './magnetic-selected-fixture.mjs'
import {reconstructionInput} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-scope.ts'
import {selectedScopeKey} from '../src/magnetic-tiles/three-d/reconstruction/selected-lineage.ts'
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'magnetic-selected-lineage-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir);return {dir,api,...await selectedProject(api)}}
test('Project Selected, independent Front/Back chains and immutable parents survive restart; no newest-history selection',async t=>{
 const f=await setup(t),key=n=>selectedScopeKey(f.scopes[n]),head=()=>f.api.dispatch('GET','visible3d/head/'+f.source.id),before=await head()
 assert.equal(before.analysisId,f.analysis.id);assert.equal(before.reviewId,f.review.id);assert.equal(Object.keys(before.groups).length,2)
 for(const g of ['Front','Back']){assert.equal(before.groups[key(g)].plan.id,f.plans[g][1].id);assert.equal(before.groups[key(g)].execution.id,f.executions[g][1].id)}
 const unchanged=await readFile(path.join(f.dir,'visible3d/plans',f.plans.Back[0].id+'.json'))
 await selectFixture(f.api,f.source.id,'plan',f.plans.Back[0]);const changed=await head()
 assert.deepEqual(changed.groups[key('Front')],before.groups[key('Front')]);assert.equal(changed.groups[key('Back')].plan.id,f.plans.Back[0].id);assert.equal(changed.groups[key('Back')].execution,undefined)
 const stale=await f.post('execute',{planId:f.plans.Back[1].id,requestId:randomUUID()});assert.equal(stale.state,'failed');assert.match(stale.error,/Selected Plan/)
 await assert.rejects(selectFixture(f.api,f.source.id,'execution',f.executions.Back[1]),/Selected Plan/)
 await selectFixture(f.api,f.source.id,'execution',f.executions.Back[0]);const o=await f.post('adopt',{executionId:f.executions.Back[0].id,candidateId:'candidate-1'});assert.equal(o.planId,f.plans.Back[0].id)
 assert.equal((await f.api.dispatch('GET','visible3d/selected-origin/'+o.id)).id,o.id);await f.post('build-check',{originId:o.id,assembly:o.assembly})
 await selectFixture(f.api,f.source.id,'plan',f.plans.Back[1]);await assert.rejects(f.api.dispatch('GET','visible3d/selected-origin/'+o.id),/Selected/);await assert.rejects(f.post('build-check',{originId:o.id,assembly:o.assembly}),/Selected/)
 assert.deepEqual(await readFile(path.join(f.dir,'visible3d/plans',f.plans.Back[0].id+'.json')),unchanged)
 const reboot=createMagneticIntake(f.dir);assert.deepEqual(await reboot.dispatch('GET','visible3d/head/'+f.source.id),await head())
})
test('explicit historical Review selection restores its own lineage; Analysis switch clears dependent current selections',async t=>{
 const f=await setup(t),r2=(await f.post('reviews',{analysisId:f.analysis.id,review:f.review.input.review,expectedRevision:1,baseReview:{id:f.review.id,hash:f.review.hash}})).record
 let h=await f.api.dispatch('GET','visible3d/head/'+f.source.id);assert.deepEqual(h.groups,{});assert.equal(h.reviewId,r2.id)
 await selectFixture(f.api,f.source.id,'review',f.review);await selectFixture(f.api,f.source.id,'plan',f.plans.Front[0]);await selectFixture(f.api,f.source.id,'execution',f.executions.Front[0]);assert.equal((await f.post('execute',{planId:f.plans.Front[0].id,requestId:randomUUID()})).state,'complete')
 const a2=await f.post('annotate',{sourceId:f.source.id,evidence:f.analysis.evidence});h=await f.api.dispatch('GET','visible3d/head/'+f.source.id);assert.equal(h.analysisId,f.analysis.id,'creating an Analysis does not select it')
 await selectFixture(f.api,f.source.id,'analysis',a2);h=await f.api.dispatch('GET','visible3d/head/'+f.source.id);assert.equal(h.reviewId,null);assert.deepEqual(h.groups,{})
 await assert.rejects(selectFixture(f.api,f.source.id,'review',f.review),/Selected Analysis/)
 await assert.rejects(f.post('reviews',{analysisId:f.analysis.id,review:f.review.input.review,expectedRevision:h.revision}),/Selected Analysis/)
 const result=await f.post('execute',{planId:f.plans.Front[0].id,requestId:randomUUID()});assert.equal(result.state,'failed');assert.match(result.error,/Selected/)
 assert.equal(f.review.analysisId,f.analysis.id);assert.equal(f.plans.Front[0].reviewId,f.review.id)
})
test('membership changes invalidate only affected Group selections; names alone do not alter geometry inputs',async t=>{
 const f=await setup(t),head=()=>f.api.dispatch('GET','visible3d/head/'+f.source.id),moduleState=()=>f.api.dispatch('GET','visible3d/module-state/'+f.review.id),key=n=>selectedScopeKey(f.scopes[n]),back=f.modules.modules.find(m=>m.name==='Back'),before=await head()
 let m=await moduleState();await f.post('module-plans',{reviewId:f.review.id,reviewHash:f.review.hash,expectedRevision:m.head.revision,expectedHash:m.head.recordHash,command:{kind:'rename',moduleId:back.id,name:'Rear'}})
 assert.deepEqual((await head()).groups,before.groups)
 m=await moduleState();await f.post('module-plans',{reviewId:f.review.id,reviewHash:f.review.hash,expectedRevision:m.head.revision,expectedHash:m.head.recordHash,command:{kind:'members',moduleId:back.id,observationIds:back.observationIds.slice(1)}})
 const h=await head();assert.deepEqual(h.groups[key('Front')],before.groups[key('Front')]);assert.equal(h.groups[key('Back')],undefined)
 await assert.rejects(selectFixture(f.api,f.source.id,'plan',f.plans.Back[0]),/范围|成员/)
 assert.equal((await f.post('execute',{planId:f.plans.Back[0].id,requestId:randomUUID()})).state,'failed')
})
test('CAS, wrong Hash and cross-Project IDs cannot change Selected; stale generation preserves its record without stealing selection',async t=>{
 const f=await setup(t),h=await f.api.dispatch('GET','visible3d/head/'+f.source.id),body={sourceId:f.source.id,expectedRevision:h.selectedRevision,stage:'plan',id:f.plans.Back[0].id,hash:f.plans.Back[0].hash}
 const results=await Promise.allSettled([f.post('selected',body),f.post('selected',{...body,id:f.plans.Front[0].id,hash:f.plans.Front[0].hash})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 const current=await f.api.dispatch('GET','visible3d/head/'+f.source.id);await assert.rejects(f.post('selected',{...body,expectedRevision:current.selectedRevision,hash:'forged'}),/Hash/)
 const other=await f.api.dispatch('POST','source-sets',{images:[{sourceId:f.source.id,sourceHash:f.source.hash,name:f.source.name,origin:'upload',role:'Final',direction:'Unknown',note:'Explicit other Project test'}]})
 await assert.rejects(f.post('selected',{...body,sourceId:other.id,expectedRevision:0}),/Project/)
 assert.deepEqual(await f.api.dispatch('GET','visible3d/head/'+f.source.id),current)
})
test('a delayed Planning response cannot steal a newer explicit selection; its immutable result remains in history',async t=>{
 const f=await setup(t),{createVisible3DWorkflow}=await import('../server/magnetic-visible3d.mjs'),{mkdir,writeFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{png}=await import('./magnetic-visible3d-fixtures.mjs')
 let started,release;const submitted=new Promise(r=>started=r),finish=new Promise(r=>release=r),before=await f.api.dispatch('GET','visible3d/head/'+f.source.id)
 const workflow=createVisible3DWorkflow(path.join(f.dir,'visible3d'),{readSource:id=>f.api.read('sources',id),readImage:async()=>png,getRegistry:()=>f.api.dispatch('GET','profiles'),runModel:async(prepared,options)=>{
  started();await finish
  const id=randomUUID(),value=f.plans.Back[0].plan,trace={id,task:'magnetic-visible3d-plan',promptVersion:'offline-selected-race-fixture',status:'plan_ready_for_review',parseStatus:'parsed',validation:{valid:true,issues:[]},wireStatus:'response_saved',finishReason:'completed',requestInput:prepared.input,plan:value,rawOutput:JSON.stringify(value),usageMetadata:{fixture:true,inputTokens:0,outputTokens:0}};await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,id+'.json'),JSON.stringify(trace));return trace
 }})
 const pending=workflow.dispatch('POST','plan',{reviewId:f.review.id,reconstructionScope:f.scopes.Back,expectedSelectedRevision:before.selectedRevision,model:'offline-fixture',requestId:randomUUID()});await submitted
 await selectFixture(f.api,f.source.id,'plan',f.plans.Back[0]);release();const result=await pending;assert.equal(result.state,'failed');assert.match(result.error,/Selected/)
 const h=await f.api.dispatch('GET','visible3d/head/'+f.source.id);assert.equal(h.groups[selectedScopeKey(f.scopes.Back)].plan.id,f.plans.Back[0].id)
 const history=await f.api.dispatch('GET','visible3d/history'),saved=history.plans.filter(p=>p.promptVersion==='offline-selected-race-fixture');assert.equal(saved.length,1);assert.equal(saved[0].reviewId,f.review.id);assert.equal(saved[0].plan.parts.length,2)
 const rejected=await workflow.dispatch('POST','plan',{reviewId:f.review.id,reconstructionScope:f.scopes.Back,expectedSelectedRevision:before.selectedRevision,model:'offline-fixture',requestId:randomUUID()});assert.equal(rejected.state,'failed');assert.match(rejected.error,/未调用模型/)
 // Hash of original result remains unchanged; no parent was rebound.
 const record=JSON.parse(await readFile(path.join(f.dir,'visible3d/plans',f.plans.Back[0].id+'.json'),'utf8')),{hash,...payload}=record;assert.equal(createHash('sha256').update(JSON.stringify(payload)).digest('hex'),hash)
})

test('Image scope is bound input, not a second simultaneous Selected Plan inside one Group',async t=>{
 const f=await setup(t),h=await f.api.dispatch('GET','visible3d/head/'+f.source.id),groupId=f.scopes.Back.groupId,scope=reconstructionInput(f.review.input,f.source,{groupId,imageId:f.source.id},f.modules).scope
 const p=await f.post('manual-plan',{reviewId:f.review.id,reconstructionScope:scope,plan:f.plans.Back[1].plan}),next=await f.api.dispatch('GET','visible3d/head/'+f.source.id)
 assert.equal(Object.keys(next.groups).length,2);assert.equal(next.groups[groupId].plan.id,p.id);assert.equal(next.groups[groupId].scope.imageId,f.source.id);assert.equal(next.groups[groupId].execution,undefined);assert.deepEqual(next.groups[f.scopes.Front.groupId],h.groups[f.scopes.Front.groupId])
 await selectFixture(f.api,f.source.id,'plan',f.plans.Back[1]);assert.equal((await f.api.dispatch('GET','visible3d/head/'+f.source.id)).groups[groupId].scope.imageId,'all')
})

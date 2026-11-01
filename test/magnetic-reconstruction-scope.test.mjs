import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,mkdtemp,cp,rm} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID,createHash} from 'node:crypto'
import {reconstructionInput,subsetVisibleInput,reconstructionScopeMatches} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-scope.ts'
import {normalizeReviewDisplay} from '../src/magnetic-tiles/intake/review-display.ts'
import {planningRequest} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-display.ts'
import {rebaseSpatialPlan} from '../src/magnetic-tiles/three-d/reconstruction/rebase-plan.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {png} from './magnetic-visible3d-fixtures.mjs'
// Portable recorded geometry/evidence fixture. No generated/production files are required.
const fixtureFile=new URL('../checks/magnetic-3d/fixtures/car-reviewed-geometry.json',import.meta.url),fixtureBytes=await readFile(fixtureFile),car=JSON.parse(fixtureBytes)
const record=data=>({...data,hash:createHash('sha256').update(JSON.stringify(data)).digest('hex')})
const frameIds=['a46687756c575adb7d1401d31d0e8c667c794f80bc483644c4601b25cb03fbcc','d3677ba6109be40b4613ac19f113a588951f305a4e2d93eef078884493419b8a','c661173e076f29bdde6dd11b80992ebd756703617b0480afd2498fce1cd4f4ae',car.input.evidence.referenceImageId]
const source={id:car.provenance.sourceId,hash:'a'.repeat(64),name:'OFFLINE recorded car evidence',primaryImageId:frameIds[3],view:{width:1,height:1},images:frameIds.map((id,i)=>({sourceId:id,sourceHash:'b'.repeat(64),name:i===3?'car-all.png':`car-${i+1}.png`,view:{width:1,height:1},origin:'server',role:i===3?'Final':'Step',direction:'Oblique',note:'offline fixture'}))}
const analysis=record({id:'00000000-0000-4000-8000-000000000001',sourceId:source.id,sourceHash:source.hash,evidence:car.input.evidence,origin:'human-annotation',traceId:null})
const review=record({id:car.provenance.reviewId,sourceId:source.id,sourceHash:source.hash,analysisId:analysis.id,analysisHash:analysis.hash,input:car.input})
const plan=record({id:car.provenance.planId,sourceId:source.id,sourceHash:source.hash,reviewId:review.id,reviewHash:review.hash,plan:car.plan,origin:'human-hypothesis',traceId:null})
const modules=record({id:'00000000-0000-4000-8000-000000000002',kind:'magnetic-module-plan',schemaVersion:1,modulePlanId:'00000000-0000-4000-8000-000000000003',revision:1,parent:null,sourceId:source.id,sourceHash:source.hash,analysisId:analysis.id,analysisHash:analysis.hash,reviewId:review.id,reviewHash:review.hash,modules:[{id:'00000000-0000-4000-8000-000000000004',name:'m_back',observationIds:car.input.review.pieces.slice(0,14).map(p=>p.id)},{id:'00000000-0000-4000-8000-000000000005',name:'m_front',observationIds:car.input.review.pieces.slice(14).map(p=>p.id)}],change:{kind:'create',moved:[]}})
const back=modules.modules.find(m=>m.name==='m_back'),front=modules.modules.find(m=>m.name==='m_front'),image=name=>source.images.find(i=>i.name===name).sourceId
const project=(groupId='all',imageId='all')=>reconstructionInput(review.input,source,{groupId,imageId},modules)
test('real 23-piece car intersects exact group IDs and image annotations; all includes unassigned',()=>{
 const before=JSON.stringify({review,modules})
 assert.equal(project().scope.observationIds.length,23);assert.equal(project(back.id).scope.observationIds.length,14);assert.equal(project(front.id).scope.observationIds.length,9)
 assert.deepEqual(project(back.id,image('car-3.png')).scope.observationIds,[]);assert.deepEqual(project(front.id,image('car-3.png')).scope.observationIds,['p19','p21','p23'])
 assert.deepEqual(project('all',image('car-2.png')).scope.observationIds,['p13','p14'])
 const omitted=structuredClone(modules);omitted.modules.pop();assert.equal(reconstructionInput(review.input,source,{},omitted).scope.observationIds.length,23)
 assert.equal(JSON.stringify({review,modules}),before);assert.throws(()=>project('foreign'),/模块/);assert.throws(()=>project('all','foreign'),/图片/)
})
test('subset removes outside parts, profiles, constraints, checks and spatial refs before planning without changing source evidence',()=>{
 const result=project(front.id,image('car-3.png')).input,ids=new Set(['p19','p21','p23'])
 assert.deepEqual(result.review.pieces.map(p=>p.id),[...ids]);assert.deepEqual(result.evidence.observations.map(p=>p.id),[...ids])
 for(const c of result.review.constraints)assert.ok(ids.has(c.pieceA)&&ids.has(c.pieceB))
 for(const f of result.evidence.spatialInterpretation.faces)assert.ok(ids.has(f.pieceId))
 for(const c of result.evidence.spatialInterpretation.connections)assert.ok(ids.has(c.pieceA)&&ids.has(c.pieceB))
 for(const o of result.evidence.observations)assert.deepEqual(o,review.input.evidence.observations.find(p=>p.id===o.id),'multi-frame coordinates retained verbatim')
 const unknown=structuredClone(review.input);unknown.review.pieces.find(p=>p.id==='p19').confirmed=false;unknown.review.pieces.find(p=>p.id==='p21').excluded=true;unknown.review.constraints=[];unknown.review.spatialChecks=[]
 assert.deepEqual(reconstructionInput(unknown,source,{groupId:front.id,imageId:image('car-3.png')},modules).scope.observationIds,['p23'])
 assert.throws(()=>subsetVisibleInput(review.input,['foreign']),/未知/)
})
test('scope matching isolates historical full result, group, image and membership; UI choices persist independently of evidence browsing',()=>{
 const all=project().scope,f=project(front.id).scope,b=project(back.id).scope,single=project(front.id,image('car-3.png')).scope
 assert.equal(reconstructionScopeMatches(undefined,all),true);assert.equal(reconstructionScopeMatches(undefined,all,all.observationIds.slice(1)),false);assert.equal(reconstructionScopeMatches(undefined,f),false);assert.equal(reconstructionScopeMatches(f,b),false);assert.equal(reconstructionScopeMatches(f,single),false);assert.equal(reconstructionScopeMatches({...f,groupName:'renamed'},f),true)
 assert.equal(reconstructionScopeMatches({...f,observationIds:f.observationIds.slice(1)},f),false)
 const state=normalizeReviewDisplay({reconstructionGroup:front.id,reconstructionImage:image('car-3.png'),imageIds:[],moduleFilter:back.id},source.images.map(i=>i.sourceId),review.input.review.pieces.map(p=>p.id));assert.equal(state.reconstructionGroup,front.id);assert.equal(state.reconstructionImage,image('car-3.png'));assert.equal(state.moduleFilter,back.id)
 const failed=scope=>({id:randomUUID(),kind:'plan',createdAt:new Date().toISOString(),state:'failed',reconstructionScope:scope,trace:{sources:[{sourceId:source.id,sourceHash:source.hash,reviewId:review.id,reviewHash:review.hash}]}})
 const old=failed(all),local=failed(f);assert.equal(planningRequest([old,local],source,review,null,null,f).id,local.id);assert.equal(planningRequest([old],source,review,null,null,f),undefined)
})
async function isolated(t){
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-scope-'));t.after(()=>rm(dir,{recursive:true,force:true}));const registry=createMagneticIntake(dir),directory=path.join(dir,'visible3d')
 for(const [kind,data]of [['analyses',analysis],['reviews',review],['plans',plan],['module-plans',modules],['module-heads',{id:review.id,revision:1,recordId:modules.id,recordHash:modules.hash,modulePlanId:modules.modulePlanId}],['heads',{id:source.id,revision:1,reviewId:review.id,reviewHash:review.hash}]]){await mkdir(path.join(directory,kind),{recursive:true});await writeFile(path.join(directory,kind,data.id+'.json'),JSON.stringify(data))}
 const factory=()=>{const workflow=createVisible3DWorkflow(directory,{readSource:async id=>{assert.equal(id,source.id);return source},readImage:async()=>png,readImages:async()=>source.images.map(i=>({...i,...png})),getRegistry:()=>registry.dispatch('GET','profiles')});return {dispatch:(method,route,body)=>workflow.dispatch(method,route.replace(/^visible3d\//,''),body)}}
 return {dir,api:factory(),factory}
}
test('production planning request/Parser/Validator and V5 consume the subset, persist scope, replay/adopt safely; HTTP intercepted only in test',async t=>{
 const {dir,api,factory}=await isolated(t),fetchBefore=globalThis.fetch,keyBefore=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='offline-test-no-real-key';const requests=[]
 t.after(()=>{globalThis.fetch=fetchBefore;if(keyBefore===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=keyBefore})
 globalThis.fetch=async(url,options)=>{
  assert.match(String(url),/api.openai.com/);const wire=JSON.parse(options.body),text=wire.input[0].content.find(c=>c.type==='input_text').text,prepared=JSON.parse(text.slice(text.indexOf('{')));requests.push(prepared)
  // Explicit offline fixture, NOT a runtime fallback or a new real Vision/Planning result.
  const fixture=rebaseSpatialPlan(plan.plan,review.input,prepared.geometryInput).plan
  return new Response(JSON.stringify({id:'offline-scope-response',model:'gpt-4.1',status:'completed',usage:{input_tokens:100,output_tokens:100,total_tokens:200},output:[{content:[{type:'output_text',text:JSON.stringify(fixture)}]}]}),{status:200,headers:{'Content-Type':'application/json'}})
 }
 const post=(route,body)=>api.dispatch('POST','visible3d/'+route,body),results=[]
 for(const selection of [{groupId:'all',imageId:'all'},{groupId:back.id,imageId:'all'},{groupId:front.id,imageId:'all'},{groupId:front.id,imageId:image('car-3.png')}]){
  const expected=reconstructionInput(review.input,source,selection,modules),p=await post('plan',{reviewId:review.id,model:'gpt-4.1',requestId:randomUUID(),reconstructionScope:expected.scope});assert.equal(p.state,'complete',JSON.stringify(p.error??p.trace?.validation));assert.ok(p.record);assert.deepEqual(requests.at(-1).geometryInput.review.pieces.map(p=>p.id),expected.scope.observationIds);assert.deepEqual(requests.at(-1).geometryInput.evidence.observations.map(o=>o.id),expected.scope.observationIds);assert.deepEqual(p.record.reconstructionScope,expected.scope)
  const x=await post('execute',{planId:p.record.id,requestId:randomUUID(),reconstructionScope:expected.scope,options:{maxAssignments:128,maxGeometryChecks:256,maxLocalSubsets:1024}});assert.equal(x.state,'complete',x.error);assert.equal(x.record.version,5);assert.deepEqual(x.record.reconstructionScope,expected.scope)
  for(const c of [...x.record.candidates,...x.record.diagnosticCandidates]){assert.equal(c.coverage.totalConfirmed,expected.scope.observationIds.length);assert.ok(c.assembly.pieces.every(p=>expected.scope.observationIds.includes(p.id)))}
  if(selection.groupId===back.id&&x.record.candidates.length){const c=x.record.candidates[0],o=await post('adopt',{executionId:x.record.id,candidateId:c.id,visualChecked:true});assert.deepEqual(o.assembly.pieces,c.assembly.pieces);assert.ok(o.pendingObservations.every(p=>expected.scope.observationIds.includes(p.id)));assert.deepEqual(o.reconstructionScope,expected.scope)}
  const restored=factory();assert.deepEqual((await restored.dispatch('GET','visible3d/executions/'+x.record.id)).record,x.record);results.push({p:p.record,x:x.record})
 }
 assert.equal(requests.length,4)
 const empty=await post('plan',{reviewId:review.id,model:'gpt-4.1',requestId:randomUUID(),reconstructionScope:project(back.id,image('car-3.png')).scope});assert.equal(empty.state,'failed');assert.match(empty.error,/没有可重建的交集/);assert.equal(requests.length,4)
 const mismatched=await post('execute',{planId:results[0].p.id,requestId:randomUUID(),reconstructionScope:project(front.id).scope});assert.equal(mismatched.state,'failed');assert.match(mismatched.error,/范围/)
 const invalid=await post('plan',{reviewId:review.id,model:'gpt-4.1',requestId:randomUUID(),reconstructionScope:{...project(front.id).scope,observationIds:['p01']}});assert.equal(invalid.state,'failed');assert.equal(requests.length,4)
 const chosen=results[1],refined=await post('refine-constraints',{planId:chosen.p.id,planHash:chosen.p.hash});assert.ok(refined.refinement.candidates.every(c=>c.plan.parts.every(p=>back.observationIds.includes(p.id))))
 const option=refined.refinement.candidates[0];if(option){const executed=await post('execute',{planId:chosen.p.id,requestId:randomUUID(),reconstructionScope:chosen.p.reconstructionScope,refinement:{id:refined.id,hash:refined.hash,candidateId:option.id,candidateHash:refined.candidateHashes[option.id]},options:{maxAssignments:128,maxGeometryChecks:256,maxLocalSubsets:1024}});assert.equal(executed.state,'complete',executed.error);assert.ok(executed.record.candidates.every(c=>c.assembly.pieces.every(p=>back.observationIds.includes(p.id))))}
 const manual=await post('manual-plan',{reviewId:review.id,basedOnPlanId:chosen.p.id,plan:chosen.p.plan});assert.deepEqual(manual.reconstructionScope,chosen.p.reconstructionScope)
 assert.deepEqual(await readFile(fixtureFile),fixtureBytes)
 await mkdir('/tmp/magnetic-v1b',{recursive:true});await writeFile('/tmp/magnetic-v1b/node-results.json',JSON.stringify(results.map(({p,x})=>({group:p.reconstructionScope.groupName,image:p.reconstructionScope.imageName,ids:p.reconstructionScope.observationIds,candidates:x.candidates.length,max:x.candidates[0]?.assembly.pieces.length??0,checks:x.search.geometryChecks})),null,2))
})

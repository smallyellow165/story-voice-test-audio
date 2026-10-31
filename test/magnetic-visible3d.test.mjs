import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
import {buildVisibleRequest,observationPrompt,planningPrompt} from '../server/magnetic-visible3d-vision.mjs'
import {runStructuredSpatialModel} from '../server/spatial-model-run.mjs'
import {captureVisionWire} from '../server/brick-vision-wire.mjs'

async function setup(t){const directory=await mkdtemp(path.join(tmpdir(),'visible3d-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const api=createMagneticIntake(directory),fixture=await visibleFixture();const source=await api.dispatch('POST','sources',{name:'synthetic test evidence.png',original:png,view:png});return {directory,api,source,...fixture}}
const post=(api,route,body)=>api.dispatch('POST','visible3d/'+route,body)
async function prepared(t){const f=await setup(t),analysis=await post(f.api,'annotate',{sourceId:f.source.id,evidence:f.evidence}),r=await post(f.api,'reviews',{analysisId:analysis.id,review:f.review,thickness:.06,expectedRevision:0}),p=await post(f.api,'manual-plan',{reviewId:r.record.id,plan:f.plan}),x=await post(f.api,'execute',{planId:p.id,requestId:randomUUID()});assert.equal(x.state,'complete');assert.equal(x.record.candidates.length,1);return {...f,analysis,r,p,x:x.record}}
test('real intake source + immutable Review/Plan/Execution + origin adoption survives factory restart',async t=>{
 const f=await prepared(t),before=await f.api.dispatch('GET','history')
 const o=await post(f.api,'adopt',{executionId:f.x.id,candidateId:f.x.candidates[0].id,visualChecked:true})
 assert.deepEqual(o.assembly.pieces,f.x.candidates[0].assembly.pieces);assert.deepEqual(o.assembly.profiles,f.r.record.input.profiles);assert.equal(o.observationMap.length,2);assert.equal(o.photoMatch.score,null);assert.equal(o.humanReview.status,'accepted')
 const restored=createMagneticIntake(f.directory);assert.deepEqual(await restored.dispatch('GET','visible3d/origins/'+o.id),o)
 const l=await restored.dispatch('GET','visible3d/executions/'+f.x.id);assert.equal(l.outdated,false);assert.equal(l.record.planHash,f.p.hash)
 const after=await f.api.dispatch('GET','history');assert.deepEqual(after,before,'2D analyses/reviews/reconstructions/selected/origins untouched')
})
test('review head CAS and stale candidate rejection work even when old IDs are submitted directly',async t=>{
 const f=await prepared(t);await assert.rejects(post(f.api,'reviews',{analysisId:f.analysis.id,review:f.review,expectedRevision:0}),/其他页面/)
 await post(f.api,'reviews',{analysisId:f.analysis.id,review:f.review,expectedRevision:1})
 assert.equal((await f.api.dispatch('GET','visible3d/executions/'+f.x.id)).outdated,true)
 await assert.rejects(post(f.api,'adopt',{executionId:f.x.id,candidateId:'candidate-1',visualChecked:true}),/过期/)
 const execute=await post(f.api,'execute',{planId:f.p.id,requestId:randomUUID()});assert.equal(execute.state,'failed');assert.match(execute.error,/Review/)
})
test('exact profile set, manual confirmation and integrity checks prevent unsupported adoption',async t=>{
 const f=await prepared(t);await assert.rejects(post(f.api,'adopt',{executionId:f.x.id,candidateId:'candidate-1'}),/对照/)
 const plan=structuredClone(f.plan);plan.parts[0].profileVersion=99;await assert.rejects(post(f.api,'manual-plan',{reviewId:f.r.record.id,plan}),/不得改变/)
 plan.parts.pop();await assert.rejects(post(f.api,'manual-plan',{reviewId:f.r.record.id,plan}),/不得改变|丢失/)
 const filename=path.join(f.directory,'visible3d','executions',f.x.id+'.json');const changed=JSON.parse(await readFile(filename,'utf8'));changed.candidates[0].assembly.pieces[0].pose.position[0]+=3;await writeFile(filename,JSON.stringify(changed))
 await assert.rejects(post(f.api,'adopt',{executionId:f.x.id,candidateId:'candidate-1',visualChecked:true}),/Hash/)
})
test('request deduplication, budget failure persistence, and input fingerprint collision protect repeated execution',async t=>{
 const f=await prepared(t),body={planId:f.p.id,requestId:randomUUID(),options:{maxAssignments:0}}
 const x=await post(f.api,'execute',body);assert.equal(x.record.status,'budget_exhausted');assert.deepEqual(x.record.candidates,[])
 const reboot=createMagneticIntake(f.directory);assert.deepEqual(await post(reboot,'execute',body),x)
 await assert.rejects(post(reboot,'execute',{...body,options:{maxAssignments:4}}),/不同输入/)
 await assert.rejects(post(reboot,'adopt',{executionId:x.record.id,candidateId:'candidate-1',visualChecked:true}),/复核失败/)
})
test('same source shared, separate 2D prompt and both providers use explicit Visible3D contracts',async()=>{
 const f=await visibleFixture(),prepared={image:png,input:{geometryInput:f.input,catalog:f.assembly.profiles}}
 for(const kind of ['analysis','plan']){
  const openai=buildVisibleRequest('gpt-4.1',prepared,kind),gemini=buildVisibleRequest('gemini-3.6-flash',prepared,kind)
  assert.equal(openai.model,'gpt-4.1');assert.match(openai.instructions,/hidden/);assert.equal(gemini.config.responseMimeType,'application/json');assert.ok(gemini.config.responseSchema.properties)
  assert.equal(openai.input[0].content.filter(c=>c.type==='input_image').length,1)
 }
 assert.match(observationPrompt,/complete outline is NOT required/);assert.match(planningPrompt,/No final XYZ/)
})
test('DUPLO shared runner records an actual mocked HTTP wire once; incomplete response remains inspectable',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'visible3d-model-'));t.after(()=>rm(directory,{recursive:true,force:true}));const previous=process.env.OPENAI_API_KEY,fetchBefore=globalThis.fetch;process.env.OPENAI_API_KEY='test-only-not-a-real-key';t.after(()=>{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;globalThis.fetch=fetchBefore})
 const f=await setup(t),prepared={image:png,input:{geometryInput:f.input},imagePayloadSha256:'test-image-sha'},calls=[];let responseOutput=f.plan,responseStatus='completed'
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({id:'mock-response',model:'gpt-4.1',status:responseStatus,output:[{content:[{type:'output_text',text:JSON.stringify(responseOutput)}]}]}),{status:200,headers:{'Content-Type':'application/json'}})}
 const r=await runStructuredSpatialModel(prepared,{model:'gpt-4.1',directory,execute:true},{runtimeStatus:async()=>({current:true}),promptVersion:'test',recordTask:'magnetic-visible3d-plan',buildRequest:(m,p)=>buildVisibleRequest(m,p,'plan'),validate:()=>({valid:true}),capture:captureVisionWire})
 assert.equal(calls.length,1);assert.equal(r.status,'plan_ready_for_review');assert.equal(r.wireStatus,'response_saved');assert.deepEqual(r.plan,f.plan)
 assert.match(await readFile(r.rawRequestPath,'utf8'),/input_image/);assert.match(await readFile(r.rawResponsePath,'utf8'),/mock-response/)
 const workflow=createVisible3DWorkflow(path.join(directory,'whole-workflow'),{readSource:id=>f.api.read('sources',id),readImage:async()=>png,getRegistry:()=>f.api.dispatch('GET','profiles')})
 responseOutput=f.evidence
 const analyzed=await workflow.dispatch('POST','analyze',{sourceId:f.source.id,model:'gpt-4.1',requestId:randomUUID()});assert.equal(analyzed.usable,true)
 const reviewed=await workflow.dispatch('POST','reviews',{analysisId:analyzed.record.id,review:f.review,expectedRevision:0})
 responseOutput=f.plan
 const planned=await workflow.dispatch('POST','plan',{reviewId:reviewed.record.id,model:'gpt-4.1',requestId:randomUUID()});assert.equal(planned.usable,true)
 const executed=await workflow.dispatch('POST','execute',{planId:planned.record.id,requestId:randomUUID()});assert.equal(executed.record.candidates.length,1);assert.equal(calls.length,3)
 responseStatus='incomplete'
 const incomplete=await workflow.dispatch('POST','analyze',{sourceId:f.source.id,model:'gpt-4.1',requestId:randomUUID()});assert.equal(incomplete.usable,false);assert.equal(incomplete.trace.finishReason,'incomplete');assert.equal(incomplete.trace.wireStatus,'response_saved');assert.deepEqual(incomplete.trace.plan,f.plan)

})
test('analysis and planning service adapter preserve input and reject parsed output without captured wire',async t=>{
 const f=await setup(t),records=[]
 const runModel=async(prepared,options,kind)=>{records.push({prepared,options,kind});const plan=kind==='analysis'?f.evidence:f.plan;const trace={id:randomUUID(),requestInput:prepared.input,status:'plan_ready_for_review',parseStatus:'parsed',validation:{valid:true},wireStatus:'response_saved',finishReason:'completed',rawOutput:JSON.stringify(plan),plan};await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,trace.id+'.json'),JSON.stringify(trace));return trace}
 const workflow=createVisible3DWorkflow(path.join(f.directory,'direct'),{readSource:id=>f.api.read('sources',id),readImage:async()=>png,getRegistry:()=>f.api.dispatch('GET','profiles'),runModel})
 const a=await workflow.dispatch('POST','analyze',{sourceId:f.source.id,model:'gpt-4.1',requestId:randomUUID()});assert.equal(a.usable,true)
 const r=await workflow.dispatch('POST','reviews',{analysisId:a.record.id,review:f.review,expectedRevision:0})
 const p=await workflow.dispatch('POST','plan',{reviewId:r.record.id,model:'gpt-4.1',requestId:randomUUID()});assert.equal(p.usable,true);assert.deepEqual(records[1].prepared.input.geometryInput,r.record.input)
 assert.ok(records[1].prepared.input.ports[0].shape.ports.length);assert.equal(records[0].kind,'analysis');assert.equal(records[1].kind,'plan')
})

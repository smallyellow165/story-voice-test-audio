import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {analysisRequest,planningScope,executionScope,planningRequest,executionRequest,requestFailure,planningDisplay,executionDisplay} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-display.ts'
const source={id:'s',hash:'source-hash'},review={id:'r',hash:'review-hash'},plan={id:'p',hash:'plan-hash'},execution={id:'x',hash:'execution-hash'}
const refs={sourceId:source.id,sourceHash:source.hash,reviewId:review.id,reviewHash:review.hash}
const failed={id:'failed',kind:'plan',state:'complete',usable:false,createdAt:'2026-10-31',trace:{id:'failed-trace',status:'invalid_plan',sources:[refs],validation:{valid:false,issues:['空间关系无效']}}}
const ready={id:'ready',kind:'plan',state:'complete',createdAt:'2026-10-30',record:{id:plan.id},trace:{id:'ready-trace',status:'plan_ready_for_review',validation:{valid:true},sources:[refs]}}
test('Planning failures survive a missing Plan; attribution requires exact Source and Review hashes',()=>{
 assert.equal(planningRequest([ready,failed],source,review,null,null),failed)
 assert.equal(planningRequest([failed],{...source,hash:'different'},review,null,null),undefined)
 assert.equal(planningRequest([failed],source,{...review,hash:'different'},null,null),undefined)
 assert.equal(planningRequest([{...failed,trace:{...failed.trace,sources:[]}}],source,review,null,null),undefined)
 assert.equal(planningRequest([ready,failed],source,review,plan,null),ready,'selected Plan pins its own request, not a newer failed attempt')
 assert.equal(planningRequest([failed],source,review,{id:'manual',hash:'manual-hash'},null),undefined,'manual Plan never borrows a model Trace')
 assert.equal(planningRequest([ready,failed],source,review,plan,{id:failed.id,kind:'plan',scope:planningScope(source,review)}),failed,'explicit regeneration failure is distinct from retained Plan')
})
test('idle, running, failed, ready and execution waiting/success states keep accurate semantics',()=>{
 assert.equal(planningDisplay(null,undefined,false).tone,'neutral')
 assert.equal(planningDisplay(plan,ready,true).tone,'running')
 assert.equal(planningDisplay(null,{...failed,state:'running'},false).tone,'running')
 assert.equal(planningDisplay(null,failed,false,'generic message').message,'空间关系无效')
 assert.equal(planningDisplay(plan,ready,false).tone,'review')
 assert.match(planningDisplay(plan,ready,false).message,/照片语义正确性尚未验证/)
 assert.equal(executionDisplay(null,null,undefined,false).label,'等待 Plan')
 assert.equal(executionDisplay(plan,null,undefined,false).tone,'neutral')
 const x={status:'candidates_found',candidates:[{geometry:{valid:true}}],diagnostics:[]}
 assert.equal(executionDisplay(plan,x,undefined,true).tone,'running')
 assert.equal(executionDisplay(plan,x,undefined,false).tone,'valid')
 assert.match(executionDisplay(plan,x,undefined,false).message,/Photo Match 未验证/)
 assert.equal(executionDisplay(plan,{...x,status:'budget_exhausted'},undefined,false).tone,'error')
 assert.equal(executionDisplay(plan,{...x,status:'no_valid_candidate',candidates:[]},undefined,false).tone,'error')
 assert.equal(executionDisplay(plan,{...x,candidates:[{geometry:{valid:false}}]},undefined,false).tone,'error')
 assert.equal(executionDisplay(plan,x,undefined,false,'HTTP 409: 来源已过期').message,'HTTP 409: 来源已过期')
 assert.match(requestFailure({...failed,trace:{...failed.trace,error:{code:'PROVIDER',message:'actual provider diagnostic'}}}),/actual provider diagnostic/)
})
test('Execution request lookup isolates selected Execution, Plan and explicit failed retries',()=>{
 const a={id:'a',kind:'execute',state:'complete',createdAt:'2026-10-31',planId:plan.id,record:{id:execution.id}},b={id:'b',kind:'execute',state:'failed',createdAt:'2026-11-01',planId:plan.id,error:'solver request rejected'}
 assert.equal(executionRequest([a,b],plan,execution,null),a)
 assert.equal(executionRequest([a,b],plan,null,null),b)
 assert.equal(executionRequest([a,b],{id:'another',hash:'other'},null,null),undefined)
 assert.equal(executionRequest([a,b],plan,execution,{id:'b',kind:'execute',scope:executionScope(plan)}),b)
 assert.equal(executionRequest([a,b],plan,execution,{id:'b',kind:'execute',scope:'wrong'}),a)
})
test('read-only wire adapter serves captured files with existing redaction, never inventing missing wire',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'visible-wire-display-')),id=randomUUID(),traceDir=path.join(directory,'model-traces'),trace={id,status:'invalid_plan',request:{prepared:true},rawOutput:'{}'}
 try{
  await mkdir(traceDir);await writeFile(path.join(traceDir,id+'.json'),JSON.stringify(trace));const workflow=createVisible3DWorkflow(directory,{})
  let result=await workflow.dispatch('GET','trace/'+id+'/wire');assert.equal(result.request.available,false);assert.equal(result.response.available,false)
  const request={model:'offline-test',prompt:'actual captured request',api_key:'synthetic-test-only',image:'data:image/png;base64,AAAA'};await writeFile(path.join(traceDir,id+'.request.json'),JSON.stringify(request));await writeFile(path.join(traceDir,id+'.response.txt'),'actual captured response')
  result=await workflow.dispatch('GET','trace/'+id+'/wire');assert.equal(result.request.available,true);assert.match(result.request.text,/actual captured request/);assert.ok(!result.request.text.includes('synthetic-test-only'));assert.ok(!result.request.text.includes('data:image/'));assert.equal(result.response.text,'actual captured response')
  assert.deepEqual(await workflow.dispatch('GET','trace/'+id),trace);assert.deepEqual(JSON.parse(await readFile(path.join(traceDir,id+'.request.json'),'utf8')),request)
  await assert.rejects(workflow.dispatch('GET','trace/'+id+'/wire/other'));await assert.rejects(workflow.dispatch('GET','trace/../wire'))
 }finally{await rm(directory,{recursive:true,force:true})}
})

test('Analysis Trace recovers failed no-result requests and isolates source hashes and explicit history selection',()=>{
 const a={id:'analysis',sourceId:source.id,sourceHash:source.hash,traceId:'success-trace'},success={...ready,kind:'analyze',record:{id:a.id},trace:{...ready.trace,id:a.traceId}},failure={...failed,kind:'analyze'}
 assert.equal(analysisRequest([success,failure],source,null),failure)
 assert.equal(analysisRequest([success,failure],source,a),failure,'latest failure is recoverable without a new Recognition Result')
 assert.equal(analysisRequest([success,failure],source,a,'record'),success,'explicit history pins its own trace')
 assert.equal(analysisRequest([success,failure],source,a,failure.id),failure,'failure selection survives refresh with retained older success')
 assert.equal(analysisRequest([success,failure],{...source,hash:'other'},a,failure.id),undefined)
 assert.equal(analysisRequest([success,failure],{id:'other',hash:source.hash},a,failure.id),undefined)
 assert.equal(analysisRequest([success,failure],source,a,'missing-request'),undefined,'never fall back from an unavailable explicit request')
 assert.equal(analysisRequest([failure],source,{...a,id:'manual',traceId:null},'record'),undefined)
 assert.equal(analysisRequest([{...failure,trace:{...failure.trace,sources:[]}}],source,null),undefined)
 assert.equal(analysisRequest([failure],null,null),undefined)
})

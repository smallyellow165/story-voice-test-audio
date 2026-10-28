import {buildOpenaiRequest} from '../server/openai-responses.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rename,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {convertBuildOutput,summarizeBuildSource,buildPlannerConfig,runBuildPlanner} from '../server/brick-build-planner.mjs'
import {stepScene} from '../src/brick-build/plan.mjs'
import {createLlmTraceStore} from '../server/llm-traces.mjs'

// Synthetic data stays within this isolated unit test; no provider calls.
function fixture(){
 const geometry={status:'reviewed',bodySizeLdu:{x:80,y:48,z:80},top:[{x:20,y:48,z:20}],bottom:[{x:20,y:0,z:20}],placement:'upright',evidence:['test shape evidence'],unknown:['No path certification'],collision:{boxes:['not for model']},sourceFiles:[{sha256:'not for model'}]}
 return {id:'source',geometryId:'geometry',candidateId:'candidate-1',candidateHash:'hash',assembly:{bricks:[{id:'a',part:'partA',color:'0',x:1,z:2,layer:0,rotation:90},{id:'b',part:'partA',color:'15',x:1,z:2,layer:1,rotation:90}]},connections:[{lowerId:'a',upperId:'b',points:[{x:1.5,z:2.5}]}],geometryUnits:{studLdu:40,layerLdu:48,mmPerLdu:0.4},geometryObservations:['a','b'].map(id=>({id,part:'partA',confirmedPart:{part_num:'printed-part',color_id:0},geometry}))}
}
const output=()=>({title:'小模型',steps:[{movingNodeId:'part:b',targetNodeId:'part:a',resultNodeId:'assembly:whole',description:'把白色积木装在黑色积木上。'}]})
test('compact input preserves identities and units, deduplicates profiles, excludes bulk geometry',()=>{
 const src=fixture(),before=JSON.stringify(src),input=summarizeBuildSource(src)
 assert.equal(input.profiles.length,1)
 assert.deepEqual(input.instances[1].finalOriginLdu,{x:40,y:48,z:80})
 assert.equal(input.instances[0].partId,'printed-part')
 assert.deepEqual(input.connections[0].worldHorizontalContactPositionsLdu,[{x:60,z:100}])
 assert.equal('y' in input.connections[0].worldHorizontalContactPositionsLdu[0],false)
 assert.equal(JSON.stringify(input).includes('not for model'),false)
 assert.equal(JSON.stringify(src),before)
})
test('conversion derives existing tree, draft and source refs; final poses are untouched',()=>{
 const src=fixture(),before=JSON.stringify(src),{plan,validation}=convertBuildOutput(output(),src)
 assert.equal(validation.complete,true);assert.equal(plan.status,'draft')
 assert.equal(plan.source_candidate_hash,'hash');assert.equal(plan.assemblyNodes.length,3)
 assert.equal(plan.steps[0].stepId,'step-1')
 assert.deepEqual(stepScene(plan,src.assembly.bricks,0).result,src.assembly.bricks)
 assert.equal(JSON.stringify(src),before)
})
test('missing connection, unknown instances and incomplete trees are rejected',()=>{
 assert.throws(()=>convertBuildOutput(output(),{...fixture(),connections:[]}),/接合证据/)
 const unknown=output();unknown.steps[0].movingNodeId='part:invented'
 assert.throws(()=>convertBuildOutput(unknown,fixture()))
 assert.throws(()=>convertBuildOutput({title:'incomplete',steps:[]},fixture()),/完整/)
})
test('forward refs, duplicate consumption and invalid motion are rejected',()=>{
 const forward=output();forward.steps[0].movingNodeId='assembly:later'
 assert.throws(()=>convertBuildOutput(forward,fixture()))
 const duplicate=output();duplicate.steps.push({...duplicate.steps[0],resultNodeId:'assembly:other'})
 assert.throws(()=>convertBuildOutput(duplicate,fixture()))
 const motion=output();motion.steps[0].motion={offsetLdu:{x:0,y:1001,z:0},startYawDegrees:0}
 assert.throws(()=>convertBuildOutput(motion,fixture()))
})
test('model cannot inject final poses, approval or a separate tree',()=>{
 for(const patch of [{status:'reviewed'},{assemblyNodes:[]},{instanceIds:['invented']}]){
  assert.throws(()=>convertBuildOutput({...output(),...patch},fixture()))
 }
 const pose=output();pose.steps[0].position={x:0,y:0,z:0}
 assert.throws(()=>convertBuildOutput(pose,fixture()))
})
test('single-part complete plan uses zero merges; Sol comes from registry',()=>{
 const src=fixture();src.assembly.bricks=src.assembly.bricks.slice(0,1);src.connections=[]
 assert.equal(convertBuildOutput({title:'单块',steps:[]},src).validation.complete,true)
 const config=buildPlannerConfig()
 assert.equal(config.provider,'openai');assert.equal(config.model,'gpt-6.1-sol')
 assert.equal(config.settings.reasoning.effort,'medium')
})
test('build trace exposes actual wire and validation failure separately',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'build-trace-test-'))
 try{
  const id='11111111-1111-4111-8111-111111111111',folder=path.join(dir,'brick-build-traces')
  await mkdir(folder)
  await writeFile(path.join(folder,id+'.json'),JSON.stringify({id,task:'build-order',status:'validation_failed',parsedOutput:{title:'invalid',steps:[]},plan:null,validation:{valid:false,errors:['missing']},source:{selectionId:'source'},usageMetadata:{input_tokens:12}}))
  await writeFile(path.join(folder,id+'.request.json'),JSON.stringify({model:'test',input:'ACTUAL REQUEST'}))
  await writeFile(path.join(folder,id+'.response.txt'),'ACTUAL RESPONSE')
  const store=createLlmTraceStore(dir),detail=await store.detail('build',id)
  assert.equal((await store.list()).items[0].source,'build')
  assert.match(detail.request.text,/ACTUAL REQUEST/);assert.equal(detail.response.text,'ACTUAL RESPONSE')
  assert.equal(JSON.parse(detail.parsed.text).validation.valid,false)
  assert.equal(JSON.parse(detail.parsed.text).plan,null)
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('Responses JSON mode explicitly mentions JSON in input; keeps model settings',()=>{
 const content=[{type:'input_text',text:'plain geometry data'}]
 const request=buildOpenaiRequest({model:'gpt-6.1-sol',task:'design',prompt:'Return JSON',schema:{title:'string'},content})
 assert.match(JSON.stringify(request.input),/JSON/)
 assert.equal(request.model,'gpt-6.1-sol')
 assert.equal(request.reasoning.effort,'medium')
 assert.equal(content.length,1)
})

async function simulate(callModel,options={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'build-failure-test-'))
 let calls=0
 try{
  const result=await runBuildPlanner(fixture(),{directory,requestId:'22222222-2222-4222-8222-222222222222'},{
   config:()=>({configured:true,provider:'openai',model:'gpt-6.1-sol',settings:{reasoning:{effort:'medium'}}}),
   capture:async(_dir,record,_persist,call)=>{record.providerRequestStarted=true;return call()},
   callModel:async args=>{calls++;return callModel(args.record)},
   ...(options.io?{io:options.io}:{}),
  })
  return {result,calls}
 }finally{await rm(directory,{recursive:true,force:true})}
}
test('request transport failure is distinct from trace errors; no retry',async()=>{
 const {result,calls}=await simulate(()=>{throw new Error('network unavailable')})
 assert.equal(calls,1);assert.equal(result.status,'provider_request_failed')
 assert.equal(result.plan,null);assert.equal(result.diagnostic.httpStatus,null)
})
test('HTTP 400 preserves provider code/message/status and redacts credentials',async()=>{
 const {result,calls}=await simulate(r=>{
  r.httpStatus=400;r.wireStatus='response_saved'
  r.response={error:{code:'invalid_request',type:'invalid_request_error',param:'input',message:'input must contain json; Bearer secret-token-value'}}
  throw Error('HTTP 400')
 })
 assert.equal(calls,1);assert.equal(result.status,'provider_response_failed')
 assert.equal(result.diagnostic.providerErrorCode,'invalid_request')
 assert.equal(result.diagnostic.httpStatus,400)
 assert.equal(result.error.includes('secret-token-value'),false)
})
test('HTTP 200 with empty output is provider_response_failed, never a valid draft',async()=>{
 const {result}=await simulate(r=>{r.httpStatus=200;r.rawOutput=' ';r.wireStatus='response_saved'})
 assert.equal(result.status,'provider_response_failed')
 assert.equal(result.diagnostic.stage,'response_content');assert.equal(result.plan,null)
})
test('provider success followed by metadata write failure does not return playable plan',async()=>{
 const io={mkdir,rename,writeFile:async(file,...args)=>{
  if(String(file).endsWith('.tmp'))throw Object.assign(Error('disk full'),{code:'ENOSPC'})
  return writeFile(file,...args)
 }}
 const {result,calls}=await simulate(r=>{r.httpStatus=200;r.rawOutput=JSON.stringify(output());r.usageMetadata={input_tokens:20};r.wireStatus='response_saved'}, {io})
 assert.equal(calls,1);assert.equal(result.status,'trace_persist_failed')
 assert.equal(result.diagnostic.stage,'final_trace_write');assert.equal(result.plan,null)
 assert.equal(result.usage.input_tokens,20)
})
test('wire persistence failures remain trace failures even after HTTP 200',async()=>{
 const {result}=await simulate(r=>{
  r.httpStatus=200;r.rawResponseBody='original body'
  throw Object.assign(Error('write failed'),{failureCategory:'trace_persist_failed',failureStage:'raw_response_capture_or_write'})
 })
 assert.equal(result.status,'trace_persist_failed')
 assert.equal(result.diagnostic.stage,'raw_response_capture_or_write')
})
test('JSON parsing and Build Plan validation have separate diagnoses',async()=>{
 const parsed=await simulate(r=>{r.httpStatus=200;r.rawOutput='{broken'})
 assert.equal(parsed.result.status,'response_parse_failed')
 const validated=await simulate(r=>{r.httpStatus=200;r.rawOutput=JSON.stringify({title:'bad',steps:[]})})
 assert.equal(validated.result.status,'build_plan_validation_failed')
 assert.equal(validated.result.plan,null)
})
test('complete legitimate model output produces unsaved draft with usage',async()=>{
 const {result,calls}=await simulate(r=>{r.httpStatus=200;r.rawOutput=JSON.stringify(output());r.usageMetadata={input_tokens:20,output_tokens:30};r.wireStatus='response_saved'})
 assert.equal(calls,1);assert.equal(result.status,'draft_ready')
 assert.equal(result.plan.status,'draft');assert.equal(result.validation.complete,true)
 assert.equal(result.usage.output_tokens,30)
})

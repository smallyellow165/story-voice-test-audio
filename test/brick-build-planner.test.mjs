import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {convertBuildOutput,summarizeBuildSource,buildPlannerConfig} from '../server/brick-build-planner.mjs'
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

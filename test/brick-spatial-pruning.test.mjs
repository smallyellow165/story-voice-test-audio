import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {executePlan} from '../experiments/geometry-execution/execute.mjs'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {geometryIssuesForDisplay} from '../src/brick-test/geometry-issues.mjs'
import {buildSpatialRequest,spatialPrompt,spatialPromptVersion} from '../experiments/spatial-planning/input.mjs'
import {promptRuntimeStatus} from '../experiments/spatial-planning/runner.mjs'
import {createSpatialWorkflow} from '../server/brick-spatial-workflow.mjs'
const rules=await loadBrickRules()
const read=id=>readFile(new URL('../generated/brick-spatial-geometry/'+id+'.json',import.meta.url),'utf8').then(JSON.parse)
test('saved Sol: 24576 -> 128 -> hard front conflict, unchanged source and full diagnostic identity',async()=>{
 const saved=await read('31dbb99a-b0b6-4f7d-8ef3-2b65e61beb26'),before=JSON.stringify(saved)
 const r=executePlan(saved.sourcePlan,saved.input,rules)
 assert.equal(r.status,'no_solution');assert.equal(r.originalCombinationCount,24576)
 assert.deepEqual(r.pruning.stages.map(s=>s.combinationCount),[128,0])
 assert.equal(r.attempts.length,0);assert.equal(r.candidates.length,0)
 assert.equal(r.diagnostics[0].kind,'front')
 assert.deepEqual(new Set([r.diagnostics[0].id,r.diagnostics[0].other]),new Set(['wing_upper','white_belly']))
 assert.equal(r.diagnosticAssembly.bricks.length,10)
 assert.ok(geometryIssuesForDisplay(r).some(i=>i.type==='Constraint Conflict'))
 assert.equal(JSON.stringify(saved),before)
})
test('saved Gemini preserves concrete connector constraint and never becomes valid',async()=>{
 const saved=await read('69c33742-bc26-4d07-8c1f-ab0968c30db1'),before=JSON.stringify(saved)
 const r=executePlan(saved.sourcePlan,saved.input,rules)
 assert.equal(r.originalCombinationCount,32);assert.equal(r.status,'no_solution');assert.equal(r.candidates.length,0)
 assert.equal(r.diagnostics[0].kind,'mates')
 assert.equal(JSON.stringify(saved),before)
})
test('same saved domains retain uncertainty; removing only front in isolated fixture does not imply validity',async()=>{
 const saved=await read('31dbb99a-b0b6-4f7d-8ef3-2b65e61beb26')
 const plan=structuredClone(saved.sourcePlan);plan.relations=plan.relations.filter(r=>r.kind!=='front')
 const r=executePlan(plan,saved.input,rules)
 assert.equal(r.combinationCount,128);assert.equal(r.attempts.length,128)
 assert.ok(r.attempts.every(a=>a.geometry))
 assert.ok(r.candidates.every(c=>c.geometry.valid&&c.ranges.every(r=>r.satisfied)&&c.intents.every(i=>i.satisfied!==false)))
 const capped=executePlan(plan,saved.input,rules,{maxCombinations:100})
 assert.equal(capped.status,'budget_exceeded');assert.equal(capped.completeSearch,false)
 assert.equal(capped.combinationCount,128);assert.equal(capped.diagnostics[0].code,'SEARCH_BUDGET')
})
test('actual request builder includes versioned coordinate/relationship contract and Sol settings',async()=>{
 const runtime=await promptRuntimeStatus();assert.deepEqual(runtime,{version:spatialPromptVersion,current:true})
 const saved=await read('31dbb99a-b0b6-4f7d-8ef3-2b65e61beb26')
 const req=buildSpatialRequest('gpt-6.1-sol',{input:saved.input,image:{mimeType:'image/png',imageBase64:'AAAA'}})
 assert.equal(req.model,'gpt-6.1-sol');assert.equal(req.reasoning.effort,'medium')
 for(const term of ['worldConnector =','NEVER apply them again','left means from.origin.x','front means from.origin.z','above means from.bodyBottom.y','right/back/below are not schema kinds','occludes and overlaps_projection','does NOT establish'])assert.ok(req.instructions.includes(term),term)
 assert.ok(req.instructions.startsWith(spatialPrompt));assert.ok(!spatialPrompt.includes('wing_upper'))
 const workflow=createSpatialWorkflow('/unused-test-directory')
 await assert.rejects(workflow.dispatch('POST','prepare',{promptVersion:'obsolete'}),/版本不一致/)
 const status=await workflow.dispatch('GET','status');assert.deepEqual(status.prompt,runtime)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {executePlan,revalidateChoice} from '../experiments/geometry-execution/execute.mjs'
import {compareLayouts,finishRanking} from '../experiments/geometry-execution/ranking.mjs'
import {createSpatialWorkflow} from '../server/brick-spatial-workflow.mjs'
import {geometryIssuesForDisplay} from '../src/brick-test/geometry-issues.mjs'
import {loadBrickRules} from '../server/brick-rules.mjs'
const rules=await loadBrickRules()
const read=async file=>JSON.parse(await readFile(new URL('../'+file,import.meta.url),'utf8'))
const camel=await read('generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.json')
const sol=await read('generated/brick-spatial-geometry/31dbb99a-b0b6-4f7d-8ef3-2b65e61beb26.json')
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
function small(){
 const plan=structuredClone(camel.plan),o=camel.requestInput.observations.find(o=>o.part==='3437'),template=plan.parts[0]
 const exact=v=>({min:v,max:v})
 plan.parts=['base','upper'].map((id,i)=>({...structuredClone(template),id,connections:i?[{...template.connections[0],other:'base',ownConnector:null,otherConnector:null}]:[],pose:{...template.pose,relativeTo:i?'base':null,offsetLdu:{x:i?{min:-40,max:40}:exact(0),y:exact(i*48),z:exact(0)},yawCandidates:[0,90,180,270]}}))
 plan.relations=[];plan.alternatives=[]
 const input={...structuredClone(camel.requestInput),observations:['base','upper'].map(id=>({...structuredClone(o),id})),inventory:[{part:o.part,color:o.color,quantity:2}]}
 return {plan,input}
}
test('two real bricks: complete ranking precedes Top 5/10 cut; not enumeration-first; stable IDs and conservative dedup',()=>{
 const {plan,input}=small(),before=JSON.stringify({plan,input})
 const five=executePlan(plan,input,rules),ten=executePlan(plan,input,rules,{topK:10})
 assert.equal(five.candidates.length,5);assert.equal(ten.candidates.length,10)
 assert.equal(five.attempts.length,ten.attempts.length);assert.ok(five.validLayoutCount>10)
 assert.equal(five.search.complete,true);assert.equal(five.candidates[0].assembly.bricks[1].x,0)
 assert.equal(five.attempts[0].positions[1].x,-40)
 assert.deepEqual(five.candidates,ten.candidates.slice(0,5))
 assert.ok(ten.candidates.every(c=>c.kind==='valid'&&c.geometry.valid&&c.intents.every(i=>i.satisfied)&&c.ranges.every(r=>r.satisfied)))
 assert.ok(ten.candidates.slice(1).every((c,i)=>compareLayouts(ten.candidates[i],c)<=0))
 assert.equal(finishRanking([ten.candidates[0],ten.candidates[0]],'candidate').length,1)
 assert.ok(new Set(ten.candidates.map(c=>JSON.stringify(c.assembly.bricks.map(b=>b.rotation)))).size>1)
 const report={diagnosticAssembly:{geometry:{code:'COLLISION',brickIds:['base','upper']}}}
 assert.equal(geometryIssuesForDisplay(report,null).length,1)
 assert.equal(geometryIssuesForDisplay({...report,selectedLayout:five.candidates[0]},null).length,0)
 assert.equal(JSON.stringify({plan,input}),before)
})
test('one legal layout, explicit indices, capped search and invalid K stay strict',()=>{
 const {plan,input}=small();for(const p of plan.parts)p.pose.yawCandidates=[0]
 plan.parts[1].pose.offsetLdu.x={min:0,max:0}
 const r=executePlan(plan,input,rules);assert.equal(r.candidates.length,1)
 assert.equal(revalidateChoice(plan,input,r.candidates[0],rules).geometry.valid,true)
 const bad=structuredClone(r.candidates[0]);bad.assembly.bricks[1].x=1
 assert.throws(()=>revalidateChoice(plan,input,bad,rules),/超出/)
 const explicit=structuredClone(plan);explicit.parts[1].connections[0].ownConnector=0;explicit.parts[1].connections[0].otherConnector=3
 assert.equal(executePlan(explicit,input,rules).candidates.length,0)
 const large=small();const capped=executePlan(large.plan,large.input,rules,{maxCombinations:1})
 assert.equal(capped.status,'budget_exceeded');assert.equal(capped.search.complete,false);assert.equal(capped.candidates.length,0)
 const huge=small();huge.plan.parts[1].pose.offsetLdu.x={min:-40000,max:40000};huge.plan.parts[1].pose.offsetLdu.z={min:-40000,max:40000}
 const preprocessing=executePlan(huge.plan,huge.input,rules);assert.equal(preprocessing.status,'budget_exceeded');assert.equal(preprocessing.diagnostics[0].code,'PREPROCESSING_BUDGET');assert.ok(preprocessing.search.combinationCount>10000);assert.equal(preprocessing.completeSearch,false)
 assert.throws(()=>executePlan(plan,input,rules,{topK:100}),/topK/)
})
test('Sol diagnostic Top-K comes from 128 filtered poses, has physical mating, but front still fails and cannot be approved',()=>{
 const before=JSON.stringify(sol),r=executePlan(sol.sourcePlan,sol.input,rules,{topK:10})
 assert.deepEqual(r.pruning.stages.map(s=>s.combinationCount),[128,0]);assert.equal(r.attempts.length,128)
 assert.equal(r.candidates.length,0);assert.equal(r.diagnosticCandidates.length,10);assert.equal(r.status,'no_solution')
 for(const c of r.diagnosticCandidates){
  assert.equal(c.kind,'diagnostic');assert.equal(c.geometry.valid,true)
  assert.ok(c.intents.every(i=>i.satisfied!==false));assert.ok(c.ranges.every(i=>i.satisfied))
  assert.ok(c.relations.some(x=>x.from==='wing_upper'&&x.to==='white_belly'&&x.kind==='front'&&!x.satisfied))
  assert.ok(c.geometry.connections.some(x=>x.lowerId==='orange_foot'&&x.upperId==='white_lower'))
  assert.throws(()=>revalidateChoice(sol.sourcePlan,sol.input,c,rules),/完整约束/)
  const issues=geometryIssuesForDisplay({...r,selectedLayout:c,diagnosticAssembly:{geometry:c.geometry}},null)
  assert.equal(issues.length,1);assert.equal(issues[0].type,'Spatial Relation')
 }
 const capped=executePlan(sol.sourcePlan,sol.input,rules,{maxCombinations:100})
 assert.equal(capped.status,'no_solution');assert.equal(capped.completeSearch,true);assert.equal(capped.search.complete,false);assert.equal(capped.diagnosticCandidates.length,0)
 assert.equal(JSON.stringify(sol),before)
})
test('physical failure ranks below physically valid diagnostic regardless of preference; all constraints remain visible',()=>{
 const {plan,input}=small();plan.parts[1].connections=[];plan.parts[1].pose.offsetLdu.y={min:0,max:0}
 const r=executePlan(plan,input,rules)
 assert.equal(r.candidates.length,0);assert.ok(r.diagnosticCandidates.length>0)
 assert.ok(r.diagnosticCandidates.every(c=>!c.geometry.valid&&c.kind==='diagnostic'))
 const d=executePlan(sol.sourcePlan,sol.input,rules).diagnosticCandidates[0]
 assert.ok(compareLayouts(d,r.diagnosticCandidates[0])<0)
})
test('selection independently persists, is idempotent, survives restart; diagnostic selection rejected and histories unchanged',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'geometry-topk-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await mkdir(path.join(root,'brick-spatial-traces'));await mkdir(path.join(root,'brick-spatial-geometry'))
 const planPath=path.join(root,'brick-spatial-traces',camel.id+'.json');await writeFile(planPath,JSON.stringify(camel))
 const svc=createSpatialWorkflow(root,{loadRules:async()=>rules,runPlanning:()=>assert.fail('No LLM')})
 const op=await svc.dispatch('POST','execute',{requestId:randomUUID(),planId:camel.id,topK:10})
 const resultPath=path.join(root,'brick-spatial-geometry',op.geometryId+'.json'),before=await readFile(resultPath,'utf8')
 const g=await svc.dispatch('GET','geometry/'+op.geometryId);assert.equal(g.candidates.length,10)
 const body={requestId:randomUUID(),planId:camel.id,geometryId:op.geometryId,candidateId:g.candidates[1].id}
 const selected=await svc.dispatch('POST','select-layout',body);assert.equal(selected.state,'complete',selected.error)
 assert.deepEqual(await svc.dispatch('POST','select-layout',body),selected)
 const restarted=createSpatialWorkflow(root,{loadRules:async()=>rules})
 const list=await restarted.dispatch('GET','selections',{},new URLSearchParams({geometryId:op.geometryId}));assert.equal(list.items.length,1)
 assert.equal(list.items[0].analysisId,camel.requestInput.provenance.analysisId);assert.equal(list.items[0].candidateId,body.candidateId)
 assert.equal(await readFile(resultPath,'utf8'),before);assert.equal(await readFile(planPath,'utf8'),JSON.stringify(camel))
 const sid=randomUUID(),splan=await read('generated/brick-spatial-traces/966c3208-b20f-4e73-89be-f8c390fefa65.json')
 await writeFile(path.join(root,'brick-spatial-traces',splan.id+'.json'),JSON.stringify(splan))
 const diagnostic={...executePlan(sol.sourcePlan,sol.input,rules),id:sid,planId:splan.id,state:'complete',sourcePlan:sol.sourcePlan,sourcePlanHash:hash(sol.sourcePlan),input:sol.input}
 await writeFile(path.join(root,'brick-spatial-geometry',sid+'.json'),JSON.stringify(diagnostic))
 const d=await restarted.dispatch('GET',`geometry/${sid}/diagnostics/diagnostic-2`);assert.equal(d.id,'diagnostic-2')
 const denied=await restarted.dispatch('POST','select-layout',{requestId:randomUUID(),planId:splan.id,geometryId:sid,candidateId:'diagnostic-2'})
 assert.equal(denied.state,'failed');assert.match(denied.error,/Diagnostic/)
 assert.equal((await restarted.dispatch('GET','selections',{},new URLSearchParams({geometryId:sid}))).items.length,0)
})

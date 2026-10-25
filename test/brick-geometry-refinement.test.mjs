import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {refineGeometry,planAtPoses} from '../experiments/geometry-refinement/refine.mjs'
import {executePlan} from '../experiments/geometry-execution/execute.mjs'
import {createSpatialWorkflow} from '../server/brick-spatial-workflow.mjs'
const rules=await loadBrickRules(),root=new URL('../',import.meta.url)
const original=JSON.parse(await readFile(new URL('generated/brick-spatial-traces/7415a066-d5e1-490d-a863-936a285a4597.json',root)))
const old=JSON.parse(await readFile(new URL('generated/brick-spatial-geometry/947e2a01-26a1-487f-82eb-6a610e6b82ea.json',root)))
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const run=(options)=>refineGeometry(original.plan,old.input,rules,options)

test('rooster bounded search aligns all declared mating indices, retains side contacts, clears collision; final graph permits hanging connections without weakening mates or collision',()=>{
 const before=JSON.stringify({original,old}),r=run()
 assert.equal(r.status,'proposals_found');assert.equal(r.completeSearch,true);assert.equal(r.proposals.length,2);assert.ok(r.stats.nodes<=r.policy.maxNodes)
 for(const p of r.proposals){
  assert.equal(p.classification,'requires_review');assert.equal(p.approved,false)
  assert.equal(p.score.totalTranslationLdu,40)
  assert.equal(p.geometry.valid,true);assert.equal(p.geometry.code,'VALID');assert.equal(rules.validateAssembly(p.assembly.bricks).code,'UNSUPPORTED')
  assert.equal(p.strictExecution.attempts[0].collision.status,'clear')
  assert.ok(p.constraints.mating.every(c=>c.aligned));assert.ok(p.constraints.contacts.every(c=>c.satisfied))
  assert.ok(p.constraints.relations.every(c=>c.satisfied!==false));assert.equal(p.constraints.cameraReview.length,1)
  assert.deepEqual(p.diffs.filter(d=>Object.values(d.deltaLdu).some(Boolean)).map(d=>[d.id,d.deltaLdu]),[['dark_lower',{x:20,y:0,z:0}],['brown_lower',{x:20,y:0,z:0}]])
  assert.ok(p.diffs.every(d=>Math.abs(d.deltaLdu.x)<=20&&d.deltaLdu.y===0&&d.deltaLdu.z===0))
  assert.ok(p.diffs.every(d=>d.originalYawCandidates.includes(d.proposed.rotation)))
  assert.equal(p.diffs.find(d=>d.id==='orange_base').proposedRelativeOffsetLdu.x,-20)
  assert.equal(p.diffs.find(d=>d.id==='brown_upright').outsideOriginalIntervals.length,0)
  assert.deepEqual(p.refinedPlan.relations,original.plan.relations)
  assert.deepEqual(p.refinedPlan.parts.map(p=>p.connections),original.plan.parts.map(p=>p.connections))
  assert.equal(executePlan(p.refinedPlan,old.input,rules).candidates.length,1)
 }
 assert.deepEqual(r.proposals.map(p=>p.poses.find(p=>p.id==='orange_base').rotation),[0,180])
 assert.equal(JSON.stringify({original,old}),before)
 assert.deepEqual(run(),r,'deterministic, no timing-based selection')
})
test('bounded no-solution, budget exhaustion, missing evidence and malformed policy are explicit',()=>{
 const tiny=run({maxNodes:1});assert.equal(tiny.status,'budget_exceeded');assert.equal(tiny.completeSearch,false)
 const bad=structuredClone(original.plan);bad.parts.find(p=>p.id==='orange_base').pose.offsetLdu.x={min:13,max:13}
 const r=refineGeometry(bad,old.input,rules);assert.ok(['no_solution_in_bounds','unresolved'].includes(r.status));assert.equal(r.proposals.length,0)
 const unknown=structuredClone(original.plan);unknown.parts[1].pose.offsetLdu.z=null
 assert.equal(refineGeometry(unknown,old.input,rules).status,'invalid_input')
 assert.throws(()=>run({radiusLdu:80}),/policy/)
})
test('existing camel remains unchanged and valid; refinement neither creates suggestions nor edits coordinates',async()=>{
 const trace=JSON.parse(await readFile(new URL('generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.json',root))),before=JSON.stringify(trace)
 const result=refineGeometry(trace.plan,trace.requestInput,rules)
 assert.equal(result.status,'unchanged_valid');assert.equal(result.proposals.length,0)
 assert.equal(JSON.stringify(trace),before)
 const execution=executePlan(trace.plan,trace.requestInput,rules)
 assert.equal(execution.candidates.length,512);assert.equal(execution.candidates[0].geometry.connections.length,6)
 assert.equal(execution.candidates[0].geometry.connections.reduce((n,c)=>n+c.points.length,0),18)
})
async function service(t,source=original,geometry=old){const dir=await mkdtemp(path.join(tmpdir(),'refinement-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));for(const [folder,id,data] of [['brick-spatial-traces',source.id,source],['brick-spatial-geometry',geometry.id,geometry]]){await mkdir(path.join(dir,folder));await writeFile(path.join(dir,folder,id+'.json'),JSON.stringify(data))}return {dir,s:createSpatialWorkflow(dir,{runPlanning:()=>assert.fail('No LLM')})}}
const start=s=>s.dispatch('POST','refine',{requestId:randomUUID(),planId:original.id,geometryId:old.id,radiusLdu:20})
test('immutable refinement, explicit approval, independent revision and strict execution survive restart without approving Geometry',async t=>{
 const {dir,s}=await service(t),before=await readFile(path.join(dir,'brick-spatial-geometry',old.id+'.json'))
 const body={requestId:randomUUID(),planId:original.id,geometryId:old.id,radiusLdu:20},op=await s.dispatch('POST','refine',body)
 assert.deepEqual(await s.dispatch('POST','refine',body),op)
 const r=await s.dispatch('GET','refinements/'+op.refinementId),p=r.proposals[1],rBefore=JSON.stringify(r)
 assert.equal((await s.dispatch('GET','refinements/'+r.id+'/revisions')).items.length,0)
 const approve={requestId:randomUUID(),refinementId:r.id,proposalId:p.id,proposalHash:p.hash,confirmed:true,acknowledgeInvalid:true,reviewNote:'Isolated automated test only; not real user approval'}
 for(const patch of [{confirmed:false},{reviewNote:''},{proposalHash:'stale'}])assert.equal((await s.dispatch('POST','approve-refinement',{...approve,...patch,requestId:randomUUID()})).state,'failed')
 const approved=await s.dispatch('POST','approve-refinement',approve);assert.equal(approved.state,'complete');assert.equal(approved.geometryValid,true)
 assert.deepEqual(await s.dispatch('POST','approve-refinement',approve),approved)
 const restarted=createSpatialWorkflow(dir),revision=await restarted.dispatch('GET','revisions/'+approved.revisionId)
 assert.deepEqual(revision.refinedPlan,planAtPoses(original.plan,p.poses));assert.equal(revision.approval.confirmed,true)
 const exec=await restarted.dispatch('POST','execute-revision',{requestId:randomUUID(),revisionId:revision.id})
 assert.equal(exec.resultStatus,'candidates_with_unverified_constraints')
 const geometry=await restarted.dispatch('GET','geometry/'+exec.geometryId)
 assert.equal(geometry.revisionId,revision.id);assert.equal(geometry.candidates.length,1)
 assert.equal((await restarted.dispatch('GET','geometry/'+exec.geometryId+'/candidates/candidate-1')).currentGeometry.valid,true)
 assert.equal(JSON.stringify(await restarted.dispatch('GET','refinements/'+r.id)),rBefore)
 assert.deepEqual(await readFile(path.join(dir,'brick-spatial-geometry',old.id+'.json')),before)
 assert.deepEqual(JSON.parse(await readFile(path.join(dir,'brick-spatial-traces',original.id+'.json'))),original)
 assert.equal((await readdir(path.join(dir,'brick-spatial-revisions'))).length,1)
 const viewer=await restarted.dispatch('GET','refinements/'+r.id+'/viewer');assert.equal(viewer.purpose,'refinement-review');assert.equal(viewer.candidates.length,3)
})
test('source drift, cross-plan geometry and unapproved revision cannot execute',async t=>{
 const {dir,s}=await service(t),op=await start(s),r=await s.dispatch('GET','refinements/'+op.refinementId),p=r.proposals[0]
 const geometry={...old,planId:randomUUID()};await writeFile(path.join(dir,'brick-spatial-geometry',old.id+'.json'),JSON.stringify(geometry))
 assert.equal((await start(s)).state,'failed')
 assert.equal((await s.dispatch('POST','approve-refinement',{requestId:randomUUID(),refinementId:r.id,proposalId:p.id,proposalHash:p.hash,confirmed:true,acknowledgeInvalid:true,reviewNote:'test'})).state,'failed')
 assert.equal((await s.dispatch('POST','execute-revision',{requestId:randomUUID(),revisionId:r.id})).state,'failed')
})
test('a synthetic half-stud error can yield a strictly valid, still unapproved revision suggestion',async()=>{
 const trace=JSON.parse(await readFile(new URL('generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.json',root)))
 const plan=structuredClone(trace.plan);plan.parts.find(p=>p.id==='head').pose.offsetLdu.x={min:-40,max:-40}
 const result=refineGeometry(plan,trace.requestInput,rules),p=result.proposals[0]
 assert.equal(result.status,'proposals_found');assert.equal(p.geometry.valid,true)
 assert.equal(p.classification,'requires_review');assert.equal(p.approved,false)
 assert.equal(p.score.totalTranslationLdu,20)
 assert.deepEqual(p.diffs.filter(d=>Object.values(d.deltaLdu).some(Boolean)).map(d=>d.id),['head'])
 assert.equal(executePlan(p.refinedPlan,trace.requestInput,rules).candidates.length,1)
})
test('within-evidence solutions are distinguished from out-of-interval suggestions when strict Cartesian search exceeded budget',async()=>{
 const trace=JSON.parse(await readFile(new URL('generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.json',root)))
 const plan=structuredClone(trace.plan);plan.parts.find(p=>p.id==='back').pose.offsetLdu.x={min:-400,max:400}
 const result=refineGeometry(plan,trace.requestInput,rules),p=result.proposals[0]
 assert.equal(result.originalExecution.status,'budget_exceeded');assert.equal(result.status,'proposals_found')
 assert.equal(p.classification,'within_evidence');assert.equal(p.geometry.valid,true);assert.equal(p.approved,false)
 assert.ok(p.diffs.every(d=>!d.outsideOriginalIntervals.length))
})
test('edited saved proposal content cannot retain an old approval hash',async t=>{
 const {dir,s}=await service(t),op=await start(s),r=await s.dispatch('GET','refinements/'+op.refinementId),p=r.proposals[0]
 p.reviewReasons.push('external edit after the browser loaded this proposal')
 await writeFile(path.join(dir,'brick-refinements',r.id+'.json'),JSON.stringify(r))
 const result=await s.dispatch('POST','approve-refinement',{requestId:randomUUID(),refinementId:r.id,proposalId:p.id,proposalHash:p.hash,confirmed:true,acknowledgeInvalid:true,reviewNote:'test'})
 assert.equal(result.state,'failed');assert.match(result.error,/哈希/)
})
test('a valid bounded suggestion still requires approval, then executes through the unchanged strict endpoint',async t=>{
 const source=JSON.parse(await readFile(new URL('generated/brick-spatial-traces/f1f84e96-8269-4132-807a-61c41243229f.json',root)))
 source.plan.parts.find(p=>p.id==='head').pose.offsetLdu.x={min:-40,max:-40};source.rawOutput=JSON.stringify(source.plan)
 const geometry={...executePlan(source.plan,source.requestInput,rules),id:randomUUID(),planId:source.id,state:'complete',createdAt:new Date().toISOString(),sourcePlan:source.plan,sourcePlanHash:hash(source.plan),input:source.requestInput}
 const {s}=await service(t,source,geometry)
 const op=await s.dispatch('POST','refine',{requestId:randomUUID(),planId:source.id,geometryId:geometry.id,radiusLdu:20}),r=await s.dispatch('GET','refinements/'+op.refinementId),p=r.proposals[0]
 assert.equal(p.geometry.valid,true);assert.equal(p.approved,false)
 const approval=await s.dispatch('POST','approve-refinement',{requestId:randomUUID(),refinementId:r.id,proposalId:p.id,proposalHash:p.hash,confirmed:true,reviewNote:'Synthetic isolated correction test'})
 assert.equal(approval.geometryValid,true)
 const executed=await s.dispatch('POST','execute-revision',{requestId:randomUUID(),revisionId:approval.revisionId})
 assert.equal(executed.resultStatus,'candidates_found')
 const current=await s.dispatch('GET','geometry/'+executed.geometryId+'/candidates/candidate-1')
 assert.equal(current.currentGeometry.valid,true);assert.equal(current.assembly.bricks.length,7)
})

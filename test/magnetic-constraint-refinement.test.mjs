import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {refineConstraints,connectionPair} from '../src/magnetic-tiles/three-d/reconstruction/constraint-refinement.ts'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {executionRequest,executionScope} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-display.ts'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
const car=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/car-reviewed-geometry.json',import.meta.url),'utf8')),hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
async function conflict(){const f=await visibleFixture();for(const list of [f.review.pieces,f.evidence.observations,f.plan.parts])list.push({...structuredClone(list[1]),id:'third'});f.plan.connections.push({...structuredClone(f.plan.connections[0]),pieceB:'third',evidenceRefs:[f.plan.parts[0].id,'third']});return f}
const options={maxAssignments:128,maxGeometryChecks:256,maxLocalSubsets:1024,algorithmVersion:4}
test('real car: uncertain multi-direction shared ports are deferred, not deleted by cardinality',()=>{
 const before=JSON.stringify(car),r=refineConstraints(car.plan,car.input)
 assert.equal(r.candidates.length,0);assert.equal(r.search.considered,0);assert.equal(r.search.complete,true)
 assert.ok(r.conflicts.every(v=>v.conflicts.length===0&&v.unverifiedPorts.includes('p15:e1-p0')))
 assert.deepEqual(refineConstraints(car.plan,car.input),r);assert.equal(JSON.stringify(car),before)
 const x=executeVisible3D(car.plan,car.input,{...options,algorithmVersion:5})
 assert.ok(x.candidates.length);assert.ok(x.candidates.every(c=>validateAssembly3D(c.assembly).valid))
 assert.ok(x.diagnosticCandidates.some(d=>d.geometry.issues.some(i=>i.code==='intersection')))
})
test('hard human edges and shared-edge reviews never disappear; mutually hard conflicts block',async()=>{
 const f=await conflict();f.input.review.constraints=[structuredClone(f.plan.connections[0])];let r=refineConstraints(f.plan,f.input);assert.equal(r.candidates.length,1);assert.ok(r.candidates[0].retained.some(c=>connectionPair(c)===connectionPair(f.plan.connections[0])));assert.deepEqual(r.candidates[0].removed[0].constraint,f.plan.connections[1])
 f.input.review.constraints=structuredClone(f.plan.connections);r=refineConstraints(f.plan,f.input);assert.equal(r.candidates.length,0);assert.match(r.blockers.join(''),/人工硬约束/)
 f.input.review.constraints=[];f.input.review.spatialChecks=[{id:'human-shared',pieceA:f.plan.connections[0].pieceA,pieceB:f.plan.connections[0].pieceB,relation:'shared-edge',minDeg:null,maxDeg:null,evidenceRefs:[],note:'reviewed'}];r=refineConstraints(f.plan,f.input);assert.equal(r.candidates.length,1);assert.equal(connectionPair(r.candidates[0].removed[0].constraint),connectionPair(f.plan.connections[1]))
 assert.equal(refineConstraints(f.plan,f.input,{protectPlan:true}).candidates.length,0)
})
test('uncertain conflicting edges are selectable alternatives; Unknown stays Unknown; no-conflict execution is unchanged',async()=>{
 const f=await conflict();f.plan.connections[1].intent='uncertain';const r=refineConstraints(f.plan,f.input);assert.equal(r.candidates.length,2);assert.equal(r.candidates.find(c=>c.retained.some(x=>x.intent==='uncertain')).retained[0].intent,'uncertain')
 f.plan.connections[1].portB=null;assert.equal(refineConstraints(f.plan,f.input).candidates.length,0)
 const clean=await visibleFixture(),before=executeVisible3D(clean.plan,clean.input,options);assert.equal(refineConstraints(clean.plan,clean.input).candidates.length,0);assert.deepEqual(executeVisible3D(clean.plan,clean.input,options),before)
 f.plan.connections[1].portB=f.plan.connections[0].portB;const partial=refineConstraints(f.plan,f.input,{maxNodes:1});assert.equal(partial.search.complete,false);assert.ok(partial.search.considered<=1);assert.throws(()=>refineConstraints(car.plan,car.input,{maxNodes:9000}),/预算/)
})
async function setup(t){
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-refine-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await conflict(),source={id:'a'.repeat(64),hash:'b'.repeat(64),view:{width:1,height:1,hash:'c'.repeat(64)}}
 let calls=0
 const api=createVisible3DWorkflow(dir,{readSource:async id=>{assert.equal(id,source.id);return source},readImage:async()=>png,getRegistry:async()=>({hash:'registry',profiles:f.assembly.profiles.map(s=>s.profile)}),runModel:async(prepared,options)=>{calls++;const trace={id:randomUUID(),requestInput:prepared.input,status:'plan_ready_for_review',parseStatus:'parsed',validation:{valid:true},wireStatus:'response_saved',finishReason:'completed',rawOutput:JSON.stringify(f.plan),plan:f.plan};await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,trace.id+'.json'),JSON.stringify(trace));return trace}})
 const post=(r,b)=>api.dispatch('POST',r,b),a=await post('annotate',{sourceId:source.id,evidence:f.evidence}),review=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:0}),p=(await post('plan',{reviewId:review.record.id,requestId:randomUUID()})).record
 return {dir,f,api,post,a,review:review.record,p,calls:()=>calls}
}
test('immutable refinement lifecycle: explicit binding, exact execution/replay/adoption, original switch, forged references and stale Review rejection',async t=>{
 const {dir,api,post,p,review,a,f,calls}=await setup(t),file=path.join(dir,'plans',p.id+'.json'),before=await readFile(file),old=(await post('execute',{planId:p.id,requestId:randomUUID(),options})).record
 const r=await post('refine-constraints',{planId:p.id,planHash:p.hash});assert.equal(calls(),1,'only the isolated mocked Plan setup ran; refinement never calls a model');assert.equal(r.refinement.candidates.length,2);assert.deepEqual(await readFile(file),before)
 const unchanged=(await post('execute',{planId:p.id,requestId:randomUUID(),options})).record;assert.deepEqual(unchanged.candidates,old.candidates);assert.equal(unchanged.refinement,undefined)
 const c=r.refinement.candidates[0],reference={id:r.id,hash:r.hash,candidateId:c.id,candidateHash:r.candidateHashes[c.id]}
 const x=(await post('execute',{planId:p.id,requestId:randomUUID(),refinement:reference,options})).record;assert.deepEqual(x.refinement,reference);assert.equal(x.effectivePlanHash,hash(c.plan));assert.deepEqual(x.candidates,executeVisible3D(c.plan,review.input,{...options,algorithmVersion:5}).candidates);assert.ok(x.candidates.length);assert.ok(x.candidates.every(c=>validateAssembly3D(c.assembly).valid));assert.ok(x.candidates.every(c=>c.assembly.connections.every(edge=>!r.refinement.candidates[0].removed.some(d=>connectionPair(d.constraint)===connectionPair(edge)))))
 const chosen=x.candidates.find(c=>c.assembly.pieces.length===2),origin=await post('adopt',{executionId:x.id,candidateId:chosen.id});assert.deepEqual(origin.refinement,reference);assert.deepEqual(origin.assembly.pieces,chosen.assembly.pieces)
 const history=await api.dispatch('GET','history');assert.equal(history.refinements.length,1);assert.deepEqual((await api.dispatch('GET','executions/'+old.id)).record,old)
 assert.equal((await post('execute',{planId:p.id,requestId:randomUUID(),refinement:{...reference,hash:'forged'},options})).state,'failed')
 assert.equal((await post('execute',{planId:p.id,requestId:randomUUID(),refinement:{...reference,candidateHash:'forged'},options})).state,'failed')
 const other=await post('manual-plan',{reviewId:review.id,plan:f.plan});assert.equal((await post('execute',{planId:other.id,requestId:randomUUID(),refinement:reference,options})).state,'failed');assert.ok((await post('refine-constraints',{planId:other.id,planHash:other.hash})).refinement.blockers.length)
 await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:1});assert.equal((await api.dispatch('GET','refinements/'+r.id)).outdated,true);assert.equal((await post('execute',{planId:p.id,refinement:reference,requestId:randomUUID()})).state,'failed');await assert.rejects(post('adopt',{executionId:x.id,candidateId:chosen.id}),/过期/)
})
test('failed execution request status does not leak between refinement choices',()=>{
 const plan={id:'plan',hash:'hash'},r={id:'ref',hash:'h',candidateId:'refinement-1',candidateHash:'c'},requests=[{id:'original',kind:'execute',state:'failed',planId:'plan',createdAt:'1'},{id:'refined',kind:'execute',state:'failed',planId:'plan',refinement:r,createdAt:'2'}]
 assert.equal(executionRequest(requests,plan,null,null)?.id,'original');assert.equal(executionRequest(requests,plan,null,null,r)?.id,'refined');assert.equal(executionRequest(requests,plan,null,{kind:'execute',id:'refined',scope:JSON.stringify([executionScope(plan),r])},r)?.id,'refined')
})
test('refined partials cannot be adopted while omitting a separate human hard connection',async t=>{
 const {post,p,review,a,f}=await setup(t)
 f.review.constraints=[structuredClone(f.plan.connections[0])]
 const updated=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:1})
 const model=(await post('plan',{reviewId:updated.record.id,requestId:randomUUID()})).record
 const r=await post('refine-constraints',{planId:model.id,planHash:model.hash}),c=r.refinement.candidates[0]
 assert.equal(r.refinement.candidates.length,1)
 const reference={id:r.id,hash:r.hash,candidateId:c.id,candidateHash:r.candidateHashes[c.id]}
 const x=(await post('execute',{planId:model.id,requestId:randomUUID(),refinement:reference,options})).record
 assert.equal(x.candidates.length,1);assert.ok(x.candidates[0].assembly.connections.some(edge=>connectionPair(edge)===connectionPair(f.review.constraints[0])))
 assert.ok(x.candidates.every(c=>c.assembly.connections.some(edge=>connectionPair(edge)===connectionPair(f.review.constraints[0]))))
 const origin=await post('adopt',{executionId:x.id,candidateId:x.candidates[0].id});assert.deepEqual(origin.refinement,reference)
 await assert.rejects(post('refine-constraints',{planId:p.id,planHash:p.hash}),/过期/)
 assert.ok(review.id!==updated.record.id)
})

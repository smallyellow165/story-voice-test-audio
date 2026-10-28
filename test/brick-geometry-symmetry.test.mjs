import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {prepareGeometryInput} from '../server/brick-geometry-input.mjs'
import {inspectBrickModel} from '../server/brick-library.mjs'
import {executePlan,revalidateChoice} from '../experiments/geometry-execution/execute.mjs'
import {proveRotations,executionSymmetry} from '../experiments/geometry-execution/symmetry.mjs'
import {createSpatialWorkflow} from '../server/brick-spatial-workflow.mjs'
import {createSelectedSpatialStore} from '../server/brick-selected-spatial.mjs'
import {createSourceImageStore} from '../server/brick-source-images.mjs'
import {createBrickReverse} from '../server/brick-reverse.mjs'
import {createBuildOrderStore} from '../server/brick-build-order.mjs'
const read=f=>readFile('generated/'+f,'utf8').then(JSON.parse),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const rules=await loadBrickRules(),planId='9bcd12c4-9af5-4da6-95f0-ea3bf9435c19',trace=await read('brick-spatial-traces/'+planId+'.json')
const prepared=await prepareGeometryInput(trace.requestInput,rules)
let optimized
// No model calls and no real output writes. A literal-yaw exhaustive run remains the oracle.
test('real Rooster: 32768 exact identities, one physical validation, exact Top 5/10 hashes and connector indices',t=>{
 const before=hash(trace),literal=executePlan(trace.plan,prepared.input,rules,{maxCombinations:32768,topK:10})
 optimized=executePlan(trace.plan,prepared.input,rules,{symmetryProofs:prepared.symmetryProofs,topK:10})
 assert.equal(optimized.originalCombinationCount,32768);assert.equal(optimized.combinationCount,32768)
 assert.equal(optimized.pruning.pairEvaluations,312);assert.ok(optimized.pruning.constraints.every(c=>c.removedCount===0))
 assert.equal(optimized.search.symmetry.physicalClassCount,1);assert.equal(optimized.search.symmetry.physicalValidations,1)
 assert.equal(optimized.search.symmetry.cacheHits,32767);assert.equal(optimized.search.symmetry.orientationExpansions,32768)
 assert.equal(literal.search.symmetry.physicalValidations,32768)
 assert.equal(optimized.validLayoutCount,32768);assert.equal(optimized.status,'candidates_with_unverified_constraints')
 assert.deepEqual(optimized.attempts,literal.attempts);assert.deepEqual(optimized.candidates,literal.candidates)
 assert.deepEqual(optimized.candidates.map(hash),literal.candidates.map(hash));assert.ok(optimized.candidates.every(c=>c.unverifiedConstraints.length===5))
 const five=executePlan(trace.plan,prepared.input,rules,{symmetryProofs:prepared.symmetryProofs})
 assert.deepEqual(five.candidates,literal.candidates.slice(0,5));assert.equal(hash(trace),before)
 assert.equal(revalidateChoice(trace.plan,prepared.input,five.candidates[1],rules).geometry.valid,true)
 t.diagnostic(JSON.stringify({physicalValidations:1,orientationExpansions:32768,top10Hash:hash(optimized.candidates)}))
})
test('mesh, full collision profile, connector attributes and appearance are mandatory proofs',async()=>{
 const models=new Map();for(const part of ['3437','4066a','2302','11170','3437p01'])models.set(part,await inspectBrickModel(part,undefined,{extractGeometry:true,includeFaces:true}))
 const g=rules.geometrySupport('3437').geometry
 assert.deepEqual(proveRotations(g,models.get('3437')).classes,{'0':0,'90':0,'180':0,'270':0})
 assert.deepEqual(proveRotations(rules.geometrySupport('4066a').geometry,models.get('4066a')).classes,{'0':0,'90':90,'180':0,'270':90})
 for(const part of ['2302','11170'])assert.deepEqual(proveRotations(rules.geometrySupport(part).geometry,models.get(part)).classes,{'0':0,'90':90,'180':180,'270':270})
 assert.equal(proveRotations(g,models.get('3437p01')),null)
 assert.equal(proveRotations(g,{available:false,errors:['missing']}),null)
 const eccentric=structuredClone(g);eccentric.top[0].radiusLdu=13
 assert.deepEqual(proveRotations(eccentric,models.get('3437')).classes,{'0':0,'90':90,'180':180,'270':270})
 const body=structuredClone(g);body.collision.boxes[0].max.x=39
 assert.deepEqual(proveRotations(body,models.get('3437')).classes,{'0':0,'90':90,'180':180,'270':270})
})
test('explicit connector indices, printed base mappings and mismatched profiles prevent pooling; permitted yaw never rewritten',()=>{
 const p=structuredClone(trace.plan),input=structuredClone(prepared.input)
 p.parts[0].connections[0].ownConnector=0;p.parts[0].connections[0].otherConnector=0
 const scope=executionSymmetry(p,new Map(input.observations.map(o=>[o.id,o])),prepared.symmetryProofs)
 for(const id of ['red_top','orange_upright'])assert.match(scope.records.find(r=>r.id===id).reason,/explicit connector/)
 input.observations[0].mapping.geometryBinding={kind:'printed_variant_base_geometry'}
 assert.match(executionSymmetry(trace.plan,new Map(input.observations.map(o=>[o.id,o])),prepared.symmetryProofs).records[0].reason,/no applicable/)
 delete input.observations[0].mapping.geometryBinding;input.observations[0].geometry.bodySizeLdu.x++
 assert.match(executionSymmetry(trace.plan,new Map(input.observations.map(o=>[o.id,o])),prepared.symmetryProofs).records[0].reason,/no applicable/)
 const restricted=structuredClone(trace.plan);restricted.parts[0].pose.yawCandidates=[270]
 const r=executePlan(restricted,prepared.input,rules,{symmetryProofs:prepared.symmetryProofs})
 assert.ok(r.candidates.every(c=>c.assembly.bricks[0].rotation===270));assert.equal(r.validLayoutCount,8192)
})
test('physical and orientation budgets stay independently enforced; no proof means no budget bypass',()=>{
 assert.equal(executePlan(trace.plan,prepared.input,rules).status,'budget_exceeded')
 const r=executePlan(trace.plan,prepared.input,rules,{symmetryProofs:prepared.symmetryProofs,maxOrientationExpansions:10000})
 assert.equal(r.status,'budget_exceeded');assert.equal(r.attempts.length,0);assert.equal(r.diagnostics.at(-1).code,'ORIENTATION_EXPANSION_BUDGET')
})
test('Penguin and Camel literal-yaw Candidate hashes and all per-attempt evidence remain unchanged',async()=>{
 for(const gid of ['c34c5c9a-b513-4ce5-b87b-47cbd96154f5','eca76c4b-a188-4b39-a644-1fbd086ebe19']){
  const g=await read('brick-spatial-geometry/'+gid+'.json'),p=await read('brick-spatial-traces/'+g.planId+'.json'),prep=await prepareGeometryInput(p.requestInput,rules)
  const a=executePlan(p.plan,prep.input,rules,{symmetryProofs:prep.symmetryProofs}),b=executePlan(p.plan,prep.input,rules)
  assert.deepEqual(a.candidates,b.candidates);assert.deepEqual(a.attempts,b.attempts);assert.equal(a.status,b.status)
 }
})
test('isolated UI service execution saves new Rooster result, supports adoption and Build Order without rewriting any old file',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'symmetry-workflow-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 for(const folder of ['brick-source-images','brick-reverse','brick-spatial-traces','brick-spatial-geometry','brick-spatial-selections','brick-parts-inputs','brick-build-plans'])await cp('generated/'+folder,path.join(dir,folder),{recursive:true})
 const protectedFiles=['brick-spatial-traces/'+planId+'.json','brick-parts-inputs/'+trace.partsSnapshotId.slice(7)+'.json','brick-spatial-selections/77d99b0e-9c62-4ba6-b655-bcf1a8db5828.json','brick-build-plans/426f27c7-a9a9-4ee9-9965-39e1cd9e30f8.json']
 const before=await Promise.all(protectedFiles.map(f=>readFile(path.join(dir,f))))
 const sourceImages=createSourceImageStore(path.join(dir,'brick-source-images')),reverse=createBrickReverse(path.join(dir,'brick-reverse'),{sourceImages}),selectedSpatial=createSelectedSpatialStore(dir,{reverse,sourceImages})
 const service=createSpatialWorkflow(dir,{reverse,selectedSpatial,runPlanning:()=>assert.fail('no model')})
 const op=await service.dispatch('POST','execute',{requestId:randomUUID(),planId});assert.equal(op.resultStatus,'candidates_with_unverified_constraints')
 const geometry=await service.dispatch('GET','geometry/'+op.geometryId+'/report');assert.equal(geometry.search.symmetry.physicalValidations,1)
 const scope=await selectedSpatial.read(planId)
 const selection=await service.dispatch('POST','select-layout',{requestId:randomUUID(),planId,geometryId:op.geometryId,candidateId:'candidate-1',selectionKey:scope.selectionKey,expectedRevision:scope.choice.revision})
 assert.equal(selection.state,'complete');assert.equal((await createBuildOrderStore(dir).dispatch('GET','sources/'+selection.selectionId)).geometryId,op.geometryId)
 assert.deepEqual(await Promise.all(protectedFiles.map(f=>readFile(path.join(dir,f)))),before)
})
test('indexed mating constraints retain exact results under optimization, including original index pairs',()=>{
 const p=structuredClone(trace.plan);p.parts[0].connections[0].ownConnector=0
 const a=executePlan(p,prepared.input,rules,{symmetryProofs:prepared.symmetryProofs}),b=executePlan(p,prepared.input,rules,{maxCombinations:32768})
 assert.ok(b.candidates.length>0);assert.deepEqual(a.candidates,b.candidates);assert.deepEqual(a.attempts,b.attempts)
 for(const c of a.candidates)assert.ok(c.intents.filter(i=>i.id==='red_top'&&i.other==='orange_upright').every(i=>i.pairs.every(p=>p.ownIndex===0)))
})
test('failed physical classes are not reused as rotated diagnostics; actual call limit still stops expansion',()=>{
 const p=structuredClone(trace.plan);p.relations=[];for(const part of p.parts)part.connections=[]
 p.parts[1].pose.relativeTo='red_top';p.parts[1].pose.offsetLdu={x:{min:0,max:0},y:{min:0,max:0},z:{min:0,max:0}}
 const r=executePlan(p,prepared.input,rules,{symmetryProofs:prepared.symmetryProofs,maxCombinations:2})
 assert.equal(r.search.symmetry.physicalClassCount,1);assert.equal(r.search.symmetry.physicalValidations,2)
 assert.equal(r.search.symmetry.cacheHits,0);assert.equal(r.attempts.length,2)
 assert.ok(r.attempts.every(a=>a.geometry.code==='COLLISION'));assert.equal(r.status,'budget_exceeded');assert.equal(r.completeSearch,false)
 assert.deepEqual(r.candidates,[]);assert.deepEqual(r.diagnosticCandidates,[])
})

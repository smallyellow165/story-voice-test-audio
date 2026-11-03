import {selectFixture} from './magnetic-selected-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
const car=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/car-reviewed-geometry.json',import.meta.url),'utf8'))
const options={maxAssignments:128,maxGeometryChecks:256,maxLocalSubsets:1024,algorithmVersion:4}
async function conflict(){const f=await visibleFixture(),copy=(x)=>structuredClone(x),id='extra';f.review.pieces.push({...copy(f.review.pieces[1]),id});f.evidence.observations.push({...copy(f.evidence.observations[1]),id});f.plan.parts.push({...copy(f.plan.parts[1]),id});f.plan.connections.push({...copy(f.plan.connections[0]),pieceB:id,evidenceRefs:[f.plan.parts[0].id,id]});return f}

test('saved car uncertain port reuse does not prove a topology conflict or alter immutable input',()=>{
 const {plan,input}=car,before=JSON.stringify(car),r=executeVisible3D(plan,input,options)
 assert.equal(r.version,3);assert.equal(r.search.componentSearch,undefined)
 assert.equal(r.status,'budget_exhausted');assert.equal(r.search.geometryChecks,256)
 assert.ok(r.diagnosticCandidates.some(c=>c.coverage.reconstructed.length===9))
 assert.ok(r.diagnosticCandidates[0].geometry.issues.some(i=>i.code==='intersection'))
 assert.deepEqual(executeVisible3D(plan,input,options),r);assert.equal(JSON.stringify(car),before)
})
test('uncertain and Unknown ports do not become hard port-conflict proofs',async()=>{
 for(const unknown of [false,true]){const f=await conflict(),c=f.plan.connections[1];if(unknown)c.portB=null;else c.intent='uncertain'
  const r=executeVisible3D(f.plan,f.input,{...options,maxLocalSubsets:0});assert.equal(r.version,3);assert.equal(r.search.componentSearch,undefined);assert.ok(r.candidates.some(c=>c.assembly.pieces.length===2));assert.ok(r.candidates.every(c=>validateAssembly3D(c.assembly).valid))
 }
})
test('hard compatible three-way joints remain required; strict errors still block a full model',()=>{
 const f=structuredClone(car);f.input.review.constraints=f.plan.connections.filter(c=>c.pieceA==='p15'&&(c.pieceB==='p16'||c.pieceB==='p21'))
 const before=JSON.stringify(f),r=executeVisible3D(f.plan,f.input,{...options,algorithmVersion:5})
 assert.ok(r.candidates.length);for(const c of r.candidates)for(const h of f.input.review.constraints)assert.ok(c.assembly.connections.some(e=>[e.pieceA,e.pieceB].sort().join('|')===[h.pieceA,h.pieceB].sort().join('|')))
 assert.ok(r.diagnosticCandidates.some(d=>d.geometry.issues.some(i=>i.code==='intersection')));assert.equal(JSON.stringify(f),before)
})
test('component, local-work, parent and validation budgets remain deterministic and incomplete work never adopts',()=>{
 for(const budget of [{maxAssignments:0},{maxGeometryChecks:1},{maxLocalSubsets:1},{maxLocalParents:1}]){const r=executeVisible3D(car.plan,car.input,{...options,...budget});assert.equal(r.status,'budget_exhausted');assert.equal(r.completeSearch,false);assert.deepEqual(r.candidates,[]);assert.ok(r.search.geometryChecks<=(budget.maxGeometryChecks??256));assert.ok((r.search.localSearch?.considered??0)<=(budget.maxLocalSubsets??1024));assert.deepEqual(executeVisible3D(car.plan,car.input,{...options,...budget}),r)}
})
test('new API uses V5 and protects manual Plans; historical V4/V3 remains read-only',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-conflict-v4-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir),f=await conflict(),post=(route,body)=>api.dispatch('POST','visible3d/'+route,body)
 const source=await api.dispatch('POST','sources',{name:'OFFLINE port-conflict fixture.png',original:png,view:png}),a=await post('annotate',{sourceId:source.id,evidence:f.evidence}),r=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:0}),p=await post('manual-plan',{reviewId:r.record.id,plan:f.plan}),x=await post('execute',{planId:p.id,requestId:randomUUID(),options:{...options,algorithmVersion:2}})
 assert.equal(x.record.version,5);assert.equal(x.record.candidates.length,0,'manual Plan connections are hard; incompatible port constraints cannot be dropped')
 const frozen={...x.record,...executeVisible3D(f.plan,r.record.input,options),id:randomUUID()};delete frozen.hash;frozen.hash=createHash('sha256').update(JSON.stringify(frozen)).digest('hex');x.record=frozen
 const file=path.join(dir,'visible3d/executions',x.record.id+'.json');await writeFile(file,JSON.stringify(x.record));const bytes=await readFile(file,'utf8');await assert.rejects(selectFixture(api,source.id,'execution',x.record),/旧 Execution/);await assert.rejects(post('adopt',{executionId:x.record.id,candidateId:'candidate-1'}),/Selected/);assert.equal(await readFile(file,'utf8'),bytes)
 const legacy={...x.record,...executeVisible3D(f.plan,r.record.input,{...options,algorithmVersion:3}),id:randomUUID()};delete legacy.hash;legacy.hash=createHash('sha256').update(JSON.stringify(legacy)).digest('hex');const oldFile=path.join(dir,'visible3d/executions',legacy.id+'.json');await writeFile(oldFile,JSON.stringify(legacy));const oldBytes=await readFile(oldFile,'utf8');await assert.rejects(post('adopt',{executionId:legacy.id,candidateId:'candidate-1'}),/Selected/);assert.equal(await readFile(oldFile,'utf8'),oldBytes)
 const forged=structuredClone(x.record);forged.candidates[0].assembly.pieces[0].pose.position[0]+=1;delete forged.hash;forged.hash=createHash('sha256').update(JSON.stringify(forged)).digest('hex');await writeFile(file,JSON.stringify(forged));await assert.rejects(post('adopt',{executionId:x.record.id,candidateId:'candidate-1'}),/Selected/)
})

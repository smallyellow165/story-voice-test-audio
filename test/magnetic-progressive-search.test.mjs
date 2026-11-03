import {selectFixture} from './magnetic-selected-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {Quaternion,Vector3} from 'three'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {attachProgressivePiece} from '../src/magnetic-tiles/three-d/reconstruction/progressive-search.ts'
import {refineConstraints} from '../src/magnetic-tiles/three-d/reconstruction/constraint-refinement.ts'
import {placePendingObservation,pendingForAssembly} from '../src/magnetic-tiles/three-d/reconstruction/pending-observations.ts'
import {createInitialHistory,undo,redo} from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {validateAssembly3D,solveAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
const fixture=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/car-reviewed-geometry.json',import.meta.url),'utf8')),opts={maxAssignments:128,maxGeometryChecks:256,maxLocalSubsets:1024,algorithmVersion:5}
const connected=a=>{const found=new Set([a.pieces[0].id]);for(let i=0;i<a.pieces.length;i++)for(const c of a.connections){if(found.has(c.pieceA))found.add(c.pieceB);if(found.has(c.pieceB))found.add(c.pieceA)}return found.size===a.pieces.length}

test('saved 23-piece original and representative Refinements recover 8-piece connected partials at the unchanged budget',()=>{
 const {plan,input}=fixture,before=JSON.stringify(fixture),refinements=refineConstraints(plan,input)
 for(const [name,p]of [['original',plan],...refinements.candidates.filter(c=>['refinement-1','refinement-3','refinement-6','refinement-7'].includes(c.id)).map(c=>[c.id,c.plan])]){
  const old=executeVisible3D(p,input,{...opts,algorithmVersion:4}),x=executeVisible3D(p,input,opts),s=x.search.progressive
  assert.equal(old.candidates.length,0); // Unresolved angle ranges no longer trigger the exclusive-port V4 shortcut.
  assert.equal(x.version,5);assert.equal(x.status,'candidates_found');assert.equal(x.completeSearch,false);assert.equal(s.termination,'geometry-budget');assert.equal(x.search.geometryChecks,256);assert.equal(Object.values(s.checks).reduce((a,b)=>a+b,0),256);assert.ok(s.nodes<=1024);assert.ok(s.checks.recovery>0);assert.ok(s.checks.growth>0);assert.equal(s.maxConnected,8);assert.equal(Math.max(...x.candidates.map(c=>c.assembly.pieces.length)),8)
  assert.ok(s.independentComponentCoverage.length>=s.maxConnected);assert.ok(s.independentComponentCoverage.length<23);assert.ok(s.verifiedConnectedUnion.length>=s.independentComponentCoverage.length);assert.equal(s.standaloneVerified.length,23);assert.ok(s.graphComponents.every(c=>c.length<=9))
  for(const c of x.candidates){assert.ok(validateAssembly3D(c.assembly).valid);assert.ok(connected(c.assembly));assert.equal(c.coverage.totalConfirmed,23);assert.equal(c.coverage.unresolved.length,23-c.assembly.pieces.length);assert.deepEqual(c.photoMatch,{status:'unverified',score:null});assert.deepEqual(c.assembly.profiles,input.profiles);assert.ok(c.construction.omittedHypotheses.length);assert.ok(c.construction.growthPath.length);assert.deepEqual(new Set([...c.coverage.reconstructed,...c.coverage.unresolved]),new Set(input.review.pieces.map(p=>p.id)))}
  assert.ok(s.failureCounts.intersection>0);if(name!=='original')assert.equal(s.failureCounts['port-reuse'],undefined)
 }
 assert.equal(JSON.stringify(fixture),before)
})
test('determinism, strict fixed-budget stopping, and verified best results survive interruption',()=>{
 const a=executeVisible3D(fixture.plan,fixture.input,opts);assert.deepEqual(executeVisible3D(fixture.plan,fixture.input,opts),a);assert.ok(a.search.progressive.cacheHits>0)
 const early=executeVisible3D(fixture.plan,fixture.input,{...opts,maxGeometryChecks:80});assert.ok(early.candidates.length);assert.equal(early.completeSearch,false);assert.ok(early.search.geometryChecks<=80);assert.ok(early.candidates.every(c=>validateAssembly3D(c.assembly).valid))
 for(const patch of [{maxAssignments:0},{maxGeometryChecks:0},{maxLocalSubsets:2},{maxLocalParents:1}]){const r=executeVisible3D(fixture.plan,fixture.input,{...opts,...patch});assert.ok(r.search.geometryChecks<=(patch.maxGeometryChecks??256));assert.ok(r.search.progressive.nodes<=(patch.maxLocalSubsets??1024));assert.ok(r.candidates.every(c=>c.geometry.valid));if(patch.maxAssignments===0||patch.maxGeometryChecks===0)assert.equal(r.candidates.length,0)}
})
test('closed cube keeps all 12 compatible closures and right-angle/mixed-profile geometry remain strict',async()=>{
 for(const name of ['right-angle','closed-cube','mixed-profiles']){
  const f=await visibleFixture(name),before=JSON.stringify(f),x=executeVisible3D(f.plan,f.input,opts);assert.ok(x.candidates.length);assert.ok(x.candidates.every(c=>validateAssembly3D(c.assembly).valid));if(name==='closed-cube'){assert.equal(x.candidates[0].assembly.pieces.length,6);assert.equal(x.candidates[0].assembly.connections.length,12)}assert.equal(JSON.stringify(f),before)
 }
})
test('incremental hinge traversal preserves old poses for both directions, signed angles, flip, arbitrary roots and thicknesses',async()=>{
 const f=await visibleFixture(),[a,b]=f.assembly.pieces
 for(const reverse of [false,true])for(const flip of [false,true])for(const angle of [-90,0,60,90,180])for(const thickness of [.03,.12]){
  const c={...f.assembly.connections[0],flip,dihedralDeg:angle},base=structuredClone(reverse?b:a),moving=structuredClone(reverse?a:b);base.pose={position:[3,-2,4],quaternion:new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.63).toArray()};const one={...structuredClone(f.assembly),profiles:f.assembly.profiles.map(s=>({...s,thickness})),pieces:[base],connections:[]},before=JSON.stringify(one),next=attachProgressivePiece(one,moving,c),solved=solveAssembly3D({...structuredClone(one),pieces:[base,moving],connections:[c]},[base.id]);assert.deepEqual(next.pieces[0],base);for(let i=0;i<3;i++)assert.ok(Math.abs(next.pieces[1].pose.position[i]-solved.pieces[1].pose.position[i])<1e-9);assert.equal(JSON.stringify(one),before)
 }
})
test('human hard constraints cannot be dropped to manufacture an adoptable partial',()=>{
 const f=structuredClone(fixture);f.input.review.constraints=f.plan.connections.filter(c=>c.pieceA==='p15'&&(c.pieceB==='p16'||c.pieceB==='p21'));const x=executeVisible3D(f.plan,f.input,opts);assert.ok(x.candidates.length);for(const c of x.candidates)for(const hard of f.input.review.constraints)assert.ok(c.assembly.connections.some(e=>[e.pieceA,e.pieceB].sort().join('|')===[hard.pieceA,hard.pieceB].sort().join('|')));assert.ok(x.candidates.every(c=>validateAssembly3D(c.assembly).valid))
 const manual=executeVisible3D(f.plan,fixture.input,{...opts,protectPlanConnections:true});assert.equal(manual.candidates.length,0)
})
test('pending observed instances require explicit coordinates, retain source identity/snapshot and use existing Undo/Redo',async()=>{
 const f=await visibleFixture(),p=f.input.review.pieces[1],pending={...p,profileSnapshot:f.assembly.profiles.find(s=>s.profile.id===p.profileId)},one={...structuredClone(f.assembly),pieces:[f.assembly.pieces[0]],connections:[]},h=createInitialHistory(one),pose={position:[5,6,7],quaternion:[0,0,0,1]},next=placePendingObservation(h,pending,pose)
 assert.equal(next.current.pieces.length,2);assert.deepEqual(next.current.pieces[0],h.current.pieces[0]);assert.deepEqual(next.current.pieces[1].pose,pose);assert.equal(next.current.pieces[1].id,p.id);assert.deepEqual(pendingForAssembly(next.current,[pending]),[]);assert.equal(pendingForAssembly(undo(next).current,[pending]).length,1);assert.deepEqual(redo(undo(next)).current,next.current);assert.throws(()=>placePendingObservation(next,pending,pose),/已存在/);assert.throws(()=>placePendingObservation(h,pending,{...pose,position:[NaN,0,0]}),/pose/);assert.throws(()=>placePendingObservation(h,{...pending,confirmed:false},pose),/已确认/);assert.deepEqual(one,h.current)
})
test('server adopts a verified V5 partial despite unfinished search; strict replay rejects forged poses and stale Review',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-progressive-api-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir),post=(r,b)=>api.dispatch('POST','visible3d/'+r,b),f=await visibleFixture('closed-cube'),source=await api.dispatch('POST','sources',{name:'offline cube.png',original:png,view:png}),a=await post('annotate',{sourceId:source.id,evidence:f.evidence}),review=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:0}),plan=await post('manual-plan',{reviewId:review.record.id,plan:f.plan}),x=(await post('execute',{planId:plan.id,requestId:randomUUID(),options:{maxGeometryChecks:4}})).record
 assert.equal(x.version,5);assert.equal(x.completeSearch,false);assert.ok(x.candidates.length);const o=await post('adopt',{executionId:x.id,candidateId:x.candidates[0].id});assert.deepEqual(o.assembly.pieces,x.candidates[0].assembly.pieces);assert.equal(o.searchProgress.scope,'bounded-progressive-connected-subgraphs');assert.deepEqual(o.pendingObservations,[])
 const file=path.join(dir,'visible3d/executions',x.id+'.json'),bytes=await readFile(file),forged=structuredClone(x);forged.candidates[0].assembly.pieces[0].pose.position[0]+=1;delete forged.hash;forged.hash=createHash('sha256').update(JSON.stringify(forged)).digest('hex');await writeFile(file,JSON.stringify(forged));await selectFixture(api,source.id,'execution',forged);await assert.rejects(post('adopt',{executionId:x.id,candidateId:'candidate-1'}),/复核失败/);await writeFile(file,bytes);await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:1});await assert.rejects(post('adopt',{executionId:x.id,candidateId:'candidate-1'}),/过期/)
})
test('large coplanar penetration and hard wrong-loop angles remain strict errors',async()=>{
 const f=await visibleFixture();f.plan.connections[0].angles=[0];f.plan.connections[0].flip=false
 const r=executeVisible3D(f.plan,f.input,opts);assert.equal(r.search.progressive.maxConnected,0);assert.ok(r.search.progressive.failureCounts.intersection>0);assert.ok(r.candidates.every(c=>c.assembly.pieces.length===1))
 const cube=await visibleFixture('closed-cube');cube.plan.connections[0].angles=[45];cube.input.review.constraints=structuredClone(cube.plan.connections)
 const invalid=executeVisible3D(cube.plan,cube.input,opts);assert.equal(invalid.candidates.length,0);assert.ok(invalid.diagnosticCandidates.some(c=>c.geometry.issues.some(i=>/loop-|connection-/.test(i.code??''))))
})

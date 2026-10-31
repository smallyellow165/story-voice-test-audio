import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID,createHash} from 'node:crypto'
import {Matrix4,Quaternion,Vector3} from 'three'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
import {visibleV2Fixture} from './magnetic-visible3d-v2-fixtures.mjs'
import {compareAssemblyGeometry,pieceViewPreset} from '../src/magnetic-tiles/three-d/reconstruction/pose-inspection.ts'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {inspectSpatialConsistency,candidateObservationMap,observationState,visualPlaneRange} from '../src/magnetic-tiles/three-d/reconstruction/spatial-consistency.ts'
import {rebaseSpatialPlan,editReviewedPiece} from '../src/magnetic-tiles/three-d/reconstruction/rebase-plan.ts'
import {validateVisibleInput} from '../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
const check=(a,b,relation='plane-angle',minDeg=85,maxDeg=90)=>({id:'relation-'+relation,pieceA:a,pieceB:b,relation,minDeg:relation==='plane-angle'?minDeg:null,maxDeg:relation==='plane-angle'?maxDeg:null,evidenceRefs:[a,b],note:'Human confirmed relative relation'})

test('proper rigid alignment detects a labelled mirror without changing poses or connections',async()=>{
 const f=await visibleV2Fixture(),source=structuredClone(f.assembly),before=JSON.stringify(source),mapping=Object.fromEntries(source.pieces.map(p=>[p.id,p.id]))
 const q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.73),translation=new Vector3(4,-2,7)
 const moved=structuredClone(source);for(const p of moved.pieces){p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(translation).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()}
 const rigid=compareAssemblyGeometry(source,moved,mapping);assert.equal(rigid.equivalentUnderProperRotation,true);assert.ok(rigid.proper.maxError<1e-12);assert.ok(Math.abs(rigid.proper.determinant-1)<1e-12)
 const mirror=structuredClone(source),reflection=new Matrix4().makeScale(-1,1,1)
 for(const p of mirror.pieces){p.pose.position=new Vector3(...p.pose.position).applyMatrix4(reflection).toArray();const rotation=new Matrix4().makeRotationFromQuaternion(new Quaternion(...p.pose.quaternion));rotation.premultiply(reflection).multiply(new Matrix4().makeScale(-1,1,1));p.pose.quaternion=new Quaternion().setFromRotationMatrix(rotation).toArray()}
 const reflected=compareAssemblyGeometry(source,mirror,mapping);assert.equal(reflected.equivalentUnderProperRotation,false);assert.equal(reflected.mirrorOnly,true);assert.ok(reflected.improper.determinant<0)
 assert.equal(JSON.stringify(source),before)
})
test('midplane equivalence is explicitly separate from stored Profile thickness differences',async()=>{
 const {assembly}=await visibleFixture(),other=structuredClone(assembly),mapping=Object.fromEntries(assembly.pieces.map(p=>[p.id,p.id]));other.profiles[0].thickness+=.02
 assert.ok(compareAssemblyGeometry(assembly,other,mapping).proper.maxError>.009)
 assert.equal(compareAssemblyGeometry(assembly,other,mapping,1e-6,'midplane').equivalentUnderProperRotation,true)
})
test('Geometry Valid can contradict separately reviewed plane relationships; signs are not screen/world axes',async()=>{
 const f=await visibleFixture(),[a,b]=f.review.pieces.map(p=>p.id);f.plan.connections[0].angles=[60];f.input.review.spatialChecks=[check(a,b)]
 const r=executeVisible3D(f.plan,f.input),c=r.candidates[0];assert.equal(c.geometry.valid,true);assert.equal(c.spatialConsistency.status,'contradicted');assert.ok(Math.abs(c.spatialConsistency.checks[0].actualAngleDeg-60)<1e-6);assert.equal(c.photoMatch.status,'unverified')
 const noChecks=structuredClone(f.input);delete noChecks.review.spatialChecks;noChecks.review.interpretationReview={status:'accepted',note:'Scene looks upright'};assert.equal(inspectSpatialConsistency(c.assembly,noChecks).status,'unverified')
 f.input.review.spatialChecks=[check(a,b,'plane-angle',55,65)];assert.equal(executeVisible3D(f.plan,f.input).candidates[0].spatialConsistency.status,'consistent')
})
test('occlusion/image ordering remain Unverified; missing reviewed shared edge is a contradiction',async()=>{
 const f=await visibleV2Fixture(),c=f.plan.connections.pop();f.plan.connections[1].portA='e2-p0';f.input.review.spatialChecks=[check(c.pieceA,c.pieceB,'shared-edge')]
 const r=executeVisible3D(f.plan,f.input);assert.equal(r.candidates[0].geometry.valid,true);assert.equal(r.candidates[0].spatialConsistency.status,'contradicted')
 for(const relation of ['occludes','above-in-image']){f.input.review.spatialChecks=[check(c.pieceA,c.pieceB,relation)];assert.equal(executeVisible3D(f.plan,f.input).candidates[0].spatialConsistency.checks[0].status,'unverified')}
})
test('explicit ID mapping and partial states never guess correspondence from equal colors or row order',async()=>{
 const f=await visibleFixture('mixed-profiles'),r=executeVisible3D(f.plan,f.input),c=r.candidates.find(c=>c.assembly.pieces.length===2),map=candidateObservationMap(c.assembly,f.input)
 assert.deepEqual(map.map(m=>m.observationId).sort(),['base','triangle']);assert.equal(observationState('base',f.input,map),'reconstructed');assert.equal(observationState('free-triangle-v2',f.input,map),'unresolved')
 f.input.review.pieces.find(p=>p.id==='free-triangle-v2').profileId=null;assert.equal(observationState('free-triangle-v2',f.input,map),'unknown-profile')
 f.input.review.pieces.find(p=>p.id==='free-triangle-v2').excluded=true;assert.equal(observationState('free-triangle-v2',f.input,map),'excluded')
})
test('human rebase preserves immutable source; changed Profile ports become unknown until explicitly reviewed',async()=>{
 const f=await visibleV2Fixture(),previous=JSON.stringify(f),next=structuredClone(f.input);next.review.pieces[0].excluded=true
 const partial=rebaseSpatialPlan(f.plan,f.input,next);assert.equal(partial.plan.parts.length,2);assert.equal(JSON.stringify(f),previous)
 const known=structuredClone(f.input);known.profiles.push({...structuredClone(known.profiles[0]),profile:{...structuredClone(known.profiles[0].profile),version:2}});known.review.pieces[0].profileVersion=2
 const changed=rebaseSpatialPlan(f.plan,f.input,known);assert.ok(changed.plan.connections.filter(c=>c.pieceA===known.review.pieces[0].id||c.pieceB===known.review.pieces[0].id).every(c=>c.pieceA===known.review.pieces[0].id?c.portA===null:c.portB===null))
})
test('visual signed alternatives fold to the same unoriented plane angle',()=>{assert.ok(Math.abs(visualPlaneRange(-90,-90)[0]-90)<1e-6);assert.ok(Math.abs(visualPlaneRange(90,90)[0]-90)<1e-6);assert.ok(Math.abs(visualPlaneRange(180,180)[0])<1e-6)})
test('view presets are finite pure camera instructions, not pose edits, gravity constraints or reflections',async()=>{
 const {assembly}=await visibleFixture(),before=JSON.stringify(assembly)
 for(const kind of ['face','up']){const p=pieceViewPreset(assembly,assembly.pieces[0].id,kind);assert.ok([...p.up,...p.direction].every(Number.isFinite));assert.ok(Math.abs(new Vector3(...p.up).length()-1)<1e-6)}
 assert.equal(JSON.stringify(assembly),before)
})
test('strict relative checks reject invented identities, world-axis shortcuts and invalid angle intervals',async()=>{
 const f=await visibleFixture(),[a,b]=f.review.pieces.map(p=>p.id)
 for(const change of [c=>c.pieceB='hidden',c=>c.relation='world-horizontal',c=>c.maxDeg=120,c=>c.evidenceRefs=['invented']]){const v=structuredClone(f.input),c=check(a,b);change(c);v.review.spatialChecks=[c];assert.throws(()=>validateVisibleInput(v))}
})
test('server rejects spatial contradictions, permits explicit no-LLM correction/rebase and preserves old records',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'visible-v21-'));t.after(()=>rm(directory,{recursive:true,force:true}));const api=createMagneticIntake(directory),f=await visibleFixture(),[a,b]=f.review.pieces.map(p=>p.id),post=(r,b)=>api.dispatch('POST','visible3d/'+r,b)
 const source=await api.dispatch('POST','sources',{name:'fixture.png',original:png,view:png}),analysis=await post('annotate',{sourceId:source.id,evidence:f.evidence});f.review.spatialChecks=[check(a,b)];f.plan.connections[0].angles=[60]
 const review=await post('reviews',{analysisId:analysis.id,review:f.review,expectedRevision:0}),plan=await post('manual-plan',{reviewId:review.record.id,plan:f.plan}),x=await post('execute',{planId:plan.id,requestId:randomUUID()})
 await assert.rejects(post('adopt',{executionId:x.record.id,candidateId:'candidate-1',visualChecked:true}),/已审核空间关系/)
 const updated=structuredClone(f.review);updated.spatialChecks=[check(a,b,'plane-angle',55,65)];const second=await post('reviews',{analysisId:analysis.id,review:updated,expectedRevision:1}),rebased=await post('rebase-plan',{reviewId:second.record.id,planId:plan.id}),y=await post('execute',{planId:rebased.id,requestId:randomUUID()})
 assert.equal(rebased.basedOnPlanHash,plan.hash);assert.equal(y.record.candidates[0].spatialConsistency.status,'consistent');const origin=await post('adopt',{executionId:y.record.id,candidateId:'candidate-1',visualChecked:true});assert.equal(origin.spatialConsistency.status,'consistent')
 assert.deepEqual((await api.dispatch('GET','visible3d/executions/'+x.record.id)).record,x.record);assert.equal((await api.dispatch('GET','visible3d/executions/'+x.record.id)).outdated,true)
})
test('legacy version-1 saved candidates remain adoptable without rewriting their historical hashes',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'visible-v21-legacy-'));t.after(()=>rm(directory,{recursive:true,force:true}));const api=createMagneticIntake(directory),f=await visibleFixture(),post=(r,b)=>api.dispatch('POST','visible3d/'+r,b),source=await api.dispatch('POST','sources',{name:'legacy.png',original:png,view:png})
 const a=await post('annotate',{sourceId:source.id,evidence:f.evidence}),r=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:0}),p=await post('manual-plan',{reviewId:r.record.id,plan:f.plan}),x=await post('execute',{planId:p.id,requestId:randomUUID()})
 const legacy=structuredClone(x.record);legacy.version=1;for(const c of legacy.candidates){delete c.spatialConsistency;delete c.observationMap}delete legacy.hash;legacy.hash=createHash('sha256').update(JSON.stringify(legacy)).digest('hex');await writeFile(path.join(directory,'visible3d/executions',legacy.id+'.json'),JSON.stringify(legacy))
 const o=await post('adopt',{executionId:legacy.id,candidateId:'candidate-1',visualChecked:true});assert.equal(o.assembly.pieces.length,2);assert.equal((await api.dispatch('GET','visible3d/executions/'+legacy.id)).record.hash,legacy.hash)
})

test('Review edits clean excluded references and invalidate changed Profile ports without mutating saved snapshots',async()=>{
 const f=await visibleFixture(),[a,b]=f.review.pieces.map(p=>p.id);f.review.constraints=structuredClone(f.plan.connections);f.review.spatialChecks=[check(a,b)];const before=JSON.stringify(f.review)
 const excluded=editReviewedPiece(f.review,a,{excluded:true});assert.deepEqual(excluded.constraints,[]);assert.deepEqual(excluded.spatialChecks,[])
 const changed=editReviewedPiece(f.review,a,{profileVersion:2});assert.equal(changed.constraints[0].portA,null);assert.equal(changed.constraints[0].portB,f.review.constraints[0].portB);assert.equal(JSON.stringify(f.review),before)
 const rebased=rebaseSpatialPlan(f.plan,f.input,f.input);const repeated=rebaseSpatialPlan(rebased.plan,f.input,f.input);assert.deepEqual(rebased.plan.unknowns,repeated.plan.unknowns)
})

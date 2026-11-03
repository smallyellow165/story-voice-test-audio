import {selectFixture} from './magnetic-selected-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {png} from './magnetic-visible3d-fixtures.mjs'
const fixture=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/orange-reviewed-geometry.json',import.meta.url),'utf8'))
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'magnetic-override-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir),post=(route,body)=>api.dispatch('POST','visible3d/'+route,body),f=structuredClone(fixture),source=await api.dispatch('POST','sources',{name:'geometry fixture.png',original:png,view:png}),analysis=await post('annotate',{sourceId:source.id,evidence:f.input.evidence}),review=await post('reviews',{analysisId:analysis.id,review:f.input.review,thickness:.06,expectedRevision:0}),plan=await post('manual-plan',{reviewId:review.record.id,plan:f.plan}),execution=await post('execute',{planId:plan.id,requestId:randomUUID()});return {dir,api,post,f,source,analysis,review,plan,x:execution.record}}
test('explicit diagnostic-only endpoint preserves six-piece Invalid geometry, lineage and immutable records; normal Adopt remains strict',async t=>{
 const f=await setup(t),body={executionId:f.x.id,executionHash:f.x.hash,candidateId:'diagnostic-1'};
 await assert.rejects(f.post('adopt',{...body}),/Diagnostic/);
 assert.equal((await f.post('open-diagnostic-draft',body)).entryMode,'diagnostic-draft');
 await assert.rejects(f.post('open-diagnostic-draft',{...body,executionHash:'forged'}),/Hash/);
 await assert.rejects(f.post('open-diagnostic-draft',{...body,candidateId:'candidate-1'}),/身份|复核/);
 const o=await f.post('open-diagnostic-draft',body),c=f.x.diagnosticCandidates[0];
 assert.equal(o.entryMode,'diagnostic-draft');assert.equal('authorization' in o,false);assert.equal('humanReview' in o,false);assert.equal(o.diagnostic.geometry.valid,false);assert.equal(o.diagnostic.validation.idealGeometry.valid,true);assert.equal(o.diagnostic.validation.solidCollision.valid,false);
 assert.deepEqual(o.assembly.pieces,c.assembly.pieces);assert.deepEqual(o.assembly.profiles,c.assembly.profiles);assert.deepEqual(o.assembly.connections,c.assembly.connections);assert.deepEqual(o.diagnostic.geometry,c.geometry);assert.deepEqual(o.diagnostic.collisions,c.collisions);assert.equal(o.candidateHash,createHash('sha256').update(JSON.stringify(c)).digest('hex'));assert.equal(o.executionHash,f.x.hash);
 assert.deepEqual((await f.api.dispatch('GET','visible3d/executions/'+f.x.id)).record,f.x);assert.deepEqual((await f.api.dispatch('GET','visible3d/plans/'+f.plan.id)).record,f.plan);
 assert.equal(f.x.candidates.length,0,'a new manual Plan cannot silently drop its hard connections');
 const legacy={...f.x,...executeVisible3D(f.plan.plan,f.review.record.input,{algorithmVersion:3}),id:randomUUID()};delete legacy.hash;legacy.hash=createHash('sha256').update(JSON.stringify(legacy)).digest('hex');await writeFile(path.join(f.dir,'visible3d/executions',legacy.id+'.json'),JSON.stringify(legacy));
 await assert.rejects(selectFixture(f.api,f.source.id,'execution',legacy),/旧 Execution/);await assert.rejects(f.post('adopt',{executionId:legacy.id,candidateId:'candidate-1'}),/Selected/);
 await f.post('reviews',{analysisId:f.analysis.id,review:f.f.input.review,thickness:.06,expectedRevision:1});await assert.rejects(f.post('open-diagnostic-draft',body),/过期/);
})
test('connection-error drafts open directly; forged geometry and mismatched sources still fail integrity checks',async t=>{
 const f=await setup(t),wrong=structuredClone(f.plan.plan);wrong.connections[0].angles=[45];
 const p=await f.post('manual-plan',{reviewId:f.review.record.id,plan:wrong}),x=(await f.post('execute',{planId:p.id,requestId:randomUUID()})).record;
 const c=x.diagnosticCandidates.find(c=>!c.validation.idealGeometry.valid);assert.ok(c);
 const draft=await f.post('open-diagnostic-draft',{executionId:x.id,executionHash:x.hash,candidateId:c.id});assert.equal(draft.diagnostic.validation.idealGeometry.valid,false);
 const forged=structuredClone(f.x);forged.diagnosticCandidates[0].assembly.pieces[0].pose.position[0]+=2;delete forged.hash;forged.hash=createHash('sha256').update(JSON.stringify(forged)).digest('hex');await writeFile(path.join(f.dir,'visible3d/executions',forged.id+'.json'),JSON.stringify(forged));await selectFixture(f.api,f.source.id,'plan',f.plan);await selectFixture(f.api,f.source.id,'execution',forged);
 await assert.rejects(f.post('open-diagnostic-draft',{executionId:forged.id,executionHash:forged.hash,candidateId:'diagnostic-1'}),/身份|复核/);
 const wrongSource=structuredClone(f.x);wrongSource.sourceId='0'.repeat(64);delete wrongSource.hash;wrongSource.hash=createHash('sha256').update(JSON.stringify(wrongSource)).digest('hex');await writeFile(path.join(f.dir,'visible3d/executions',wrongSource.id+'.json'),JSON.stringify(wrongSource));await assert.rejects(f.post('open-diagnostic-draft',{executionId:wrongSource.id,executionHash:wrongSource.hash,candidateId:'diagnostic-1'}),/来源/);
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm,readdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {Quaternion,Vector3} from 'three'
import {createHumanCollisionReview} from '../server/magnetic-human-collision.mjs'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {acceptedDiagnosticErrors,diagnosticAcceptanceEligibility} from '../src/magnetic-tiles/three-d/diagnostic-acceptance.ts'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {validateTutorial3D} from '../src/magnetic-tiles/three-d/tutorial.ts'
import {tutorialReadyToSave} from '../src/magnetic-tiles/three-d/tutorial-workflow.ts'
import {png} from './magnetic-visible3d-fixtures.mjs'

const file=new URL('../checks/magnetic-3d/fixtures/front-diagnostic-geometry.json',import.meta.url),bytes=await readFile(file),front=JSON.parse(bytes)
const req={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:9999',origin:'http://127.0.0.1:9999','sec-fetch-site':'same-origin'}}
async function context(api){const {token}=await api.dispatch('POST','session',{}, {request:req});return {request:{...req,headers:{...req.headers,authorization:'Bearer '+token}}}}
async function setup(t){
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-human-diagnostic-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const a=structuredClone(front.assembly);a.id='human-diagnostic-'+randomUUID();a.revision=0
 const origin={id:randomUUID(),hash:'a'.repeat(64),entryMode:'human-accepted-diagnostic',authorization:{scope:'accepted-diagnostic-errors',explicit:true},executionId:front.provenance.executionId,executionHash:'b'.repeat(64),candidateId:'diagnostic-1',diagnostic:{hash:'c'.repeat(64)},assembly:structuredClone(a)}
 const readOrigin=async id=>{assert.equal(id,origin.id);return structuredClone(origin)}
 const api=createHumanCollisionReview(dir,{enabled:true,readOrigin}),ctx=await context(api)
 const call=(route,body={})=>api.dispatch('POST',route,{assembly:a,...body},ctx)
 const adopt=()=>call('accept-diagnostic',{expectedVersion:null,originId:origin.id})
 return {dir,a,origin,readOrigin,api,ctx,call,adopt}
}
test('one explicit acceptance preserves Front nine-piece Invalid geometry and authorizes the real nine-step Tutorial/save/reopen flow',async t=>{
 const {a,call,adopt,dir,origin}=await setup(t),raw=canonical(a)
 const s=await adopt();assert.equal(s.geometry.valid,false);assert.equal(s.grant.geometry.valid,false);assert.equal(s.acceptedKeys.length,4);assert.equal(s.humanAcceptedDiagnostic,true)
 assert.equal(s.grant.acceptedDiagnostic.execution.id,origin.executionId);assert.equal(s.grant.acceptedDiagnostic.origin.id,origin.id);assert.equal(s.acceptedErrors.length,4)
 assert.ok(s.acceptedErrors.every(i=>i.code==='intersection'&&i.severity==='error'));assert.equal(s.blockers.length,0)
 const id=s.grant.id;assert.equal((await adopt()).grant.id,id,'retry of the same origin is idempotent, not another approval')
 const generated=await call('generate',{expectedVersion:s.version,approvalId:id});assert.equal(generated.result.status,'complete');assert.equal(generated.result.tutorial.steps.length,9);assert.equal(generated.result.finalGeometryValid,false)
 const tutorial=generated.result.tutorial,report=validateTutorial3D(tutorial,s.grant);assert.equal(report.humanApproved,true);assert.equal(report.finalValid,false);assert.equal(tutorialReadyToSave(tutorial,report,a),true);assert.equal(tutorialReadyToSave(tutorial,validateTutorial3D(tutorial),a),false)
 assert.ok(report.issues.some(i=>i.severity==='error'&&i.humanAccepted));assert.equal(report.steps.filter(s=>!s.geometryValid).every(s=>s.humanApproved),true)
 const saved=await call('saveTutorial',{expectedVersion:s.version,approvalId:id,tutorial});assert.ok(saved.recordId);assert.equal(saved.review.grant.id,id)
 assert.equal((await call('revalidate',{expectedVersion:saved.review.version})).grant.id,id)
 assert.equal(canonical(a),raw);assert.equal(validateAssembly3D(a).valid,false);assert.ok((await readdir(path.join(dir,'approvals'))).length>=1);assert.ok(bytes.equals(await readFile(file)))
})
test('rigid transforms, color changes and harmless Revision changes retain acceptance through current server grants, restart and stale-request checks',async t=>{
 const f=await setup(t),old=await f.adopt(),q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),1.27)
 for(const p of f.a.pieces){p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(new Vector3(5,-3,8)).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()}
 f.a.revision++;f.a.pieces[0].color='#112233'
 const s=await f.call('sync',{expectedVersion:old.version});assert.ok(s.grant);assert.notEqual(s.grant.id,old.grant.id);assert.equal(s.acceptedErrors.length,4);assert.equal(s.grant.revision,f.a.revision);assert.equal(s.geometry.valid,false)
 assert.equal(canonical(s.grant.acceptedDiagnostic),canonical(old.grant.acceptedDiagnostic),'original accepted relationships remain immutable')
 await assert.rejects(f.call('generate',{expectedVersion:old.version,approvalId:old.grant.id}),e=>e.statusCode===409)
 await assert.rejects(f.call('generate',{expectedVersion:s.version,approvalId:old.grant.id}),e=>e.statusCode===403)
 const restarted=createHumanCollisionReview(f.dir,{enabled:true,readOrigin:f.readOrigin}),ctx=await context(restarted),restored=await restarted.dispatch('POST','status',{assembly:f.a},ctx)
 assert.equal(restored.grant.id,s.grant.id);assert.equal((await restarted.dispatch('POST','generate',{assembly:f.a,expectedVersion:s.version,approvalId:s.grant.id},ctx)).result.status,'complete')
})
test('a changed relative pose is rejected even for the same collision pair and same SAT depth',async t=>{
 const f=await setup(t),old=await f.adopt(),baseline=old.grant.acceptedDiagnostic
 const changed=structuredClone(f.a);changed.pieces.find(p=>p.id==='p22').pose.position[0]+=.01;changed.revision++
 const result=acceptedDiagnosticErrors(changed,validateAssembly3D(changed),baseline)
 assert.ok(result.blockers.length);assert.ok(result.accepted.length<4)
 const originalIssue=baseline.geometry.issues.find(i=>i.code==='intersection'&&i.relatedPieceIds.includes('p22'))
 // Prove that identity and an unchanged numeric depth alone do not authorize a moved pair.
 assert.equal(acceptedDiagnosticErrors(changed,{valid:false,issues:[structuredClone(originalIssue)]},baseline).complete,false)
 Object.assign(f.a,changed);const s=await f.call('sync',{expectedVersion:old.version});assert.equal(s.grant,null);assert.ok(s.blockers.length)
 await assert.rejects(f.call('generate',{expectedVersion:s.version,approvalId:old.grant.id}),e=>e.statusCode===403)
})
test('new collisions, related connections and thickness changes cannot inherit old acceptance',async t=>{
 for(const change of [a=>a.pieces.push({...structuredClone(a.pieces.find(p=>p.id==='p17')),id:'new-intruder'}),a=>{a.connections=a.connections.filter(c=>c.pieceA!=='p17'&&c.pieceB!=='p17')}]){
  const f=await setup(t),s=await f.adopt();change(f.a);f.a.revision++;const after=await f.call('sync',{expectedVersion:s.version});assert.equal(after.grant,null);assert.ok(after.blockers.length);await assert.rejects(f.call('generate',{expectedVersion:after.version,approvalId:s.grant.id}),e=>e.statusCode===403)
 }
})
test('same-version thickness overrides cannot enter formal authorization or Build',async t=>{const f=await setup(t);await f.adopt();f.a.profiles[0].thickness*=1.1;await assert.rejects(f.call('sync',{expectedVersion:1}),/Canonical Profile/);await assert.rejects(f.call('generate',{expectedVersion:1}),/Canonical Profile/)})
test('unknown errors, forged origins, unaccepted snapshots, unauthorized requests and concurrent changes fail closed',async t=>{
 const f=await setup(t),r=validateAssembly3D(f.a)
 assert.equal(diagnosticAcceptanceEligibility(f.a,{...r,issues:[...r.issues,{modelId:f.a.id,severity:'error',code:'other',message:'unknown geometry fault'}]}).eligible,false)
 await assert.rejects(f.api.dispatch('POST','accept-diagnostic',{assembly:f.a,expectedVersion:null,originId:f.origin.id},{request:req}),e=>e.statusCode===401)
 f.origin.entryMode='diagnostic-override';await assert.rejects(f.adopt(),e=>e.statusCode===409);f.origin.entryMode='human-accepted-diagnostic'
 await assert.rejects(f.call('generate',{expectedVersion:null,approvalId:'forged'}),e=>[403,409].includes(e.statusCode))
 const other=structuredClone(f.a);other.pieces[0].pose.position[0]+=.1;await assert.rejects(f.call('accept-diagnostic',{assembly:other,expectedVersion:null,originId:f.origin.id}),e=>e.statusCode===409)
 let s=await f.adopt();const a=structuredClone(f.a),b=structuredClone(f.a);a.revision++;b.revision+=2
 const writes=await Promise.allSettled([f.call('sync',{assembly:a,expectedVersion:s.version}),f.call('sync',{assembly:b,expectedVersion:s.version})]);assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);assert.equal(writes.find(r=>r.status==='rejected').reason.statusCode,409)
})
test('Reconstruction handoff keeps the immutable Diagnostic and requires the existing authenticated grant endpoint before Build',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-human-origin-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir,{enableHumanReview:true}),fixture=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/orange-reviewed-geometry.json',import.meta.url)))
 const post=(r,b)=>api.dispatch('POST','visible3d/'+r,b),source=await api.dispatch('POST','sources',{name:'OFFLINE geometry fixture.png',original:png,view:png}),analysis=await post('annotate',{sourceId:source.id,evidence:fixture.input.evidence}),review=await post('reviews',{analysisId:analysis.id,review:fixture.input.review,expectedRevision:0,thickness:.06}),plan=await post('manual-plan',{reviewId:review.record.id,plan:fixture.plan}),execution=(await post('execute',{planId:plan.id,requestId:randomUUID()})).record
 const c=execution.diagnosticCandidates[0],request={executionId:execution.id,executionHash:execution.hash,candidateId:c.id,humanAccepted:true},recordPath=path.join(dir,'visible3d/executions',execution.id+'.json'),original=await readFile(recordPath)
 const origin=await post('open-diagnostic-draft',request);assert.equal(origin.entryMode,'human-accepted-diagnostic');assert.deepEqual(origin.assembly.pieces,c.assembly.pieces);assert.deepEqual(origin.assembly.connections,c.assembly.connections);assert.deepEqual(origin.diagnostic.geometry,c.geometry)
 const {token}=await api.dispatch('POST','assembly3d-review/session',{}, {request:req}),ctx={request:{...req,headers:{...req.headers,authorization:'Bearer '+token}}}
 const accepted=await api.dispatch('POST','assembly3d-review/accept-diagnostic',{assembly:origin.assembly,expectedVersion:null,originId:origin.id},ctx);assert.ok(accepted.grant);assert.equal(accepted.geometry.valid,false)
 assert.ok(original.equals(await readFile(recordPath)));await assert.rejects(post('adopt',{...request,visualChecked:true}),/Diagnostic/)
 await assert.rejects(post('open-diagnostic-draft',{...request,executionHash:'forged'}),/Hash/)
 const forged=structuredClone(execution);forged.diagnosticCandidates[0].assembly.pieces[0].pose.position[0]+=1;delete forged.hash;forged.hash=createHash('sha256').update(JSON.stringify(forged)).digest('hex');await writeFile(recordPath,JSON.stringify(forged));await assert.rejects(post('open-diagnostic-draft',{...request,executionHash:forged.hash}),/身份|快照/);await writeFile(recordPath,original)
 const metadata=structuredClone(execution);metadata.diagnosticCandidates[0].unverifiedConstraints=['forged photo claim'];delete metadata.hash;metadata.hash=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');await writeFile(recordPath,JSON.stringify(metadata));await assert.rejects(post('open-diagnostic-draft',{...request,executionHash:metadata.hash}),/身份|快照/);await writeFile(recordPath,original)
 await post('reviews',{analysisId:analysis.id,review:fixture.input.review,expectedRevision:1,thickness:.06})
 await assert.rejects(api.dispatch('POST','assembly3d-review/accept-diagnostic',{assembly:origin.assembly,expectedVersion:null,originId:origin.id},ctx),/过期/)
 // Already accepted immutable Assemblies are independent of later Review edits.
 assert.ok((await api.dispatch('POST','assembly3d-review/status',{assembly:origin.assembly},ctx)).grant)
})

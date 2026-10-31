import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHumanCollisionReview} from '../server/magnetic-human-collision.mjs'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {collisionReviewPolicy} from '../src/magnetic-tiles/three-d/human-collision-policy.ts'
import {validateTutorial3D,parseTutorial3D} from '../src/magnetic-tiles/three-d/tutorial.ts'
import {tutorialReadyToSave} from '../src/magnetic-tiles/three-d/tutorial-workflow.ts'
const orange=JSON.parse(await readFile(new URL('../generated/magnetic-intake/visible3d/executions/21b18495-3ff3-4d5f-95d3-dc7902ea7cb7.json',import.meta.url),'utf8')).diagnosticCandidates.find(d=>d.assembly.pieces.length===6).assembly
const request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:9999',origin:'http://127.0.0.1:9999','sec-fetch-site':'same-origin'}}
async function session(api,req=request){const {token}=await api.dispatch('POST','session',{}, {request:req});return {request:{...req,headers:{...req.headers,authorization:'Bearer '+token}}}}
async function setup(fn){const dir=await mkdtemp(path.join(tmpdir(),'magnetic-human-test-'));try{const api=createHumanCollisionReview(dir,{enabled:true}),context=await session(api),a=structuredClone(orange);await fn({dir,api,context,a,call:(route,body)=>api.dispatch('POST',route,{assembly:a,...body},context)})}finally{await rm(dir,{recursive:true,force:true})}}
const rejected=(p,code)=>assert.rejects(p,e=>e.statusCode===code)
async function approved(call){let s=await call('sync',{expectedVersion:null});for(const key of s.collisionKeys)s=await call('accept',{expectedVersion:s.version,acceptedKeys:[...s.acceptedKeys,key]});return call('approve',{expectedVersion:s.version,acceptedKeys:s.acceptedKeys})}

test('local-only session and protected actions reject unauthorized, remote, cross-origin, proxy and production requests',async()=>{
 await setup(async({dir,api,context,a})=>{
  await rejected(api.dispatch('POST','sync',{assembly:a,expectedVersion:null},{request}),401)
  await rejected(api.dispatch('POST','sync',{assembly:a,expectedVersion:null},{request:{...request,headers:{...request.headers,authorization:'Bearer forged'}}}),401)
  for(const req of [{...request,socket:{remoteAddress:'192.168.1.1'}},{...request,headers:{...request.headers,origin:'http://evil.example'}},{...request,headers:{...request.headers,'x-forwarded-for':'127.0.0.1'}}])await rejected(api.dispatch('POST','session',{}, {request:req}),403)
  const production=createHumanCollisionReview(dir,{enabled:false});await rejected(production.dispatch('POST','session',{}, {request}),403)
  await rejected(api.dispatch('POST','sync',{assembly:a,expectedVersion:null,path:'/tmp/arbitrary'},context),400)
  assert.deepEqual(await readdir(dir),[])
 })
})
test('four individual acceptances authorize the existing six-step planner/player format while strict geometry stays Invalid',async()=>{
 await setup(async({call,a,dir})=>{
  const before=JSON.stringify(a);let s=await call('sync',{expectedVersion:null});assert.equal(s.collisionKeys.length,4);assert.equal(s.geometry.valid,false)
  await rejected(call('approve',{expectedVersion:s.version,acceptedKeys:s.collisionKeys}),422)
  for(const key of s.collisionKeys.slice(0,3))s=await call('accept',{expectedVersion:s.version,acceptedKeys:[...s.acceptedKeys,key]})
  assert.equal(s.acceptedKeys.length,3);await rejected(call('approve',{expectedVersion:s.version,acceptedKeys:s.collisionKeys}),422)
  s=await call('accept',{expectedVersion:s.version,acceptedKeys:s.collisionKeys});s=await call('approve',{expectedVersion:s.version,acceptedKeys:s.acceptedKeys})
  assert.equal(s.geometry.valid,false);assert.equal(s.grant.geometry.valid,false);assert.equal(s.grant.collisionKeys.length,4)
  const r=await call('generate',{expectedVersion:s.version,approvalId:s.grant.id});assert.equal(r.result.status,'complete');assert.equal(r.result.finalGeometryValid,false);assert.equal(r.result.humanApproved,true);assert.equal(r.result.tutorial.steps.length,6)
  const t=parseTutorial3D(JSON.stringify(r.result.tutorial)),v=validateTutorial3D(t,s.grant)
  assert.equal(v.finalValid,false);assert.equal(v.humanApproved,true);assert.ok(v.issues.some(i=>i.severity==='error'&&i.humanAccepted));assert.equal(tutorialReadyToSave(t,v,a),true);assert.equal(tutorialReadyToSave(t,validateTutorial3D(t),a),false)
  const saved=await call('saveTutorial',{expectedVersion:s.version,approvalId:s.grant.id,tutorial:t});assert.ok(saved.recordId)
  assert.equal(JSON.parse(await readFile(path.join(dir,'tutorials',saved.recordId+'.json'),'utf8')).tutorial.source.humanCollisionApproval.id,s.grant.id)
  assert.equal(JSON.stringify(a),before);assert.equal(validateAssembly3D(a).valid,false)
 })
})
test('structural/unknown/unidentified errors and forged acceptance keys remain blockers',async()=>{
 await setup(async({api,context,a,call})=>{
  let s=await call('sync',{expectedVersion:null});await rejected(call('accept',{expectedVersion:s.version,acceptedKeys:['unknown']}),422)
  a.connections[0].dihedralDeg=20;s=await call('sync',{expectedVersion:s.version});assert.equal(s.eligible,false);assert.ok(s.blockers.length)
  await rejected(call('accept',{expectedVersion:s.version,acceptedKeys:s.collisionKeys}),422)
  const r=validateAssembly3D(orange);assert.equal(collisionReviewPolicy(orange,{...r,issues:[...r.issues,{severity:'error',message:'Unknown structure error'}]}).eligible,false)
  assert.equal(collisionReviewPolicy(orange,{...r,issues:[{severity:'error',code:'intersection',message:'unidentified'}]}).eligible,false)
 })
})
test('mutation and Undo to identical bytes revoke old authorization; stale revision/hash/approval requests fail',async()=>{
 await setup(async({call,a})=>{
  let s=await approved(call);const old=structuredClone(s),original=structuredClone(a)
  a.pieces[0].pose.position[0]+=.2;a.revision++
  await rejected(call('approve',{expectedVersion:s.version,acceptedKeys:s.collisionKeys}),409)
  s=await call('sync',{expectedVersion:s.version});assert.equal(s.grant,null);assert.deepEqual(s.acceptedKeys,[])
  Object.assign(a,original);s=await call('sync',{expectedVersion:s.version});assert.equal(s.grant,null)
  await rejected(call('generate',{expectedVersion:s.version,approvalId:old.grant.id}),403)
  await rejected(call('approve',{expectedVersion:old.version,acceptedKeys:old.acceptedKeys}),409)
  await rejected(call('approve',{expectedVersion:s.version,acceptedKeys:old.acceptedKeys,assemblyHash:old.assemblyHash}),400)
  s=await call('accept',{expectedVersion:s.version,acceptedKeys:s.collisionKeys});s=await call('approve',{expectedVersion:s.version,acceptedKeys:s.acceptedKeys});assert.notEqual(s.grant.id,old.grant.id)
 })
})
test('CAS is enforced across service instances; unchanged revalidation/restart restore only active approvals',async()=>{
 await setup(async({dir,api,context,a,call})=>{
  let s=await call('sync',{expectedVersion:null});const second=createHumanCollisionReview(dir,{enabled:true}),ctx2=await session(second)
  const results=await Promise.allSettled([call('accept',{expectedVersion:s.version,acceptedKeys:[s.collisionKeys[0]]}),second.dispatch('POST','accept',{assembly:a,expectedVersion:s.version,acceptedKeys:[s.collisionKeys[1]]},ctx2)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409)
  s=await call('status',{});s=await call('accept',{expectedVersion:s.version,acceptedKeys:s.collisionKeys});s=await call('approve',{expectedVersion:s.version,acceptedKeys:s.acceptedKeys});const id=s.grant.id
  s=await call('revalidate',{expectedVersion:s.version});assert.equal(s.grant.id,id)
  const restarted=createHumanCollisionReview(dir,{enabled:true}),ctx3=await session(restarted),restored=await restarted.dispatch('POST','status',{assembly:a},ctx3);assert.equal(restored.grant.id,id)
  await rejected(restarted.dispatch('POST','generate',{assembly:a,expectedVersion:s.version,approvalId:'forged'},ctx3),403)
 })
})
test('approved collisions cannot waive Tutorial assignment, connectivity or wrong source checks',async()=>{
 await setup(async({call,a})=>{
  const s=await approved(call),r=await call('generate',{expectedVersion:s.version,approvalId:s.grant.id}),t=r.result.tutorial
  const missing=structuredClone(t);missing.steps.pop();await rejected(call('saveTutorial',{expectedVersion:s.version,approvalId:s.grant.id,tutorial:missing}),422)
  const wrong=structuredClone(t);wrong.assembly.pieces[0].pose.position[0]+=.1;await rejected(call('saveTutorial',{expectedVersion:s.version,approvalId:s.grant.id,tutorial:wrong}),422)
  const ref=structuredClone(t);ref.source.humanCollisionApproval.id='forged';await rejected(call('saveTutorial',{expectedVersion:s.version,approvalId:s.grant.id,tutorial:ref}),422)
 })
})

// Approval is a per-workflow authorization, not a geometry-result rewrite.
test('unchecking revokes approval, other Assembly IDs stay isolated, and persisted evidence is integrity checked',async()=>{
 await setup(async({call,a,dir,api,context})=>{
  let s=await approved(call);const id=s.grant.id
  const other=structuredClone(a);other.id='different-draft';other.revision++
  const isolated=await api.dispatch('POST','status',{assembly:other},context);assert.equal(isolated.grant,null);assert.equal(isolated.version,null)
  s=await call('accept',{expectedVersion:s.version,acceptedKeys:s.acceptedKeys.slice(1)});assert.equal(s.acceptedKeys.length,3);assert.equal(s.grant,null)
  await rejected(call('generate',{expectedVersion:s.version,approvalId:id}),403)
  s=await call('accept',{expectedVersion:s.version,acceptedKeys:s.collisionKeys});s=await call('approve',{expectedVersion:s.version,acceptedKeys:s.acceptedKeys})
  const file=path.join(dir,'approvals',s.grant.id+'.json');const damaged=JSON.parse(await readFile(file,'utf8'));damaged.revision++
  const {writeFile}=await import('node:fs/promises');await writeFile(file,JSON.stringify(damaged))
  await rejected(call('status',{}),409)
 })
})

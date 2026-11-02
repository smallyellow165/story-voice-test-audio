import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHumanCollisionReview} from '../server/magnetic-human-collision.mjs'
import {confirmSymmetryFill,previewSymmetryFill,proposeSymmetryPlane} from '../src/magnetic-tiles/three-d/symmetry-fill.ts'
import {createInitialHistory,undo,redo} from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {saveDraft3D,loadDraft3D} from '../src/magnetic-tiles/three-d/draft-storage.ts'
const file=new URL('../generated/magnetic-intake/visible3d/executions/21b18495-3ff3-4d5f-95d3-dc7902ea7cb7.json',import.meta.url),raw=await readFile(file,'utf8'),a=JSON.parse(raw).diagnosticCandidates.find(d=>d.assembly.pieces.length===6).assembly
const request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:9999',origin:'http://127.0.0.1:9999','sec-fetch-site':'same-origin'}}
test('six approved → symmetry 9/12 → old authorization revoked → eight collision review → nine-step existing Build',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-symmetry-test-'))
 try{
  const api=createHumanCollisionReview(dir,{enabled:true}),{token}=await api.dispatch('POST','session',{}, {request}),context={request:{...request,headers:{...request.headers,authorization:'Bearer '+token}}},call=(route,body)=>api.dispatch('POST',route,body,context)
  async function approve(assembly,state){for(const key of state.collisionKeys)state=await call('accept',{assembly,expectedVersion:state.version,acceptedKeys:[...state.acceptedKeys,key]});return call('approve',{assembly,expectedVersion:state.version,acceptedKeys:state.acceptedKeys})}
  let s=await call('sync',{assembly:a,expectedVersion:null});s=await approve(a,s);const oldGrant=s.grant
  const ids=['tile2','tile3','tile4'],preview=previewSymmetryFill(a,{sourceIds:ids,plane:proposeSymmetryPlane(a,ids),planeMode:'auto',confirmedPlane:true}),h=confirmSymmetryFill(createInitialHistory(a),preview),nine=h.current
  assert.equal(nine.pieces.length,9);assert.equal(nine.connections.length,12);assert.deepEqual(nine.pieces.slice(0,6),a.pieces);assert.deepEqual(nine.connections.slice(0,7),a.connections)
  s=await call('sync',{assembly:nine,expectedVersion:s.version});assert.equal(s.grant,null);assert.deepEqual(s.acceptedKeys,[]);assert.equal(s.collisionKeys.length,8)
  await assert.rejects(call('generate',{assembly:nine,expectedVersion:s.version,approvalId:oldGrant.id}),e=>e.statusCode===403)
  // Even returning through Undo then Redo cannot resurrect the six-piece grant.
  const sixAgain=undo(h).current;s=await call('sync',{assembly:sixAgain,expectedVersion:s.version});assert.equal(s.grant,null)
  const restored=redo(undo(h)).current;assert.deepEqual(restored,nine);s=await call('sync',{assembly:restored,expectedVersion:s.version});assert.equal(s.grant,null)
  s=await approve(nine,s);assert.equal(s.geometry.valid,false);const generated=await call('generate',{assembly:nine,expectedVersion:s.version,approvalId:s.grant.id})
  assert.equal(generated.result.status,'complete');assert.equal(generated.result.tutorial.steps.length,9);assert.equal(generated.result.finalGeometryValid,false);assert.equal(generated.result.humanApproved,true)
  assert.deepEqual(generated.result.tutorial.assembly,nine);assert.equal(generated.result.tutorial.source.assemblyRevision,nine.revision)
  const saved=await call('saveTutorial',{assembly:nine,expectedVersion:s.version,approvalId:s.grant.id,tutorial:generated.result.tutorial});assert.ok(saved.recordId)
  const storage={raw:null,getItem(){return this.raw},setItem(_k,v){this.raw=v}};saveDraft3D(storage,nine,null);assert.deepEqual(loadDraft3D(storage).assembly,nine)
  assert.equal(validateAssembly3D(nine).valid,false);assert.equal(await readFile(file,'utf8'),raw)
 }finally{await rm(dir,{recursive:true,force:true})}
})

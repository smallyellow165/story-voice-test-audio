import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {combinedFreeFixture} from './magnetic-combined-free-fixture.mjs'
import {connectedRamp} from './magnetic-snap-session-fixture.mjs'
import {previewSnapSession} from '../src/magnetic-tiles/three-d/snap-session.ts'
import {createMoveObjectSearch,confirmMoveObjectSnap} from '../src/magnetic-tiles/three-d/move-object-snap.ts'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {transformModule} from '../src/magnetic-tiles/three-d/module-transform.ts'
import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {createViewerModel} from '../src/magnetic-tiles/three-d/viewer-model.ts'
import {computeAllConnectionResiduals} from '../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'

test('Truck-Ramp temporary copy: discover y07 -> connected free board, ambiguity, strict collisions, rigid atomic commit, CAS and restart',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'move-object-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await combinedFreeFixture(dir),{history:h,request:r}=await connectedRamp(f),base=h.current
 const exact=previewSnapSession(base,r).assembly;exact.connections=structuredClone(base.connections)
 const raw=transformModule(exact,r.moving.groupId,{position:[.08,0,0],quaternion:[0,0,0,1]}),moving={kind:'group',groupId:r.moving.groupId},search=createMoveObjectSearch(base,moving),found=search(raw,'less-strict')
 const candidate=found.candidates.find(c=>c.request.moving.tileId===r.moving.tileId&&c.request.moving.portId===r.moving.portId&&c.request.fixed.tileId===r.fixed.tileId&&c.request.fixed.portId===r.fixed.portId)
 assert.ok(candidate);assert.equal(candidate.error,undefined);assert.ok(Math.abs(candidate.request.dihedralDeg+30)<1e-7);assert.equal(candidate.request.flip,true);assert.equal(candidate.preview.geometry.valid,false)
 const blocked=search(raw,'strict').candidates.find(c=>c.request.moving.tileId===r.moving.tileId&&c.request.moving.portId===r.moving.portId&&c.request.fixed.tileId===r.fixed.tileId&&c.request.fixed.portId===r.fixed.portId);assert.match(blocked.error,/Strict/)
 const state={sourceRaw:serializeAssembly3D(base),moving,raw,dragged:raw,search:found,selectedKey:candidate.key,released:true},next=confirmMoveObjectSnap(h,state),ids=new Set(base.modules[1].pieces.map(p=>p.id))
 assert.equal(next.current.pieces.length,49);assert.equal(next.current.connections.length,98);assert.deepEqual(next.current.pieces.filter(p=>!ids.has(p.id)),base.pieces.filter(p=>!ids.has(p.id)));assert.deepEqual(next.current.connections.slice(0,97),base.connections);assert.deepEqual(next.current.modules.map(({frame,...m})=>m),base.modules.map(({frame,...m})=>m))
 const models=createViewerModel(next.current),rs=computeAllConnectionResiduals(next.current.connections,Object.fromEntries(models.map(m=>[m.id,m.transform])),id=>models.find(m=>m.id===id)?.shape);assert.ok(rs.every(r=>r.positionError<1e-8&&r.directionDot>1-1e-8&&r.dihedralError<1e-6));assert.deepEqual(actions.undo(next).current,base);assert.deepEqual(actions.redo(actions.undo(next)).current,next.current)
 const snapshot={...f.combined.snapshot,assembly:next.current},saved=await f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.combined.hash}),restored=await createMagneticIntake(dir).dispatch('GET','assembly3d/records/'+base.id);assert.deepEqual(restored.snapshot,snapshot);assert.deepEqual(restored.parent,f.combined.parent);await assert.rejects(f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.combined.hash}),e=>e.statusCode===409)
 for(const [file,bytes]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),bytes)
 console.log(JSON.stringify({version:saved.version,candidates:found.total,automatic:!!found.automaticKey,dihedral:candidate.request.dihedralDeg,collisions:candidate.preview.geometry.issues.filter(i=>i.code==='intersection').length,productionWrites:0}))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {combinedFreeFixture} from './magnetic-combined-free-fixture.mjs'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {previewEdgeSnap,confirmEdgeSnap} from '../src/magnetic-tiles/three-d/editor-snap.ts'
import {previewConnectionRotation,confirmConnectionRotation} from '../src/magnetic-tiles/three-d/connection-rotate.ts'
import {createViewerModel} from '../src/magnetic-tiles/three-d/viewer-model.ts'
import {computeAllConnectionResiduals} from '../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'

test('Truck-Ramp copy: connected large square rotates down 20 / 30 / 45 deg; fixed Parents / ports / other joints, validation, Undo and CAS restore',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'connection-rotate-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await combinedFreeFixture(dir),base=f.combined.snapshot.assembly
 const inserted=actions.addPieceAction(actions.createInitialHistory(base),canonicalProfileSnapshot(f.large),'#fc0303',[5,5,5]),id=inserted.pieceId,c={pieceA:f.roofId,portA:'e0-p0',pieceB:id,portB:'e2-p1',dihedralDeg:0,flip:true}
 const h=confirmEdgeSnap(inserted.history,previewEdgeSnap(inserted.history.current,c,'less-strict'),'less-strict'),index=h.current.connections.length-1,before=structuredClone(h.current)
 for(const angle of [20,30,45]){
  const strict=previewConnectionRotation(h.current,id,index,angle);assert.equal(strict.canConfirm,false);assert.throws(()=>confirmConnectionRotation(h,strict),/旋转被验证拒绝/)
  const p=previewConnectionRotation(h.current,id,index,angle,'less-strict');assert.equal(p.canConfirm,true);assert.equal(p.geometry.valid,false);assert.ok(p.geometry.issues.every(i=>i.code==='intersection'))
  const a=p.assembly;assert.deepEqual(a.pieces.slice(0,48),base.pieces);assert.deepEqual(a.modules,base.modules);assert.deepEqual(a.connections.slice(0,96),base.connections);assert.ok(Math.abs(a.connections[index].dihedralDeg-angle)<1e-10)
  const models=createViewerModel(a),rs=computeAllConnectionResiduals(a.connections,Object.fromEntries(models.map(m=>[m.id,m.transform])),id=>models.find(m=>m.id===id)?.shape);assert.ok(rs.every(r=>r.positionError<1e-8&&r.directionDot>1-1e-8&&r.dihedralError<1e-8))
  const pos=a.pieces.at(-1).pose.position;assert.ok(Math.abs(pos[1]-(3.03-Math.sin(angle*Math.PI/180)))<1e-10);assert.ok(Math.abs(pos[2]-(.5+Math.cos(angle*Math.PI/180)))<1e-10)
 }
 assert.deepEqual(h.current,before);assert.throws(()=>previewConnectionRotation(h.current,f.roofId,index,30,'less-strict'),/Parent/)
 const conflict=previewConnectionRotation(h.current,id,index,90,'less-strict');assert.equal(conflict.canConfirm,false);assert.ok(conflict.geometry.issues.some(i=>i.code==='port-reuse'));assert.throws(()=>confirmConnectionRotation(h,conflict,'less-strict'),/空间方向占位/)
 const p=previewConnectionRotation(h.current,id,index,30,'less-strict'),next=confirmConnectionRotation(h,p,'less-strict');assert.deepEqual(actions.undo(next).current,before);assert.deepEqual(actions.redo(actions.undo(next)).current,next.current)
 const snapshot={...structuredClone(f.combined.snapshot),assembly:next.current},saved=await f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.combined.hash});assert.equal(saved.version,3)
 const restored=await createMagneticIntake(dir).dispatch('GET','assembly3d/records/'+base.id);assert.deepEqual(restored.snapshot,snapshot);assert.deepEqual(restored.parent,f.combined.parent);assert.deepEqual(validateAssembly3D(restored.snapshot.assembly),p.geometry)
 await assert.rejects(f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.combined.hash}),e=>e.statusCode===409)
 for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {combinedFreeFixture} from './magnetic-combined-free-fixture.mjs'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {previewEdgeSnap,confirmEdgeSnap} from '../src/magnetic-tiles/three-d/editor-snap.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {createViewerModel} from '../src/magnetic-tiles/three-d/viewer-model.ts'
import {computeAllConnectionResiduals} from '../src/magnetic-tiles/three-d/vendor/engine/solver.ts'

test('Truck-Ramp copy: Strict rejects; Less Strict retains collisions, exact Port math, Parents, Undo / Redo and CAS save / restart',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'less-strict-snap-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await combinedFreeFixture(dir),base=f.combined.snapshot.assembly
 assert.equal(base.pieces.length,48);assert.equal(base.connections.length,96);assert.equal(validateAssembly3D(base).valid,true)
 const added=actions.addPieceAction(actions.createInitialHistory(base),canonicalProfileSnapshot(f.large),'#fc0303',[5,5,5]),h=added.history,c={pieceA:f.roofId,portA:'e0-p0',pieceB:added.pieceId,portB:'e2-p1',dihedralDeg:0,flip:true},before=structuredClone(h.current)
 assert.throws(()=>previewEdgeSnap(h.current,c),/严格验证拒绝.*穿透/)
 const preview=previewEdgeSnap(h.current,c,'less-strict');assert.deepEqual(h.current,before);assert.equal(preview.geometry.valid,false)
 assert.ok(preview.geometry.issues.every(i=>i.code==='intersection'));for(const id of ['m0-p0-r01','m0-p1-r02'])assert.ok(preview.geometry.issues.some(i=>i.relatedPieceIds?.includes(id)))
 const models=createViewerModel(preview.assembly),residuals=computeAllConnectionResiduals(preview.assembly.connections,Object.fromEntries(models.map(m=>[m.id,m.transform])),id=>models.find(m=>m.id===id)?.shape)
 assert.ok(residuals.every(r=>r.positionError<1e-8&&r.directionDot>1-1e-8&&r.dihedralError<1e-8))
 const next=confirmEdgeSnap(h,preview,'less-strict'),a=next.current;assert.equal(a.pieces.length,49);assert.equal(a.connections.length,97);assert.deepEqual(a.connections.at(-1),c)
 assert.deepEqual(a.pieces.slice(0,48),base.pieces);assert.deepEqual(a.connections.slice(0,96),base.connections);assert.deepEqual(a.modules,base.modules);assert.deepEqual(validateAssembly3D(a),preview.geometry)
 assert.deepEqual(actions.undo(next).current,before);assert.deepEqual(actions.redo(actions.undo(next)).current,a)
 assert.throws(()=>previewEdgeSnap(h.current,{...c,dihedralDeg:90},'less-strict'),/相同空间方向占位/)
 assert.throws(()=>previewEdgeSnap(a,c,'less-strict'),/重复连接/)
 assert.throws(()=>previewEdgeSnap(h.current,{...c,pieceA:added.pieceId,pieceB:f.roofId,portA:'e2-p1',portB:'e0-p0'},'less-strict'),/固定 Parent/)
 const snapshot={...structuredClone(f.combined.snapshot),assembly:a},saved=await f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.combined.hash});assert.equal(saved.version,3)
 const restarted=createMagneticIntake(dir),restored=await restarted.dispatch('GET','assembly3d/records/'+base.id);assert.deepEqual(restored.snapshot,snapshot);assert.deepEqual(restored.parent,f.combined.parent);assert.deepEqual(validateAssembly3D(restored.snapshot.assembly),preview.geometry)
 assert.deepEqual((await restarted.dispatch('GET',`assembly3d/records/${base.id}/versions/2`)).snapshot,f.combined.snapshot)
 await assert.rejects(restarted.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.combined.hash}),e=>e.statusCode===409)
 for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw)
})

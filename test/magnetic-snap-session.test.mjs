import {connectedRamp} from './magnetic-snap-session-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {combinedFreeFixture} from './magnetic-combined-free-fixture.mjs'
import {canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {previewSnapSession,confirmSnapSession,snapObject} from '../src/magnetic-tiles/three-d/snap-session.ts'
import {createViewerModel} from '../src/magnetic-tiles/three-d/viewer-model.ts'
import {computeAllConnectionResiduals} from '../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {moduleStep} from '../src/magnetic-tiles/three-d/module-transform.ts'

function residuals(a){const models=createViewerModel(a);return computeAllConnectionResiduals(a.connections,Object.fromEntries(models.map(m=>[m.id,m.transform])),id=>models.find(m=>m.id===id)?.shape)}
function exactConstraints(a){for(const r of residuals(a)){assert.ok(r.positionError<1e-8);assert.ok(r.directionDot>1-1e-8);assert.ok(r.dihedralError<1e-8)}}

test('registered Truck-Ramp copy: Group -> connected Free Tile is rigid, fixed side immutable, strict constraints, history, CAS, restart',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'snap-session-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await combinedFreeFixture(dir),{history:h,id,request:r}=await connectedRamp(f),a=h.current,before=structuredClone(a)
 assert.throws(()=>previewSnapSession(a,{...r,mode:'strict'}),/验证拒绝.*穿透/)
 const p=previewSnapSession(a,r);assert.equal(p.geometry.valid,false);assert.equal(p.geometry.issues.length,8);assert.ok(p.geometry.issues.every(i=>i.code==='intersection'));assert.equal(p.assembly.pieces.length,49);assert.equal(p.assembly.connections.length,98);exactConstraints(p.assembly)
 const moving=new Set(a.modules[1].pieces.map(p=>p.id))
 assert.deepEqual(p.assembly.pieces.filter(p=>!moving.has(p.id)),a.pieces.filter(p=>!moving.has(p.id)),'red, green, already connected board exactly fixed')
 assert.deepEqual(p.assembly.modules.filter(m=>m.id!==r.moving.groupId),a.modules.filter(m=>m.id!==r.moving.groupId));assert.deepEqual(p.assembly.modules.map(({frame,...rest})=>rest),a.modules.map(({frame,...rest})=>rest));assert.deepEqual(p.assembly.connections.slice(0,97),a.connections)
 const next=confirmSnapSession(h,p,r);assert.equal(next.current.revision,a.revision+1);assert.deepEqual(actions.undo(next).current,a);assert.deepEqual(actions.redo(actions.undo(next)).current,next.current);assert.deepEqual(a,before)
 for(const bad of [{...r,dihedralDeg:-29},{...r,flip:false},{...r,mode:'strict'},{...r,fixed:{...r.fixed,portId:'e0-p1'}},{...r,moving:{...r.moving,kind:'tile'}}])assert.throws(()=>confirmSnapSession(h,p,bad),/输入或作品已变化/)
 assert.throws(()=>confirmSnapSession({...h,current:{...a,revision:a.revision+1}},p,r),/输入或作品已变化/)
 assert.throws(()=>previewSnapSession(a,{...r,fixed:snapObject(a,'group',r.moving.tileId,'e0-p0')}),/Fixed 不能属于/)
 assert.throws(()=>previewSnapSession(a,{...r,moving:{...r.moving,kind:'tile'}}),/Parent/)
 assert.throws(()=>previewSnapSession(a,{...r,moving:{...r.moving,groupId:'module-0'}}),/不属于/)
 assert.throws(()=>previewSnapSession(a,{...r,fixed:{...r.fixed,kind:'group',groupId:'module-0'}}),/不属于/)
 assert.throws(()=>previewSnapSession(a,{...r,dihedralDeg:90}),/空间方向占位/)
 assert.throws(()=>previewSnapSession(a,{...r,moving:{...r.moving,portId:'missing'}}),/端口|port/i)
 assert.throws(()=>previewSnapSession(next.current,r),/重复|存在/)
 const broken=structuredClone(a);broken.connections[0].dihedralDeg+=15;assert.throws(()=>previewSnapSession(broken,r),/验证拒绝/,'Less Strict cannot ignore any noncollision constraint')
 // Existing external joint cannot silently be broken by another Group snap.
 assert.throws(()=>previewSnapSession(next.current,{...r,fixed:snapObject(next.current,'group',f.roofId,'e3-p0')}),/验证拒绝/)
 const snapshot={...structuredClone(f.combined.snapshot),assembly:next.current},saved=await f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.combined.hash})
 const restored=await createMagneticIntake(dir).dispatch('GET','assembly3d/records/'+a.id);assert.equal(saved.version,3);assert.deepEqual(restored.snapshot,snapshot);assert.deepEqual(validateAssembly3D(restored.snapshot.assembly),p.geometry);assert.deepEqual(restored.parent,f.combined.parent)
 await assert.rejects(f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.combined.hash}),e=>e.statusCode===409)
 for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw)
})

test('both executor paths: Tile -> Tile / Group member, Group -> Group member, exact Port constraints; no moving Fixed',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'snap-combos-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await combinedFreeFixture(dir),base=f.combined.snapshot.assembly
 const add=actions.addPieceAction(actions.createInitialHistory(base),canonicalProfileSnapshot(f.large),'#fc0303',[5,5,5]),id=add.pieceId
 for(const fixedKind of ['tile','group']){
  const r={moving:snapObject(add.history.current,'tile',id,'e2-p1'),fixed:snapObject(add.history.current,fixedKind,f.roofId,'e0-p0'),dihedralDeg:90,flip:false,mode:'strict'}
  const p=previewSnapSession(add.history.current,r);assert.equal(p.geometry.valid,true);assert.deepEqual(p.assembly.pieces.slice(0,48),base.pieces);exactConstraints(p.assembly);assert.equal(confirmSnapSession(add.history,p,r).current.connections.length,97)
 }
 // A different standalone Tile is also a Fixed anchor; it need not have a Group.
 const second=actions.addPieceAction(add.history,canonicalProfileSnapshot(f.large),'#ff0000',[8,8,8]),a=second.history.current,r={moving:snapObject(a,'tile',id,'e2-p0'),fixed:snapObject(a,'tile',second.pieceId,'e0-p0'),dihedralDeg:0,flip:true,mode:'strict'},p=previewSnapSession(a,r)
 assert.equal(p.geometry.valid,true);exactConstraints(p.assembly);assert.deepEqual(p.assembly.pieces.find(x=>x.id===second.pieceId),a.pieces.find(x=>x.id===second.pieceId))
 const yellow=base.modules[1],roof=yellow.pieces.find(p=>p.sourceId==='y07').id,groupR={moving:snapObject(base,'group',roof,'e2-p0'),fixed:snapObject(base,'group',f.roofId,'e0-p0'),dihedralDeg:0,flip:true,mode:'less-strict'}
 const groupP=previewSnapSession(base,groupR);exactConstraints(groupP.assembly);assert.deepEqual(groupP.assembly.pieces.filter(x=>!yellow.pieces.some(m=>m.id===x.id)),base.pieces.filter(x=>!yellow.pieces.some(m=>m.id===x.id)))
 // A Group's external connections must be checked even if the joint being added aligns perfectly.
 const bad=moduleStep(groupP.assembly,'module-0','translate','y',1,'global');assert.throws(()=>previewSnapSession(bad,{...groupR,fixed:snapObject(bad,'group',f.roofId,'e3-p0')}),/验证拒绝/)
})

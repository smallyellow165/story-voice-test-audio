import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {combinedFreeFixture} from './magnetic-combined-free-fixture.mjs'
import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {previewEdgeSnap,confirmEdgeSnap} from '../src/magnetic-tiles/three-d/editor-snap.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {parentModule} from '../src/magnetic-tiles/three-d/combined-editing.ts'
import {moduleStep,assertModuleOrigin,combineAssemblySnapshots} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {faceOrientationQuaternion} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {Quaternion} from 'three'

async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'combined-free-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await combinedFreeFixture(dir);return {dir,...f}}
const fixed=a=>({modules:a.modules,pieces:a.pieces.filter(p=>parentModule(a,p.id)),connections:a.connections.filter(c=>parentModule(a,c.pieceA)&&parentModule(a,c.pieceB))})
test('real registered Combined: Insert / Move / Rotate / Orient / exact Snap / Undo / Redo / CAS save and restore',async t=>{
 const f=await setup(t),base=f.combined.snapshot.assembly,original=structuredClone(base);assert.equal(base.pieces.length,48);assert.equal(base.connections.length,96);assert.equal(validateAssembly3D(base).valid,true)
 const inserted=actions.addPieceAction(actions.createInitialHistory(base),canonicalProfileSnapshot(f.large),'#8899aa',[8,6,8]),id=inserted.pieceId
 let h=inserted.history;assert.equal(parentModule(h.current,id),undefined);assert.equal(h.current.pieces.length,49)
 h=actions.setPieceTransformAction(h,id,{position:[10,7,8],quaternion:new Quaternion().setFromAxisAngle({x:0,y:1,z:0},Math.PI/4).toArray()})
 const q=new Quaternion(...h.current.pieces.at(-1).pose.quaternion),oriented=faceOrientationQuaternion(q,'up').multiply(q)
 h=actions.setPieceTransformAction(h,id,{position:[10,7,8],quaternion:oriented.toArray()})
 const before=structuredClone(h.current),connection={pieceA:f.roofId,portA:'e0-p0',pieceB:id,portB:'e0-p1',dihedralDeg:90,flip:false},preview=previewEdgeSnap(h.current,connection)
 assert.deepEqual(h.current,before);assert.equal(preview.geometry.valid,true);h=confirmEdgeSnap(h,preview)
 assert.equal(h.current.pieces.length,49);assert.equal(h.current.connections.length,97);assert.deepEqual(fixed(h.current),fixed(base));assert.equal(validateAssembly3D(h.current).valid,true)
 const snapped=structuredClone(h.current);h=actions.undo(h);assert.deepEqual(h.current,before);h=actions.redo(h);assert.deepEqual(h.current,snapped)
 assert.throws(()=>previewEdgeSnap(h.current,connection),/重复连接/)
 assert.throws(()=>actions.solveComponentAction(h,id),/固定 Parent/)
 const old={id:f.combined.assembly.id,version:f.combined.version,hash:f.combined.hash},snapshot={...structuredClone(f.combined.snapshot),assembly:h.current}
 const saved=await f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:old.hash});assert.equal(saved.version,3)
 const restarted=createMagneticIntake(f.dir),restored=await restarted.dispatch('GET','assembly3d/records/'+old.id);assert.deepEqual(restored.snapshot,snapshot);assert.deepEqual(restored.parent,f.combined.parent);assert.deepEqual(restored.snapshot.photoOrigin.origin.sceneRegistration,f.combined.snapshot.photoOrigin.origin.sceneRegistration)
 assert.deepEqual((await restarted.dispatch('GET',`assembly3d/records/${old.id}/versions/2`)).snapshot,f.combined.snapshot)
 await assert.rejects(restarted.dispatch('POST','assembly3d/save',{snapshot:f.combined.snapshot,expectedHash:old.hash}),e=>e.statusCode===409)
 h=actions.deletePieceAction(h,id);assert.equal(h.current.connections.length,96);assert.equal(h.current.pieces.length,48);assert.deepEqual(fixed(h.current),fixed(base));assert.deepEqual(actions.undo(h).current,snapped)
 const dup=actions.duplicatePieceAction(actions.createInitialHistory(snapped),id);assert.notEqual(dup.newId,id);assert.equal(parentModule(dup.history.current,dup.newId),undefined);assert.equal(dup.history.current.connections.length,97)
 assert.deepEqual(base,original);for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw)
})
test('Parent structure stays rigid at history and save boundaries; illegal/occupied Snap and second endpoint leave all groups fixed',async t=>{
 const f=await setup(t),base=f.combined.snapshot.assembly,init=actions.createInitialHistory(base),p=base.pieces[0]
 assert.throws(()=>actions.deletePieceAction(init,p.id),/membership|模块成员/)
 assert.throws(()=>actions.setPieceTransformAction(init,p.id,{...p.pose,position:[20,20,20]}),/Parent Tile/)
 assert.throws(()=>actions.removeConnectionAction(init,0),/内部 Connection/)
 assert.throws(()=>actions.commit(init,a=>{a.profiles[0].thickness*=2;return a}),/Profile.*Port/)
 const inserted=actions.addPieceAction(init,canonicalProfileSnapshot(f.large),'#8899aa',[10,8,10]),id=inserted.pieceId,h=inserted.history
 const bad={pieceA:f.roofId,portA:'e0-p0',pieceB:id,portB:'e0-p0',dihedralDeg:0,flip:false}
 assert.throws(()=>previewEdgeSnap(h.current,bad),/冲突|穿透/);assert.throws(()=>previewEdgeSnap(h.current,{...bad,portB:'missing'}),/Port/)
 assert.throws(()=>previewEdgeSnap(h.current,{...bad,pieceB:f.roofId,pieceA:id}),/固定 Parent/)
 const good={...bad,portB:'e0-p1',dihedralDeg:90},snapped=confirmEdgeSnap(h,previewEdgeSnap(h.current,good)),yellow=base.modules.find(m=>m.name==='yellow-pole'),target=yellow.pieces.find(p=>p.sourceId==='y07').id
 assert.throws(()=>previewEdgeSnap(snapped.current,{...good,pieceA:target,portB:'e2-p0'}),/仍有连接.*需平移/)
 // Explicit non-moving constraint can express and diagnose a mismatched second
 // endpoint; it does not claim validity and never stretches or solves Groups.
 const second={...good,pieceA:target,portB:'e2-p0'},diagnostic=actions.createConnectionAction(snapped,second,false)
 assert.equal(validateAssembly3D(diagnostic.current).valid,false);assert.deepEqual(fixed(diagnostic.current),fixed(base));assert.equal(diagnostic.current.connections.length,98)
 assert.throws(()=>actions.solveComponentAction(diagnostic,id),/固定 Parent/)
 assert.deepEqual(actions.undo(diagnostic).current,snapped.current)
 const corrupt=structuredClone(f.combined.snapshot);corrupt.assembly.pieces[0].pose.position[0]+=1
 await assert.rejects(f.api.dispatch('POST','assembly3d/save',{snapshot:corrupt,expectedHash:f.combined.hash}),/Parent Tile/)
 const moved=moduleStep(snapped.current,'module-0','translate','x',.1,'global');assert.doesNotThrow(()=>assertModuleOrigin(moved,f.combined.snapshot.photoOrigin.origin));assert.deepEqual(moved.pieces.filter(p=>!parentModule(moved,p.id)),snapped.current.pieces.filter(p=>!parentModule(snapped.current,p.id)))
})
test('two exact single-end Snaps can connect a free Tile to different Groups without moving either Parent; deletion removes both links',async()=>{
 const source=JSON.parse(await readFile(new URL('../src/magnetic-tiles/three-d/examples/right-angle.json',import.meta.url))),one={...source,pieces:[{...source.pieces[0],id:'one',pose:{position:[0,0,0],quaternion:[0,0,0,1]}}],connections:[]},two=structuredClone(one);two.pieces[0].pose.position=[2,0,0]
 const ref=id=>({id,version:1,hash:'a'.repeat(64),snapshotHash:'b'.repeat(64),revision:0}),base=combineAssemblySnapshots('free-cross-group',[{name:'A',parent:ref('a'),assembly:one},{name:'B',parent:ref('b'),assembly:two}]),added=actions.addPieceAction(actions.createInitialHistory(base),source.profiles[0],'#8899aa',[5,5,5]),id=added.pieceId
 const first={pieceA:base.modules[0].pieces[0].id,portA:'e1-p0',pieceB:id,portB:'e3-p0',dihedralDeg:0,flip:true},h=confirmEdgeSnap(added.history,previewEdgeSnap(added.history.current,first)),before=structuredClone(h.current)
 const second={pieceA:base.modules[1].pieces[0].id,portA:'e3-p0',pieceB:id,portB:'e1-p0',dihedralDeg:0,flip:true},linked=confirmEdgeSnap(h,previewEdgeSnap(h.current,second))
 assert.equal(linked.current.connections.length,2);assert.equal(validateAssembly3D(linked.current).valid,true);assert.deepEqual(fixed(linked.current),fixed(base));assert.deepEqual(linked.current.pieces,before.pieces)
 const conflict=actions.addPieceAction(linked,source.profiles[0],'#123456',[8,8,8]);assert.throws(()=>previewEdgeSnap(conflict.history.current,{...first,pieceB:conflict.pieceId}),/冲突|穿透/)
 const removed=actions.deletePieceAction(linked,id);assert.equal(removed.current.connections.length,0);assert.deepEqual(fixed(removed.current),fixed(base));assert.deepEqual(actions.undo(removed).current,linked.current)
})

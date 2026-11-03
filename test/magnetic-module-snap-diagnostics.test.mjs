import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {Quaternion,Vector3} from 'three'
import {snapCaseFixture} from './magnetic-snap-case-fixture.mjs'
import {moduleSnapDiagnostics,faceWorldNormal} from '../src/magnetic-tiles/three-d/module-snap-diagnostics.ts'
import {moduleBounds,moduleStep,previewModuleSnap,confirmModulePreview} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {createViewerModel} from '../src/magnetic-tiles/three-d/viewer-model.ts'
import {portWorldEndpoints} from '../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
import * as history from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
const close=(actual,expected,eps=1e-9)=>assert.ok(Math.abs(actual-expected)<eps,`${actual} != ${expected}`)
function relative(a){const ids=new Set(a.modules[1].pieces.map(p=>p.id)),ps=a.pieces.filter(p=>ids.has(p.id)),root=ps[0].pose,q=new Quaternion(...root.quaternion).invert();return ps.map(p=>({p:new Vector3(...p.pose.position).sub(new Vector3(...root.position)).applyQuaternion(q),q:q.clone().multiply(new Quaternion(...p.pose.quaternion))}))}
test('exact saved case: both Flip values align ports but 0° conflicts with top-up / coplanar bottoms; no omitted twist candidate',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'snap-diagnostics-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await snapCaseFixture(dir),a=f.record.snapshot.assembly,raw=serializeAssembly3D(a),rel=relative(a)
 assert.equal(a.revision,4);assert.equal(a.pieces.length,21);assert.equal(a.connections.length,22);close(faceWorldNormal(a,f.reference.pieceId).angleTo(new Vector3(0,1,0)),0);close(moduleBounds(a,'module-1').min.y-moduleBounds(a,'module-0').min.y,0)
 const models=createViewerModel(a),transforms=Object.fromEntries(models.map(p=>[p.id,p.transform])),shape=id=>models.find(p=>p.id===id)?.shape
 const pa=portWorldEndpoints(f.connection.pieceA,'e2-p0',transforms,shape),pb=portWorldEndpoints(f.connection.pieceB,'e0-p0',transforms,shape)
 assert.ok(pa.p0.distanceTo(new Vector3(.5,-.5,0))<1e-12);assert.ok(pa.p1.distanceTo(new Vector3(.5,-.5,-1))<1e-12);assert.ok(pb.p0.distanceTo(new Vector3(1.5,-.5,.9070190528383295))<1e-12);assert.ok(pb.p1.distanceTo(new Vector3(2.5,-.5,.9070190528383295))<1e-12)
 for(const flip of [false,true]){
  const p=previewModuleSnap(a,'module-1','module-0',{...f.connection,flip}),d=moduleSnapDiagnostics(a,p,'module-1','module-0',f.reference)
  close(d.orientation.angleDeg,30);close(d.orientation.normal[0],flip?.5:-.5);close(d.bottomGap,-1.3620061658979714);close(d.rotationDeg,93.84096571625811);assert.ok(d.residual.positionError<1e-12);close(d.residual.directionDot,1);close(d.residual.dihedralError,0)
  assert.equal(d.collisions.before,10);assert.equal(d.collisions.retained,10);assert.equal(d.collisions.newCross,flip?0:4);assert.equal(d.collisions.newInternal,0);assert.equal(d.connectionErrors.length,0);assert.equal(d.geometryValid,false);close(d.orientation.requiredDihedralDeg,flip?-30:30)
  assert.deepEqual(moduleSnapDiagnostics(a,p,'module-1','module-0',f.reference),d,'deterministic projection');assert.equal(serializeAssembly3D(a),raw)
  const fixed=new Set(a.modules[0].pieces.map(p=>p.id));assert.deepEqual(p.assembly.pieces.filter(p=>fixed.has(p.id)),a.pieces.filter(p=>fixed.has(p.id)));assert.deepEqual(p.assembly.connections.slice(0,22),a.connections)
  relative(p.assembly).forEach((r,i)=>{assert.ok(r.p.distanceTo(rel[i].p)<1e-10);assert.ok(r.q.angleTo(rel[i].q)<1e-7)})
  // Same fixed ports/angle/flip determine the same absolute group placement
  // even after arbitrary initial Orient/Move/Rotate. There is no pose ranking.
  const moved=moduleStep(moduleStep(a,'module-1','rotate','y',51,'global'),'module-1','translate','z',7,'global'),p2=previewModuleSnap(moved,'module-1','module-0',{...f.connection,flip})
  p.assembly.pieces.forEach((x,i)=>{const y=p2.assembly.pieces[i];assert.ok(new Vector3(...x.pose.position).distanceTo(new Vector3(...y.pose.position))<1e-10);assert.ok(new Quaternion(...x.pose.quaternion).angleTo(new Quaternion(...y.pose.quaternion))<1e-7)})
  // Analytically derived alternative input, NOT a 0° candidate or auto-change.
  const alternate=previewModuleSnap(a,'module-1','module-0',{...f.connection,flip,dihedralDeg:d.orientation.requiredDihedralDeg}),ad=moduleSnapDiagnostics(a,alternate,'module-1','module-0',f.reference)
  close(ad.orientation.angleDeg,0);close(ad.bottomGap,0);close(ad.rotationDeg,90);assert.equal(ad.collisions.newCross,flip?5:8);assert.equal(ad.geometryValid,false)
 }
 assert.throws(()=>previewModuleSnap(a,'module-1','module-0',{...f.connection,portB:'not-a-port'}),/Port|端口/)
 assert.equal(moduleSnapDiagnostics(a,previewModuleSnap(a,'module-1','module-0',f.connection),'module-1','module-0').orientation,undefined,'no guessed persisted Orient goal')
 for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw)
})
test('diagnostics never grant review or change preview/confirm, Undo/Redo, CAS, lineage, source snapshots or strict Build',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'snap-diagnostics-save-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await snapCaseFixture(dir),a=f.record.snapshot.assembly,head=await f.api.dispatch('GET','visible3d/head/'+f.source.id)
 const p=previewModuleSnap(a,'module-1','module-0',{...f.connection,dihedralDeg:-30}),d=moduleSnapDiagnostics(a,p,'module-1','module-0',f.reference)
 assert.equal(d.collisions.newCross,5);assert.equal(d.geometryValid,false)
 const h=history.createInitialHistory(a);assert.deepEqual(h.current,a);const applied=history.commit(h,()=>confirmModulePreview(h.current,p));assert.deepEqual(history.undo(applied).current,a);assert.deepEqual(history.redo(history.undo(applied)).current,applied.current)
 const next=applied.current;assert.equal(next.revision,a.revision+1);assert.equal(next.connections.length,23)
 const snapshot={...f.record.snapshot,assembly:next},saved=await f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.record.hash}),restored=await f.api.dispatch('GET','assembly3d/records/'+a.id)
 assert.deepEqual(restored.snapshot.assembly,next);assert.deepEqual(saved.parent,f.record.parent);assert.deepEqual(saved.snapshot.photoOrigin.origin,f.record.snapshot.photoOrigin.origin)
 await assert.rejects(f.api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:f.record.hash}),e=>e.statusCode===409)
 assert.equal((await f.api.dispatch('POST','assembly3d/build-check',{originId:a.id,assembly:next})).geometry.valid,false)
 for(const original of [f.front,f.rear])assert.deepEqual((await f.api.dispatch('GET','assembly3d/records/'+original.assembly.id)).snapshot,original.snapshot)
 assert.deepEqual(await f.api.dispatch('GET','visible3d/head/'+f.source.id),head);for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {Quaternion,Vector3} from 'three'
import {multiAssemblyFixture} from './magnetic-multi-assembly-fixture.mjs'
import {combineAssemblySnapshots,moduleStep,moduleCenter,alignModuleFace,modulePivot,pivotDelta,transformModule,previewModuleTransform,previewModuleSnap,confirmModulePreview} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {generateBuildOrder3D} from '../src/magnetic-tiles/three-d/build-order.ts'
import {validateTutorial3D,stepAssembly} from '../src/magnetic-tiles/three-d/tutorial.ts'
import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
const example=JSON.parse(await readFile(new URL('../src/magnetic-tiles/three-d/examples/right-angle.json',import.meta.url),'utf8'))
const parent=(id)=>({id,version:1,hash:'a'.repeat(64),snapshotHash:'b'.repeat(64),revision:0})
function combined(){return combineAssemblySnapshots('combined-test',[{name:'A',parent:parent('a'),assembly:example},{name:'B',parent:parent('b'),assembly:example}])}
function members(a,id){const ids=new Set(a.modules.find(m=>m.id===id).pieces.map(p=>p.id));return a.pieces.filter(p=>ids.has(p.id))}
function relative(a,id){const ps=members(a,id),root=ps[0].pose,q=new Quaternion(...root.quaternion).invert();return ps.map(p=>({id:p.id,p:new Vector3(...p.pose.position).sub(new Vector3(...root.position)).applyQuaternion(q).toArray(),q:q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()}))}
function equivalent(a,b){assert.equal(a.length,b.length);for(let i=0;i<a.length;i++){assert.ok(new Vector3(...a[i].p).distanceTo(new Vector3(...b[i].p))<1e-10);assert.ok(1-Math.abs(new Quaternion(...a[i].q).dot(new Quaternion(...b[i].q)))<1e-10)}}
test('module SE(3) preserves all internal relations and fixed poses, including Global / Local / Face axes',()=>{
 const a=combined(),raw=serializeAssembly3D(a),before=relative(a,'module-1'),rot=moduleStep(a,'module-1','rotate','y',45,'global'),local=moduleStep(rot,'module-1','translate','x',2,'local'),global=moduleStep(rot,'module-1','translate','x',2,'global')
 assert.notDeepEqual(local.pieces.map(p=>p.pose),global.pieces.map(p=>p.pose));equivalent(before,relative(local,'module-1'));assert.deepEqual(members(local,'module-0'),members(a,'module-0'));assert.deepEqual(local.connections,a.connections);assert.equal(serializeAssembly3D(a),raw)
 const face=a.modules[1].pieces[0].id,oriented=alignModuleFace(rot,'module-1',face,'up'),normal=new Vector3(0,0,1).applyQuaternion(new Quaternion(...oriented.pieces.find(p=>p.id===face).pose.quaternion));assert.ok(normal.distanceTo(new Vector3(0,1,0))<1e-12);equivalent(before,relative(oriented,'module-1'))
 const faceShift=moduleStep(oriented,'module-1','translate','z',.4,'face',face);assert.ok(new Vector3(...faceShift.pieces.find(p=>p.id===face).pose.position).sub(new Vector3(...oriented.pieces.find(p=>p.id===face).pose.position)).distanceTo(new Vector3(0,.4,0))<1e-12)
 const front=alignModuleFace(oriented,'module-1',face,'front');assert.ok(new Vector3(0,0,1).applyQuaternion(new Quaternion(...front.pieces.find(p=>p.id===face).pose.quaternion)).distanceTo(new Vector3(0,0,1))<1e-12)
 const pivot=modulePivot(oriented,'module-1','face',face),target={position:[...pivot.position],quaternion:[...pivot.quaternion]};target.position[1]+=1.25;const gizmo=transformModule(oriented,'module-1',pivotDelta(pivot,target));equivalent(before,relative(gizmo,'module-1'));assert.ok(moduleCenter(gizmo,'module-1').sub(moduleCenter(oriented,'module-1')).distanceTo(new Vector3(0,1.25,0))<1e-12)
 assert.throws(()=>moduleStep(a,'module-1','rotate','z',NaN,'global'));assert.throws(()=>modulePivot(a,'module-1','face','unknown'))
})
test('module Snap reuses exact Port alignment, not a single-tile move; preview / confirm / Undo stay atomic',()=>{
 const a=moduleStep(combined(),'module-1','translate','x',5,'global'),b=a.modules[1].pieces[0].id,f=a.modules[0].pieces[0].id
 const p=previewModuleSnap(a,'module-1','module-0',{pieceA:f,portA:'e1-p0',pieceB:b,portB:'e3-p0',dihedralDeg:0,flip:true});assert.deepEqual(members(p.assembly,'module-0'),members(a,'module-0'));equivalent(relative(a,'module-1'),relative(p.assembly,'module-1'));assert.deepEqual(p.assembly.connections.slice(0,a.connections.length),a.connections)
 assert.equal(p.geometry.issues.some(i=>i.severity==='error'&&i.code!=='intersection'),false);let h=actions.createInitialHistory(a);h=actions.commit(h,()=>confirmModulePreview(h.current,p));assert.equal(h.current.connections.length,a.connections.length+1);assert.deepEqual(actions.undo(h).current,a);assert.deepEqual(actions.redo(actions.undo(h)).current,h.current)
 const changed=moduleStep(a,'module-1','translate','x',1,'global');assert.throws(()=>confirmModulePreview(changed,p),/过期/);assert.throws(()=>previewModuleSnap(a,'module-1','module-1',p.connection),/不同/)
 assert.throws(()=>confirmModulePreview(h.current,previewModuleTransform(h.current,moduleStep(h.current,'module-1','translate','x',1,'global'))),/连接验证失败/)
})
test('real saved Front9 + Rear12: fixed parent lineage, rigid orientation, 23 exact joints, Invalid remains strict',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'module-transform-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await multiAssemblyFixture(dir),api=f.api,head=await api.dispatch('GET','visible3d/head/'+f.source.id),refs=[f.front,f.rear].map(r=>({id:r.assembly.id,version:r.version,hash:r.hash}))
 const r=await api.dispatch('POST','assembly3d/combine',{name:'Combined Test',parents:refs}),a=r.snapshot.assembly;assert.equal(r.type,'combined');assert.equal(a.pieces.length,21);assert.equal(a.connections.length,22);assert.equal(r.parent.kind,'assemblies');assert.equal(r.parent.assemblies.length,2);assert.equal(r.lineage.selected,true);assert.ok(!('executionId' in r.snapshot.photoOrigin.origin));assert.ok(!('planId' in r.snapshot.photoOrigin.origin))
 assert.deepEqual(members(a,'module-0').map(p=>p.pose),f.front.snapshot.assembly.pieces.map(p=>p.pose));assert.deepEqual(members(a,'module-1').map(p=>p.pose),f.rear.snapshot.assembly.pieces.map(p=>p.pose))
 const find=(i,id)=>a.modules[i].pieces.find(p=>p.sourceId===id).id,green=find(1,'ramp-lower-left'),blue=find(0,'front-floor-left'),top=find(1,'rear-top-left'),up=alignModuleFace(a,'module-1',top,'up'),normal=new Vector3(0,0,1).applyQuaternion(new Quaternion(...up.pieces.find(p=>p.id===top).pose.quaternion));assert.ok(normal.distanceTo(new Vector3(0,1,0))<1e-12);equivalent(relative(a,'module-1'),relative(up,'module-1'))
 const p=previewModuleSnap(up,'module-1','module-0',{pieceA:blue,portA:'e0-p0',pieceB:green,portB:'e0-p0',dihedralDeg:-30,flip:true});assert.equal(p.geometry.issues.filter(i=>i.severity==='error'&&i.code!=='intersection').length,0);assert.equal(p.geometry.valid,false);assert.ok(new Vector3(0,0,1).applyQuaternion(new Quaternion(...p.assembly.pieces.find(piece=>piece.id===top).pose.quaternion)).distanceTo(new Vector3(0,1,0))<1e-12);assert.equal(p.geometry.issues.filter(i=>i.code==='intersection').length,13);assert.equal(p.assembly.pieces.length,21);assert.equal(p.assembly.connections.length,23);assert.deepEqual(members(p.assembly,'module-0'),members(a,'module-0'));equivalent(relative(a,'module-1'),relative(p.assembly,'module-1'))
 const moved=actions.commit(actions.createInitialHistory(up),()=>confirmModulePreview(up,p)).current,snapshot={...r.snapshot,assembly:moved},saved=await api.dispatch('POST','assembly3d/save',{snapshot,expectedHash:r.hash});assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+a.id)).snapshot.assembly,moved);assert.deepEqual(saved.parent,r.parent)
 await assert.rejects(api.dispatch('POST','assembly3d/save',{snapshot:r.snapshot,expectedHash:r.hash}),e=>e.statusCode===409)
 const forged=structuredClone(saved.snapshot);forged.assembly.modules[0].parent.hash='0'.repeat(64);await assert.rejects(api.dispatch('POST','assembly3d/save',{snapshot:forged,expectedHash:saved.hash}),/不可重绑/)
 assert.equal((await api.dispatch('POST','assembly3d/build-check',{originId:a.id,assembly:moved})).geometry.valid,false)
 for(const original of [f.front,f.rear])assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+original.assembly.id)).snapshot,original.snapshot)
 assert.deepEqual(await api.dispatch('GET','visible3d/head/'+f.source.id),head);for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw)
})

test('Combined geometry builds through the existing planner and player step projections without copying full module membership to prefixes',()=>{
 const one=structuredClone(example);one.pieces=one.pieces.slice(0,1);one.connections=[];one.pieces[0].pose={position:[0,0,0],quaternion:[0,0,0,1]}
 const a=combineAssemblySnapshots('combined-build',[{name:'A',parent:parent('a'),assembly:one},{name:'B',parent:parent('b'),assembly:one}]),p=previewModuleSnap(a,'module-1','module-0',{pieceA:a.modules[0].pieces[0].id,pieceB:a.modules[1].pieces[0].id,portA:'e1-p0',portB:'e3-p0',dihedralDeg:0,flip:true});assert.equal(p.geometry.valid,true)
 const result=generateBuildOrder3D(p.assembly);assert.equal(result.status,'complete');assert.equal(result.tutorial.steps.length,2);assert.equal(validateTutorial3D(result.tutorial).finalValid,true);assert.equal(stepAssembly(result.tutorial,0).modules,undefined);assert.deepEqual(result.tutorial.assembly.modules,p.assembly.modules)
})

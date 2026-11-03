import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Quaternion,Vector3} from 'three'
import {multiAssemblyFixture} from './magnetic-multi-assembly-fixture.mjs'
import {moduleBounds,moduleStep,previewModuleBoundsAlign,confirmModulePreview} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'

test('isolated Front9 / Rear12 bounds alignment: world Y up, rigid poses, strict collisions, CAS, lineage and restored snapshots',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'spatial-inspection-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const f=await multiAssemblyFixture(dir),api=f.api,head=await api.dispatch('GET','visible3d/head/'+f.source.id)
 const record=await api.dispatch('POST','assembly3d/combine',{name:'Spatial inspection test',parents:[f.front,f.rear].map(r=>({id:r.assembly.id,version:r.version,hash:r.hash}))})
 let a=moduleStep(record.snapshot.assembly,'module-1','rotate','z',31,'global');a=moduleStep(a,'module-1','translate','y',3.27,'global')
 const raw=serializeAssembly3D(a),ids=new Set(a.modules[1].pieces.map(p=>p.id)),reference=moduleBounds(a,'module-0'),before=moduleBounds(a,'module-1'),preview=previewModuleBoundsAlign(a,'module-1','module-0','y','min')
 assert.equal(serializeAssembly3D(a),raw);assert.ok(Math.abs(preview.boundsAlignment.delta-(reference.min.y-before.min.y))<1e-12)
 const history=actions.commit(actions.createInitialHistory(a),()=>confirmModulePreview(a,preview)),next=history.current
 assert.equal(next.pieces.length,21);assert.equal(next.connections.length,22);assert.deepEqual(next.connections,a.connections)
 assert.ok(Math.abs(moduleBounds(next,'module-1').min.y-reference.min.y)<1e-10)
 const oldRoot=a.pieces.find(p=>ids.has(p.id)),newRoot=next.pieces.find(p=>ids.has(p.id)),inverse=new Quaternion(...oldRoot.pose.quaternion).invert()
 for(const p of next.pieces){const old=a.pieces.find(x=>x.id===p.id);assert.deepEqual(p.pose.quaternion,old.pose.quaternion)
  if(!ids.has(p.id)){assert.deepEqual(p,old);continue}
  assert.equal(p.pose.position[0],old.pose.position[0]);assert.equal(p.pose.position[2],old.pose.position[2])
  const relative=(piece,root)=>new Vector3(...piece.pose.position).sub(new Vector3(...root.pose.position)).applyQuaternion(inverse)
  assert.ok(relative(p,newRoot).distanceTo(relative(old,oldRoot))<1e-10)
 }
 assert.deepEqual(actions.undo(history).current,a);assert.deepEqual(actions.redo(actions.undo(history)).current,next)
 const zero=previewModuleBoundsAlign(next,'module-1','module-0','y','min');assert.equal(zero.boundsAlignment.delta,0);assert.deepEqual(zero.assembly,next);assert.equal(actions.commit(history,()=>confirmModulePreview(next,zero)),history)
 const saved=await api.dispatch('POST','assembly3d/save',{snapshot:{...record.snapshot,assembly:next},expectedHash:record.hash})
 assert.deepEqual(saved.parent,record.parent);assert.deepEqual(saved.snapshot.assembly.modules.map(({frame,...m})=>m),record.snapshot.assembly.modules.map(({frame,...m})=>m))
 assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+record.assembly.id)).snapshot.assembly,next)
 await assert.rejects(api.dispatch('POST','assembly3d/save',{snapshot:record.snapshot,expectedHash:record.hash}),e=>e.statusCode===409)
 assert.equal(preview.geometry.valid,false,'original strict collision diagnostics remain present')
 await assert.rejects(api.dispatch('POST','assembly3d/build-check',{originId:record.assembly.id,assembly:next}),/Invalid/)
 for(const original of [f.front,f.rear])assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+original.assembly.id)).snapshot,original.snapshot)
 assert.deepEqual(await api.dispatch('GET','visible3d/head/'+f.source.id),head)
 for(const [file,bytes]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),bytes)
})

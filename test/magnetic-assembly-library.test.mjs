import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {selectedProject} from './magnetic-selected-project-fixture.mjs'
import {selectFixture} from './magnetic-selected-fixture.mjs'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {restoreAssemblySnapshot,ASSEMBLY_SAVED_REF_KEY} from '../src/magnetic-tiles/three-d/assembly-library.ts'
import {DRAFT_3D_KEY,DRAFT_COLLISION_POLICY_KEY} from '../src/magnetic-tiles/three-d/draft-storage.ts'
import {PHOTO_ORIGIN_3D_KEY} from '../src/magnetic-tiles/three-d/reconstruction/adopt-draft.ts'
const request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:9999',origin:'http://127.0.0.1:9999','sec-fetch-site':'same-origin'}}
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'assembly-library-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir),f=await selectedProject(api);return {dir,api,f}}
async function origin(api,f,name){const p=f.plans[name][1],x=f.executions[name][1];await selectFixture(api,f.source.id,'plan',p);await selectFixture(api,f.source.id,'execution',x);return api.dispatch('POST','visible3d/adopt',{executionId:x.id,executionHash:x.hash,candidateId:'candidate-1'})}
function snapshot(o,count=2){const a=structuredClone(o.assembly);for(let i=a.pieces.length;i<count;i++)a.pieces.push({...structuredClone(a.pieces[0]),id:'manual-'+i,pose:{...a.pieces[0].pose,position:[i*3,0,0]}});return {assembly:a,photoOrigin:{origin:o,assemblyRaw:serializeAssembly3D(o.assembly)},nonRepairable:[]}}
const save=(api,s,expectedHash=null)=>api.dispatch('POST','assembly3d/save',{snapshot:s,expectedHash})
test('Project-wide Front/Rear snapshots are independent of selected Group/Plan; 8 -> 12 restores edited data, not Execution',async t=>{
 const {dir,api,f}=await setup(t),back=await origin(api,f,'Back'),front=await origin(api,f,'Front'),eight=snapshot(back,8),first=await save(api,eight),twelve=snapshot(back,12);twelve.assembly.revision=4
 const rear=await save(api,twelve,first.hash),fore=await save(api,snapshot(front,9));assert.equal(rear.snapshot.assembly.pieces.length,12);assert.equal(rear.snapshot.assembly.revision,4)
 const list=await api.dispatch('GET','assembly3d/projects/'+f.source.id);assert.deepEqual(list.assemblies.map(r=>r.name),['Back','Front']);assert.ok(list.assemblies.every(r=>r.type==='group'))
 const loaded=await api.dispatch('GET','assembly3d/records/'+back.assembly.id);assert.deepEqual(loaded.snapshot,twelve);assert.deepEqual(loaded.parent,{kind:'geometry-origin',id:back.id,hash:back.hash})
 assert.equal(loaded.snapshot.photoOrigin.assemblyRaw,serializeAssembly3D(back.assembly));assert.equal(back.assembly.pieces.length,2,'fixture Execution/origin stays immutable')
 const restart=createMagneticIntake(dir);assert.deepEqual((await restart.dispatch('GET','assembly3d/records/'+fore.assembly.id)).snapshot.assembly,snapshot(front,9).assembly)
 const head=await api.dispatch('GET','visible3d/head/'+f.source.id);await api.dispatch('GET','assembly3d/records/'+back.assembly.id);assert.deepEqual(await api.dispatch('GET','visible3d/head/'+f.source.id),head)
})
test('CAS detects stale/concurrent writes; repeated registration is idempotent and Parent cannot be rebound',async t=>{
 const {api,f}=await setup(t),o=await origin(api,f,'Back'),s=snapshot(o,8),r=await save(api,s)
 assert.equal((await save(api,s)).hash,r.hash);assert.equal((await save(api,s,r.hash)).version,1)
 const changed=structuredClone(s);changed.assembly.pieces[0].color='#123456'
 const newer=await save(api,changed,r.hash);await assert.rejects(save(api,s,r.hash),e=>e.statusCode===409)
 const other=await origin(api,f,'Front'),rebound=structuredClone(changed);rebound.photoOrigin.origin=other
 await assert.rejects(save(api,rebound,newer.hash),e=>e.statusCode===409)
 const a=structuredClone(changed),b=structuredClone(changed);a.assembly.pieces[0].color='#234567';b.assembly.pieces[0].color='#345678'
 const outcomes=await Promise.allSettled([save(api,a,newer.hash),save(api,b,newer.hash)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1)
})
test('stale lineage remains readable and editable as a Draft; strict Build/source authorization still rejects it',async t=>{
 const {api,f}=await setup(t),o=await origin(api,f,'Back'),s=snapshot(o,8),r=await save(api,s)
 await selectFixture(api,f.source.id,'plan',f.plans.Back[0])
 const saved=await api.dispatch('GET','assembly3d/records/'+o.assembly.id);assert.equal(saved.lineage.selected,false);assert.deepEqual(saved.snapshot,s)
 s.assembly.pieces[0].color='#123456';assert.equal((await save(api,s,r.hash)).lineage.selected,false)
 await assert.rejects(api.dispatch('POST','visible3d/build-check',{originId:o.id,assembly:s.assembly}),e=>e.statusCode===409)
})
test('restoration reuses one working-slot CAS and restores exact document/sidecar/policy without new Revision',async t=>{
 const {api,f}=await setup(t),o=await origin(api,f,'Back'),r=await save(api,snapshot(o,12)),map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}
 const expected={raw:null,policy:null,origin:null},restored=restoreAssemblySnapshot(storage,r,expected)
 assert.equal(restored.raw,serializeAssembly3D(r.snapshot.assembly));assert.equal(JSON.parse(storage.getItem(DRAFT_3D_KEY)).pieces.length,12);assert.deepEqual(JSON.parse(storage.getItem(PHOTO_ORIGIN_3D_KEY)),r.snapshot.photoOrigin)
 assert.equal(JSON.parse(storage.getItem(ASSEMBLY_SAVED_REF_KEY)).hash,r.hash);assert.deepEqual(JSON.parse(storage.getItem(DRAFT_COLLISION_POLICY_KEY)).nonRepairable,[])
 await assert.rejects(async()=>restoreAssemblySnapshot(storage,r,expected),/其他页面/)
})
test('Invalid versions save and restore without approval metadata',async t=>{
 const {api,f}=await setup(t),o=await origin(api,f,'Back'),s=snapshot(o,3);s.assembly.pieces[2].pose=structuredClone(s.assembly.pieces[0].pose)
 const r=await save(api,s);assert.equal('reviewRef' in r,false)
 assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+r.assembly.id)).snapshot,s)
 const newer=structuredClone(s);newer.assembly.revision++;newer.assembly.pieces[2].pose.position=[5,5,5]
 const next=await save(api,newer,r.hash);assert.equal(next.version,r.version+1)
 assert.deepEqual((await api.dispatch('GET',`assembly3d/records/${r.assembly.id}/versions/${r.version}`)).snapshot,s)
})
test('tampered files and invalid Profile snapshots fail closed',async t=>{
 const {dir,api,f}=await setup(t),o=await origin(api,f,'Back'),s=snapshot(o),r=await save(api,s),bad=structuredClone(s);bad.assembly.profiles[0].thickness=.5
 await assert.rejects(save(api,bad,r.hash))
 const filename=path.join(dir,'assembly3d',o.assembly.id,'000000000001.json'),data=JSON.parse(await readFile(filename,'utf8'));data.snapshot.assembly.revision=999;await writeFile(filename,JSON.stringify(data))
 await assert.rejects(api.dispatch('GET','assembly3d/records/'+o.assembly.id),e=>e.statusCode===409)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {sceneRegistrationFixture} from './magnetic-scene-registration-fixture.mjs'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {fitSceneRegistration} from '../src/magnetic-tiles/three-d/scene-registration/fit.ts'
import {moduleStep} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {createHash} from 'node:crypto'
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex')
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'scene-registration-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,...await sceneRegistrationFixture(dir)}}
const post=(f,route,body)=>f.api.dispatch('POST','scene-registration/'+route,{parents:f.parents,projectId:f.projectId,...body})
test('Truck-Ramp: fixed lineage, common image, offline-equivalent fit, 48 Tiles / 96 Connections, save/restart/manual Group edit',async t=>{
 const f=await setup(t),headFile=`visible3d/heads/${f.projectId}/${f.source.id}.json`,head=await readFile(path.join(f.dir,headFile),'utf8'),options=await post(f,'options')
 assert.deepEqual(options.images.map(i=>i.name),['Truck-Ramp/2.png']);assert.equal(options.results.length,0)
 const result=await post(f,'run',{image:options.images[0]})
 assert.ok(Math.abs(result.solution.quality.pointRmsePx-2.146975385)<.01);assert.ok(Math.abs(result.solution.quality.bboxCrosscheckPointRmsePx-2.41563)<.02)
 assert.equal(result.preview.pieces.length,48);assert.equal(result.preview.connections.length,96);assert.equal(new Set(result.preview.pieces.map(p=>p.id)).size,48);assert.equal(result.geometryValid,true)
 assert.equal(validateAssembly3D(result.preview,{checkGround:true}).valid,true)
 assert.equal((await post(f,'options')).results[0].hash,result.hash)
 const second=await post(f,'run',{image:options.images[0]});assert.deepEqual(second.solution,result.solution);assert.notEqual(second.id,result.id)
 const combined=await f.api.dispatch('POST','assembly3d/combine',{name:'Offline test registration',parents:f.parents,registration:{id:result.id,hash:result.hash}})
 assert.equal(combined.snapshot.assembly.pieces.length,48);assert.equal(combined.snapshot.assembly.connections.length,96);assert.equal(combined.lineage.selected,true)
 assert.deepEqual(combined.snapshot.photoOrigin.origin.sceneRegistration,{id:result.id,hash:result.hash})
 for(const [i,m]of combined.snapshot.assembly.modules.entries()){
  const parent=f.records[i].snapshot.assembly
  assert.equal(m.pieces.length,parent.pieces.length)
  assert.equal(combined.snapshot.assembly.connections.filter(c=>m.pieces.some(p=>p.id===c.pieceA)).length,parent.connections.length)
  for(const a of parent.pieces)for(const b of parent.pieces){const x=combined.snapshot.assembly.pieces.find(p=>p.id===m.pieces.find(p=>p.sourceId===a.id).id),y=combined.snapshot.assembly.pieces.find(p=>p.id===m.pieces.find(p=>p.sourceId===b.id).id),dist=(a,b)=>Math.hypot(...a.pose.position.map((v,i)=>v-b.pose.position[i]));assert.ok(Math.abs(dist(a,b)-dist(x,y))<1e-10)}
 }
 const restart=createMagneticIntake(f.dir),r=await restart.dispatch('GET','assembly3d/records/'+combined.assembly.id);assert.deepEqual(r.snapshot,combined.snapshot)
 const changed=structuredClone(r.snapshot);changed.assembly=moduleStep(changed.assembly,'module-1','translate','x',.1,'global');changed.assembly.revision++
 const saved=await restart.dispatch('POST','assembly3d/save',{snapshot:changed,expectedHash:r.hash});assert.equal(saved.version,2)
 await assert.rejects(restart.dispatch('POST','assembly3d/save',{snapshot:r.snapshot,expectedHash:r.hash}),e=>e.statusCode===409)
 assert.deepEqual((await restart.dispatch('GET',`assembly3d/records/${r.assembly.id}/versions/1`)).snapshot,r.snapshot)
 assert.equal(await readFile(path.join(f.dir,headFile),'utf8'),head)
 for(const [file,raw]of f.copied){assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.equal(await readFile(path.join(f.dir,file),'utf8'),raw)}
})
test('wrong Project, image, version, Source/Review and result hashes fail closed without saving a Combined',async t=>{
 const f=await setup(t),options=await post(f,'options'),image=options.images[0]
 await assert.rejects(post(f,'options',{projectId:'00000000-0000-4000-8000-000000000000'}),/Project/)
 for(const mutation of [p=>p[0].hash='0'.repeat(64),p=>p[0].version=999]){const p=structuredClone(f.parents);mutation(p);await assert.rejects(post(f,'options',{parents:p}),/Hash|版本/)}
 await assert.rejects(post(f,'run',{image:{...image,viewHash:'0'.repeat(64)}}),/图片/)
 const filename=path.join(f.dir,'assembly3d',f.parents[0].id,'000000000001.json'),original=await readFile(filename,'utf8'),changed=JSON.parse(original)
 changed.project.hash='0'.repeat(64);const {hash:oldHash,...payload}=changed;changed.hash=digest(payload);await writeFile(filename,JSON.stringify(changed))
 await assert.rejects(post(f,'options',{parents:f.parents.map((p,i)=>i?p:{...p,hash:changed.hash})}),/Parent.*Source.*关联/)
 await writeFile(filename,original)
 const r=await post(f,'run',{image})
 await assert.rejects(f.api.dispatch('POST','assembly3d/combine',{name:'bad',parents:f.parents,registration:{id:r.id,hash:'0'.repeat(64)}}),/Hash/)
 const file=path.join(f.dir,`visible3d/heads/${f.projectId}/${f.source.id}.json`),head=JSON.parse(await readFile(file));head.reviewHash='0'.repeat(64);await writeFile(file,JSON.stringify(head))
 await assert.rejects(f.api.dispatch('POST','assembly3d/combine',{name:'stale',parents:f.parents,registration:{id:r.id,hash:r.hash}}),/过期|Selected/)
 assert.equal((await readdir(path.join(f.dir,'assembly3d'))).length,3)
})
test('insufficient / inconsistent evidence rejects; no forced fallback; input and parent geometries remain immutable',async t=>{
 const f=await setup(t),o=await post(f,'options'),r=await post(f,'run',{image:o.images[0]}),input=structuredClone(r.input),before=canonical(input)
 assert.deepEqual(fitSceneRegistration(input),r.solution);assert.equal(canonical(input),before)
 assert.throws(()=>fitSceneRegistration({...input,points:[]}),/不足/)
 assert.throws(()=>fitSceneRegistration({...input,constraints:[{kind:'reviewed-spatial-check',members:input.members.slice(0,2).map(m=>m.ref.id),check:{id:'cross-group',pieceA:'g01',pieceB:'y01',relation:'shared-edge',minDeg:null,maxDeg:null,evidenceRefs:[],note:'future reviewed cross-member fact'}}]}),/跨成员.*已保留/)
 const bad=structuredClone(input);bad.points.forEach((p,i)=>p.pixel=[(i*137)%640,(i*79)%600]);assert.throws(()=>fitSceneRegistration(bad),/配准|空间|布局/)
 const filename=path.join(f.dir,'scene-registrations',r.id+'.json'),tampered=JSON.parse(await readFile(filename));tampered.solution.transforms[0].delta.position[0]+=5;await writeFile(filename,JSON.stringify(tampered))
 await assert.rejects(f.api.dispatch('GET','scene-registration/records/'+r.id),/Hash/)
 // Even a recomputed record hash cannot rebind its fixed Review/parent inputs.
 tampered.input.review.hash='0'.repeat(64);const {hash,...payload}=tampered;tampered.hash=digest(payload);await writeFile(filename,JSON.stringify(tampered))
 await assert.rejects(f.api.dispatch('POST','assembly3d/combine',{name:'bad binding',parents:f.parents,registration:{id:r.id,hash:tampered.hash}}),/过期/)
})

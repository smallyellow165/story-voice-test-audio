import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {profiles as seeds} from '../src/magnetic-tiles/profiles.ts'
import {parametricProfile,profileAngles,parametersFor} from '../src/magnetic-tiles/parametric-profile.ts'
import {profileIssues,validate,vertices,edges,alignEdge,findSnap} from '../src/magnetic-tiles/geometry.ts'
import {createProfileRegistry} from '../server/magnetic-profile-registry.mjs'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {generateBuild,validateBuild,contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {parseAssembly} from '../src/magnetic-tiles/storage.ts'
import {matchRelativeProfiles,estimateRelativeScale} from '../src/magnetic-tiles/intake/relative-size.ts'
import {recognitionRequest} from '../server/magnetic-intake-vision.mjs'
import {cases,evidenceFor} from './fixtures/magnetic-intake/cases.mjs'
const input=(id='custom-triangle',shape='isosceles-triangle',dimensions={base:1,height:1.4})=>({id,name:id,parameters:{shape,dimensions},connectableEdges:shape==='square'||shape==='rectangle'?['e0','e1','e2','e3']:['e0','e1','e2'],estimated:true,source:'Test parameters'})
const temporary=async fn=>{const dir=await mkdtemp(path.join(os.tmpdir(),'magnetic-registry-'));try{await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}}
test('five templates: CCW vertices, computed lengths and angles; chosen isosceles kind survives special proportions',()=>{
 const examples=[['square',{side:2},[[0,0],[2,0],[2,2],[0,2]],[90,90,90,90]],['rectangle',{width:2,height:3},[[0,0],[2,0],[2,3],[0,3]],[90,90,90,90]],['equilateral-triangle',{side:2},[[0,0],[2,0],[1,Math.sqrt(3)]],[60,60,60]],['isosceles-triangle',{base:2,height:2},[[0,0],[2,0],[1,2]],[63.434948822922,63.434948822922,53.130102354156]],['right-triangle',{legA:1,legB:2},[[0,0],[1,0],[0,2]],[90,63.434948822922,26.565051177078]]]
 for(const [shape,d,v,angles]of examples){const p=parametricProfile(input('test',shape,d),1);assert.deepEqual(p.vertices,v);assert.deepEqual(profileIssues(p),[]);profileAngles(p).forEach((a,i)=>assert.ok(Math.abs(a-angles[i])<1e-8));assert.deepEqual(parametersFor(p),{shape,dimensions:d})}
 const p=parametricProfile(input('special','isosceles-triangle',{base:2,height:Math.sqrt(3)}),1);assert.equal(p.parametric.shape,'isosceles-triangle')
 for(const seed of seeds)assert.ok(parametersFor(seed));assert.equal(seeds.length,5)
})
test('reject invalid dimensions, degenerate and out-of-range geometry, identity and connectors',()=>{
 for(const n of [0,-1,NaN,Infinity,1e-9,101])assert.throws(()=>parametricProfile(input('bad','square',{side:n}),1))
 for(const patch of [{id:'unknown'},{id:'../bad'},{name:''},{connectableEdges:['e9']},{connectableEdges:['e0','e0']},{parameters:{shape:'toString',dimensions:{}}},{parameters:{shape:'square',dimensions:{side:1,unused:2}}}])assert.throws(()=>parametricProfile({...input(),...patch},1))
})
test('append-only versions, duplicate IDs, fresh process recovery and cross-process CAS',()=>temporary(async dir=>{
 const registry=createProfileRegistry(dir);let r=await registry.get();assert.deepEqual(r.profiles,seeds)
 const one=await registry.save({expectedRevision:0,operation:'create',input:input()});assert.equal(one.profile.version,1)
 await assert.rejects(registry.save({expectedRevision:1,operation:'create',input:input()}),/ID 已存在/)
 const two=await registry.save({expectedRevision:1,operation:'version',input:input('custom-triangle','isosceles-triangle',{base:1,height:2})});assert.equal(two.profile.version,2);assert.deepEqual(two.registry.profiles[5],one.profile);assert.deepEqual(two.registry.profiles.slice(0,5),seeds)
 await assert.rejects(registry.save({expectedRevision:1,operation:'version',input:input()}),e=>e.statusCode===409)
 const module=new URL('../server/magnetic-profile-registry.mjs',import.meta.url).href
 const script=`import {createProfileRegistry} from ${JSON.stringify(module)};const registry=createProfileRegistry(process.argv[1]);try{await registry.save({expectedRevision:2,operation:'create',input:JSON.parse(process.argv[2])});console.log('saved')}catch(e){console.log(e.statusCode)}`
 const run=promisify(execFile),results=await Promise.all(['concurrent-a','concurrent-b'].map(id=>run(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,dir,JSON.stringify(input(id))])))
 assert.deepEqual(results.map(r=>r.stdout.trim()).sort(),['409','saved']);r=await createProfileRegistry(dir).get();assert.equal(r.revision,3);assert.equal(r.profiles.length,8)
 const filename=path.join(dir,'profile-registry','000000000003.json'),bad=JSON.parse(await readFile(filename));bad.profile.vertices[1][0]=99;await writeFile(filename,JSON.stringify(bad));await assert.rejects(registry.get(),/损坏/)
}))
test('saved custom profile enters real matching, reconstruction, snap, Assembly and Build; old versions and traces survive additions',()=>temporary(async dir=>{
 const store=createMagneticIntake(dir),first=await store.dispatch('POST','profiles',{operation:'create',expectedRevision:0,input:input()});let catalog=first.registry.profiles
 const anchor={...cases[0].tiles[0],id:'anchor',pose:{x:0,y:0,angleRad:0}},moving={...anchor,id:'custom',profileId:first.profile.id,profileVersion:1}
 const tile=alignEdge(moving,edges(moving,catalog)[0],edges(anchor,catalog)[2],catalog),tiles=[anchor,tile]
 assert.equal(validate(tiles,catalog).valid,true);assert.ok(findSnap(tile,[anchor],catalog,.1));const f=evidenceFor(tiles,catalog,vertices,validate)
 const match=matchRelativeProfiles(f.evidence.observations[1],f.width,f.height,catalog,estimateRelativeScale(f.evidence.observations,'custom',f.width,f.height,catalog));assert.equal(match.status,'scored');assert.ok(match.candidates.some(c=>c.profileId===first.profile.id&&c.similarityScore>99))
 async function seed(kind,value){await mkdir(path.join(dir,kind),{recursive:true});const r={...value,hash:await contentHash(value)};await writeFile(path.join(dir,kind,value.id+'.json'),JSON.stringify(r));return r}
 const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),view:{width:f.width,height:f.height},createdAt:new Date().toISOString()})
 const analysis=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',evidence:f.evidence,createdAt:new Date().toISOString()})
 const review=await store.dispatch('POST','reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence:f.evidence})
 const r=await store.dispatch('POST','reconstruct',{reviewId:review.id,reviewHash:review.hash});assert.ok(r.candidates.length,JSON.stringify(r.diagnostics))
 const a=parseAssembly(r.candidates[0].assembly,catalog),build=await generateBuild(a,catalog);assert.equal((await validateBuild(build,catalog)).plan.steps.length,2)
 const next=await store.dispatch('POST','profiles',{operation:'version',expectedRevision:1,input:input('custom-triangle','isosceles-triangle',{base:1,height:2})});catalog=next.registry.profiles
 assert.deepEqual(parseAssembly(a,catalog),a);assert.deepEqual(await validateBuild(build,catalog),build);assert.equal((await store.result(r.id)).reconstruction.hash,r.hash)
 assert.equal((await store.dispatch('GET','profiles')).profiles.length,7)
 const originalSquare=structuredClone(seeds[0]);const builtin=await store.dispatch('POST','profiles',{operation:'version',expectedRevision:2,input:input('square','square',{side:1.5})});assert.equal(builtin.profile.version,2);assert.deepEqual(builtin.registry.profiles.find(p=>p.id==='square'&&p.version===1),originalSquare);assert.equal((await store.result(r.id)).reconstruction.hash,r.hash)
 await assert.rejects(store.dispatch('POST','profiles',{operation:'create',expectedRevision:3,input:input('invalid','square',{side:0})}),e=>e.statusCode===422)
 // Request construction only, using a locally registered model; no provider call.
 const {modelOptions}=await import('../server/brick-model-registry.mjs')
 for(const model of new Map(modelOptions('reverse').map(m=>[m.provider,m])).values()){
  const request=recognitionRequest(model.id,{width:100,height:100,mimeType:'image/png',imageBase64:'AA=='},catalog),schema=request.text?.format?.schema??request.config.responseSchema
  assert.ok(JSON.stringify(request).includes('custom-triangle'));assert.ok(schema.properties.observations.items.properties.profileId.enum.includes('custom-triangle'));assert.ok(schema.properties.observations.items.properties.profileVersion.enum.includes(2))
 }
}))

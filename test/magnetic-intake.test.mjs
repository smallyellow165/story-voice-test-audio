import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {validate,vertices} from '../src/magnetic-tiles/geometry.ts'
import {contentHash,generateBuild} from '../src/magnetic-tiles/build-plan.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {parseEvidence} from '../src/magnetic-tiles/intake/contracts.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {cases,evidenceFor} from './fixtures/magnetic-intake/cases.mjs'
for(const fixture of cases)test('reconstruction ground truth: '+fixture.id,async()=>{
 const expected=validate(fixture.tiles,profiles);assert.equal(expected.valid,true)
 const {width,height,evidence}=evidenceFor(fixture.tiles,profiles,vertices,validate)
 const r=reconstruct(evidence,width,height,profiles,'assembly')
 assert.ok(r.candidates.length,JSON.stringify(r));const c=r.candidates[0]
 assert.equal(c.assembly.instances.length,fixture.tiles.length);assert.equal(c.connections,expected.connections.length)
 assert.ok(c.imageError<.02);assert.equal(validate(c.assembly.instances,profiles).valid,true)
 assert.equal((await generateBuild(c.assembly,profiles)).plan.steps.length,fixture.tiles.length)
 assert.deepEqual(reconstruct(evidence,width,height,profiles,'assembly'),r)
})
test('unknown/3D, oversized, false connections and image-inconsistent layouts do not become success',()=>{
 const f=evidenceFor(cases[0].tiles,profiles,vertices,validate)
 for(const change of [e=>{e.sourceKind='unsupported';e.reason='3D'},e=>{e.observations[0].profileId='unknown'},e=>{e.relations[0].intent='separate'},e=>{e.observations[1].outline=e.observations[1].outline.map(([x,y])=>[x*.2,y*.2])}]){
  const e=structuredClone(f.evidence);change(e);assert.equal(reconstruct(e,f.width,f.height,profiles,'a').candidates.length,0)
 }
 const e=structuredClone(f.evidence);e.relations[0].to='missing';assert.throws(()=>parseEvidence(e))
})
test('manual repair, exclusion and confidence never weaken geometry',()=>{
 const f=evidenceFor(cases[1].tiles,profiles,vertices,validate),e=structuredClone(f.evidence)
 e.observations[1].profileId='square';assert.equal(reconstruct(e,f.width,f.height,profiles,'a').candidates.length,0)
 e.observations[1].profileId='right-triangle';e.observations[1].confidence=.1
 assert.ok(reconstruct(e,f.width,f.height,profiles,'a').candidates.length)
 e.observations[1].excluded=true;assert.equal(reconstruct(e,f.width,f.height,profiles,'a').candidates[0].assembly.instances.length,1)
})
test('immutable review/reconstruction lineage and hash integrity (fixture analysis; no provider invocation)',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'magnetic-intake-test-'))
 try{
  const store=createMagneticIntake(dir)
  async function seed(kind,value){const r={...value,hash:await contentHash(value)};const {mkdir}=await import('node:fs/promises');await mkdir(path.join(dir,kind),{recursive:true});await writeFile(path.join(dir,kind,value.id+'.json'),JSON.stringify(r));return r}
  const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),view:{width:540,height:360},createdAt:new Date().toISOString()})
  const f=evidenceFor(cases[0].tiles,profiles,vertices,validate)
  const a=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',evidence:f.evidence,createdAt:new Date().toISOString()})
  const r=await store.dispatch('POST','reviews',{analysisId:a.id,analysisHash:a.hash,evidence:a.evidence})
  const result=await store.dispatch('POST','reconstruct',{reviewId:r.id,reviewHash:r.hash});assert.ok(result.candidates.length)
  const next=structuredClone(a.evidence);next.observations[0].color='#ff0000'
  const r2=await store.dispatch('POST','reviews',{analysisId:a.id,analysisHash:a.hash,evidence:next});assert.notEqual(r2.id,r.id)
  assert.equal((await store.read('analyses',a.id)).hash,a.hash)
  const c=result.candidates[0]
  const origin=await store.dispatch('POST','origins',{reconstructionId:result.id,reconstructionHash:result.hash,candidateId:c.id,visualChecked:true,assembly:{...c.assembly,revision:8}})
  await assert.rejects(store.dispatch('POST','origins',{reconstructionId:result.id,reconstructionHash:result.hash,candidateId:c.id,visualChecked:true,assembly:{...c.assembly,schemaVersion:2,mode:'flat-mosaic'}}),/不一致/)
  assert.equal(origin.assembly.revision,8);assert.equal(origin.assemblyHash,await contentHash(origin.assembly))
  await assert.rejects(store.dispatch('POST','reconstruct',{reviewId:r.id,reviewHash:'bad'}))
  const raw=JSON.parse(await readFile(path.join(dir,'reviews',r.id+'.json'),'utf8'));raw.evidence.reason='tampered';await writeFile(path.join(dir,'reviews',r.id+'.json'),JSON.stringify(raw));await assert.rejects(store.result(result.id),/Hash/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('oversized observations, normalized coordinate contract and provider strict JSON schema',async()=>{
 const f=evidenceFor(cases[0].tiles,profiles,vertices,validate)
 const e=structuredClone(f.evidence);e.observations=Array.from({length:26},(_,i)=>({...e.observations[0],id:'o'+i}));e.relations=[]
 assert.throws(()=>reconstruct(e,f.width,f.height,profiles,'x'),/结构无效/)
 const invalid=structuredClone(f.evidence);invalid.observations[0].outline[0][0]=80;assert.throws(()=>parseEvidence(invalid))
 const {recognitionRequest}=await import('../server/magnetic-intake-vision.mjs')
 const req=recognitionRequest('gpt-4.1',{width:10,height:10,mimeType:'image/png',imageBase64:'AA=='})
 assert.equal(req.text.format.type,'json_schema');assert.equal(req.text.format.strict,true)
 const schema=req.text.format.schema;assert.equal(schema.additionalProperties,false)
 const o=schema.properties.observations.items;assert.equal(o.additionalProperties,false)
 assert.equal(o.properties.outline.items.items.maximum,1)
 assert.equal(o.properties.color.pattern,'^#[0-9a-fA-F]{6}$')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {vertices,validate} from '../src/magnetic-tiles/geometry.ts'
import {parseEvidence,recognitionSummary,reconstructionSummary} from '../src/magnetic-tiles/intake/contracts.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {prompt,recognitionSchema} from '../server/magnetic-intake-vision.mjs'
import {cases,evidenceFor} from './fixtures/magnetic-intake/cases.mjs'
const fixture=()=>evidenceFor(cases[0].tiles,profiles,vertices,validate)
const mixed=()=>{const f=fixture();f.evidence.observations[1].profileId='unknown';f.evidence.observations[1].uncertainty='比例未知，候选 square@1 尚未确认';return f}
test('unsupported retains known/unknown and uncertain overlap evidence without weakening reconstruction',()=>{
 const f=mixed(),e=f.evidence;e.sourceKind='unsupported';e.reason='局部遮挡';e.relations[0].intent='uncertain';e.relations[0].evidence='第二片可能遮挡第一片'
 assert.deepEqual(parseEvidence(e),e)
 assert.match(recognitionSummary(e),/部分识别/)
 const r=reconstruct(e,f.width,f.height,profiles,'test');assert.equal(r.candidates.length,0);assert.ok(r.diagnostics.some(s=>s.includes('Unknown')));assert.ok(r.diagnostics.some(s=>s.includes('二维')))
 e.sourceKind='diagram';assert.equal(reconstruct(e,f.width,f.height,profiles,'test').candidates.length,0)
 assert.match(prompt,/does NOT require empty observations/);assert.ok(recognitionSchema.properties.observations.items.properties.profileId.enum.includes('unknown'))
})
test('complete, partial, empty and explicit subset have distinct semantics',()=>{
 const f=fixture(),e=f.evidence;assert.match(recognitionSummary(e),/完整识别/)
 assert.match(recognitionSummary({...e,observations:[],relations:[]}),/没有可恢复/)
 e.observations[1].profileId='unknown';e.observations[1].excluded=true
 const r=reconstruct(e,f.width,f.height,profiles,'test');assert.ok(r.candidates.length);assert.equal(r.candidates[0].assembly.instances.length,1);assert.ok(r.diagnostics.some(s=>s.includes('部分作品')))
 assert.match(reconstructionSummary(r,e),/部分作品/);assert.match(recognitionSummary(e),/部分识别/)
})
test('immutable Review roundtrip retains Unknown, then can map to a newly available verified profile',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'magnetic-partial-'))
 try{
  const api=createMagneticIntake(dir),f=mixed();
  async function seed(kind,value){const r={...value,hash:await contentHash(value)};await mkdir(path.join(dir,kind),{recursive:true});await writeFile(path.join(dir,kind,r.id+'.json'),JSON.stringify(r));return r}
  const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),view:{width:f.width,height:f.height},createdAt:new Date().toISOString()})
  const a=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),status:'complete',sourceId:source.id,sourceHash:source.hash,evidence:f.evidence,createdAt:new Date().toISOString()})
  const review=await api.dispatch('POST','reviews',{analysisId:a.id,analysisHash:a.hash,evidence:a.evidence})
  const fresh=createMagneticIntake(dir);assert.deepEqual((await fresh.read('reviews',review.id)).evidence,a.evidence)
  const newProfile={...structuredClone(profiles[0]),id:'test-verified-profile',version:2}
  profiles.push(newProfile) // isolated test Catalog extension; never modifies JSON or production runtime
  try{
   const e=structuredClone(review.evidence);e.observations[1].profileId=newProfile.id;e.observations[1].profileVersion=2
   const next=await fresh.dispatch('POST','reviews',{analysisId:a.id,analysisHash:a.hash,evidence:e})
   assert.notEqual(next.id,review.id)
   const r=await fresh.dispatch('POST','reconstruct',{reviewId:next.id,reviewHash:next.hash});assert.ok(r.candidates.length)
   assert.equal((await fresh.read('analyses',a.id)).evidence.observations[1].profileId,'unknown');assert.equal((await fresh.read('reviews',review.id)).hash,review.hash)
  }finally{profiles.pop()}
 }finally{await rm(dir,{recursive:true,force:true})}
})

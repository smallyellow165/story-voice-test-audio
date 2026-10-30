import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {removeManualPart,setPartExcluded} from '../src/magnetic-tiles/intake/review-edit.ts'
import {parseEvidence} from '../src/magnetic-tiles/intake/contracts.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
const part=(id,origin='observed')=>({id,profileId:'square',profileVersion:1,color:'#00ff00',outline:[[.1,.1],[.3,.1],[.3,.3],[.1,.3]],confidence:.99,evidence:'original evidence',uncertainty:'minor rim uncertainty',origin,excluded:false})
const fixture=()=>({sourceKind:'diagram',reason:'retained reason',observations:[part('original'),part('manual-1','manual'),part('other')],relations:[{from:'original',to:'manual-1',intent:'connect',evidence:'first'},{from:'manual-1',to:'other',intent:'uncertain',evidence:'second'},{from:'other',to:'original',intent:'separate',evidence:'retained'}]})

test('manual removal cleans every incident relation, preserves other evidence, and keeps the input usable for undo',()=>{
 const e=fixture(),before=structuredClone(e),next=removeManualPart(e,'manual-1')
 assert.deepEqual(parseEvidence(next),next)
 assert.deepEqual(next.observations,e.observations.filter(o=>o.id!=='manual-1'))
 assert.deepEqual(next.relations,[e.relations[2]])
 assert.deepEqual(e,before)
 assert.deepEqual(parseEvidence(e),before,'the unchanged prior draft can be restored by single-step undo')
 assert.throws(()=>removeManualPart(e,'original'),/排除/)
 assert.throws(()=>removeManualPart(e,'missing'))
})

test('exclude/restore retain source evidence and relations exactly, and excluded endpoints do not constrain reconstruction',()=>{
 const e=fixture(),excluded=setPartExcluded(e,'original',true)
 assert.deepEqual(excluded.relations,e.relations)
 assert.deepEqual(excluded.observations[0],{...e.observations[0],excluded:true})
 assert.deepEqual(setPartExcluded(excluded,'original',false),e)
 assert.throws(()=>setPartExcluded(e,'missing',true))
 const onlySquare=setPartExcluded(removeManualPart(e,'manual-1'),'other',true)
 const r=reconstruct(onlySquare,1000,1000,profiles,'safe')
 assert.ok(r.candidates.length,JSON.stringify(r.diagnostics))
 assert.deepEqual(r.candidates[0].assembly.instances.map(t=>t.id),['original'])
})

test('deleting the last manual tile leaves a valid empty Review and an explicit unsuccessful reconstruction',()=>{
 const e={...fixture(),observations:[part('manual-1','manual')],relations:[]},next=removeManualPart(e,'manual-1')
 assert.deepEqual(parseEvidence(next).observations,[])
 const r=reconstruct(next,1000,1000,profiles,'empty')
 assert.equal(r.candidates.length,0);assert.ok(r.diagnostics.length)
})

test('new Review snapshots persist add/delete/exclude/restore without rewriting Analysis or prior Reviews',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'review-ui-'))
 try {
  const store=createMagneticIntake(directory)
  async function seed(kind,value){const record={...value,hash:await contentHash(value)};await mkdir(path.join(directory,kind),{recursive:true});await writeFile(path.join(directory,kind,value.id+'.json'),JSON.stringify(record));return record}
  const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),view:{width:1000,height:1000},createdAt:new Date().toISOString()})
  const evidence={...fixture(),observations:[part('original'),part('other')],relations:[]}
  const a=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',evidence,createdAt:new Date().toISOString()})
  const save=evidence=>store.dispatch('POST','reviews',{analysisId:a.id,analysisHash:a.hash,evidence})
  const added=await save(fixture()),deleted=await save(setPartExcluded(removeManualPart(added.evidence,'manual-1'),'other',true)),restored=await save(setPartExcluded(deleted.evidence,'other',false))
  assert.equal(deleted.evidence.observations.length,2);assert.equal(deleted.evidence.relations.length,1)
  assert.equal(restored.evidence.observations.find(o=>o.id==='other').excluded,false)
  for(const r of [added,deleted,restored])assert.deepEqual(await store.dispatch('GET','reviews/'+r.id),r)
  assert.deepEqual(await store.dispatch('GET','analyses/'+a.id),a)
  assert.notEqual(added.id,deleted.id);assert.notEqual(deleted.id,restored.id)
  const result=await store.dispatch('POST','reconstruct',{reviewId:deleted.id,reviewHash:deleted.hash})
  assert.equal(result.candidates[0].assembly.instances[0].id,'original')
 } finally {await rm(directory,{recursive:true,force:true})}
})

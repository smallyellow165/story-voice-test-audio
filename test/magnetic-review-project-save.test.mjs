import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'

async function setup(t){
 const dir=await mkdtemp(path.join(tmpdir(),'review-project-save-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const api=createMagneticIntake(dir),f=await visibleFixture(),source=await api.dispatch('POST','sources',{name:'same-input.png',original:png,view:png})
 async function project(){
  const id=randomUUID(),prefix='visible3d/project/'+id+'/',post=(route,body)=>api.dispatch('POST',prefix+route,body),get=route=>api.dispatch('GET',prefix+route)
  const analysis=await post('annotate',{sourceId:source.id,evidence:f.evidence});await post('selected',{sourceId:source.id,stage:'analysis',id:analysis.id,hash:analysis.hash,expectedRevision:0})
  async function save(form=f.review){const head=await get('head/'+source.id);return post('reviews',{analysisId:analysis.id,review:form,expectedRevision:head.revision,expectedSelectedRevision:head.selectedRevision,...(head.reviewId?{baseReview:{id:head.reviewId,hash:head.reviewHash}}:{})})}
  return {id,prefix,post,get,analysis,save}
 }
 const other=await project(),otherReview=await other.save(),otherModule=await other.post('module-plans',{reviewId:otherReview.record.id,reviewHash:otherReview.record.hash,expectedRevision:0,expectedHash:null,command:{kind:'create',name:'another Project',observationIds:f.review.pieces.map(p=>p.id)}})
 return {dir,api,f,source,other,otherReview,otherModule,current:await project()}
}
test('foreign modules cannot block a fresh Project first Review, module read, second save or own-module inheritance',async t=>{
 const {dir,f,source,current:a,other,otherReview,otherModule}=await setup(t),foreignBytes=await readFile(path.join(dir,'visible3d/module-plans',otherModule.record.id+'.json'))
 const first=await a.save();assert.equal(first.head.revision,1);assert.equal(first.record.projectId,a.id);assert.equal(first.record.analysisId,a.analysis.id);assert.equal(first.record.sourceId,source.id)
 const state=await a.get('module-state/'+first.record.id);assert.equal(state.record,null);assert.deepEqual(state.history,[])
 const firstBytes=await readFile(path.join(dir,'visible3d/reviews',first.record.id+'.json')),edited=structuredClone(f.review);edited.pieces[0].color='#123456'
 const second=await a.save(edited);assert.equal(second.head.revision,2);assert.deepEqual(second.record.parentReview,{id:first.record.id,hash:first.record.hash});assert.equal(second.record.input.review.pieces[0].color,'#123456')
 const group=await a.post('module-plans',{reviewId:second.record.id,reviewHash:second.record.hash,expectedRevision:0,expectedHash:null,command:{kind:'create',name:'only A',observationIds:[edited.pieces[0].id]}})
 const third=await a.save(edited),inherited=await a.get('module-state/'+third.record.id)
 assert.deepEqual(inherited.record.modules,group.record.modules);assert.equal(inherited.record.projectId,a.id);assert.equal(inherited.history.length,1)
 assert.deepEqual((await other.get('module-state/'+otherReview.record.id)).record,otherModule.record)
 assert.ok(firstBytes.equals(await readFile(path.join(dir,'visible3d/reviews',first.record.id+'.json'))));assert.ok(foreignBytes.equals(await readFile(path.join(dir,'visible3d/module-plans',otherModule.record.id+'.json'))))
})
test('Project, Review Hash and stale CAS guards still reject; failed saves leave Selected and saved form intact',async t=>{
 const {f,source,current:a,other,otherReview}=await setup(t),first=await a.save(),head=await a.get('head/'+source.id)
 await assert.rejects(a.get('reviews/'+otherReview.record.id),/不属于当前作品 Project/)
 await assert.rejects(a.get('module-state/'+otherReview.record.id),/不属于当前作品 Project/)
 await assert.rejects(a.post('reviews',{analysisId:other.analysis.id,review:f.review,expectedRevision:head.revision}),/不属于当前作品 Project/)
 await assert.rejects(a.post('reviews',{analysisId:a.analysis.id,review:f.review,expectedRevision:head.revision-1,expectedSelectedRevision:head.selectedRevision,baseReview:{id:first.record.id,hash:first.record.hash}}),e=>e.statusCode===409)
 await assert.rejects(a.post('reviews',{analysisId:a.analysis.id,review:f.review,expectedRevision:head.revision,expectedSelectedRevision:head.selectedRevision-1,baseReview:{id:first.record.id,hash:first.record.hash}}),e=>e.statusCode===409)
 await assert.rejects(a.post('reviews',{analysisId:a.analysis.id,review:f.review,expectedRevision:head.revision,expectedSelectedRevision:head.selectedRevision,baseReview:{id:first.record.id,hash:'bad'}}),/ID \/ Hash/)
 assert.deepEqual(await a.get('head/'+source.id),head);assert.deepEqual((await a.get('reviews/'+first.record.id)).record.input.review,first.record.input.review)
})
test('filtering candidates never exempts this Review own module from Project / Hash / lineage validation',async t=>{
 const {dir,current:a,f}=await setup(t),review=await a.save(),created=await a.post('module-plans',{reviewId:review.record.id,reviewHash:review.record.hash,expectedRevision:0,expectedHash:null,command:{kind:'create',name:'A',observationIds:f.review.pieces.map(p=>p.id)}}),file=path.join(dir,'visible3d/module-plans',created.record.id+'.json'),bytes=await readFile(file)
 const badHash={...created.record,hash:'0'.repeat(64)};await writeFile(file,JSON.stringify(badHash));await assert.rejects(a.get('module-state/'+review.record.id),/Hash 不一致/)
 const wrongProject={...created.record,projectId:randomUUID()};delete wrongProject.hash;wrongProject.hash=createHash('sha256').update(JSON.stringify(wrongProject)).digest('hex');await writeFile(file,JSON.stringify(wrongProject));await assert.rejects(a.get('module-state/'+review.record.id),/不属于当前作品 Project/)
 await writeFile(file,bytes);assert.equal((await a.get('module-state/'+review.record.id)).record.id,created.record.id)
})

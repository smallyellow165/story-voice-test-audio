import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {editReviewedPiece,exactProfileReview} from '../src/magnetic-tiles/three-d/reconstruction/rebase-plan.ts'
import {validateVisibleInput} from '../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {visibleV2Fixture} from './magnetic-visible3d-v2-fixtures.mjs'
import {png} from './magnetic-visible3d-fixtures.mjs'

test('Exact Profile edit removes duplicate family metadata without accepting instance existence or changing AI evidence',async()=>{
 const f=await visibleV2Fixture(),review=structuredClone(f.review),p=review.pieces[0];p.confirmed=false;p.profileId=null;p.profileVersion=null;p.shapeFamily='triangle';p.shapeNote='Legacy manual guess'
 const before=structuredClone(review),evidence=structuredClone(f.evidence)
 const adopted=editReviewedPiece(review,p.id,{profileId:'square',profileVersion:1})
 assert.equal(adopted.pieces[0].profileId,'square');assert.equal(adopted.pieces[0].confirmed,false)
 assert.ok(adopted.pieces.every(p=>!('shapeFamily' in p)&&!('shapeNote' in p)))
 const confirmed=editReviewedPiece(adopted,p.id,{confirmed:true});assert.equal(confirmed.pieces[0].confirmed,true)
 const changed=editReviewedPiece(confirmed,p.id,{profileId:'equilateral-triangle',profileVersion:1});assert.equal(changed.pieces[0].confirmed,true,'changing specification preserves explicit existence confirmation')
 const excluded=editReviewedPiece(changed,p.id,{excluded:true});assert.equal(excluded.pieces[0].confirmed,false)
 assert.equal(editReviewedPiece(excluded,p.id,{profileId:'square',profileVersion:1}).pieces[0].confirmed,false)
 const unknown=exactProfileReview(review);assert.equal(unknown.pieces[0].profileId,null,'family metadata never infers an Exact Profile')
 assert.deepEqual(review,before);assert.deepEqual(f.evidence,evidence)
})

test('new saved Reviews keep Exact Profile only; legacy data remains readable and full validator still rejects malformed input',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'review-profile-save-'));t.after(()=>rm(directory,{recursive:true,force:true}))
 const api=createMagneticIntake(directory),f=await visibleV2Fixture(),source=await api.dispatch('POST','sources',{name:'OFFLINE-review-profile.png',original:png,view:png})
 const a=await api.dispatch('POST','visible3d/annotate',{sourceId:source.id,evidence:f.evidence}),review=structuredClone(f.review)
 review.pieces[0].shapeFamily='rectangle';review.pieces[0].shapeNote='Legacy manual family contradicts square'
 const oldInput={...f.input,review};assert.deepEqual(validateVisibleInput(oldInput),oldInput,'existing legacy schema remains readable')
 const saved=await api.dispatch('POST','visible3d/reviews',{analysisId:a.id,review,expectedRevision:0})
 assert.equal(saved.record.input.review.pieces[0].profileId,'square');assert.ok(saved.record.input.review.pieces.every(p=>!('shapeFamily' in p)&&!('shapeNote' in p)))
 assert.deepEqual(saved.record.input.evidence,f.evidence);assert.equal(review.pieces[0].shapeFamily,'rectangle')
 assert.deepEqual((await api.dispatch('GET','visible3d/reviews/'+saved.record.id)).record,saved.record)
 const invalid=structuredClone(review);invalid.pieces[0].shapeFamily='not-a-family'
 await assert.rejects(api.dispatch('POST','visible3d/reviews',{analysisId:a.id,review:invalid,expectedRevision:1}),/形状|Shape/)
 const missing=structuredClone(review);missing.pieces.pop()
 await assert.rejects(api.dispatch('POST','visible3d/reviews',{analysisId:a.id,review:missing,expectedRevision:1}),/全部 Observation/)
})

test('planning an immutable legacy Review excludes duplicate manual shape metadata but retains source hashes, profiles and evidence',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'review-profile-history-'));t.after(()=>rm(directory,{recursive:true,force:true}))
 const api=createMagneticIntake(directory),f=await visibleV2Fixture(),source=await api.dispatch('POST','sources',{name:'OFFLINE-legacy-review.png',original:png,view:png}),scoped=path.join(directory,'isolated-visible3d'),calls=[]
 const workflow=createVisible3DWorkflow(scoped,{readSource:id=>api.read('sources',id),readImage:async()=>png,getRegistry:()=>api.dispatch('GET','profiles'),runModel:async prepared=>{calls.push(prepared);throw Error('OFFLINE spy: no model request')}})
 const a=await workflow.dispatch('POST','annotate',{sourceId:source.id,evidence:f.evidence}),r=await workflow.dispatch('POST','reviews',{analysisId:a.id,review:f.review,expectedRevision:0})
 // Seed an explicitly synthetic old-format record in this disposable store only.
 const {hash:discard,...payload}=structuredClone(r.record);payload.input.review.pieces[0].shapeFamily='rectangle';payload.input.review.pieces[0].shapeNote='Legacy correction'
 const legacy={...payload,hash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')},file=path.join(scoped,'reviews',legacy.id+'.json')
 await writeFile(file,JSON.stringify(legacy));await writeFile(path.join(scoped,'heads',source.id+'.json'),JSON.stringify({revision:1,reviewId:legacy.id,reviewHash:legacy.hash}));const bytes=await readFile(file,'utf8')
 await workflow.dispatch('POST','plan',{reviewId:legacy.id,requestId:randomUUID(),model:'gpt-4.1'})
 assert.equal(calls.length,1);assert.deepEqual(calls[0].input.geometryInput.review,exactProfileReview(legacy.input.review))
 assert.deepEqual(calls[0].input.geometryInput.profiles,legacy.input.profiles);assert.deepEqual(calls[0].input.geometryInput.evidence,legacy.input.evidence)
 assert.equal(await readFile(file,'utf8'),bytes);assert.deepEqual((await workflow.dispatch('GET','reviews/'+legacy.id)).record,legacy)
})

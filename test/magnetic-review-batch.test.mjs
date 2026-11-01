import test from 'node:test'
import assert from 'node:assert/strict'
import {visibleFixture} from './magnetic-visible3d-fixtures.mjs'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {availableAISuggestions,acceptedProfilePatch,planAIReview,adoptAllAIReview} from '../src/magnetic-tiles/three-d/reconstruction/review-profile-actions.ts'
import {editReviewedPiece} from '../src/magnetic-tiles/three-d/reconstruction/rebase-plan.ts'

async function unknowns(){const f=await visibleFixture('closed-cube');f.review.pieces.forEach(p=>Object.assign(p,{profileId:null,profileVersion:null,confirmed:false,excluded:false}));return f}
test('batch and single-item acceptance use the same legal ordered candidates and atomic patch',async()=>{
 const f=await unknowns(),before=structuredClone(f),p=f.review.pieces[0],o=f.evidence.observations[0]
 o.profileCandidates=[{profileId:'not-in-catalog',profileVersion:1,reason:'invalid'},{profileId:'equilateral-triangle',profileVersion:1,reason:'first legal'},{profileId:'square',profileVersion:1,reason:'alternative'}]
 const choice=availableAISuggestions(o,profiles)[0];assert.equal(choice.profileId,'equilateral-triangle')
 const single=editReviewedPiece(f.review,p.id,acceptedProfilePatch(choice)),batch=adoptAllAIReview(f.review,f.evidence,profiles)
 assert.deepEqual(batch.review.pieces[0],single.pieces[0]);assert.equal(batch.adopted,6);assert.ok(batch.review.pieces.every(p=>p.confirmed&&p.profileId))
 assert.deepEqual(acceptedProfilePatch(null),{profileId:null,profileVersion:null,confirmed:false});assert.deepEqual(f.review,before.review)
})
test('batch preserves manual/confirmed/excluded instances, counts skip reasons and never infers a Profile',async()=>{
 const f=await unknowns(),[a,b,c,d,e,g]=f.review.pieces
 Object.assign(a,{profileId:'right-triangle',profileVersion:1,confirmed:true});Object.assign(b,{excluded:true,shapeFamily:'rectangle',shapeNote:'legacy excluded metadata'});Object.assign(g,{profileId:'square',profileVersion:1})
 f.evidence.observations[2].profileCandidates=[];f.evidence.observations[2].shapeAssessment={family:'square',alternativeFamilies:[],evidence:'family only',perspectiveUncertainty:'unknown size',exactProfileUncertainty:'unknown'}
 f.evidence.observations[3].profileCandidates=[{profileId:'square',profileVersion:999,reason:'unknown version'}]
 const before=structuredClone(f),plan=planAIReview(f.review,f.evidence,profiles),result=adoptAllAIReview(f.review,f.evidence,profiles)
 assert.deepEqual(plan.skips,{confirmed:1,excluded:1,profile:1,noCandidate:2});assert.equal(plan.adopted,1);assert.equal(plan.skipped,5);assert.deepEqual(plan.actions.map(a=>a.id),[e.id])
 for(const id of [a.id,b.id,c.id,d.id,g.id])assert.deepEqual(result.review.pieces.find(p=>p.id===id),before.review.pieces.find(p=>p.id===id))
 assert.deepEqual(f,before);assert.deepEqual(adoptAllAIReview(result.review,f.evidence,profiles).adopted,0)
})
test('batch respects exact versions and keeps geometry/connection invalidation in the existing Review edit path',async()=>{
 const f=await unknowns(),p=f.review.pieces[0],original=profiles.find(p=>p.id==='square'),v2={...structuredClone(original),version:2,vertices:original.vertices.map(([x,y])=>[x*2,y*2])},catalog=[...profiles,v2]
 f.evidence.observations[0].profileCandidates=[{profileId:'square',profileVersion:2,reason:'explicit sized version'}]
 f.review.constraints=structuredClone(f.plan.connections);const before=structuredClone(f),result=adoptAllAIReview(f.review,f.evidence,catalog)
 assert.equal(result.review.pieces[0].profileVersion,2)
 for(let i=0;i<result.review.constraints.length;i++){const c=result.review.constraints[i];assert.equal(c.portA,null);assert.equal(c.portB,null);assert.deepEqual(c.angles,before.review.constraints[i].angles)}
 assert.deepEqual(f,before);assert.equal(result.review.pieces[0].color,p.color)
})
test('a no-op batch returns the same data and treats confirmed Unknown as a protected human decision',async()=>{
 const f=await unknowns();f.review.pieces.forEach(p=>p.confirmed=true);const before=structuredClone(f.review),result=adoptAllAIReview(f.review,f.evidence,profiles)
 assert.equal(result.adopted,0);assert.equal(result.skips.confirmed,6);assert.deepEqual(result.review,before)
})

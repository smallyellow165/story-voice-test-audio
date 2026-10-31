import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {planningParticipation} from '../src/magnetic-tiles/three-d/reconstruction/planning-preflight.ts'
import {editReviewedPiece} from '../src/magnetic-tiles/three-d/reconstruction/rebase-plan.ts'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'

test('only explicit confirmation participates; Profile presence, Unknown and exclusion retain their separate meanings',async()=>{
 const f=await visibleFixture(),draft={...structuredClone(f.review),pieces:f.review.pieces.map(p=>({...p,confirmed:false}))},before=structuredClone(draft),id=draft.pieces[0].id
 assert.equal(planningParticipation(draft).confirmed,0);assert.match(planningParticipation(draft).blocker,/0\/2/)
 const prefill=editReviewedPiece(draft,id,{profileId:'square',profileVersion:1});assert.equal(prefill.pieces[0].confirmed,false,'a generic/AI prefill does not confirm')
 const adopted=editReviewedPiece(draft,id,{profileId:'square',profileVersion:1,confirmed:true});assert.equal(planningParticipation(adopted).confirmed,1)
 const canceled=editReviewedPiece(adopted,id,{confirmed:false});assert.equal(planningParticipation(canceled).confirmed,0)
 const excluded=editReviewedPiece(adopted,id,{excluded:true});assert.equal(excluded.pieces[0].excluded,true);assert.equal(excluded.pieces[0].confirmed,false)
 assert.equal(editReviewedPiece(excluded,id,{profileId:'square',profileVersion:1,confirmed:true}).pieces[0].confirmed,false,'Profile adoption cannot override exclusion')
 assert.equal(editReviewedPiece(excluded,id,{excluded:false}).pieces[0].confirmed,false,'restore does not silently reconfirm')
 const unknown=editReviewedPiece(draft,id,{profileId:null,profileVersion:null,confirmed:true});assert.equal(planningParticipation(unknown).blocker,null);assert.equal(planningParticipation(unknown).knownProfiles,0,'existing confirmed Unknown semantics stay available')
 assert.deepEqual(draft,before)
})

test('saved zero-confirmation Review blocks the provider server-side; partial membership and stale/Hash checks survive',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'visible-confirmation-'));t.after(()=>rm(directory,{recursive:true,force:true}))
 const api=createMagneticIntake(directory),f=await visibleFixture(),source=await api.dispatch('POST','sources',{name:'offline.png',original:png,view:png}),calls=[];let imageReads=0
 const workflow=createVisible3DWorkflow(path.join(directory,'scoped'),{readSource:id=>api.read('sources',id),readImage:async()=>{imageReads++;return png},getRegistry:()=>api.dispatch('GET','profiles'),runModel:async(prepared,options)=>{
  calls.push(prepared);const parts=prepared.input.geometryInput.review.pieces.filter(p=>p.confirmed&&!p.excluded),plan={...f.plan,parts:parts.map(p=>({id:p.id,profileId:p.profileId,profileVersion:p.profileVersion,orientationEvidence:'offline spy fixture'})),connections:[]}
  const trace={id:randomUUID(),sources:options.sources,requestInput:prepared.input,status:'plan_ready_for_review',parseStatus:'parsed',validation:{valid:true},wireStatus:'response_saved',finishReason:'completed',rawOutput:JSON.stringify(plan),plan};await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,trace.id+'.json'),JSON.stringify(trace));return trace
 }})
 const a=await workflow.dispatch('POST','annotate',{sourceId:source.id,evidence:f.evidence}),none={...f.review,pieces:f.review.pieces.map(p=>({...p,confirmed:false}))},r=await workflow.dispatch('POST','reviews',{analysisId:a.id,review:none,expectedRevision:0})
 const body={reviewId:r.record.id,requestId:randomUUID(),model:'gpt-4.1'},blocked=await workflow.dispatch('POST','plan',body)
 assert.equal(blocked.state,'failed');assert.match(blocked.error,/0\/2 个实例已确认/);assert.equal(calls.length,0);assert.equal(imageReads,0);assert.deepEqual(await workflow.dispatch('POST','plan',body),blocked,'existing request dedup remains intact')
 const partial=editReviewedPiece(none,none.pieces[0].id,{confirmed:true}),saved=await workflow.dispatch('POST','reviews',{analysisId:a.id,review:partial,expectedRevision:1}),result=await workflow.dispatch('POST','plan',{reviewId:saved.record.id,requestId:randomUUID(),model:'gpt-4.1'})
 assert.equal(result.usable,true);assert.equal(calls.length,1);assert.deepEqual(calls[0].input.geometryInput,saved.record.input);assert.deepEqual(result.record.plan.parts.map(p=>p.id),[partial.pieces[0].id]);assert.equal(calls[0].input.geometryInput.review.pieces[1].confirmed,false)
 const stale=await workflow.dispatch('POST','plan',{reviewId:r.record.id,requestId:randomUUID(),model:'gpt-4.1'});assert.match(stale.error,/过期/);assert.equal(calls.length,1)
 const stored=(await workflow.dispatch('GET','reviews/'+saved.record.id)).record;assert.deepEqual(stored,saved.record);assert.deepEqual((await workflow.dispatch('GET','analyses/'+a.id)).analysis.evidence,f.evidence)
 const file=path.join(directory,'scoped/reviews',saved.record.id+'.json');await writeFile(file,JSON.stringify({...stored,sourceHash:'tampered'}));const bad=await workflow.dispatch('POST','plan',{reviewId:stored.id,requestId:randomUUID(),model:'gpt-4.1'});assert.match(bad.error,/Hash/);assert.equal(calls.length,1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {visibleV2Fixture,upgradeVisibleFixture} from './magnetic-visible3d-v2-fixtures.mjs'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
import {parseVisibleEvidence,parseSpatialHypothesis,validateVisibleInput} from '../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {buildVisibleRequest,visiblePromptVersion,evidenceSchema,spatialSchema} from '../server/magnetic-visible3d-vision.mjs'

test('V2 supports perspective family independently of unknown Exact Profile and preserves V1 roundtrip',async()=>{
 const legacy=await visibleFixture();assert.deepEqual(parseVisibleEvidence(legacy.evidence),legacy.evidence);assert.deepEqual(parseSpatialHypothesis(legacy.plan,legacy.input),legacy.plan)
 const f=await visibleV2Fixture();f.evidence.observations[0].profileCandidates=[];assert.equal(parseVisibleEvidence(f.evidence).observations[0].shapeAssessment.family,'square')
 f.input.review.pieces[0].profileId=null;f.input.review.pieces[0].profileVersion=null;f.input.review.pieces[0].shapeFamily='square';f.input.review.pieces[0].shapeNote='Human family known, size unknown'
 f.plan.parts[0].profileId=null;f.plan.parts[0].profileVersion=null;f.plan.connections=f.plan.connections.filter(c=>c.pieceA!==f.plan.parts[0].id&&c.pieceB!==f.plan.parts[0].id)
 const r=executeVisible3D(f.plan,f.input);assert.ok(r.candidates.length);assert.ok(r.candidates.every(c=>!c.assembly.pieces.some(p=>p.id===f.plan.parts[0].id)))
})
test('V2 visible metadata validates evidence references, distinct layers and bounded corner/edge points',async()=>{
 const f=await visibleV2Fixture();assert.deepEqual(parseVisibleEvidence(f.evidence),f.evidence)
 for(const change of [e=>e.spatialInterpretation.faces[0].pieceId='hidden-face',e=>e.spatialInterpretation.hiddenStructureHypotheses[0].pieces=[],e=>e.spatialInterpretation.connections[0].featureA='invented',e=>e.spatialInterpretation.overallShapeHypotheses[0].visiblePieceIds.push('hidden-face'),e=>e.observations[0].features[0].points.push([.2,.3]),e=>e.observations[0].shapeAssessment.family='cube',e=>e.spatialInterpretation.camera.position=[0,0,0]]){
  const e=structuredClone(f.evidence);change(e);assert.throws(()=>parseVisibleEvidence(e))
 }
})
test('V2 human shape/scene corrections persist without changing fixed geometry identity',async()=>{
 const f=await visibleV2Fixture();f.input.review.pieces[0].shapeFamily='rectangle';f.input.review.pieces[0].shapeNote='Human correction';f.input.review.interpretationReview={status:'corrected',note:'Open corner, not a confirmed full enclosure'}
 assert.deepEqual(validateVisibleInput(f.input),f.input);assert.deepEqual(parseSpatialHypothesis(f.plan,f.input).parts,f.plan.parts)
 const bad=structuredClone(f.plan);bad.parts.push({...bad.parts[0],id:'hidden-face'});assert.throws(()=>parseSpatialHypothesis(bad,f.input),/不得改变/)
 const excluded=structuredClone(f.input);excluded.review.pieces[0].excluded=true;assert.throws(()=>parseSpatialHypothesis(f.plan,excluded),/不得改变|连接/)
})
test('hidden hypotheses are non-executable; three actual panels and the closing edge remain valid',async()=>{
 const f=await visibleV2Fixture(),before=JSON.stringify(f),r=executeVisible3D(f.plan,f.input)
 assert.equal(r.status,'candidates_found');assert.equal(r.candidates[0].assembly.pieces.length,3);assert.equal(r.candidates[0].assembly.connections.length,3);assert.equal(r.candidates[0].photoMatch.status,'unverified')
 f.evidence.spatialInterpretation.hiddenStructureHypotheses=[];f.plan.spatialInterpretation.hiddenStructureHypotheses=[]
 assert.deepEqual(executeVisible3D(f.plan,f.input),r);assert.notEqual(JSON.stringify(f),before)
})
test('V2 alternatives use existing engine; wrong closure remains rejected without modifying source',async()=>{
 const f=upgradeVisibleFixture(await visibleFixture()),before=JSON.stringify(f);f.plan.connections[0].angles=[90,-90]
 const r=executeVisible3D(f.plan,f.input);assert.equal(r.candidates.length,2);assert.ok(r.candidates.every(c=>c.geometry.valid));assert.notEqual(JSON.stringify(f),before)
 const three=await visibleV2Fixture();three.plan.connections[2].angles=[45];assert.deepEqual(executeVisible3D(three.plan,three.input).candidates,[])
})
test('V2 requests use existing two model tasks and explicit bounded features, legacy 2D prompt untouched',async()=>{
 const f=await visibleV2Fixture(),prepared={image:png,input:{geometryInput:f.input,catalog:f.assembly.profiles}}
 assert.match(visiblePromptVersion,/v2/);assert.equal(evidenceSchema.properties.version.enum[0],2);assert.equal(spatialSchema.properties.version.enum[0],2)
 assert.equal(evidenceSchema.properties.observations.items.properties.features.items.properties.points.maxItems,2)
 for(const kind of ['analysis','plan'])for(const model of ['gpt-4.1','gemini-3.6-flash']){const r=buildVisibleRequest(model,prepared,kind);assert.equal(r.model,model);const text=r.instructions??r.config.systemInstruction;assert.match(text,/SHAPE|Profile/);assert.match(text,/HIDDEN STRUCTURE/)}
})
test('V2 review, selected full-plan alternative, stale protection and immutable derived-plan provenance',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'visible-v2-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));const api=createMagneticIntake(directory),f=await visibleV2Fixture(),post=(route,b)=>api.dispatch('POST','visible3d/'+route,b),source=await api.dispatch('POST','sources',{name:'syntheticV2.png',original:png,view:png})
 const a=await post('annotate',{sourceId:source.id,evidence:f.evidence});f.review.pieces[0].shapeFamily='square';f.review.pieces[0].shapeNote='Human confirmed family';f.review.interpretationReview={status:'accepted',note:'Visible corner only'}
 const r=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:0}),p=await post('manual-plan',{reviewId:r.record.id,plan:f.plan})
 const derived=await post('manual-plan',{reviewId:r.record.id,basedOnPlanId:p.id,plan:f.plan});assert.equal(derived.basedOnPlanId,p.id);assert.equal(derived.basedOnPlanHash,p.hash)
 const x=await post('execute',{planId:derived.id,requestId:randomUUID()});assert.equal(x.record.candidates[0].assembly.pieces.length,3)
 const origin=await post('adopt',{executionId:x.record.id,candidateId:'candidate-1',visualChecked:true});assert.equal(origin.assembly.pieces.length,3)
 await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:1});await assert.rejects(post('manual-plan',{reviewId:r.record.id,basedOnPlanId:p.id,plan:f.plan}),/过期/)
})

import {canonicalGeometryManifest,canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {sourceImages,assertImageEvidence} from '../src/magnetic-tiles/intake/image-set.ts'
import {parseVisibleEvidence} from '../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {evidenceForImage} from '../src/magnetic-tiles/three-d/reconstruction/image-evidence.ts'
import {multiFixture} from './magnetic-multi-image-fixtures.mjs'
import {buildVisibleRequest,observationPrompt,planningPrompt} from '../server/magnetic-visible3d-vision.mjs'
import {recognitionRequest,multiRecognitionRequest,prompt} from '../server/magnetic-intake-vision.mjs'
import {multiImagePrompt,multiImagePromptVersion} from '../server/magnetic-multi-image-vision.mjs'
import {parseEvidence} from '../src/magnetic-tiles/intake/contracts.ts'

async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'magnetic-multi-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,...await multiFixture(dir)}}
test('immutable shared Source collections retain order, roles, views, notes and byte identity across restart',async t=>{
 const f=await setup(t),reboot=createMagneticIntake(f.dir),loaded=await reboot.dispatch('GET','sources/'+f.source.id);assert.deepEqual(loaded,f.source);assert.equal(loaded.images.length,4);assert.equal(loaded.primaryImageId,f.sources[0].id)
 const again=await reboot.dispatch('POST','source-sets',{images:f.images});assert.deepEqual(again,f.source)
 const order=await reboot.dispatch('POST','source-sets',{images:[...f.images].reverse()});assert.notEqual(order.hash,loaded.hash);assert.equal(order.primaryImageId,f.sources[0].id)
 const note=await reboot.dispatch('POST','source-sets',{images:f.images.map((e,i)=>i?e:{...e,note:'Changed'})});assert.notEqual(note.id,loaded.id)
 const h=await reboot.dispatch('GET','visible3d/history');assert.equal(h.analyses.length,0,'no Vision invocation while selecting/editing sources')
})
test('server enforces collection bounds, duplicates, exact source hashes, metadata and non-nesting',async t=>{
 const f=await setup(t)
 for(const images of [[],[...f.images,f.images[0]],[f.images[0],f.images[0]],[{...f.images[0],sourceHash:'bad'}],[{...f.images[0],note:'x'.repeat(501)}],[{...f.images[0],direction:'random'}],[{...f.images[0],role:'Imaginary'}],[{...f.images[0],sourceId:f.source.id,sourceHash:f.source.hash}]])await assert.rejects(f.api.dispatch('POST','source-sets',{images}))
})
test('one request includes four labeled images for both providers; single-image request and prompts unchanged',async t=>{
 const f=await setup(t)
 for(const model of ['gpt-6.1-sol','gemini-3.6-flash']){
  const request=buildVisibleRequest(model,f.prepared,'analysis'),text=JSON.stringify(request);assert.ok(text.includes(JSON.stringify(multiImagePrompt).slice(1,-1)));assert.ok(text.includes('referenceImageId'))
  assert.equal(model.startsWith('gpt')?request.input[0].content.filter(c=>c.type==='input_image').length:request.contents[0].parts.filter(p=>p.inlineData).length,4)
  const planar=multiRecognitionRequest(model,f.prepared.images,f.source);assert.ok(JSON.stringify(planar).includes(JSON.stringify(multiImagePrompt).slice(1,-1)))
  const single={image:f.prepared.image,input:{catalog:f.prepared.input.catalog}},legacy=buildVisibleRequest(model,single,'analysis');assert.ok(JSON.stringify(legacy).includes(JSON.stringify(observationPrompt).slice(1,-1)));assert.ok(!JSON.stringify(legacy).includes(JSON.stringify(multiImagePrompt).slice(1,-1)))
  assert.ok(JSON.stringify(recognitionRequest(model,f.prepared.image)).includes(JSON.stringify(prompt).slice(1,-1)));f.prepared.input.geometryContract=canonicalGeometryManifest(f.prepared.input.catalog.map(canonicalProfileSnapshot));assert.ok(JSON.stringify(buildVisibleRequest(model,f.prepared,'plan')).includes(JSON.stringify(planningPrompt).slice(1,-1)))
 }
 // Regression fingerprints are pinned from pre-change HEAD exports, independent of multi-image prompt.
 assert.equal(createHash('sha256').update(prompt).digest('hex'),'4ade987533137ac510ef46523c202b5617c29d51587840cbeb6ca2ee8f6ee8fb')
 assert.equal(createHash('sha256').update(observationPrompt).digest('hex'),'d9cfbad84d3e582ac2c16fac5ac06e6165832cb0b2a949437e853998a39b9366')
})
test('per-image evidence projects only the selected frame, preserves canonical data and rejects foreign/mixed coordinates',async t=>{
 const f=await setup(t),original=JSON.stringify(f.evidence),e=parseVisibleEvidence(f.evidence);assertImageEvidence(e,f.source)
 const a=evidenceForImage(e,f.sources[1].id,f.sources[0].id);assert.deepEqual(a.observations[0].bbox,e.observations[0].imageEvidence[1].bbox);assert.notDeepEqual(a.observations[0].bbox,e.observations[0].bbox);assert.equal(JSON.stringify(f.evidence),original)
 assert.deepEqual(evidenceForImage(e,'missing',f.sources[0].id).observations,[])
 const bad=structuredClone(e);bad.observations[0].imageEvidence[0].bbox=[0,0,.1,.1];assert.throws(()=>parseVisibleEvidence(bad),/主图/)
 const foreign=structuredClone(e);foreign.observations[0].imageEvidence[0].imageId='a'.repeat(64);assert.throws(()=>assertImageEvidence(foreign,f.source),/来源/)
 const absent=structuredClone(e);const o=absent.observations[0];o.imageEvidence.shift();o.bbox=null;o.features=[];absent.spatialInterpretation.connections.forEach(c=>{c.featureA=null;c.featureB=null});assert.doesNotThrow(()=>parseVisibleEvidence(absent),'step-visible final occlusion does not fabricate a final bbox')
 const noProof=structuredClone(e);noProof.observations[0].imageEvidence=[];noProof.observations[0].bbox=null;noProof.observations[0].features=[];assert.throws(()=>parseVisibleEvidence(noProof),/可见/)
})
test('joint canonical record travels through existing Review, Planning, Execution and Adopt with immutable group provenance',async t=>{
 const f=await setup(t),calls=[]
 const workflow=createVisible3DWorkflow(path.join(f.dir,'visible3d'),{readSource:id=>f.api.dispatch('GET','sources/'+id),readImage:s=>f.api.dispatch('GET','image/'+s.id),readImages:s=>Promise.all(sourceImages(s).map(async e=>({...e,...await f.api.dispatch('GET','image/'+e.sourceId)}))),getRegistry:()=>f.api.dispatch('GET','profiles'),runModel:async(prepared,options,kind)=>{
  calls.push({prepared,kind});const value=kind==='analysis'?f.evidence:f.plan,id=randomUUID(),trace={id,task:'magnetic-visible3d-'+kind,promptVersion:kind==='analysis'?multiImagePromptVersion:'magnetic-visible3d-v2-spatial-understanding',status:'plan_ready_for_review',parseStatus:'parsed',validation:{valid:true,issues:[]},wireStatus:'response_saved',finishReason:'completed',requestInput:prepared.input,request:buildVisibleRequest(options.model,prepared,kind),plan:value,rawOutput:JSON.stringify(value),usageMetadata:{fixture:true,inputTokens:0,outputTokens:0}}
  await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,id+'.json'),JSON.stringify(trace));return trace
 }})
 const post=(route,body)=>workflow.dispatch('POST',route,body),a=await post('analyze',{sourceId:f.source.id,model:'gpt-6.1-sol',requestId:randomUUID()});assert.equal(a.usable,true);assert.equal(a.state,'complete');assert.equal(a.record.evidence.observations.length,2);assert.equal(calls.length,1);assert.equal(calls[0].prepared.images.length,4)
 const review=await post('reviews',{analysisId:a.record.id,review:f.review,thickness:.06,expectedRevision:0}),plan=await post('plan',{reviewId:review.record.id,model:'gpt-6.1-sol',requestId:randomUUID()});assert.equal(calls.length,2);assert.equal(calls[1].prepared.input.geometryInput.evidence.observations[0].imageEvidence.length,4)
 const x=await post('execute',{planId:plan.record.id,requestId:randomUUID()}),o=await post('adopt',{executionId:x.record.id,candidateId:x.record.candidates[0].id,visualChecked:true});assert.equal(o.assembly.pieces.length,2);assert.equal(o.sourceId,f.source.id);assert.equal(o.sourceHash,f.source.hash)
 const restarted=createMagneticIntake(f.dir);assert.deepEqual(await restarted.dispatch('GET','visible3d/origins/'+o.id),o)
 const changed=await restarted.dispatch('POST','source-sets',{images:f.images.slice(0,3)});assert.notEqual(changed.hash,f.source.hash);assert.equal((await restarted.dispatch('GET','visible3d/history')).analyses.filter(a=>a.sourceId===changed.id).length,0)
})
test('2D supplemental polygons are bounded and do not rewrite the canonical outline',()=>{
 const o={id:'t1',profileId:'square',profileVersion:1,color:'#abc123',outline:[[0,0],[1,0],[1,1],[0,1]],confidence:.8,evidence:'visible',uncertainty:'',origin:'observed',excluded:false,imageEvidence:[{imageId:'a'.repeat(64),outline:[[.1,.1],[.5,.1],[.5,.5],[.1,.5]],evidence:'same tile in a different image',uncertainty:'identity uncertain'}]},e={sourceKind:'flat_photo',reason:'',observations:[o],relations:[]}
 assert.deepEqual(parseEvidence(e),e);const bad=structuredClone(e);bad.observations[0].imageEvidence[0].outline[0]=[2,0];assert.throws(()=>parseEvidence(bad),/证据/)
})
test('multi-image count extension is bounded; step-only proof remains usable by the unchanged solver',async t=>{
 const f=await setup(t),e=structuredClone(f.evidence);e.observations=Array.from({length:25},(_,i)=>({...structuredClone(e.observations[0]),id:'tile'+i}));const s=e.spatialInterpretation;s.faces=[];s.connections=[];s.overallShapeHypotheses=[];s.alternatives=[];assert.equal(parseVisibleEvidence(e).observations.length,25)
 const legacy=structuredClone(e);delete legacy.referenceImageId;assert.throws(()=>parseVisibleEvidence(legacy),/范围/)
 const tooMany=structuredClone(e);tooMany.observations.push({...structuredClone(e.observations[0]),id:'tile26'});assert.throws(()=>parseVisibleEvidence(tooMany),/范围/)
 const onlyStep=structuredClone(f.evidence);for(const o of onlyStep.observations){o.imageEvidence.shift();o.bbox=null;o.features=[]}onlyStep.spatialInterpretation.connections.forEach(c=>{c.featureA=null;c.featureB=null})
 const a=await f.api.dispatch('POST','visible3d/annotate',{sourceId:f.source.id,evidence:onlyStep}),r=await f.api.dispatch('POST','visible3d/reviews',{analysisId:a.id,review:f.review,expectedRevision:0}),plan=structuredClone(f.plan);plan.connections.forEach(c=>c.evidenceRefs=[c.pieceA,c.pieceB]);plan.spatialInterpretation.connections.forEach(c=>{c.featureA=null;c.featureB=null})
 const p=await f.api.dispatch('POST','visible3d/manual-plan',{reviewId:r.record.id,plan}),x=await f.api.dispatch('POST','visible3d/execute',{planId:p.id,requestId:randomUUID()});assert.equal(x.record.candidates[0].coverage.reconstructed.length,2)
})
test('collection display filenames support an upload/library alias without duplicating image bytes',async t=>{
 const f=await setup(t),entry={...f.images[0],name:'uploaded-final-alias.png',origin:'upload'},group=await f.api.dispatch('POST','source-sets',{images:[entry]});assert.equal(group.name,entry.name);assert.equal(group.images[0].sourceId,f.sources[0].id);assert.equal(group.images[0].sourceHash,f.sources[0].hash);assert.equal(group.view.hash,f.sources[0].view.hash)
 await assert.rejects(f.api.dispatch('POST','source-sets',{images:[{...entry,name:'x'.repeat(256)}]}),/元数据/)
})
test('reference feature geometry is insensitive to JSON property/feature ordering and explanatory wording',async t=>{
 const f=await setup(t),e=structuredClone(f.evidence),o=e.observations[0],a=o.imageEvidence[0];o.features.push({id:'corner',points:[[.1,.2]],visibility:'visible',note:'Canonical corner'});a.features=[{note:'Frame-specific description',visibility:'visible',points:[[.1,.2]],id:'corner'},{note:'Different summary of the same edge',visibility:o.features[0].visibility,points:o.features[0].points,id:o.features[0].id}];assert.doesNotThrow(()=>parseVisibleEvidence(e))
 a.features[0].points[0][0]+=.01;assert.throws(()=>parseVisibleEvidence(e),/主图坐标/)
})

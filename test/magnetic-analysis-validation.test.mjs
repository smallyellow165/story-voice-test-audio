import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {multiFixture} from './magnetic-multi-image-fixtures.mjs'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {prepareAnalysisEvidence,validateAnalysisEvidence} from '../server/magnetic-analysis-validation.mjs'
import {parseVisibleEvidence,validateVisibleInput} from '../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {analysisHistoryEntries,analysisDisplay} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-display.ts'

const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'analysis-validation-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,...await multiFixture(dir)}}
function missingAlias(f){const raw=structuredClone(f.evidence);raw.observations.forEach(o=>o.imageEvidence.find(e=>e.imageId===raw.referenceImageId).features=[]);return raw}
async function oldRequest(f,raw=missingAlias(f),extra={}){
 const trace={id:randomUUID(),status:'invalid_plan',parseStatus:'parsed',wireStatus:'response_saved',finishReason:'completed',error:null,validation:{valid:false,issues:['主图坐标必须与对应图片证据一致']},requestInput:f.prepared.input,sources:[{sourceId:f.source.id,sourceHash:f.source.hash}],rawOutput:JSON.stringify(raw),plan:raw,background:{state:'completed',responseId:'resp_offline_retained'},usageMetadata:{total_tokens:123},...extra}
 const request={id:randomUUID(),kind:'analyze',createdAt:new Date().toISOString(),sourceId:f.source.id,sourceHash:f.source.hash,state:'failed',usable:false,error:'主图坐标必须与对应图片证据一致',trace}
 const base=path.join(f.dir,'visible3d');await mkdir(path.join(base,'model-traces'),{recursive:true});await mkdir(path.join(base,'requests'),{recursive:true});
 const file=path.join(base,'model-traces',trace.id+'.json');await writeFile(file,JSON.stringify(trace));await writeFile(path.join(base,'requests',request.id+'.json'),JSON.stringify(request));return {trace,request,file,bytes:await readFile(file)}
}
const resume=(f,request,api=f.api,extra={})=>api.dispatch('POST','visible3d/resume-analyze',{requestId:request.id,sourceId:f.source.id,sourceHash:f.source.hash,...extra})

test('reference aliases are projected explicitly; all source evidence and raw coordinates remain intact',async t=>{
 const f=await setup(t),raw=missingAlias(f),before=structuredClone(raw),p=prepareAnalysisEvidence(raw,f.source)
 assert.deepEqual(raw,before);assert.deepEqual(p.rawEvidence,raw);assert.equal(p.analysisValidation.state,'reviewable');assert.equal(p.analysisValidation.diagnostics.length,raw.observations.length)
 for(const [i,o] of p.evidence.observations.entries()){
  assert.deepEqual(o.features,raw.observations[i].features);assert.deepEqual(o.bbox,raw.observations[i].bbox)
  assert.deepEqual(o.imageEvidence.slice(1),raw.observations[i].imageEvidence.slice(1),'secondary/Step coordinates never borrowed or rewritten')
  assert.deepEqual(o.imageEvidence[0].features,o.features)
 }
 assert.throws(()=>parseVisibleEvidence(raw),/主图坐标/,'strict geometry input still rejects unprojected aliases')
 assert.doesNotThrow(()=>validateVisibleInput({evidence:p.evidence,review:f.review,profiles:f.input.profiles}))
 assert.deepEqual(prepareAnalysisEvidence(f.evidence,f.source).evidence,f.evidence)
 assert.equal(prepareAnalysisEvidence(f.evidence,f.source).rawEvidence,undefined)
})
test('safe annotation disagreement is diagnosed; malformed coordinates and broken references stay blocking',async t=>{
 const f=await setup(t),raw=missingAlias(f)
 raw.observations[0].imageEvidence[0].bbox=[.2,.2,.3,.3]
 assert.equal(validateAnalysisEvidence(raw,f.source).state,'reviewable')
 for(const mutate of [
  v=>v.observations[0].features[0].points[0][0]=1.5,
  v=>v.observations.push(structuredClone(v.observations[0])),
  v=>v.observations[0].imageEvidence[0].imageId='foreign-image',
  v=>v.referenceImageId='foreign-image',
  v=>v.observations[0].imageEvidence=[],
  v=>v.observations[0].imageEvidence.shift(),
  v=>v.spatialInterpretation.faces[0].pieceId='missing-observation',
  v=>v.observations[0].features[0].id='changed-feature',
 ]){
  const bad=structuredClone(raw);mutate(bad);const result=validateAnalysisEvidence(bad,f.source)
  assert.equal(result.valid,false,JSON.stringify(result));assert.equal(result.state,'blocked')
 }
})
test('a completed invalid_plan recovers offline, saves Review, is immutable/idempotent and follows only its workspace receipt',async t=>{
 const f=await setup(t),old=await oldRequest(f),originalFetch=globalThis.fetch
 globalThis.fetch=()=>{throw Error('NO NETWORK ALLOWED')};t.after(()=>globalThis.fetch=originalFetch)
 assert.equal((await f.api.dispatch('GET','visible3d/history')).analyses.length,0)
 assert.match(analysisHistoryEntries([{...old.request,projectId:'test-project'}],[],'test-project')[0].label,/Validation Failed/)
 const recovered=await resume(f,old.request)
 assert.equal(recovered.usable,true);assert.equal(recovered.state,'complete');assert.equal(recovered.error,null)
 assert.equal(recovered.record.id,old.trace.id);assert.equal(recovered.trace.status,'invalid_plan');assert.equal(recovered.trace.validation.valid,false)
 assert.equal(recovered.record.analysisValidation.state,'reviewable');assert.deepEqual(recovered.record.rawEvidence,old.trace.plan)
 assert.deepEqual(await readFile(old.file),old.bytes);assert.equal(recovered.record.traceHash,digest(old.trace))
 assert.match(analysisDisplay(recovered).label,/Reviewable/)
 const restored=createMagneticIntake(f.dir);assert.deepEqual(await resume(f,old.request,restored),recovered)
 const records=await restored.dispatch('GET','visible3d/history');assert.equal(records.analyses.length,1);assert.equal(records.plans.length,0);assert.equal(records.executions.length,0)
 const own=await restored.dispatch('POST','visible3d/workspace-history',{refs:[],requestIds:[old.request.id]})
 assert.equal(own.analyses[0].hash,recovered.record.hash);assert.equal(analysisHistoryEntries(own.requests.map(r=>({...r,projectId:'test-project'})),own.analyses.map(r=>({...r,projectId:'test-project'})),'test-project').length,1)
 const other=await restored.dispatch('POST','visible3d/workspace-history',{refs:[],requestIds:[]});assert.deepEqual(other.analyses,[]);assert.deepEqual(other.requests,[])
 const review=await restored.dispatch('POST','visible3d/reviews',{analysisId:recovered.record.id,review:f.review,expectedRevision:0})
 assert.equal(review.record.analysisHash,recovered.record.hash);assert.deepEqual(review.record.input.evidence,recovered.record.evidence)
 assert.deepEqual(await readFile(old.file),old.bytes)
 // Even rehashing a tampered projection cannot sever its raw Trace binding.
 const file=path.join(f.dir,'visible3d/analyses',recovered.record.id+'.json'),changed=structuredClone(recovered.record)
 changed.evidence.observations[0].bbox[0]+=.001;const {hash,...payload}=changed;await writeFile(file,JSON.stringify({...payload,hash:digest(payload)}))
 await assert.rejects(restored.dispatch('GET','visible3d/analyses/'+changed.id),/规范化结果/)
})
test('recovery rejects wrong hashes, foreign frames, raw/parsed mismatch and changed image sets without network',async t=>{
 const f=await setup(t),originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('NO NETWORK ALLOWED')};t.after(()=>globalThis.fetch=originalFetch)
 let old=await oldRequest(f);await assert.rejects(resume(f,old.request,f.api,{sourceHash:'wrong'}),/来源不一致/)
 const foreign=missingAlias(f);foreign.observations[0].imageEvidence[0].imageId='foreign';old=await oldRequest(f,foreign)
 assert.equal((await resume(f,old.request)).usable,false)
 old=await oldRequest(f,undefined,{rawOutput:JSON.stringify({...f.evidence,unknowns:['different raw']})});assert.equal((await resume(f,old.request)).usable,false)
 const mismatchedInput=structuredClone(f.prepared.input);mismatchedInput.images[0].sourceHash='wrong'
 old=await oldRequest(f,undefined,{requestInput:mismatchedInput});await assert.rejects(resume(f,old.request),/图片集合与来源不一致/)
 assert.equal((await f.api.dispatch('GET','visible3d/history')).analyses.length,0)
})

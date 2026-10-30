import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {vertices,edges,alignEdge,validate,distance,matched} from '../src/magnetic-tiles/geometry.ts'
import {diagnosticCollector} from '../src/magnetic-tiles/intake/execution-trace.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {cases,evidenceFor} from './fixtures/magnetic-intake/cases.mjs'
const rose=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/rose-relative-size.json',import.meta.url),'utf8'))
const evidence=structuredClone(rose.evidence);evidence.sourceKind='diagram'
for(const [id,profileId] of [['p1','tall-right-triangle'],['p2','large-equilateral-triangle'],['p3','tall-right-triangle']])evidence.observations.find(o=>o.id===id).profileId=profileId
const variants=v=>[v,[...v].reverse()].flatMap(a=>a.map((_,i)=>[...a.slice(i),...a.slice(0,i)]))
const polygonKey=(tiles,catalog)=>tiles.map(t=>t.id+':'+vertices(t,catalog).map(v=>v.map(x=>x.toFixed(7)).join(',')).sort().join(';')).sort().join('|')
for(const [mode,trials,bestRms] of [['connected-construction',474,.5910235265278042],['flat-mosaic',165,.6069919541805159]])test('observed rose attempts: '+mode,()=>{
 const r=reconstruct(evidence,792,977,profiles,'rose',mode,{mirroring:false})
 assert.equal(r.explored,10);assert.equal(r.trials,trials);assert.equal(r.candidates.length,0);assert.equal(r.truncated,false)
 assert.equal(r.diagnosticCandidates.length,10);assert.ok(JSON.stringify(r).length<200000)
 assert.equal(new Set(r.diagnosticCandidates.map(d=>polygonKey(d.tiles,profiles))).size,10)
 assert.deepEqual(r.trace.input.evidence,evidence);assert.equal(r.trace.planning.modelGenerated,false)
 const p3=r.trace.planning.observations.find(o=>o.id==='p3');assert.equal(p3.mirrorHypothesis.mirrored,true)
 assert.equal(r.trace.search.parameters.mirroring,false)
 const first=r.diagnosticCandidates[0];assert.equal(first.attemptedConnection.from,'p3');assert.equal(first.attemptedConnection.to,'p6');assert.ok(Math.abs(first.attemptedTileRms-bestRms)<1e-12)
 assert.equal(first.layout,'partial');assert.equal(first.tiles.length,mode==='flat-mosaic'?2:11)
 for(const d of r.diagnosticCandidates){
  assert.equal(d.provenance,'observed-search-attempt');assert.ok(d.attemptIndex<=r.trials&&d.stateIndex<=r.explored)
  assert.equal(d.tiles.length+d.unplacedIds.length,14);assert.deepEqual(d.placedIds,d.tiles.map(t=>t.id))
  const a=d.attemptedConnection,tile=d.tiles.find(t=>t.id===a.from),target=d.tiles.find(t=>t.id===a.to),own=edges(tile,profiles).find(e=>e.id===a.ownEdgeId),edge=edges(target,profiles).find(e=>e.id===a.targetEdgeId)
  assert.ok(matched(own,edge));assert.deepEqual(alignEdge(tile,own,edge,profiles).pose,tile.pose)
  const o=evidence.observations.find(o=>o.id===tile.id),image=o.outline.map(([x,y])=>[x*792/r.trace.planning.scalePixelsPerUnit,-y*977/r.trace.planning.scalePixelsPerUnit]),world=vertices(tile,profiles)
  const rms=Math.min(...variants(image).map(v=>Math.sqrt(world.reduce((n,p,i)=>n+distance(p,v[i])**2,0)/v.length)))
  assert.ok(Math.abs(rms-d.attemptedTileRms)<1e-12);assert.ok(rms>.3);assert.equal(d.failureStage,'outline')
  assert.equal(d.validator.checkedBy,'diagnostic-recheck');assert.deepEqual(d.validator.report,validate(d.tiles,profiles))
 }
 assert.deepEqual(reconstruct(evidence,792,977,profiles,'rose',mode,{mirroring:false}),r)
})
test('admission, fitting, budget and valid candidates remain distinct; capture does not create missing layouts',()=>{
 const unsupported=reconstruct({...evidence,sourceKind:'unsupported'},792,977,profiles,'u');assert.equal(unsupported.trace.phase,'admission');assert.deepEqual(unsupported.diagnosticCandidates,[]);assert.equal(unsupported.trace.planning.fittedSeeds,undefined)
 const f=evidenceFor(cases[0].tiles,profiles,vertices,validate),ok=reconstruct(f.evidence,f.width,f.height,profiles,'valid');assert.ok(ok.candidates.length);assert.equal(validate(ok.candidates[0].assembly.instances,profiles).valid,true)
 const bad=structuredClone(f.evidence);bad.relations[0].intent='separate';const conflict=reconstruct(bad,f.width,f.height,profiles,'conflict');assert.equal(conflict.candidates.length,0);assert.ok(conflict.diagnosticCandidates.some(d=>d.failureStage==='relation'&&d.validator.checkedBy==='search'))
 const limited=reconstruct(evidence,792,977,profiles,'limited','connected-construction',{trials:1});assert.equal(limited.truncated,true);assert.equal(limited.trials,1);assert.ok(limited.diagnosticCandidates.every(d=>d.attemptIndex<=1));assert.ok(limited.diagnosticCandidates.length<=10)
})
test('immutable persisted execution, small history, redacted raw traces, legacy availability and diagnostic non-adoption',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'magnetic-trace-'))
 try{
  const api=createMagneticIntake(dir)
  async function seed(kind,payload){const r={...payload,hash:await contentHash(payload)};await mkdir(path.join(dir,kind),{recursive:true});await writeFile(path.join(dir,kind,r.id+'.json'),JSON.stringify(r));return r}
  const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),view:{width:792,height:977},createdAt:new Date().toISOString()})
  const a=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',evidence:rose.evidence,rawOutput:JSON.stringify(rose.evidence),request:{authorization:'Bearer private-unit-test-token',imageBase64:'UNIT_IMAGE_BYTES'},createdAt:new Date().toISOString()})
  const review=await api.dispatch('POST','reviews',{analysisId:a.id,analysisHash:a.hash,evidence})
  const r=await api.dispatch('POST','reconstruct',{reviewId:review.id,reviewHash:review.hash,mode:'flat-mosaic'})
  const next=createMagneticIntake(dir);assert.deepEqual(await next.read('reconstructions',r.id),r)
  assert.equal(r.trace.references.reviewHash,review.hash);assert.equal(r.trace.references.sourceHash,source.hash);assert.equal(r.trace.references.reconstructionId,r.id)
  const history=await next.dispatch('GET','history'),summary=history.reconstructions.find(v=>v.id===r.id);assert.equal(summary.trace,undefined);assert.equal(summary.diagnosticCandidates,undefined);assert.equal(summary.diagnosticCount,10);assert.equal(summary.traceAvailable,true)
  const raw=await next.dispatch('GET','trace/reviews/'+review.id);assert.ok(raw.text.includes('REDACTED'));assert.ok(raw.text.includes('IMAGE BASE64 OMITTED'));assert.ok(!raw.text.includes('private-unit-test-token'));assert.ok(!raw.text.includes('UNIT_IMAGE_BYTES'));assert.equal(JSON.parse(raw.text).savedFieldAvailability.response,false)
  const exec=JSON.parse((await next.dispatch('GET','trace/reconstructions/'+r.id)).text);assert.equal(exec.references.reconstruction.hash,r.hash);assert.deepEqual(exec.execution.diagnosticCandidates,r.diagnosticCandidates)
  await assert.rejects(next.dispatch('POST','origins',{reconstructionId:r.id,reconstructionHash:r.hash,candidateId:r.diagnosticCandidates[0].id,visualChecked:true,assembly:{}}),/选择候选/)
  const {hash:ignoredHash,...badTrace}=structuredClone(r);badTrace.id=crypto.randomUUID();badTrace.trace.references.reconstructionId=badTrace.id;badTrace.trace.references.reviewHash='wrong'
  const invalid=await seed('reconstructions',badTrace);await assert.rejects(next.dispatch('GET','trace/reconstructions/'+invalid.id),/Trace 输入或来源/)
  const {id,hash,trace,diagnosticCandidates,...payload}=r,legacy=await seed('reconstructions',{...payload,id:crypto.randomUUID()})
  const old=JSON.parse((await next.dispatch('GET','trace/reconstructions/'+legacy.id)).text);assert.equal(old.available,false);assert.match(old.note,/not fabricated/)
  const missing=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'failed',createdAt:new Date().toISOString()})
  const unavailable=JSON.parse((await next.dispatch('GET','trace/analyses/'+missing.id+'/planning')).text);assert.equal(unavailable.available,false);assert.equal(unavailable.planning,null)
  assert.equal((await next.read('analyses',a.id)).hash,a.hash);assert.equal((await next.read('reviews',review.id)).hash,review.hash)
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('bounded diagnostic dedup collapses equivalent rotations and signed-zero noise',()=>{
 const c=diagnosticCollector(profiles),tile={...cases[0].tiles[0],id:'same'},offer={tiles:[tile],phase:'edge-alignment',failureStage:'outline',reason:'unit rejected sample',attemptIndex:1,stateIndex:1,attemptedTileRms:1}
 c.offer(offer);c.offer({...offer,attemptIndex:2,tiles:[{...tile,pose:{...tile.pose,angleRad:Math.PI*2}}]});c.offer({...offer,domainBlocked:true})
 assert.equal(c.count,2);const out=c.finish(['same'],[],()=>1,tiles=>validate(tiles,profiles));assert.equal(out.length,1);assert.equal(out[0].domainBlocked,true)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {vertices,validate,edges,alignEdge} from '../src/magnetic-tiles/geometry.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {reconstructionSummary} from '../src/magnetic-tiles/intake/contracts.ts'
import {cases,evidenceFor,tile} from './fixtures/magnetic-intake/cases.mjs'
const modes=['connected-construction','flat-mosaic']

test('unsupported Analysis stays immutable; explicit Review classification is saved and consumed, without changing Selected',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'magnetic-review-admission-'))
 try{
  const f=evidenceFor(cases[0].tiles,profiles,vertices,validate),api=createMagneticIntake(dir)
  async function seed(kind,payload){const r={...payload,hash:await contentHash(payload)};await mkdir(path.join(dir,kind),{recursive:true});await writeFile(path.join(dir,kind,r.id+'.json'),JSON.stringify(r));return r}
  const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),view:{width:f.width,height:f.height},createdAt:new Date().toISOString()})
  const original={...f.evidence,sourceKind:'unsupported',reason:'Unconfirmed planar scope / potential 3D'}
  const analysis=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',evidence:original,createdAt:new Date().toISOString()})
  const snapshot=await api.dispatch('POST','reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence:original})
  const selected=await api.dispatch('POST','selected',{sourceId:source.id,stage:'review',snapshotId:snapshot.id,expectedRevision:0})
  const readBytes=(kind,id)=>readFile(path.join(dir,kind,id+'.json'),'utf8')
  const bytes=await Promise.all([readBytes('analyses',analysis.id),readBytes('reviews',snapshot.id)])
  // Even all Known and an explicitly saved Review do not themselves confirm a planar input.
  for(const mode of modes){
   const blocked=await api.dispatch('POST','reconstruct',{reviewId:snapshot.id,reviewHash:snapshot.hash,mode})
   assert.equal(blocked.explored,0);assert.equal(blocked.trials,0);assert.equal(blocked.candidates.length,0)
   assert.match(blocked.diagnostics.join('\n'),/当前 Review.*输入类别.*保存新 Review/)
   assert.ok(!blocked.diagnostics.join('\n').includes(original.reason),'do not repeat a historical Analysis verdict as a current geometric diagnosis')
  }
  const evidence={...original,sourceKind:'diagram'}
  const corrected=await api.dispatch('POST','reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence})
  assert.notEqual(corrected.id,snapshot.id);assert.deepEqual(corrected.evidence,evidence)
  const reloaded=createMagneticIntake(dir)
  for(const mode of modes){
   const r=await reloaded.dispatch('POST','reconstruct',{reviewId:corrected.id,reviewHash:corrected.hash,mode})
   assert.ok(r.explored>0&&r.trials>0);assert.ok(r.candidates.length)
   assert.equal(r.reviewId,corrected.id);assert.equal(r.reviewHash,corrected.hash)
   assert.equal(validate(r.candidates[0].assembly.instances,profiles).valid,true)
   assert.deepEqual((await reloaded.result(r.id)).review.evidence,evidence)
  }
  assert.deepEqual(await Promise.all([readBytes('analyses',analysis.id),readBytes('reviews',snapshot.id)]),bytes)
  assert.deepEqual(await api.dispatch('GET','selected/'+source.id),selected)
  await assert.rejects(api.dispatch('POST','reconstruct',{reviewId:corrected.id,reviewHash:'wrong'}),/Hash/)
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('classification confirmation does not bypass Unknown, corner count or rigid contour fitting',()=>{
 const f=evidenceFor(cases[0].tiles,profiles,vertices,validate)
 for(const mode of modes){
  const unknown=structuredClone(f.evidence);unknown.observations[0].profileId='unknown'
  const u=reconstruct(unknown,f.width,f.height,profiles,'unknown',mode);assert.equal(u.explored,0);assert.match(u.diagnostics.join('\n'),/Unknown/)
  assert.match(reconstructionSummary(u,unknown),/输入审核未完成/)
  const corners=structuredClone(f.evidence);corners.observations[0].outline.pop()
  const c=reconstruct(corners,f.width,f.height,profiles,'corners',mode);assert.equal(c.explored,0);assert.match(c.diagnostics.join('\n'),/顶点数与 Profile 不一致/)
  const size=structuredClone(f.evidence);size.observations[0].profileId='large-equilateral-triangle';size.observations[0].outline.pop()
  const r=reconstruct(size,f.width,f.height,profiles,'size',mode);assert.equal(r.explored,0)
  assert.match(r.diagnostics.join('\n'),/轮廓拟合未通过.*RMS.*0\.300.*Profile 尺寸/)
 }
})

test('new triangle profiles have usable whole-edge connections under the unchanged Validator',()=>{
 const square=tile('square'),tall=tile('tall','tall-right-triangle'),large=tile('large','large-equilateral-triangle')
 const tallEdges=edges(tall,profiles),largeEdges=edges(large,profiles)
 assert.ok(tallEdges.every(e=>e.enabled));assert.ok(largeEdges.every(e=>e.enabled))
 const placedTall=alignEdge(tall,tallEdges.find(e=>e.length===1),edges(square,profiles)[0],profiles)
 const a=validate([square,placedTall],profiles);assert.equal(a.valid,true);assert.equal(a.connections.length,1)
 const placedLarge=alignEdge(large,largeEdges[0],edges(placedTall,profiles).find(e=>Math.abs(e.length-2)<1e-9),profiles)
 const b=validate([placedTall,placedLarge],profiles);assert.equal(b.valid,true);assert.equal(b.connections.length,1)
})

test('segmented rose reviewed profiles reach the real search; diagnostics distinguish tried alignment errors from sampled-layout overlap',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/rose-relative-size.json',import.meta.url),'utf8'))
 const e=structuredClone(fixture.evidence);e.sourceKind='diagram'
 for(const [id,profileId] of [['p1','tall-right-triangle'],['p2','large-equilateral-triangle'],['p3','tall-right-triangle']])e.observations.find(o=>o.id===id).profileId=profileId
 for(const mode of modes){
  const r=reconstruct(e,fixture.width,fixture.height,profiles,'rose',mode)
  assert.ok(r.explored>0&&r.trials>0);assert.equal(r.candidates.length,0);assert.equal(r.truncated,false)
  assert.ok(!r.diagnostics.some(d=>d.includes('unsupported')||d.includes(e.reason)))
  if(mode==='connected-construction'){assert.ok(r.diagnosticCandidates.some(d=>d.attemptedConnection?.from==='p2'&&d.failureStage==='geometry'&&d.attemptedTileRms<.3));assert.equal(r.trace.search.parameters.connectionModel,'segmented-edge-v1')}
  assert.match(r.diagnostics.join('\n'),/原图独立拟合.*p1 \/ p2.*不是搜索已接受的布局/)
  assert.deepEqual(reconstruct(e,fixture.width,fixture.height,profiles,'rose',mode),r)
 }
})

import {selectFixture} from './magnetic-selected-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createProfileRegistry} from '../server/magnetic-profile-registry.mjs'
import {canonicalProfileSnapshot,canonicalProfileGeometry,canonicalGeometryManifest,canonicalGeometryContract} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {buildVisibleRequest,planningPromptVersion,planningPrompt} from '../server/magnetic-visible3d-vision.mjs'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
async function directory(t){const d=await mkdtemp(path.join(tmpdir(),'magnetic-canonical-contract-'));t.after(()=>rm(d,{recursive:true,force:true}));return d}
test('versioned solid / segmented Ports survive Registry restart and are the exact Review and Planning geometry',async t=>{
 const dir=await directory(t),registry=createProfileRegistry(dir),api=createMagneticIntake(dir)
 const saved=await registry.save({expectedRevision:0,operation:'create',input:{id:'test-segmented',name:'Test segmented plate',parameters:{shape:'square',dimensions:{side:1}},connectableEdges:['e0','e1','e2','e3'],source:'isolated contract test',estimated:false,solid3d:{thickness:.09,ports:[{edgeId:'e0',ranges:[[0,.4],[.6,1]]}]}}})
 assert.deepEqual((await createProfileRegistry(dir).get()).profiles.at(-1),saved.profile)
 const f=await visibleFixture(),p=saved.profile;f.evidence.observations[0].profileCandidates=[{profileId:p.id,profileVersion:p.version,reason:'test only'}];f.review.pieces[0].profileId=p.id;f.review.pieces[0].profileVersion=p.version
 const source=await api.dispatch('POST','sources',{name:'test.png',original:png,view:png}),analysis=await api.dispatch('POST','visible3d/annotate',{sourceId:source.id,evidence:f.evidence})
 const review=(await api.dispatch('POST','visible3d/reviews',{analysisId:analysis.id,review:f.review,expectedRevision:0})).record
 assert.deepEqual(review.input.profiles[0],canonicalProfileSnapshot(p));assert.equal(review.input.profiles[0].thickness,.09)
 const manifest=canonicalGeometryManifest(review.input.profiles),prepared={image:png,input:{geometryInput:review.input,geometryContract:manifest}}
 for(const model of ['gpt-4.1','gemini-3.6-flash']){const r=buildVisibleRequest(model,prepared,'plan');assert.ok(JSON.stringify(r).includes('e0-p1'));assert.ok(JSON.stringify(r).includes(canonicalGeometryContract));assert.ok(JSON.stringify(r).includes('polygon-area-centroid'))}
 assert.match(planningPromptVersion,/canonical-geometry-v1/);assert.match(planningPrompt,/Do not reorder, mirror/);assert.equal(manifest.profiles[0].thickness,.09);assert.deepEqual(manifest.profiles[0],canonicalProfileGeometry(review.input.profiles[0]))
 await assert.rejects(api.dispatch('POST','visible3d/reviews',{analysisId:analysis.id,review:f.review,thickness:.06,expectedRevision:1}),/厚度属于 Canonical/)
})
test('a new Plan is contract-bound; a missing marker cannot silently execute historical Port assignments',async t=>{
 const dir=await directory(t),api=createMagneticIntake(dir),f=await visibleFixture(),source=await api.dispatch('POST','sources',{name:'test.png',original:png,view:png}),analysis=await api.dispatch('POST','visible3d/annotate',{sourceId:source.id,evidence:f.evidence}),review=(await api.dispatch('POST','visible3d/reviews',{analysisId:analysis.id,review:f.review,expectedRevision:0})).record
 const plan=await api.dispatch('POST','visible3d/manual-plan',{reviewId:review.id,plan:f.plan});assert.equal(plan.geometryContract,canonicalGeometryContract)
 const x=await api.dispatch('POST','visible3d/execute',{planId:plan.id,requestId:randomUUID()});assert.equal(x.state,'complete');assert.equal(x.record.candidates.length,1)
 const filename=path.join(dir,'visible3d/plans',plan.id+'.json'),old=JSON.parse(await readFile(filename,'utf8'));delete old.geometryContract;delete old.hash;old.hash=createHash('sha256').update(JSON.stringify(old)).digest('hex');await writeFile(filename,JSON.stringify(old));await assert.rejects(selectFixture(api,source.id,'plan',old),/Canonical Geometry/)
 const rejected=await api.dispatch('POST','visible3d/execute',{planId:plan.id,requestId:randomUUID()});assert.equal(rejected.state,'failed');assert.match(rejected.error,/Selected Plan|缺少当前 Canonical Geometry/)
 assert.throws(()=>buildVisibleRequest('gpt-4.1',{image:png,input:{geometryInput:f.input}},'plan'),/未调用模型/)
})

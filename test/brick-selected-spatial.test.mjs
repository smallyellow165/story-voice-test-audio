import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSelectedSpatialStore } from '../server/brick-selected-spatial.mjs'
import { createSourceImageStore } from '../server/brick-source-images.mjs'
import { createBrickReverse } from '../server/brick-reverse.mjs'
import { createBuildOrderStore } from '../server/brick-build-order.mjs'
import { createWorkflowHistory } from '../server/brick-workflow-history.mjs'
const planId = 'f18759ed-d4e1-45cc-b257-4ad5d71d48a8'
const original = JSON.parse(await readFile(new URL('../generated/brick-spatial-traces/'+planId+'.json', import.meta.url)))
async function fixture(t) {
 const root = await mkdtemp(path.join(tmpdir(), 'spatial-choice-')); t.after(()=>rm(root,{recursive:true,force:true}))
 for(const folder of ['brick-source-images','brick-reverse','brick-spatial-traces','brick-spatial-geometry','brick-spatial-selections','brick-build-plans','brick-build-traces','brick-spatial-requests','brick-refinements']) await cp(new URL('../generated/'+folder,import.meta.url),path.join(root,folder),{recursive:true})
 const sourceImages=createSourceImageStore(path.join(root,'brick-source-images')), reverse=createBrickReverse(path.join(root,'brick-reverse'),{sourceImages,getCatalog:async()=>({colors:[]})})
 const make=()=>createSelectedSpatialStore(root,{sourceImages,reverse}),store=make()
 async function run(patch=()=>{}){const r=structuredClone(original);r.id=randomUUID();r.generationId=r.id;patch(r);await writeFile(path.join(root,'brick-spatial-traces',r.id+'.json'),JSON.stringify(r));return r.id}
 async function select(id){const r=await store.read(id);return store.select(id,{selectionKey:r.selectionKey,expectedRevision:r.choice.revision})}
 return {root,store,make,run,select,sourceImages,reverse}
}
test('same exact input runs share one choice; load is read-only; switch and restart persist',async t=>{
 const f=await fixture(t),a=await f.run(),b=await f.run();const before=await readFile(path.join(f.root,'brick-spatial-traces',a+'.json'))
 const first=await f.store.read(a);assert.equal(first.choice.selectedSpatialPlanId,null);assert.equal(first.selectionKey,(await f.store.read(b)).selectionKey)
 await f.select(a);assert.equal((await f.store.read(b)).choice.selectedSpatialPlanId,a)
 await f.select(b);assert.equal((await f.make().read(a)).choice.selectedSpatialPlanId,b)
 assert.deepEqual(await readFile(path.join(f.root,'brick-spatial-traces',a+'.json')),before)
})
test('Review, Mapping and input snapshot versions remain independent',async t=>{
 const f=await fixture(t),a=await f.run()
 const b=await f.run(r=>{r.requestInput.provenance.reviewVersion='a'.repeat(64);r.sources[0].reviewVersion='a'.repeat(64)})
 const c=await f.run(r=>{const id=randomUUID();r.requestInput.provenance.reviewId=id;r.sources[0].mappingReviewId=id;r.sources[0].mappingReview.id=id;for(const o of r.requestInput.observations)o.mapping.reviewId=id})
 const d=await f.run(r=>{r.requestInput.manualReviewGuidance+=' explicit new input'})
 const keys=await Promise.all([a,b,c,d].map(async id=>(await f.select(id)).selectionKey));assert.equal(new Set(keys).size,4)
 for(const id of [a,b,c,d])assert.equal((await f.make().read(id)).choice.selectedSpatialPlanId,id)
})
test('failed, prepared, corrupt and inconsistent upstream runs cannot replace the prior choice',async t=>{
 const f=await fixture(t),good=await f.run();await f.select(good)
 for(const patch of [r=>{r.status='prepared'},r=>{r.status='provider_or_trace_failed'},r=>{r.rawOutput='{}'},r=>{r.plan={}},r=>{r.sources[0].reviewVersion='f'.repeat(64)},r=>{r.requestInput.observations[0].mapping.reviewId=randomUUID()},r=>{r.imagePayloadSha256='f'.repeat(64)}]){
  const id=await f.run(patch);await assert.rejects(f.select(id));assert.equal((await f.store.read(good)).choice.selectedSpatialPlanId,good)
 }
})
test('stale pages, concurrent service instances and wrong scope cannot silently overwrite',async t=>{
 const f=await fixture(t),a=await f.run(),b=await f.run(),r=await f.store.read(a),body={selectionKey:r.selectionKey,expectedRevision:0}
 const outcomes=await Promise.allSettled([f.store.select(a,body),f.make().select(b,body)])
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.statusCode,409)
 await assert.rejects(f.store.select(b,body),e=>e.statusCode===409)
 await assert.rejects(f.store.select(b,{...body,selectionKey:'sha256:'+'f'.repeat(64)}),/范围/)
})
test('missing historical Review evidence is not replaced with current Review',async t=>{
 const f=await fixture(t),id=await f.run(r=>{delete r.requestInput.provenance.reviewVersion})
 await assert.rejects(f.store.read(id),/缺少/)
})
test('corrupt choice remains explicit and is not overwritten',async t=>{
 const f=await fixture(t),id=await f.run(),selected=await f.select(id),file=path.join(f.root,'brick-spatial-plan-choices',selected.selectionKey.slice(7)+'.json')
 await writeFile(file,'broken');await assert.rejects(f.store.read(id),/损坏/);await assert.rejects(f.store.select(id,{selectionKey:selected.selectionKey,expectedRevision:1}),/损坏/);assert.equal(await readFile(file,'utf8'),'broken')
})
test('real Penguin: five proven input scopes, four selectable plans, prepared run read-only',async t=>{
 const f=await fixture(t),ids=['b02871ca-e1ed-43ef-a416-9ba6dff25b74','966c3208-b20f-4e73-89be-f8c390fefa65','b774d098-b19e-48e7-b827-49ccf204b864',planId,'b052f246-bce4-4a43-93aa-69de7572c0fe']
 const values=await Promise.all(ids.map(id=>f.store.read(id)));assert.equal(new Set(values.map(v=>v.selectionKey)).size,5);assert.equal(values.filter(v=>v.eligible).length,4)
})
test('selection annotates Workflow History but never changes any lineage edge or downstream record',async t=>{
 const f=await fixture(t),image=original.imagePayloadSha256
 const workflow=createWorkflowHistory(f.root,{sourceImages:f.sourceImages,reverse:f.reverse,buildOrder:createBuildOrderStore(f.root),selectedSpatial:f.store})
 const before=await workflow.read('sha256:'+image);await f.select(planId);const after=await workflow.read('sha256:'+image)
 assert.deepEqual(after.nodes.map(n=>[n.key,n.parent,n.analysisId]),before.nodes.map(n=>[n.key,n.parent,n.analysisId]))
 assert.equal(after.nodes.find(n=>n.stage==='Spatial'&&n.id===planId).evidence.spatialChoice.selectedSpatialPlanId,planId)
 assert.ok(after.nodes.some(n=>n.stage==='Build Plan'&&n.status==='draft · 11 步'))
})

test('UI keeps failed runs viewable, separates history loading from explicit Select and protects switches',async()=>{
 const {uiModuleUrl}=await import('./ui-module.mjs'), React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server')
 const {SpatialPlanningHistory}=await import(await uiModuleUrl(new URL('../src/brick-test/SpatialPlanningHistory.tsx',import.meta.url)))
 const html=renderToStaticMarkup(React.createElement(SpatialPlanningHistory,{runs:[{id:planId,createdAt:'2026-01-01',status:'provider_or_trace_failed'}],loadedId:planId,disabled:false,onLoad:()=>assert.fail('render never loads or selects')}))
 assert.match(html,/provider_or_trace_failed/);assert.match(html,/disabled="">Select/);assert.match(html,/popover="auto"/)
 assert.doesNotMatch(html,/>刷新<|>加载识别结果</)
 const control=await readFile(new URL('../src/brick-test/SpatialPlanningHistory.tsx',import.meta.url),'utf8')
 assert.match(control,/onChange=\{e => \{ if \(e.target.value\) onLoad\(e.target.value\) \}\}/)
 const panel=await readFile(new URL('../src/brick-test/SpatialAssemblyPanel.tsx',import.meta.url),'utf8')
 assert.match(panel,/window.confirm\('切换 Spatial/)
})
test('selected marker appears only on the adopted Spatial node, alongside its real downstream branch',async t=>{
 const f=await fixture(t);await f.select(planId)
 const history=await createWorkflowHistory(f.root,{sourceImages:f.sourceImages,reverse:f.reverse,buildOrder:createBuildOrderStore(f.root),selectedSpatial:f.store}).read('sha256:'+original.imagePayloadSha256)
 const {uiModuleUrl}=await import('./ui-module.mjs'), React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server')
 const {WorkflowHistoryBranch}=await import(await uiModuleUrl(new URL('../src/brick-vision/WorkflowHistory.tsx',import.meta.url)))
 const html=renderToStaticMarkup(React.createElement(WorkflowHistoryBranch,{node:history.nodes.find(n=>n.stage==='Spatial'&&n.id===planId),history,disabled:false,onLoad:()=>{}}))
 assert.match(html,/plan_ready_for_review · Selected/);assert.match(html,/draft · 11 步/)
 assert.equal((html.match(/ · Selected<\/summary>/g)||[]).length,1)
})

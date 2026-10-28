import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createPartsInputStore,partsIdentity} from '../server/brick-parts-input.mjs'
import {resolvePartsGeometry,definitionId} from '../server/brick-parts-geometry.mjs'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {createBrickReverse} from '../server/brick-reverse.mjs'
import {createSourceImageStore} from '../server/brick-source-images.mjs'
import {createSpatialWorkflow} from '../server/brick-spatial-workflow.mjs'
import {modelOptions} from '../server/brick-model-registry.mjs'
import {runSpatialPlanning} from '../experiments/spatial-planning/runner.mjs'
const trace=JSON.parse(await readFile(new URL('../generated/brick-spatial-traces/f18759ed-d4e1-45cc-b257-4ad5d71d48a8.json',import.meta.url)))
const rules=await loadBrickRules(),oldRows=trace.sources[0].mappingReview.mapping.rows
const parts=new Map(oldRows.map(r=>[r.source.part_num,r.evidence.part]));for(const r of oldRows)if(r.geometryBinding)parts.set(r.geometryBinding.basePartNum,r.geometryBinding.baseMapping)
const colors=new Map(oldRows.map(r=>[String(r.source.color_id),r.evidence.color]))
const metadata=async(route,p)=>{if(route==='mapping-part')return structuredClone(parts.get(p.part_num));if(route==='mapping-color')return structuredClone(colors.get(p.color_id));if(route==='parts'){const b=oldRows.find(r=>r.source.part_num===p.search).geometryBinding;return {items:[{part_num:p.search,print_relationships:b.relationships}]}}assert.fail(route)}
const realReverse=createBrickReverse('generated/brick-reverse',{sourceImages:createSourceImageStore('generated/brick-source-images'),getCatalog:async()=>({colors:[]})})
const realSaved=await realReverse.restore(trace.requestInput.provenance.analysisId)
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'parts-input-'));t.after(()=>rm(dir,{recursive:true,force:true}));const state={saved:structuredClone(realSaved),calls:0};const store=createPartsInputStore(dir,{reverse:{restore:async()=>structuredClone(state.saved)},loadRules:async()=>rules,resolve:async(items,r)=>{state.calls++;return resolvePartsGeometry(items,r,{getMetadata:metadata})}});return {dir,store,state}}
const recordPath=(dir,id)=>path.join(dir,'brick-parts-inputs',id.slice(7)+'.json')
test('real Penguin concurrent preparation, restart and timestamp-only saves reuse immutable collection and Mapping',async t=>{
 const {dir,store,state}=await fixture(t);const results=await Promise.all([store.prepare(realSaved.analysis.id),store.prepare(realSaved.analysis.id)]);assert.equal(results[0].partsSnapshotId,results[1].partsSnapshotId);assert.equal(results[0].preparationContextId,results[1].preparationContextId)
 const first=results[0],before=await readFile(recordPath(dir,first.partsSnapshotId),'utf8'),snapshot=await store.read(first.partsSnapshotId)
 assert.equal(snapshot.identity.instances.length,12);assert.equal(snapshot.identity.instances.filter(o=>o.part==='11170').length,4);assert.equal(snapshot.geometryReady,true)
 state.saved.updatedAt='2026-10-28T10:00:00Z';const second=await store.prepare(realSaved.analysis.id);assert.equal(first.partsSnapshotId,second.partsSnapshotId);assert.notEqual(first.preparationContextId,second.preparationContextId)
 assert.equal(await readFile(recordPath(dir,first.partsSnapshotId),'utf8'),before)
 assert.equal((await createPartsInputStore(dir).read(first.partsSnapshotId)).mappingReview.id,snapshot.mappingReview.id)
 assert.equal((await readdir(path.join(dir,'brick-parts-inputs'))).filter(f=>f.endsWith('.json')).length,1)
})
test('identity covers actual instance, color, quantity, hidden source and geometry; connector order is semantic',async t=>{
 const {store}=await fixture(t),r=await store.prepare(realSaved.analysis.id),snapshot=await store.read(r.partsSnapshotId),base=snapshot.identity
 for(const change of [x=>x.instances[0].confirmedPart.part_num='999',x=>x.instances[0].color='1',x=>x.instances[0].confirmedPart.color_id=1,x=>x.instances[0].id+='changed',x=>x.instances.push({...x.instances[0],id:'extra'}),x=>x.instances[0].provenance.source='manual',x=>x.instances[0].geometry.bodySizeLdu.x++,x=>x.instances[0].definitionReferences.geometryDefinitionId='sha256:'+'a'.repeat(64),x=>x.instances.find(o=>o.geometry.top.length>1).geometry.top.reverse()]){const other=structuredClone(base);change(other);assert.notEqual(definitionId(other),r.partsSnapshotId)}
 const mapped={observations:base.instances.map(o=>({...o,mapping:{definitionReferences:o.definitionReferences}})),inventory:base.inventory,units:base.units};assert.equal(definitionId(partsIdentity({id:base.analysisId,sourceImageId:base.sourceImageId},mapped)),r.partsSnapshotId)
})
test('same Snapshot gives independent runs; Planner cannot restore Review or map; evidence toggles are per-run',async t=>{
 const {dir,store,state}=await fixture(t),p=await store.prepare(realSaved.analysis.id),calls=state.calls
 const reader=createPartsInputStore(dir),workflow=createSpatialWorkflow(dir,{partsInputs:reader,reverse:{restore:()=>assert.fail('Planner cannot restore Review')}})
 const body={analysisId:realSaved.analysis.id,...p,model:'gpt-6.1-sol',includeEvidence:true}
 const one=await workflow.dispatch('POST','prepare',{...body,requestId:randomUUID()}),two=await workflow.dispatch('POST','prepare',{...body,model:modelOptions('design').find(m=>m.id!==body.model).id,includeEvidence:false,requestId:randomUUID()})
 assert.equal(one.state,'complete',one.error);assert.equal(two.state,'complete',two.error);assert.notEqual(one.planId,two.planId);assert.equal(state.calls,calls)
 const a=JSON.parse(await readFile(path.join(dir,'brick-spatial-traces',one.planId+'.json'))),b=JSON.parse(await readFile(path.join(dir,'brick-spatial-traces',two.planId+'.json')))
 assert.equal(a.partsSnapshotId,b.partsSnapshotId);assert.notEqual(a.model,b.model);assert.notDeepEqual(a.request,b.request);assert.ok(a.requestInput.analysis);assert.equal(b.requestInput.analysis,undefined);assert.equal(a.imagePayloadSha256,b.imagePayloadSha256);await reader.verifyTrace(a);await reader.verifyTrace(b)
 const altered=structuredClone(a);altered.requestInput.observations[0].color='1';await assert.rejects(reader.verifyTrace(altered),/不一致/)
 assert.equal((await store.match(a)).status,'Current');const before=await readFile(recordPath(dir,p.partsSnapshotId),'utf8')
 state.saved.rows.head_front.excluded=true;assert.equal((await store.match(a)).status,'Outdated');assert.equal(await readFile(recordPath(dir,p.partsSnapshotId),'utf8'),before)
 assert.equal((await readdir(path.join(dir,'brick-parts-inputs'))).filter(f=>f.endsWith('.json')).length,1,'matching does not save')
 const next=await store.prepare(realSaved.analysis.id);assert.notEqual(next.partsSnapshotId,p.partsSnapshotId)
 assert.equal((await store.match(trace)).status,'Unknown')
})
test('run contexts preserve changed human guidance without changing collection, and reject swapped evidence',async t=>{
 const {store,state}=await fixture(t),a=await store.prepare(realSaved.analysis.id)
 state.saved.manualRelations=[{from:'head_front',to:'head_rear',relation:'symmetric',source:'manual',note:'new explicit guidance'}]
 const b=await store.prepare(realSaved.analysis.id);assert.equal(a.partsSnapshotId,b.partsSnapshotId);assert.notEqual(a.preparationContextId,b.preparationContextId)
 const aa=await store.forPlanning(a.partsSnapshotId,a.preparationContextId,true),bb=await store.forPlanning(b.partsSnapshotId,b.preparationContextId,true)
 assert.notDeepEqual(aa.prepared.input.manualRelations,bb.prepared.input.manualRelations)
 const fake={inputContract:'parts-input-snapshot-v1',...bb.prepared,requestInput:aa.prepared.input,sources:bb.sources};await assert.rejects(store.verifyTrace(fake),/不一致/)
})
test('missing/corrupt Snapshot and old write contract are rejected without repair',async t=>{
 const {dir,store}=await fixture(t),p=await store.prepare(realSaved.analysis.id)
 const workflow=createSpatialWorkflow(dir,{partsInputs:store});await assert.rejects(workflow.dispatch('POST','prepare',{requestId:randomUUID(),analysisId:realSaved.analysis.id,reviewVersion:'old',model:'gpt-6.1-sol',includeEvidence:true}),/无效/)
 await assert.rejects(store.forPlanning('sha256:'+'0'.repeat(64),p.preparationContextId,true),/缺失/)
 const file=recordPath(dir,p.partsSnapshotId),r=JSON.parse(await readFile(file));r.identity.instances[0].color='999';await writeFile(file,JSON.stringify(r));await assert.rejects(store.read(p.partsSnapshotId),/校验失败/);await assert.rejects(store.prepare(realSaved.analysis.id),/校验失败/)
})
test('missing ordinary Profile stays planning eligible, never geometry ready or fabricated',async t=>{
 const {dir,state}=await fixture(t);const altered={...rules,geometrySupport:part=>part==='2302'?{supported:false,geometry:null,reasons:['explicit missing Profile']}:rules.geometrySupport(part)}
 const store=createPartsInputStore(dir,{reverse:{restore:async()=>state.saved},loadRules:async()=>altered,resolve:(items,r)=>resolvePartsGeometry(items,r,{getMetadata:metadata})});const r=await store.prepare(realSaved.analysis.id);assert.equal(r.planningEligible,true);assert.equal(r.geometryReady,false);const snapshot=await store.read(r.partsSnapshotId);assert.ok(snapshot.identity.instances.filter(o=>o.part==='2302').every(o=>o.geometry===null&&o.definitionReferences.geometryDefinitionId===null))
})
test('isolated Penguin replay: new Snapshot → Spatial → Geometry → Layout → 11-step Build Plan; Selected and History stay independent',async t=>{
 const {createBuildOrderStore}=await import('../server/brick-build-order.mjs'),{createSelectedSpatialStore}=await import('../server/brick-selected-spatial.mjs'),{createWorkflowHistory}=await import('../server/brick-workflow-history.mjs'),{mkdir,copyFile}=await import('node:fs/promises')
 const {dir,store,state}=await fixture(t),p=await store.prepare(realSaved.analysis.id)
 // Replay a known saved model result in isolated storage; no model transport.
 const workflow=createSpatialWorkflow(dir,{partsInputs:store,runPlanning:async(prepared,options)=>{
  const r=await runSpatialPlanning(prepared,{...options,execute:false});Object.assign(r,{plan:structuredClone(trace.plan),rawOutput:JSON.stringify(trace.plan),status:trace.status,parseStatus:trace.parseStatus,validation:trace.validation,finishReason:trace.finishReason,wireStatus:trace.wireStatus});await writeFile(path.join(dir,'brick-spatial-traces',r.id+'.json'),JSON.stringify(r));return r
 }})
 const op=await workflow.dispatch('POST','plan',{requestId:randomUUID(),analysisId:realSaved.analysis.id,...p,model:'gpt-6.1-sol',includeEvidence:true});assert.equal(op.state,'complete',op.error)
 const execute=await workflow.dispatch('POST','execute',{requestId:randomUUID(),planId:op.planId});assert.equal(execute.state,'complete',execute.error)
 const geometry=await workflow.dispatch('GET','geometry/'+execute.geometryId);assert.ok(geometry.candidates.length>0)
 const selected=await workflow.dispatch('POST','select-layout',{requestId:randomUUID(),planId:op.planId,geometryId:execute.geometryId,candidateId:geometry.candidates[0].id});assert.equal(selected.state,'complete',selected.error)
 const builds=createBuildOrderStore(dir),src=await builds.dispatch('GET','sources/'+selected.selectionId)
 const original=JSON.parse(await readFile(new URL('../generated/brick-build-plans/426f27c7-a9a9-4ee9-9965-39e1cd9e30f8.json',import.meta.url)))
 const plan={...original,build_plan_id:randomUUID(),source_selection_id:src.id,source_geometry_result_id:src.geometryId,source_candidate_id:src.candidateId,source_candidate_hash:src.candidateHash}
 const build=await builds.dispatch('POST','save',{plan,expectedUpdatedAt:null});assert.equal(build.validation.complete,true);assert.equal(build.plan.steps.length,11)
 const sourceImages=createSourceImageStore('generated/brick-source-images'),reverse={read:async()=>realSaved.analysis,restore:async()=>state.saved,history:async()=>({items:[{id:realSaved.analysis.id}],warnings:[]})}
 const choices=createSelectedSpatialStore(dir,{reverse,sourceImages,partsInputs:store}),scope=await choices.read(op.planId);await choices.select(op.planId,{selectionKey:scope.selectionKey,expectedRevision:0});const choiceBefore=await choices.read(op.planId)
 await mkdir(path.join(dir,'brick-reverse'));await copyFile('generated/brick-reverse/'+realSaved.analysis.id+'.json.review',path.join(dir,'brick-reverse',realSaved.analysis.id+'.json.review'))
 const history=createWorkflowHistory(dir,{reverse,sourceImages,partsInputs:store,selectedSpatial:choices,buildOrder:builds});let h=await history.read(realSaved.analysis.sourceImageId)
 assert.equal(h.nodes.find(n=>n.stage==='Spatial').evidence.partsInputMatch.status,'Current');assert.ok(h.nodes.some(n=>n.stage==='Build Plan'))
 state.saved.rows.head_front.excluded=true;h=await history.read(realSaved.analysis.sourceImageId);assert.equal(h.nodes.find(n=>n.stage==='Spatial').evidence.partsInputMatch.status,'Outdated');assert.deepEqual(await choices.read(op.planId),choiceBefore)
 assert.equal((await builds.dispatch('GET','plans/'+plan.build_plan_id)).validation.complete,true)
})

test('actual Profile definition update produces a new Snapshot while old Profile and connector order remain frozen',async t=>{
 const {dir,store,state}=await fixture(t),first=await store.prepare(realSaved.analysis.id),before=await readFile(recordPath(dir,first.partsSnapshotId),'utf8')
 const changedRules={...rules,geometrySupport:part=>{const c=structuredClone(rules.geometrySupport(part));if(part==='2302')c.geometry.evidence.push('explicit reviewed definition revision');return c}}
 const changed=createPartsInputStore(dir,{reverse:{restore:async()=>state.saved},loadRules:async()=>changedRules,resolve:(items,r)=>resolvePartsGeometry(items,r,{getMetadata:metadata})})
 const second=await changed.prepare(realSaved.analysis.id);assert.notEqual(first.partsSnapshotId,second.partsSnapshotId);assert.equal(await readFile(recordPath(dir,first.partsSnapshotId),'utf8'),before)
 const old=await store.read(first.partsSnapshotId),next=await changed.read(second.partsSnapshotId)
 assert.deepEqual(old.identity.instances.find(o=>o.part==='2302').geometry.top,next.identity.instances.find(o=>o.part==='2302').geometry.top)
 // V2 compares runs across exact input versions while preserving each lineage.
 const {createSelectedSpatialStore}=await import('../server/brick-selected-spatial.mjs')
 const makeRun=async(ref,inputs)=>{const {prepared,sources}=await inputs.forPlanning(ref.partsSnapshotId,ref.preparationContextId,true);const r=await runSpatialPlanning(prepared,{model:'gpt-6.1-sol',directory:path.join(dir,'brick-spatial-traces'),sources,execute:false});Object.assign(r,{plan:structuredClone(trace.plan),rawOutput:JSON.stringify(trace.plan),status:trace.status,parseStatus:trace.parseStatus,validation:trace.validation,finishReason:trace.finishReason,wireStatus:trace.wireStatus});await writeFile(path.join(dir,'brick-spatial-traces',r.id+'.json'),JSON.stringify(r));return r}
 const a=await makeRun(first,store),b=await makeRun(second,changed)
 const choices=createSelectedSpatialStore(dir,{reverse:{read:async()=>state.saved.analysis},sourceImages:createSourceImageStore('generated/brick-source-images'),partsInputs:changed})
 const scopeA=await choices.read(a.id),scopeB=await choices.read(b.id);assert.equal(scopeA.selectionKey,scopeB.selectionKey)
 await choices.select(a.id,{selectionKey:scopeA.selectionKey,expectedRevision:0})
 assert.equal((await changed.match(a)).status,'Outdated');assert.equal((await choices.read(a.id)).choice.selectedSpatialPlanId,a.id)
 assert.equal((await changed.match(b)).status,'Current');await choices.select(b.id,{selectionKey:scopeB.selectionKey,expectedRevision:1});assert.equal((await choices.read(a.id)).choice.selectedSpatialPlanId,b.id)
 assert.equal(await readFile(recordPath(dir,first.partsSnapshotId),'utf8'),before)

})

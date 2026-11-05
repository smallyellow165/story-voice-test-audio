import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {workspaceStore,rememberSavedAssembly} from '../src/magnetic-tiles/workspace-context.ts'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {DRAFT_PROJECT_PREFIX,WORKFLOW_DRAFT_KEY,LEGACY_CONTEXT_KEY,touchDraftProject,listDraftProjects,migrateDraftProjects} from '../src/magnetic-tiles/draft-projects.ts'
import {emptyWorkflowDraft,saveWorkflowDraft,readWorkflowDraft,resolveWorkflowDraft,migrateLegacyWorkflow,selectedHeadsEqual,headMatchesOwnSelection} from '../src/magnetic-tiles/three-d/reconstruction/workflow-draft.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'

function store(entries=[]){const map=new Map(entries);return {get length(){return map.size},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,String(v))},removeItem:k=>{map.delete(k)},entries:()=>[...map.entries()]}}
function bind(s,id=randomUUID()){const scoped=workspaceStore(s,{mode:'create',id});scoped.setItem('binding',canonical({mode:'create',id}));return {id,scoped}}
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'draft-project-unit-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir),f=await visibleFixture(),id=randomUUID(),prefix='visible3d/project/'+id+'/'
 const source=await api.dispatch('POST','sources',{name:'same photo.png',original:png,view:png}),a=await api.dispatch('POST',prefix+'annotate',{sourceId:source.id,evidence:f.evidence})
 await api.dispatch('POST',prefix+'selected',{sourceId:source.id,stage:'analysis',id:a.id,hash:a.hash,expectedRevision:0})
 const d=emptyWorkflowDraft(id);d.source={id:source.id,hash:source.hash};d.head=await api.dispatch('GET',prefix+'head/'+source.id);d.form=structuredClone(f.review)
 return {api,f,id,prefix,source,a,d,get:route=>api.dispatch('GET',route)}
}
test('Create indexes survive browser storage reload; Edit/global keys are not discovered',()=>{
 const s=store(),a=bind(s),b=bind(s);touchDraftProject(s,a.id,{name:'A',stage:'review'});touchDraftProject(s,b.id,{name:'B',stage:'source'})
 s.setItem('magnetic-studio.workspace.v1.edit.fake.binding','{}');s.setItem('magnetic-visible3d-context.v2','legacy global')
 const reloaded=store(s.entries()),found=listDraftProjects(reloaded)
 assert.deepEqual(new Set(found.projects.map(p=>p.workspaceId)),new Set([a.id,b.id]));assert.deepEqual(found.warnings,[])
 assert.equal(found.projects.find(p=>p.workspaceId===a.id).stage,'review')
})
test('publishing an explicitly owned Assembly hides only that Create, including later Assembly revisions; data is retained',()=>{
 const s=store(),a=bind(s),b=bind(s);for(const v of [a,b])touchDraftProject(s,v.id)
 rememberSavedAssembly(a.scoped,{id:'assembly-a',version:2,hash:'b'.repeat(64)})
 const before=s.entries();assert.deepEqual(listDraftProjects(s,[{assemblyRef:{id:'assembly-a',version:1}}]).projects.map(p=>p.workspaceId),[b.id]);assert.deepEqual(s.entries(),before)
 assert.equal(listDraftProjects(s,[{assemblyRef:{id:'unrelated'}}]).projects.length,2)
})
test('workflow checkpoint CAS preserves the winner and the losing in-memory draft; malformed originals fail closed',()=>{
 const s=store(),a=bind(s),initial=emptyWorkflowDraft(a.id),first=saveWorkflowDraft(a.scoped,initial,null),loser=structuredClone(initial);loser.manual='unsaved local JSON'
 const winner=saveWorkflowDraft(a.scoped,{...initial,manual:'other page'},first)
 assert.throws(()=>saveWorkflowDraft(a.scoped,loser,first),/其他页面/);assert.equal(a.scoped.getItem(WORKFLOW_DRAFT_KEY),winner);assert.equal(loser.manual,'unsaved local JSON')
 a.scoped.setItem(WORKFLOW_DRAFT_KEY,'{broken');assert.throws(()=>readWorkflowDraft(a.scoped,a.id));assert.equal(a.scoped.getItem(WORKFLOW_DRAFT_KEY),'{broken')
 a.scoped.setItem(WORKFLOW_DRAFT_KEY,first);assert.throws(()=>readWorkflowDraft(a.scoped,randomUUID()),/跨 Project/)
})
test('own operation refresh accepts only its exact selection receipt; concurrent foreign group changes cannot be adopted',()=>{
 const d=emptyWorkflowDraft(randomUUID()),old=d.head,receipt={kind:'plan',id:'my-plan',hash:'my-hash',groupId:'all'}
 const next={...old,selectedRevision:1,groups:{all:{plan:{id:receipt.id,hash:receipt.hash},scope:{groupId:'all'}}}}
 assert.equal(headMatchesOwnSelection(old,next,receipt),true)
 assert.equal(headMatchesOwnSelection(old,{...next,groups:{all:{...next.groups.all,plan:{id:'another-plan',hash:'other'}}}},receipt),false)
 assert.equal(headMatchesOwnSelection(old,{...next,groups:{...next.groups,other:next.groups.all}},receipt),false)
 assert.equal(headMatchesOwnSelection(old,{...next,reviewId:'another-review'},receipt),false)
})
test('unsaved Review and saved exact bases restore; alien Source / Project / Hash / members never resolve',async t=>{
 const {api,id,prefix,d,source,a,f}=await fixture(t),h=await api.dispatch('GET',prefix+'history')
 const unsaved=structuredClone(d);unsaved.form.pieces[0].color='#123456';assert.equal(resolveWorkflowDraft(unsaved,h).analysis.id,a.id);assert.equal(unsaved.form.pieces[0].color,'#123456')
 const r=await api.dispatch('POST',prefix+'reviews',{analysisId:a.id,review:f.review,expectedRevision:0,expectedSelectedRevision:d.head.selectedRevision})
 const saved={...unsaved,head:r.head};assert.equal(resolveWorkflowDraft(saved,await api.dispatch('GET',prefix+'history')).review.id,r.record.id)
 for(const bad of [{...d,workspaceId:randomUUID()},{...d,source:{id:source.id,hash:'bad'}},{...d,head:{...d.head,analysisHash:'bad'}},{...d,form:{pieces:[],constraints:[]}}])assert.throws(()=>resolveWorkflowDraft(bad,h))
 assert.equal(saved.head.reviewHash,r.record.hash)
})
test('external Selected updates do not advance the restored CAS base; old Review save is rejected without deleting draft',async t=>{
 const {api,prefix,d,a,f}=await fixture(t),s=store(),scope=workspaceStore(s,{mode:'create',id:d.workspaceId}),raw=saveWorkflowDraft(scope,d,null)
 const first=await api.dispatch('POST',prefix+'reviews',{analysisId:a.id,review:f.review,expectedRevision:d.head.revision,expectedSelectedRevision:d.head.selectedRevision})
 assert.equal(selectedHeadsEqual(d.head,first.head),false)
 await assert.rejects(api.dispatch('POST',prefix+'reviews',{analysisId:a.id,review:d.form,expectedRevision:d.head.revision,expectedSelectedRevision:d.head.selectedRevision}),e=>e.statusCode===409)
 assert.equal(scope.getItem(WORKFLOW_DRAFT_KEY),raw);assert.equal(readWorkflowDraft(scope,d.workspaceId).value.head.reviewId,null)
})
test('migration is additive, once only, uses exact UUID/Source references, and reports corrupt bindings without mixing globals',async t=>{
 const {api,id,source,a,get}=await fixture(t),s=store(),old=bind(s,id),bad=bind(s),empty=bind(s)
 old.scoped.setItem(LEGACY_CONTEXT_KEY,JSON.stringify({sourceId:source.id,inputSourceId:source.id,model:'test-model'}));old.scoped.setItem('magnetic-studio.right-panel.v1',JSON.stringify({lastStage:'review'}))
 bad.scoped.setItem('binding',JSON.stringify({mode:'create',id:randomUUID()}));s.setItem(LEGACY_CONTEXT_KEY,JSON.stringify({sourceId:'unowned'}))
 const before=s.entries(),report=await migrateDraftProjects(s,(id,scoped)=>migrateLegacyWorkflow(id,scoped,get))
 assert.deepEqual(new Set(report.migrated),new Set([id,empty.id]));assert.equal(report.skipped[0].id,bad.id)
 const recovered=readWorkflowDraft(old.scoped,id).value;assert.equal(recovered.head.analysisId,a.id);assert.equal(recovered.head.reviewId,null)
 for(const [key,value]of before)assert.equal(s.getItem(key),value)
 assert.equal(s.getItem(DRAFT_PROJECT_PREFIX+bad.id),null)
 assert.deepEqual(await migrateDraftProjects(s,()=>{throw Error('must not rerun')}),report)
 assert.equal((await api.dispatch('GET',`visible3d/project/${id}/history`)).reviews.length,0)
})
test('migration cannot use same-source records from another Project; an invalid current contract never falls back to legacy',async t=>{
 const {id,source,get}=await fixture(t),s=store(),alien=bind(s),own=bind(s,id)
 alien.scoped.setItem(LEGACY_CONTEXT_KEY,JSON.stringify({sourceId:source.id}))
 // An explicit alien head has no selected records: no history is inferred.
 await migrateLegacyWorkflow(alien.id,alien.scoped,get);assert.equal(readWorkflowDraft(alien.scoped,alien.id).value.head.analysisId,null)
 own.scoped.setItem(WORKFLOW_DRAFT_KEY,'broken');own.scoped.setItem(LEGACY_CONTEXT_KEY,JSON.stringify({sourceId:source.id}));await assert.rejects(migrateLegacyWorkflow(id,own.scoped,get));assert.equal(own.scoped.getItem(WORKFLOW_DRAFT_KEY),'broken')
})

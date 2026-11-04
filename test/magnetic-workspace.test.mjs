import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {selectedProject} from './magnetic-selected-project-fixture.mjs'
import {selectFixture} from './magnetic-selected-fixture.mjs'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {moduleStep} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {readWorkspaceContext,workspaceStore,rememberWorkspaceResult,workspaceHistory,ownSelectedHead,rememberSavedAssembly,ownAssemblyReferences} from '../src/magnetic-tiles/workspace-context.ts'
const ref=r=>({id:r.assembly.id,version:r.version,hash:r.hash})
const save=(api,snapshot,expectedHash=null)=>api.dispatch('POST','assembly3d/save',{snapshot,expectedHash})
async function setup(t){
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-workspace-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const api=createMagneticIntake(dir),f=await selectedProject(api)
 async function saved(name){
  await selectFixture(api,f.source.id,'plan',f.plans[name][1]);await selectFixture(api,f.source.id,'execution',f.executions[name][1])
  const x=f.executions[name][1],origin=await api.dispatch('POST','visible3d/adopt',{executionId:x.id,executionHash:x.hash,candidateId:'candidate-1'})
  return save(api,{assembly:structuredClone(origin.assembly),photoOrigin:{origin,assemblyRaw:serializeAssembly3D(origin.assembly)},nonRepairable:[]})
 }
 return {api,dir,f,saved}
}
async function files(dir){const out={};async function visit(d){for(const e of await readdir(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await visit(p);else out[path.relative(dir,p)]=await readFile(p,'utf8')}}await visit(dir);return out}
test('URL context and browser keys isolate Create, Edit A, Edit B and legacy data',()=>{
 const values=new Map([['draft','legacy']]),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
 const url='https://test/magnetic-tiles.html',create=readWorkspaceContext(url+'?workspace=create&workspaceId='+randomUUID())
 const edit=id=>readWorkspaceContext(url+'?'+new URLSearchParams({workspace:'edit',galleryId:id.repeat(64),assemblyId:'draft-'+id,version:'2',hash:'c'.repeat(64)}))
 const a=workspaceStore(storage,edit('a')),b=workspaceStore(storage,edit('b')),c=workspaceStore(storage,create)
 a.setItem('draft','A unsaved');b.setItem('draft','B unsaved');c.setItem('draft','Create unsaved')
 assert.equal(a.getItem('draft'),'A unsaved');assert.equal(b.getItem('draft'),'B unsaved');assert.equal(c.getItem('draft'),'Create unsaved');assert.equal(storage.getItem('draft'),'legacy')
 assert.deepEqual(readWorkspaceContext(url),null)
 for(const q of ['workspace=edit','workspace=create','workspace=unknown','workspace=edit&galleryId=../outside'])assert.throws(()=>readWorkspaceContext(url+'?'+q))
 const recovered=readWorkspaceContext(url+'?workspace=create&workspaceId='+create.id)
 assert.equal(workspaceStore(storage,recovered).getItem('draft'),'Create unsaved')
})
test('history ownership uses exact operation receipts; a shared Project cannot select another work',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
 const result={id:'analysis-a',hash:'a',createdAt:'now',sourceId:'same-photo',parent:{id:'unowned',hash:'p',createdAt:'then'}}
 rememberWorkspaceResult(storage,{record:result},'request-a')
 assert.deepEqual(workspaceHistory(storage),{refs:[{id:'analysis-a',hash:'a'}],requestIds:['request-a']})
 const shared={revision:99,selectedRevision:10,analysisId:'other',analysisHash:'other',reviewId:'review-b',reviewHash:'b',groups:{other:{plan:{id:'plan-b',hash:'p'}}}}
 assert.deepEqual(ownSelectedHead(shared,workspaceHistory(storage)),{...shared,analysisId:null,analysisHash:null,reviewId:null,reviewHash:null,groups:{}})
 assert.equal(shared.analysisId,'other')
})
test('Edit resolves published snapshot, separates save-head CAS, appends revision and preserves all original files',async t=>{
 const {api,dir,saved}=await setup(t),a=await saved('Front'),b=await saved('Back')
 const item=(await api.dispatch('POST','gallery/publish',{description:'A',assemblyRef:ref(a)})).item
 const s=structuredClone(a.snapshot);s.assembly.revision++;s.assembly.pieces[0].color='#112233'
 const newer=await save(api,s,a.hash),before=await files(dir)
 const opened=await api.dispatch('GET','gallery/edit-context/'+item.id)
 assert.deepEqual(opened.saved.snapshot,a.snapshot);assert.deepEqual(opened.saveHead,ref(newer))
 const edit=structuredClone(opened.saved.snapshot);edit.assembly.revision++;edit.assembly.pieces[0].color='#998877'
 const edited=await save(api,edit,opened.saveHead.hash)
 assert.equal(edited.version,newer.version+1);assert.deepEqual((await api.dispatch('GET','gallery/items/'+item.id)).assembly,a.snapshot.assembly)
 assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+b.assembly.id+'/versions/'+b.version)).snapshot,b.snapshot)
 const after=await files(dir);for(const [name,raw] of Object.entries(before))assert.equal(after[name],raw,name)
 await assert.rejects(save(api,edit,opened.saveHead.hash),e=>e.statusCode===409)
})
test('Combined Edit restores its own groups, pinned parents and sidecars without historical Reconstruction',async t=>{
 const {api,dir,saved}=await setup(t),a=await saved('Front'),b=await saved('Back')
 const combined=await api.dispatch('POST','assembly3d/combine',{name:'Combined',parents:[ref(a),ref(b)]})
 const item=(await api.dispatch('POST','gallery/publish',{description:'C',assemblyRef:ref(combined)})).item
 await rm(path.join(dir,'visible3d'),{recursive:true})
 const opened=await api.dispatch('GET','gallery/edit-context/'+item.id)
 assert.deepEqual(opened.saved.snapshot,combined.snapshot)
 const checked=await api.dispatch('POST','assembly3d/snapshot-check',{assemblyRef:ref(combined),assembly:combined.snapshot.assembly})
 assert.equal(checked.origin.hash,combined.snapshot.photoOrigin.origin.hash)
 await assert.rejects(api.dispatch('POST','assembly3d/snapshot-check',{assemblyRef:{...ref(combined),hash:'0'.repeat(64)},assembly:combined.snapshot.assembly}),e=>e.statusCode===409)
 const changed=structuredClone(opened.saved.snapshot);changed.assembly=moduleStep(changed.assembly,'module-1','translate','x',10,'global')
 const edited=await save(api,changed,opened.saveHead.hash)
 assert.deepEqual(edited.parent,combined.parent);assert.deepEqual(edited.snapshot.assembly.modules.map(m=>m.parent),combined.snapshot.assembly.modules.map(m=>m.parent))
 assert.deepEqual(edited.snapshot.photoOrigin,combined.snapshot.photoOrigin)
 assert.deepEqual((await api.dispatch('GET','gallery/items/'+item.id)).assembly,combined.snapshot.assembly)
 for(const p of [a,b])assert.deepEqual((await api.dispatch('GET',`assembly3d/records/${p.assembly.id}/versions/${p.version}`)).snapshot,p.snapshot)
})
test('new Editor-created works save normal immutable versions and publish without Analysis history',async t=>{
 const {api,saved}=await setup(t),template=await saved('Front'),workspaceId=randomUUID(),a=structuredClone(template.snapshot.assembly)
 a.id='creation-'+workspaceId;a.revision=1
 const v1=await api.dispatch('POST','assembly3d/save-editor',{workspaceId,assembly:a,nonRepairable:[]})
 assert.equal(v1.lineage.selected,true);assert.equal(v1.snapshot.photoOrigin.origin.kind,'editor-created')
 const item=(await api.dispatch('POST','gallery/publish',{description:'手工新建',assemblyRef:ref(v1)})).item
 const s=structuredClone(v1.snapshot);s.assembly.revision++;s.assembly.pieces[0].color='#abcdef'
 const v2=await save(api,s,v1.hash);assert.equal(v2.version,2)
 assert.deepEqual((await api.dispatch('GET','gallery/items/'+item.id)).assembly,a)
 await assert.rejects(api.dispatch('POST','assembly3d/save-editor',{workspaceId,assembly:a}),e=>e.statusCode===409)
 await assert.rejects(api.dispatch('POST','assembly3d/save-editor',{workspaceId:randomUUID(),assembly:a}),e=>e.statusCode===409)
})
test('scoped history is read-only and returns no global records; bad hashes fail closed',async t=>{
 const {api,dir,f}=await setup(t),before=await files(dir)
 const empty=await api.dispatch('POST','visible3d/workspace-history',{refs:[],requestIds:[]})
 assert.ok(Object.values(empty).every(x=>x.length===0))
 const wanted=f.plans.Front[1],result=await api.dispatch('POST','visible3d/workspace-history',{refs:[{id:wanted.id,hash:wanted.hash}],requestIds:[]})
 assert.deepEqual(result.plans,[wanted]);assert.equal(result.analyses.length,0);assert.equal(result.executions.length,0)
 await assert.rejects(api.dispatch('POST','visible3d/workspace-history',{refs:[{id:wanted.id,hash:'bad'}],requestIds:[]}),e=>e.statusCode===409)
 assert.deepEqual(await files(dir),before)
})
test('legacy Selected head defaults are read-only; absent pointers never infer a latest Analysis',async t=>{
 const {api,dir,f}=await setup(t),file=path.join(dir,'visible3d','heads',f.source.id+'.json')
 const {writeFile}=await import('node:fs/promises'),raw=JSON.stringify({revision:7,reviewId:f.review.id,reviewHash:f.review.hash})
 await writeFile(file,raw)
 const h=await api.dispatch('GET','visible3d/head/'+f.source.id)
 assert.equal(h.selectedRevision,0);assert.equal(h.analysisId,null);assert.deepEqual(h.groups,{})
 assert.equal(h.reviewId,f.review.id);assert.equal(await readFile(file,'utf8'),raw)
})

test('Create library keeps only its own explicit save receipts and versions',()=>{
 const values=new Map(),base={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}
 const a=workspaceStore(base,{mode:'create',id:randomUUID()}),b=workspaceStore(base,{mode:'create',id:randomUUID()})
 const first={id:'own-a',version:1,hash:'a'.repeat(64)},second={id:'own-b',version:3,hash:'b'.repeat(64)}
 rememberSavedAssembly(a,first);rememberSavedAssembly(a,second)
 assert.deepEqual(ownAssemblyReferences(a),[first,second]);assert.deepEqual(ownAssemblyReferences(b),[])
 const next={...first,version:2,hash:'c'.repeat(64)};rememberSavedAssembly(a,next)
 assert.deepEqual(ownAssemblyReferences(a),[second,next]);assert.deepEqual(ownAssemblyReferences(b),[])
})

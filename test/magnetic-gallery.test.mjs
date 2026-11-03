import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {selectedProject} from './magnetic-selected-project-fixture.mjs'
import {selectFixture} from './magnetic-selected-fixture.mjs'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {moduleStep} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {png} from './magnetic-visible3d-fixtures.mjs'

const ref=r=>({id:r.assembly.id,version:r.version,hash:r.hash})
const save=(api,snapshot,expectedHash=null)=>api.dispatch('POST','assembly3d/save',{snapshot,expectedHash})
const publish=(api,r,description='我的作品')=>api.dispatch('POST','gallery/publish',{description,assemblyRef:ref(r)})
const open=(api,id)=>api.dispatch('GET','gallery/items/'+id)
const snapshot=o=>({assembly:structuredClone(o.assembly),photoOrigin:{origin:o,assemblyRaw:serializeAssembly3D(o.assembly)},nonRepairable:[]})
async function setup(t){
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-gallery-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const api=createMagneticIntake(dir),f=await selectedProject(api)
 async function saved(name='Front'){
  const p=f.plans[name][1],x=f.executions[name][1]
  await selectFixture(api,f.source.id,'plan',p);await selectFixture(api,f.source.id,'execution',x)
  const origin=await api.dispatch('POST','visible3d/adopt',{executionId:x.id,executionHash:x.hash,candidateId:'candidate-1'})
  return save(api,snapshot(origin))
 }
 return {dir,api,f,saved}
}
test('multiple text-only publications survive restart; duplicate/concurrent adds never replace a description',async t=>{
 const {dir,api,saved}=await setup(t),a=await saved(),b=await saved('Back')
 const added=await Promise.all([publish(api,a,'小房子'),publish(api,a,'重复提交不覆盖')]);assert.equal(added.filter(r=>r.created).length,1)
 const second=await publish(api,b,'花园'),list=await api.dispatch('GET','gallery/items')
 assert.equal(list.items.length,2);assert.notEqual(list.items[0].id,list.items[1].id);assert.deepEqual(list.warnings,[])
 const restarted=createMagneticIntake(dir),loaded=await open(restarted,second.item.id)
 assert.deepEqual(loaded.assembly,b.snapshot.assembly);assert.equal(loaded.item.description,'花园')
 assert.equal((await publish(api,a,'再点一次')).item.description,added.find(r=>r.created).item.description)
 const raw=JSON.parse(await readFile(path.join(dir,'gallery',second.item.id+'.json'),'utf8'))
 assert.deepEqual(Object.keys(raw).sort(),['schemaVersion','id','description','assemblyRef','createdAt'].sort())
 assert.deepEqual(raw.assemblyRef,ref(b));assert.equal('snapshot' in raw,false)
})

test('saving newer revisions cannot change a published version, including after all reconstruction history is removed',async t=>{
 const {dir,api,saved}=await setup(t),v1=await saved(),added=await publish(api,v1),s=structuredClone(v1.snapshot)
 s.assembly.revision++;s.assembly.pieces[0].color='#123456'
 const v2=await save(api,s,v1.hash);assert.equal(v2.version,v1.version+1)
 assert.deepEqual((await api.dispatch('GET',`assembly3d/records/${v1.assembly.id}/versions/${v1.version}`)).snapshot,v1.snapshot)
 assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+v1.assembly.id)).snapshot,v2.snapshot)
 for(const folder of ['visible3d','sources','analyses','reviews','reconstructions','origins','profile-registry'])await rm(path.join(dir,folder),{recursive:true,force:true})
 const restarted=createMagneticIntake(dir),loaded=await open(restarted,added.item.id)
 assert.deepEqual(loaded.assembly,v1.snapshot.assembly);assert.deepEqual(loaded.item.assemblyRef,ref(v1))
 assert.equal((await restarted.dispatch('GET','gallery/items')).items.length,1)
 // Only another explicit publication exposes v2, as a separate item in V1.
 const another=await publish(restarted,v2,'新配色');assert.notEqual(another.item.id,added.item.id)
 assert.deepEqual((await open(restarted,added.item.id)).assembly,v1.snapshot.assembly)
 assert.equal((await restarted.dispatch('GET','gallery/items')).items.length,2)
 await assert.rejects(restarted.dispatch('POST','gallery/items/'+added.item.id,{assemblyRef:ref(v2)}),e=>e.statusCode===404)
})

test('Combined publishes its own saved poses and opens without Parent files or selected history',async t=>{
 const {dir,api,saved}=await setup(t),a=await saved(),b=await saved('Back')
 const combined=await api.dispatch('POST','assembly3d/combine',{name:'房子和花园',parents:[ref(a),ref(b)]})
 const s=structuredClone(combined.snapshot);s.assembly=moduleStep(s.assembly,'module-1','translate','x',10,'global');s.assembly.revision++
 assert.equal(validateAssembly3D(s.assembly).valid,true)
 const fixed=await save(api,s,combined.hash),added=await publish(api,fixed,'组合后的作品')
 // Updating a Parent cannot change the Combined publication.
 const parent=structuredClone(a.snapshot);parent.assembly.pieces[0].color='#abcdef';await save(api,parent,a.hash)
 for(const id of [a.assembly.id,b.assembly.id])await rm(path.join(dir,'assembly3d',id),{recursive:true})
 await rm(path.join(dir,'visible3d'),{recursive:true})
 const loaded=await open(createMagneticIntake(dir),added.item.id)
 assert.deepEqual(loaded.assembly,fixed.snapshot.assembly);assert.deepEqual(loaded.assembly.modules,s.assembly.modules)
})

test('Invalid saved snapshots publish without any approval or review files',async t=>{
 const {dir,api,saved}=await setup(t),original=await saved(),s=structuredClone(original.snapshot)
 s.assembly.pieces.push({...structuredClone(s.assembly.pieces[0]),id:'collision-copy'});s.assembly.revision++
 const invalid=await save(api,s,original.hash);assert.equal(validateAssembly3D(s.assembly).valid,false)
 assert.equal('reviewRef' in invalid,false)
 const added=await publish(api,invalid)
 assert.deepEqual((await open(api,added.item.id)).assembly,s.assembly)
 assert.equal(validateAssembly3D((await open(api,added.item.id)).assembly).valid,false)
 await assert.rejects(readdir(path.join(dir,'assembly3d-review')),e=>e.code==='ENOENT')
})

test('Diagnostic drafts publish directly while their saved geometry remains Invalid',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-gallery-diagnostic-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const api=createMagneticIntake(dir),f=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/orange-reviewed-geometry.json',import.meta.url)))
 const post=(route,body)=>api.dispatch('POST','visible3d/'+route,body)
 const source=await api.dispatch('POST','sources',{name:'OFFLINE diagnostic.png',original:png,view:png})
 const analysis=await post('annotate',{sourceId:source.id,evidence:f.input.evidence}),review=await post('reviews',{analysisId:analysis.id,review:f.input.review,expectedRevision:0,thickness:.06})
 const plan=await post('manual-plan',{reviewId:review.record.id,plan:f.plan}),x=(await post('execute',{planId:plan.id,requestId:randomUUID()})).record
 const o=await post('open-diagnostic-draft',{executionId:x.id,executionHash:x.hash,candidateId:x.diagnosticCandidates[0].id})
 const saved=await save(api,snapshot(o)),added=await publish(api,saved,'Diagnostic 作品')
 assert.deepEqual((await open(api,added.item.id)).assembly,o.assembly);assert.equal(validateAssembly3D(o.assembly).valid,false)
})

test('missing/tampered pinned versions never fall back to latest; invalid requests do not publish',async t=>{
 const {dir,api,saved}=await setup(t),v1=await saved(),added=await publish(api,v1)
 for(const assemblyRef of [{id:v1.assembly.id,hash:v1.hash},{...ref(v1),version:0},{...ref(v1),version:999},{...ref(v1),hash:'0'.repeat(64)},{...ref(v1),id:'../outside'}])await assert.rejects(api.dispatch('POST','gallery/publish',{description:'不应保存',assemblyRef}))
 for(const description of ['', '  ', 'x'.repeat(501)])await assert.rejects(publish(api,v1,description))
 const v2=structuredClone(v1.snapshot);v2.assembly.revision++;v2.assembly.pieces[0].color='#123456';await save(api,v2,v1.hash)
 const filename=path.join(dir,'assembly3d',v1.assembly.id,String(v1.version).padStart(12,'0')+'.json'),raw=await readFile(filename)
 const corrupt=JSON.parse(raw);corrupt.snapshot.assembly.pieces[0].color='#abcdef';await writeFile(filename,JSON.stringify(corrupt))
 await assert.rejects(open(api,added.item.id),e=>e.statusCode===409)
 await rm(filename);await assert.rejects(open(api,added.item.id),e=>e.statusCode===404)
 assert.equal((await readdir(path.join(dir,'gallery'))).filter(n=>n.endsWith('.json')).length,1)
})

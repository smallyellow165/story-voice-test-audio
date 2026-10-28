import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,cp,readFile,writeFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createGalleryStore,aggregateGalleryParts} from '../server/brick-gallery.mjs'
import {createBuildOrderStore} from '../server/brick-build-order.mjs'
import {createSelectedSpatialStore} from '../server/brick-selected-spatial.mjs'
import {createSourceImageStore} from '../server/brick-source-images.mjs'
import {createBrickReverse} from '../server/brick-reverse.mjs'
import {stepScene} from '../src/brick-build/plan.mjs'
const samples=[['Penguin','77d99b0e-9c62-4ba6-b655-bcf1a8db5828','426f27c7-a9a9-4ee9-9965-39e1cd9e30f8',12,11],['Camel','3ed40ce2-be18-423f-ba35-70e36d6760a9','6ed1bf38-f3e7-47bf-8dc1-4e34993faeba',7,6],['Rooster','cce60109-271b-4fe7-847d-b4f0550c84d2','ba8b0138-9f1c-4ad1-97b4-ec987cd2615f',9,8]]
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'gallery-'));t.after(()=>rm(root,{recursive:true,force:true}))
 for(const folder of ['brick-source-images','brick-reverse','brick-spatial-traces','brick-spatial-selections','brick-spatial-geometry','brick-parts-inputs','brick-build-plans'])await cp('generated/'+folder,path.join(root,folder),{recursive:true})
 const images=createSourceImageStore(path.join(root,'brick-source-images')),reverse=createBrickReverse(path.join(root,'brick-reverse'),{sourceImages:images}),buildOrder=createBuildOrderStore(root),selectedSpatial=createSelectedSpatialStore(root,{reverse,sourceImages:images})
 const make=()=>createGalleryStore(root,{sourceImages:images,reverse,buildOrder,selectedSpatial})
 const gallery=make(),d=await gallery.resolve(samples[0][1],samples[0][2])
 const body={layoutSelectionId:d.source.id,buildPlanId:d.plan.build_plan_id,title:'小企鹅',description:'一起搭企鹅',cover:{kind:'source-image',imageId:d.sourceImageId},expectedRevision:null}
 return {root,gallery,make,body}
}
test('three real saved plans: strict lineage, exact detail assembly, complete ordered player scenes and canonical covers',async t=>{
 const f=await fixture(t)
 for(const [name,selection,plan,bricks,steps]of samples){
  const d=await f.gallery.resolve(selection,plan)
  assert.equal(d.brickCount,bricks);assert.equal(d.stepCount,steps);assert.equal(d.canBuild,true)
  const before=await readFile(path.join(f.root,'brick-build-plans',plan+'.json'))
  const saved=await f.gallery.save({...f.body,title:name,layoutSelectionId:selection,buildPlanId:plan,cover:{kind:'source-image',imageId:d.sourceImageId}})
  const loaded=await f.make().detail(saved.item.id)
  assert.deepEqual(loaded.source.assembly,d.source.assembly);assert.deepEqual(loaded.plan,d.plan)
  assert.equal(loaded.parts.reduce((n,p)=>n+p.quantity,0),bricks)
  for(let i=0;i<steps;i++)assert.deepEqual(stepScene(loaded.plan,loaded.source.assembly.bricks,i).step,loaded.plan.steps[i])
  const last=stepScene(loaded.plan,loaded.source.assembly.bricks,steps-1)
  assert.deepEqual(new Set(last.result.map(b=>b.id)),new Set(loaded.source.assembly.bricks.map(b=>b.id)))
  assert.ok((await f.gallery.cover(saved.item.id)).imageBase64)
  assert.deepEqual(await readFile(path.join(f.root,'brick-build-plans',plan+'.json')),before)
 }
 assert.equal((await f.make().list()).items.length,3)
})
test('layout-only never enables building; mismatched, unsaved and incomplete Plans reject',async t=>{
 const f=await fixture(t)
 const saved=await f.gallery.save({...f.body,buildPlanId:null});const d=await f.gallery.detail(saved.item.id)
 assert.equal(d.canBuild,false);assert.equal(d.plan,null);assert.equal(d.stepCount,0)
 await assert.rejects(f.gallery.save({...f.body,buildPlanId:samples[1][2]}),/不一致/)
 await assert.rejects(f.gallery.save({...f.body,buildPlanId:randomUUID()}),/ENOENT/)
 const file=path.join(f.root,'brick-build-plans',f.body.buildPlanId+'.json'),p=JSON.parse(await readFile(file));p.steps.pop();await writeFile(file,JSON.stringify(p))
 await assert.rejects(f.gallery.save(f.body))
})
test('duplicate adds are idempotent; CAS edits preserve sources; concurrent stores cannot silently overwrite',async t=>{
 const f=await fixture(t),original=await readFile(path.join(f.root,'brick-spatial-selections',f.body.layoutSelectionId+'.json'))
 const a=await f.gallery.save(f.body),b=await f.make().save({...f.body,title:'重复点击不覆盖'})
 assert.equal(a.item.id,b.item.id);assert.equal(b.created,false);assert.equal(b.item.title,'小企鹅')
 const update={...f.body,id:a.item.id,expectedRevision:1,title:'企鹅朋友',description:'新介绍'}
 const attempts=await Promise.allSettled([f.gallery.save(update),f.make().save(update)])
 assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);assert.equal(attempts.find(a=>a.status==='rejected').reason.statusCode,409)
 const edited=await f.make().detail(a.item.id);assert.equal(edited.item.title,'企鹅朋友');assert.equal(edited.item.revision,2)
 await assert.rejects(f.gallery.save(update),/已被其他/)
 await assert.rejects(f.gallery.save({...update,expectedRevision:2,layoutSelectionId:samples[1][1]}),/不能更换/)
 const camel=await f.gallery.resolve(samples[1][1],samples[1][2])
 await f.gallery.save({...update,expectedRevision:2,cover:{kind:'source-image',imageId:camel.sourceImageId}})
 assert.equal((await f.make().detail(a.item.id)).item.cover.imageId,camel.sourceImageId)
 assert.deepEqual(await readFile(path.join(f.root,'brick-spatial-selections',f.body.layoutSelectionId+'.json')),original)
 assert.equal((await readdir(path.join(f.root,'brick-gallery'))).filter(f=>f.endsWith('.json')).length,1)
})
test('damaged upstream and cover evidence are surfaced without repairs',async t=>{
 const f=await fixture(t),saved=await f.gallery.save(f.body)
 const selection=path.join(f.root,'brick-spatial-selections',f.body.layoutSelectionId+'.json'),r=JSON.parse(await readFile(selection));r.candidateHash='bad';await writeFile(selection,JSON.stringify(r))
 const list=await f.gallery.list();assert.equal(list.items.length,0);assert.equal(list.warnings.length,1)
 await assert.rejects(f.gallery.detail(saved.item.id));assert.equal(JSON.parse(await readFile(selection)).candidateHash,'bad')
 await assert.rejects(f.gallery.save({...f.body,cover:{kind:'url',url:'http://example.com'}}),/正式 Source Image/)
})
test('inventory aggregates exact part and color, retaining printed identity and instance counts',()=>{
 const bricks=[{id:'a',part:'shape',color:'4'},{id:'b',part:'shape',color:'4'},{id:'c',part:'shape',color:'1'},{id:'d',part:'shape',color:'4'}]
 const source={assembly:{bricks},identities:bricks.map(b=>({id:b.id,partNumber:b.id==='d'?'printed':'ordinary'}))}
 const rows=aggregateGalleryParts(source,{PARTS:[{id:'shape',label:'2×2'}]},new Map([['4',{name:'Red',hex:'#FF0000'}],['1',{name:'Blue',hex:'#0000FF'}]]))
 assert.deepEqual(rows.map(r=>[r.partNumber,r.colorCode,r.quantity]),[['ordinary','4',2],['ordinary','1',1],['printed','4',1]])
 assert.throws(()=>aggregateGalleryParts({...source,identities:[]},{PARTS:[]},new Map()),/来源/)
})
test('a corrupt metadata file cannot redirect edits to another Gallery identity',async t=>{
 const f=await fixture(t),saved=await f.gallery.save(f.body),file=path.join(f.root,'brick-gallery',saved.item.id+'.json')
 const corrupt={...saved.item,id:randomUUID()};await writeFile(file,JSON.stringify(corrupt))
 await assert.rejects(f.gallery.save({...f.body,id:saved.item.id,expectedRevision:1}),/身份不一致/)
 await assert.rejects(f.gallery.save(f.body),/身份不一致/)
 assert.deepEqual(JSON.parse(await readFile(file)),corrupt)
 assert.equal((await readdir(path.join(f.root,'brick-gallery'))).filter(n=>n.endsWith('.json')).length,1)
})

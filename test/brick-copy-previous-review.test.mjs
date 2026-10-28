import { sourceImageFixture } from './source-image-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createBrickReverse} from '../server/brick-reverse.mjs'
async function setup(t){
 const dir=await mkdtemp(path.join(tmpdir(),'copy-review-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const previous=randomUUID(),current=randomUUID(),searchId=randomUUID()
 const obs=id=>({id,color_id:null,size:null,shape:null,print:'unknown',quantity:1,bbox:null,confidence:.5,visible_studs:null,evidence:'new evidence',occlusion:'unknown'})
 const imageFields=await sourceImageFixture(dir)
 const record=(id,time)=>({...imageFields,id,createdAt:time,kind:'reverse-analysis',status:'complete',source:{kind:'full'},analysis:{appearance:'test',observations:[obs('same'),obs('new')],relations:[],unknowns:[]}})
 const put=(name,value)=>writeFile(path.join(dir,name),JSON.stringify(value))
 await put(previous+'.json',record(previous,'2026-01-01'));await put(current+'.json',record(current,'2026-01-02'))
 const features={partNumber:'3437',color:'0',size:'2x2',width_studs:'2',depth_studs:'2',height_brick_units:'1.0',shape:'brick',print:'unknown'}
 const row={features,quantity:'2',excluded:false,reason:'user note',searchId,index:0}
 await put(searchId+'.json',{id:searchId,kind:'reverse-search',analysisId:previous,observationId:'same',partNumber:'3437',rows:[{sourceAllowed:true,source:{part_num:'3437',color_id:0},target:{part:'3437',color:'0'},errors:[]}]})
 await put(previous+'.json.review',{analysisId:previous,updatedAt:'saved',rows:{same:row,removed:{...row,searchId:undefined,index:undefined}}})
 const service=createBrickReverse(dir,{callModel:()=>assert.fail('No LLM'),getCatalog:()=>assert.fail('No Catalog')})
 return {dir,previous,current,service,row,put}
}
test('copy reads exact saved fields and confirmations without writes; save and reload preserve copied confirmation',async t=>{
 const f=await setup(t),before=await readdir(f.dir),old=await readFile(path.join(f.dir,f.previous+'.json.review'),'utf8'),raw=await readFile(path.join(f.dir,f.current+'.json'),'utf8')
 const copy=await f.service.previousReview(f.current)
 assert.equal(copy.analysisId,f.previous);assert.deepEqual(copy.rows.same.features,f.row.features);assert.equal(copy.rows.same.quantity,'2');assert.equal(copy.rows.same.index,0)
 assert.deepEqual(await readdir(f.dir),before)
 const current=(await f.service.restore(f.current)).rows
 // Same UI rule: only matching IDs; single-row copy leaves new unchanged.
 const untouched=structuredClone(current.new);current.same=copy.rows.same
 const rows=Object.fromEntries(Object.entries(current).map(([id,r])=>[id,{...r,searchId:r.search?.id}]))
 const result=await f.service.saveReview({analysisId:f.current,rows})
 assert.notEqual(result.copiedSearches.same.id,f.row.searchId)
 const restored=await f.service.restore(f.current)
 assert.deepEqual(restored.rows.same.features,f.row.features);assert.equal(restored.rows.same.index,0);assert.equal(restored.rows.same.quantity,'2')
 assert.deepEqual(restored.rows.new,untouched);assert.equal(restored.rows.removed,undefined)
 assert.equal(await readFile(path.join(f.dir,f.previous+'.json.review'),'utf8'),old);assert.equal(await readFile(path.join(f.dir,f.current+'.json'),'utf8'),raw)
})
test('direct predecessor without Review does not skip to an older saved run; oldest has no previous',async t=>{
 const f=await setup(t),middle=randomUUID()
 await f.put(middle+'.json',{...await sourceImageFixture(f.dir),id:middle,kind:'reverse-analysis',createdAt:'2026-01-01T12:00:00'})
 assert.match((await f.service.previousReview(f.current)).message,/没有保存/)
 assert.deepEqual((await f.service.previousReview(f.previous)).rows,{})
})
test('unconfirmed and excluded fields copy verbatim, no Analysis evidence copied',async t=>{
 const f=await setup(t),row={features:{color:'',size:'',shape:'',print:'unknown',height_brick_units:''},quantity:'3',excluded:true,reason:'hidden'}
 await f.put(f.previous+'.json.review',{analysisId:f.previous,rows:{same:row}})
 const copied=(await f.service.previousReview(f.current)).rows.same
 for(const key of Object.keys(row))assert.deepEqual(copied[key],row[key])
 assert.equal(copied.index,undefined)
 for(const key of ['bbox','relations','anchors','evidence'])assert.equal(key in copied,false)
})

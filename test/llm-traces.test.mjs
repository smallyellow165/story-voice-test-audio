import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createLlmTraceStore,shareText} from '../server/llm-traces.mjs'

test('sanitizes credentials and provider image formats without truncating text',()=>{
 const tail='x'.repeat(200000)+'END'
 const result=shareText(JSON.stringify({Authorization:'Bearer private',headers:{'x-api-key':'private',Cookie:'private'},input:[{image_url:'data:image/png;base64,AAAA'}],inlineData:{mimeType:'image/png',data:'AAAA'},nested:JSON.stringify({api_key:'private'}),tail}))
 assert.ok(!result.text.includes('private'));assert.ok(!result.text.includes('AAAA'))
 assert.equal(JSON.parse(result.text).tail,tail);assert.equal(result.changes.images,2)
 assert.equal(shareText('hello\nworld').text,'hello\nworld')
 assert.ok(!shareText('Authorization: Bearer private\nCookie: private').text.includes('private'))
})
test('metadata only, canonical raw files, missing wire data stays unavailable',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'llm-traces-'))
 const id='11111111-1111-1111-1111-111111111111'
 try{
 await mkdir(path.join(root,'brick-reverse'))
 const prefix=path.join(root,'brick-reverse',id)
 await writeFile(prefix+'.json',JSON.stringify({id,kind:'reverse-analysis',createdAt:'2026-01-01',analysis:{observations:[]},request:{fake:'prepared'},rawOutput:'not wire',rawRequestPath:'/etc/passwd'}))
 const store=createLlmTraceStore(root),list=await store.list()
 assert.equal(list.items.length,1);assert.equal(list.items[0].analysis,undefined)
 let d=await store.detail('reverse',id)
 assert.equal(d.request.available,false);assert.equal(d.response.available,false);assert.equal(d.parsed.available,true)
 await writeFile(prefix+'.request.json','{"model":"actual-model"}')
 await writeFile(prefix+'.response.txt','original non-JSON reply')
 d=await store.detail('reverse',id)
 assert.equal(JSON.parse(d.request.text).model,'actual-model');assert.equal(d.response.text,'original non-JSON reply')
 await assert.rejects(()=>store.detail('reverse','../../etc/passwd'))
 await assert.rejects(()=>store.detail('other',id))
 }finally{await rm(root,{recursive:true,force:true})}
})
test('three specified historical records resolve actual request, response and parsed data unchanged',async()=>{
 const root=path.resolve('generated'),store=createLlmTraceStore(root),list=await store.list()
 for(const [source,id,dir,field]of [
 ['reverse','80a0ad1a-db21-4f5d-ba3b-96215e1aed83','brick-reverse','analysis'],
 ['spatial','b052f246-bce4-4a43-93aa-69de7572c0fe','brick-spatial-traces','plan'],
 ['spatial','966c3208-b20f-4e73-89be-f8c390fefa65','brick-spatial-traces','plan']]){
 const prefix=path.join(root,dir,id),before=await readFile(prefix+'.json','utf8'),r=JSON.parse(before)
 assert.ok(list.items.some(x=>x.id===id&&x.source===source))
 const d=await store.detail(source,id)
 assert.equal(d.request.text,shareText(await readFile(prefix+'.request.json','utf8')).text)
 assert.equal(d.response.text,shareText(await readFile(prefix+'.response.txt','utf8')).text)
 assert.equal(d.parsed.text,shareText(JSON.stringify(r[field])).text)
 assert.equal(d.provider,r.provider);assert.equal(d.model,r.model)
 assert.equal(await readFile(prefix+'.json','utf8'),before)
 }
 assert.deepEqual(list.items.map(x=>x.createdAt),list.items.map(x=>x.createdAt).sort().reverse())
})

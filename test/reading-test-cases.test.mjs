import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore, validateCase, caseDirectory } from '../server/reading-test-cases.mjs'
import { ReadingWorkbench } from '../src/reading-workbench.ts'
import { runV2 } from '../server/reading-v2.mjs'
import { reference, events } from './fixtures/reading-jingyesi-observed.mjs'
const data={name:'测试',reference:'春眠不觉晓',stt_sequence:[['P','春'],['F','春年不绝小']],note:'人工构造'}
test('persistent JSON, create unique, overwrite revision protection, path and symlink guards',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reading-case-test-'))
 try {
  const store=createCaseStore(dir), saved=await store.save({data})
  assert.deepEqual(JSON.parse(await readFile(join(dir,saved.id),'utf8')),data)
  assert.deepEqual((await createCaseStore(dir).list()).cases[0],saved)
  const second=await store.save({data});assert.notEqual(second.id,saved.id)
  await assert.rejects(store.save({data,id:saved.id}),/覆盖凭据/)
  const updated=await store.save({data:{...data,note:'changed'},id:saved.id,expectedRevision:saved.revision})
  await assert.rejects(store.save({data,id:saved.id,expectedRevision:saved.revision}),/文件已变化/)
  assert.equal((await store.read(saved.id)).revision,updated.revision)
  for(const id of ['../escape.json','/tmp/escape.json','x/y.json','a.txt']) await assert.rejects(store.read(id),/非法文件名/)
  await symlink(join(dir,saved.id),join(dir,'link.json'))
  await assert.rejects(store.save({data,id:'link.json',expectedRevision:updated.revision}),/符号链接/)
  assert.equal((await store.list()).errors.length,1)
 } finally {await rm(dir,{recursive:true,force:true})}
})
test('reject outputs, parameters, invalid P/F and oversized data',()=>{
 for(const value of [{...data,cursor:4},{...data,parameters:{}},{...data,stt_sequence:[['pause','']]},{...data,stt_sequence:[]},{...data,name:''},{...data,reference:'x'.repeat(20001)}]) assert.throws(()=>validateCase(value))
})
test('seed provenance and existing Jingyesi data; Chunxiao Load does not Match; same Python core result',async()=>{
 const list=await createCaseStore(caseDirectory).list()
 const c=list.cases.find(c=>c.id==='chunxiao.json').data,j=list.cases.find(c=>c.id==='jingyesi.json').data
 assert.match(c.note,/截图重建/);assert.match(j.note,/截图重建/)
 assert.equal(j.reference,reference);assert.deepEqual(j.stt_sequence,events.map(e=>[e.final?'F':'P',e.text]))
 const w=new ReadingWorkbench();w.draftReference=c.reference;w.draftSequence=JSON.stringify(c.stt_sequence);w.load();assert.equal(w.last,undefined)
 w.strategy='V2';await w.matchV2(runV2);assert.equal(w.last.v2.rows.at(-1).matching.candidate_cursor,4)
})

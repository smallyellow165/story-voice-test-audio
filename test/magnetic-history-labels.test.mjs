import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {historyTime,analysisHistoryLabel,reviewHistoryLabel,planningHistoryLabel,reconstructionHistoryLabel} from '../src/magnetic-tiles/three-d/reconstruction/history-labels.ts'

const timestamp='2026-11-05T07:29:01.558Z',zone='America/Los_Angeles',entry={createdAt:timestamp}
test('display time uses the supplied server zone, with date rollover, DST, midnight and non-hour offsets',()=>{
 assert.equal(historyTime(timestamp,zone),'11/04 23:29')
 assert.equal(historyTime(timestamp,'UTC'),'11/05 07:29')
 assert.equal(historyTime(timestamp,'Asia/Kathmandu'),'11/05 13:14')
 assert.equal(historyTime('2026-07-05T07:00:00Z',zone),'07/05 00:00')
 assert.equal(historyTime('2026-11-01T08:30:00Z',zone),'11/01 01:30')
 assert.equal(historyTime('2026-11-01T09:30:00Z',zone),'11/01 01:30')
 for(const [date,tz]of [[undefined,zone],['invalid',zone],[timestamp,undefined],[timestamp,'invalid-zone']])assert.equal(historyTime(date,tz),'')
})
test('Analysis shows actual input metadata and reviewability; completed alone never means reviewable or reviewed',()=>{
 const source={images:[{name:'folder/1.png',role:'Step'},{name:'folder/2.png',role:'Final'}]},saved={createdAt:timestamp}
 assert.equal(analysisHistoryLabel(entry,saved,source,zone),'11/04 23:29 · 2图 · Final: 2.png · 待审核')
 const request={id:'hidden-request-id',kind:'analyze',state:'complete',createdAt:timestamp}
 assert.equal(analysisHistoryLabel({...entry,request},undefined,source,zone),'11/04 23:29 · 2图 · Final: 2.png · 已完成（无可审核结果）')
 assert.match(analysisHistoryLabel({...entry,request:{...request,usable:false,trace:{id:'trace',validation:{valid:false}}}},undefined,source,zone),/校验失败$/)
 assert.match(analysisHistoryLabel({...entry,request:{...request,state:'running'}},undefined,source,zone),/识别中$/)
 assert.match(analysisHistoryLabel({...entry,request:{...request,state:'timeout'}},undefined,source,zone),/超时$/)
 assert.match(analysisHistoryLabel({...entry,request:{...request,state:'running',trace:{id:'trace',background:{state:'timeout',responseId:'hidden-response-id'}}}},undefined,source,zone),/超时$/)
 assert.match(analysisHistoryLabel({...entry,request:{...request,state:'failed'}},undefined,source,zone),/失败$/)
 assert.match(analysisHistoryLabel(entry,{analysisValidation:{state:'reviewable'}},source,zone),/待审核（含诊断）$/)
 assert.equal(analysisHistoryLabel(entry,saved,{images:[{name:'not-final.png',role:'Unknown'}]},zone),'11/04 23:29 · 1图 · 待审核')
 assert.equal(analysisHistoryLabel({},undefined,undefined,undefined),'')
})
test('Review and Planning count only saved record members, omit missing data and never mutate records',()=>{
 const review={...entry,input:{review:{pieces:Array(24).fill({id:'hidden'})}}},plan={...entry,plan:{parts:Array(8).fill({id:'hidden'})}},before=structuredClone({review,plan})
 assert.equal(reviewHistoryLabel(review,zone),'11/04 23:29 · 24实例 · 已保存')
 assert.equal(planningHistoryLabel(plan,zone),'11/04 23:29 · 8实例 · 已完成')
 assert.equal(reviewHistoryLabel(entry,zone),'11/04 23:29 · 已保存')
 assert.equal(planningHistoryLabel(entry,zone),'11/04 23:29 · 已完成')
 assert.deepEqual({review,plan},before)
})
test('Reconstruction coverage and Geometry status come from the same real default candidate',()=>{
 const candidate=(n,valid)=>({geometry:{valid},coverage:{reconstructed:Array(n).fill('tile'),totalConfirmed:24}})
 assert.equal(reconstructionHistoryLabel({...entry,candidates:[],diagnosticCandidates:[candidate(18,false)]},zone),'11/04 23:29 · 18/24块 · Geometry Invalid')
 assert.equal(reconstructionHistoryLabel({...entry,status:'candidates_found',candidates:[candidate(18,true),candidate(24,true)]},zone),'11/04 23:29 · 24/24块 · Geometry Valid')
 assert.equal(reconstructionHistoryLabel({...entry,candidates:[candidate(18,true)]},zone),'11/04 23:29 · 18/24块 · Geometry Valid / 部分重建')
 assert.match(reconstructionHistoryLabel({...entry,status:'budget_exhausted',diagnosticCandidates:[candidate(24,false)]},zone),/Geometry Invalid \/ 预算耗尽$/)
 assert.equal(reconstructionHistoryLabel(entry,zone),'11/04 23:29')
})
test('all labels are single-line and omit technical IDs; path/newline cleanup is display-only',()=>{
 const source={images:[{name:'folder/line\nbreak.png',role:'Final'}]},before=structuredClone(source),record={...entry,id:'private-uuid',hash:'private-hash'}
 const text=analysisHistoryLabel(record,record,source,zone)
 assert.equal(text,'11/04 23:29 · 1图 · Final: line break.png · 待审核');assert.ok(!text.includes('private'));assert.deepEqual(source,before)
})
test('status reports the server runtime configured zone without changing history or persisted timestamps',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'history-zone-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir),old=process.env.TZ
 try{for(const tz of ['America/New_York','Asia/Kathmandu']){process.env.TZ=tz;const status=await api.dispatch('GET','visible3d/status');assert.equal(status.displayTimeZone,new Intl.DateTimeFormat().resolvedOptions().timeZone);assert.equal(historyTime(timestamp,status.displayTimeZone),tz==='Asia/Kathmandu'?'11/05 13:14':'11/05 02:29')}}
 finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old}
})

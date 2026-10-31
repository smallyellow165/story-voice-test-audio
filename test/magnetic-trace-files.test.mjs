import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createMagneticTraceFiles,assertLocalTraceRequest,revealTraceFile} from '../server/magnetic-trace-files.mjs'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
const request=()=>({method:'POST',socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:5173',origin:'http://localhost:5173','sec-fetch-site':'same-origin'}})
async function setup(t){
 const root=await mkdtemp(path.join(tmpdir(),'trace-files-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=path.join(root,'generated/magnetic-intake'),api=createMagneticIntake(directory),f=await visibleFixture(),s=await api.dispatch('POST','sources',{name:'offline.png',original:png,view:png}),a=await api.dispatch('POST','visible3d/annotate',{sourceId:s.id,evidence:f.evidence}),r=(await api.dispatch('POST','visible3d/reviews',{analysisId:a.id,review:f.review,expectedRevision:0})).record,p=await api.dispatch('POST','visible3d/manual-plan',{reviewId:r.id,plan:f.plan}),x=(await api.dispatch('POST','visible3d/execute',{planId:p.id,requestId:randomUUID()})).record,revealed=[]
 const service=createMagneticTraceFiles({projectRoot:root,directory,intake:api,enabled:true,reveal:async file=>{revealed.push(file);return {selected:true,message:'offline file-manager spy'}}}),base={mode:'visible3d',sourceId:s.id,sourceHash:s.hash,analysisId:a.id,analysisHash:a.hash,reviewId:r.id,reviewHash:r.hash}
 return {root,directory,api,s,a,r,p,x,service,base,revealed}
}
test('stage files use existing immutable records and current IDs; no runtime files are fabricated',async t=>{
 const f=await setup(t),call=(tab,extra={})=>f.service.dispatch(request(),'files',{...f.base,tab,...extra})
 const parts=await call('parts');assert.equal(parts.primary,path.join(f.directory,'visible3d/reviews',f.r.id+'.json'));assert.ok(parts.files.some(p=>p.path.endsWith('analyses/'+f.a.id+'.json')));assert.ok(parts.files.some(p=>p.path.endsWith('sources/'+f.s.id+'.json')))
 const plan=await call('spatial',{planId:f.p.id,planHash:f.p.hash});assert.equal(plan.primary,path.join(f.directory,'visible3d/plans',f.p.id+'.json'))
 const execution=await call('execution',{planId:f.p.id,executionId:f.x.id,executionHash:f.x.hash});assert.equal(execution.primary,path.join(f.directory,'visible3d/executions',f.x.id+'.json'))
 assert.equal((await call('execution')).available,false);assert.equal((await call('spatial')).primary,null)
 await f.service.dispatch(request(),'reveal',{...f.base,tab:'parts'});assert.deepEqual(f.revealed,[parts.primary])
 await assert.rejects(call('parts',{reviewHash:'a'.repeat(64)}),/Hash/);await assert.rejects(call('execution',{executionId:randomUUID()}),/不存在/)
 const other=await f.api.dispatch('POST','visible3d/manual-plan',{reviewId:f.r.id,plan:f.p.plan});assert.equal((await call('spatial',{planId:other.id})).primary,path.join(f.directory,'visible3d/plans',other.id+'.json'))
 assert.deepEqual((await f.api.dispatch('GET','visible3d/reviews/'+f.r.id)).record,f.r)
})
test('failed Planning resolves the complete trace and captured sidecars via exact source/review provenance',async t=>{
 const f=await setup(t),id=randomUUID(),requestId=randomUUID(),trace={id,status:'invalid_plan',sources:[{sourceId:f.s.id,sourceHash:f.s.hash,reviewId:f.r.id,reviewHash:f.r.hash}],validation:{valid:false,issues:['offline fixture']}}
 await mkdir(path.join(f.directory,'visible3d/model-traces'));await writeFile(path.join(f.directory,'visible3d/model-traces',id+'.json'),JSON.stringify(trace));await writeFile(path.join(f.directory,'visible3d/model-traces',id+'.request.json'),'{}')
 const stored={id:requestId,kind:'plan',state:'complete',usable:false,trace};await writeFile(path.join(f.directory,'visible3d/requests',requestId+'.json'),JSON.stringify(stored))
 const body={...f.base,tab:'spatial',requestId},r=await f.service.dispatch(request(),'files',body);assert.equal(r.primary,path.join(f.directory,'visible3d/model-traces',id+'.json'));assert.ok(r.files.some(f=>f.path.endsWith('.request.json')));assert.ok(r.missing.some(s=>s.includes('Raw Response')))
 await assert.rejects(f.service.dispatch(request(),'files',{...body,reviewId:randomUUID()}),/不存在/)
 stored.trace.sources[0].reviewHash='a'.repeat(64);await writeFile(path.join(f.directory,'visible3d/requests',requestId+'.json'),JSON.stringify(stored));await assert.rejects(f.service.dispatch(request(),'reveal',body),/来源/);assert.equal(f.revealed.length,0)
})
test('2D Parts uses saved Review; runtime spatial evidence has no file until a Reconstruction is saved',async t=>{
 const f=await setup(t),evidence={sourceKind:'diagram',reason:'offline fixture',observations:[{id:'p1',profileId:'square',profileVersion:1,color:'#55b8ac',outline:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]],confidence:1,evidence:'offline square',uncertainty:'',origin:'observed',excluded:false}],relations:[]},a={schemaVersion:1,id:randomUUID(),sourceId:f.s.id,sourceHash:f.s.hash,status:'complete',evidence,createdAt:new Date().toISOString()},analysis={...a,hash:await contentHash(a)}
 await mkdir(path.join(f.directory,'analyses'));await writeFile(path.join(f.directory,'analyses',a.id+'.json'),JSON.stringify(analysis))
 const review=await f.api.dispatch('POST','reviews',{analysisId:a.id,analysisHash:analysis.hash,evidence}),body={mode:'2d',analysisId:a.id,reviewId:review.id}
 const parts=await f.service.dispatch(request(),'files',{...body,tab:'parts'});assert.equal(parts.primary,path.join(f.directory,'reviews',review.id+'.json'))
 const unsaved=await f.service.dispatch(request(),'files',{...body,tab:'spatial'});assert.equal(unsaved.available,false);assert.match(unsaved.note,/运行时证据推导/)
 const reconstruction=await f.api.dispatch('POST','reconstruct',{reviewId:review.id,reviewHash:review.hash})
 for(const tab of ['spatial','execution','conflicts']){const files=await f.service.dispatch(request(),'files',{...body,tab,reconstructionId:reconstruction.id});assert.equal(files.primary,path.join(f.directory,'reconstructions',reconstruction.id+'.json'))}
})
test('local-development gate blocks production, remote, proxies, cross-origin and missing origin before touching a file',()=>{
 for(const r of [request(),{...request(),socket:{remoteAddress:'192.168.1.5'}},{...request(),headers:{...request().headers,host:'evil.example'}},{...request(),headers:{...request().headers,origin:'https://evil.example'}},{...request(),headers:{...request().headers,'x-forwarded-for':'8.8.8.8'}},{...request(),headers:{host:'localhost:5173'}}]){
  if(r===undefined)continue
  if(r.socket.remoteAddress==='127.0.0.1'&&r.headers.origin==='http://localhost:5173'&&Object.keys(r.headers).length===3)assert.throws(()=>assertLocalTraceRequest(r,false),/开发环境/)
  else assert.throws(()=>assertLocalTraceRequest(r,true),/仅允许|同源/)
 }
 assert.doesNotThrow(()=>assertLocalTraceRequest(request(),true))
 assert.doesNotThrow(()=>assertLocalTraceRequest({...request(),socket:{remoteAddress:'::1'},headers:{host:'[::1]:5173',origin:'http://[::1]:5173'}},true))
})
test('arbitrary paths, command fields, traversal, escaped symlinks and missing files never reach the launcher',async t=>{
 const f=await setup(t)
 for(const extra of [{path:'/etc/passwd'},{command:'touch unwanted'},{analysisId:'../../etc/passwd'},{reviewId:'$(id)'}])await assert.rejects(f.service.dispatch(request(),'reveal',{...f.base,tab:'parts',...extra}),/不接受|无效/)
 const target=path.join(f.directory,'visible3d/reviews',f.r.id+'.json'),external=await mkdtemp(path.join(tmpdir(),'trace-outside-'));t.after(()=>rm(external,{recursive:true,force:true}));await writeFile(path.join(external,'outside.json'),await readFile(target));await rm(target);await symlink(path.join(external,'outside.json'),target)
 await assert.rejects(f.service.dispatch(request(),'reveal',{...f.base,tab:'parts'}),/项目之外/);await rm(target);await assert.rejects(f.service.dispatch(request(),'reveal',{...f.base,tab:'parts'}),/不存在/);assert.equal(f.revealed.length,0)
})
test('file-manager calls use fixed argv without a shell; GUI failures are explicit and directory fallback is acknowledged',async()=>{
 const env={DISPLAY:':test',DBUS_SESSION_BUS_ADDRESS:'unix:path=/offline'},calls=[],file='/tmp/path with spaces/$(untrusted).json',run=async(...args)=>{calls.push(args);return {stdout:'()'}}
 const r=await revealTraceFile(file,{env,run,platform:'linux'});assert.equal(r.selected,true);assert.equal(calls[0][0],'gdbus');assert.equal(calls[0][2].shell,false);assert.ok(calls[0][1].includes('org.freedesktop.FileManager1.ShowItems'));assert.ok(calls[0][1].includes(JSON.stringify([pathToFileURL(file).href])))
 const fallback=await revealTraceFile(file,{env,platform:'linux',run:async(_cmd,args)=>{if(args.includes('org.freedesktop.FileManager1.ShowItems'))throw Error('unsupported');return {stdout:'()'}}});assert.equal(fallback.selected,false)
 await assert.rejects(revealTraceFile(file,{env:{},run,platform:'linux'}),/图形桌面/)
 await assert.rejects(revealTraceFile(file,{env,platform:'linux',run:async()=>{throw Error('no FileManager1 service')}}),/no FileManager1/)
})

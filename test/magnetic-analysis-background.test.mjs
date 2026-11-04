import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {multiFixture} from './magnetic-multi-image-fixtures.mjs'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {analysisDisplay,analysisRequest} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-display.ts'

// All provider traffic is intercepted before the first transport is installed.
// No fixture or fake provider enters normal runtime.
const originalFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY
let provider,calls=[]
before(()=>{process.env.OPENAI_API_KEY='offline-background-test';globalThis.fetch=async(url,init)=>{assert.ok(String(url).startsWith('https://api.openai.com/v1/responses'));const call={url:String(url),method:init.method,body:init.body?JSON.parse(init.body):null};calls.push(call);return provider(call,init)}})
after(()=>{globalThis.fetch=originalFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey})
const response=(status='queued',value=null,id='resp_offline_saved')=>new Response(JSON.stringify({id,model:'gpt-6.1-sol',status,output:value?[{content:[{type:'output_text',text:JSON.stringify(value)}]}]:[],usage:status==='completed'?{input_tokens:42,output_tokens:84,total_tokens:126}:null}),{headers:{'x-request-id':'req_offline_only','Content-Type':'application/json'}})
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'magnetic-background-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));calls=[];const f={dir,...await multiFixture(dir)};f.body={requestId:randomUUID(),sourceId:f.source.id,sourceHash:f.source.hash,model:'gpt-6.1-sol'};f.start=()=>f.api.dispatch('POST','visible3d/analyze',f.body);f.resume=(api=f.api,body={})=>api.dispatch('POST','visible3d/resume-analyze',{requestId:f.body.requestId,sourceId:f.source.id,sourceHash:f.source.hash,...body});return f}
test('one submit survives >180 seconds; retrieval, restart, canonical validation and immutable completion reuse the same response',async t=>{
 const f=await setup(t);let gets=0;provider=c=>c.method==='POST'?response():response(++gets===1?'in_progress':'completed',gets===2?f.evidence:null)
 const start=await f.start();assert.equal(start.state,'running');assert.equal(start.usable,false);assert.equal(start.trace.background.responseId,'resp_offline_saved');assert.equal(start.trace.background.state,'running')
 assert.equal(calls[0].body.background,true);assert.equal(calls[0].body.store,true);assert.equal(calls[0].body.text.format.strict,true);assert.equal(calls[0].body.reasoning.effort,'medium');assert.equal(calls[0].body.input[0].content.filter(p=>p.type==='input_image').length,4)
 assert.deepEqual(await f.start(),start);assert.equal(calls.length,1)
 const now=Date.now();t.mock.method(Date,'now',()=>now+240000)
 const running=await f.resume(createMagneticIntake(f.dir));assert.equal(running.state,'running');assert.equal(running.trace.parseStatus,'pending');assert.ok(running.trace.elapsedMs>180000)
 const done=await f.resume(createMagneticIntake(f.dir));assert.equal(done.state,'complete');assert.equal(done.usable,true);assert.deepEqual(done.record.evidence,f.evidence);assert.equal(done.trace.parseStatus,'parsed');assert.equal(done.trace.validation.valid,true);assert.equal(done.trace.usageMetadata.total_tokens,126)
 assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls.filter(c=>c.method==='GET').length,2);assert.ok(calls.filter(c=>c.method==='GET').every(c=>c.url.endsWith('/resp_offline_saved')&&c.body===null))
 const file=path.join(f.dir,'visible3d/model-traces',done.trace.id+'.json'),before=await readFile(file);assert.deepEqual(await f.resume(),done);assert.deepEqual(await readFile(file),before);assert.equal(calls.length,3)
 // Simulate a crash after immutable Analysis creation but before the final
 // operation record is linked. Recovery must find that same Analysis ID.
 const op=path.join(f.dir,'visible3d/requests',f.body.requestId+'.json');await writeFile(op,JSON.stringify({...done,record:undefined,usable:false,state:'running'}));const recovered=await f.resume(createMagneticIntake(f.dir));assert.equal(recovered.record.id,done.record.id);assert.equal(recovered.state,'complete');assert.equal(calls.length,3)
 const history=await f.api.dispatch('GET','visible3d/history');assert.equal(history.analyses.length,1);assert.equal((await f.api.dispatch('GET','visible3d/analyses/'+done.record.id)).analysis.hash,done.record.hash)
 const wire=await f.api.dispatch('GET','visible3d/trace/'+done.trace.id+'/wire');assert.equal(JSON.parse(wire.response.text).status,'completed');assert.equal(JSON.parse(wire.submissionResponse.text).status,'queued');assert.equal(done.trace.background.polls.length,2)
})
test('GET timeout/network failure retains provider ID, distinct diagnostics and can resume without a second POST',async t=>{
 const f=await setup(t);provider=()=>response();await f.start()
 provider=()=>{throw new DOMException('offline query timeout','TimeoutError')};const timed=await f.resume();assert.equal(timed.state,'timeout');assert.equal(timed.trace.background.responseId,'resp_offline_saved');assert.equal(timed.trace.failureKind,'timeout');assert.match(analysisDisplay(timed).label,/Timeout/)
 provider=()=>{throw new TypeError('offline network interrupted')};const unknown=await f.resume(createMagneticIntake(f.dir));assert.equal(unknown.state,'unknown');assert.equal(unknown.trace.failureKind,'network_error');assert.equal(unknown.trace.background.responseId,'resp_offline_saved')
 provider=()=>response('completed',f.evidence);const done=await f.resume();assert.equal(done.usable,true);assert.equal(calls.filter(c=>c.method==='POST').length,1)
})
test('HTTP retrieval errors do not claim the underlying generation failed; response ID mismatch cannot supply a Recognition',async t=>{
 const f=await setup(t);provider=()=>response();await f.start()
 provider=()=>new Response(JSON.stringify({error:{code:'server_error',message:'OFFLINE transient retrieval failure'}}),{status:503});const query=await f.resume();assert.equal(query.state,'unknown');assert.equal(query.trace.background.providerStatus,'queued');assert.equal(query.trace.httpStatus,503)
 provider=()=>response('completed',f.evidence,'resp_wrong_task');const foreign=await f.resume();assert.equal(foreign.usable,false);assert.equal(foreign.trace.failureKind,'unknown_response');assert.equal(foreign.trace.background.responseId,'resp_offline_saved');assert.equal((await f.api.dispatch('GET','visible3d/history')).analyses.length,0)
 provider=()=>response('completed',f.evidence);assert.equal((await f.resume()).usable,true);assert.equal(calls.filter(c=>c.method==='POST').length,1)
})
test('ambiguous submission timeout/no response is never retried and cannot be recovered without a provider ID',async t=>{
 const f=await setup(t);provider=()=>{throw new DOMException('offline submit timeout','TimeoutError')}
 const result=await f.start();assert.equal(result.state,'timeout');assert.equal(result.trace.background.responseId,null);assert.equal(result.trace.background.possiblyCharged,true);assert.match(analysisDisplay(result).message,/无法安全恢复/)
 assert.deepEqual(await f.start(),result);await assert.rejects(f.resume(),/尚无 Provider Response ID/);assert.equal(calls.length,1);assert.equal((await f.api.dispatch('GET','visible3d/history')).analyses.length,0)
})
test('quota, schema and other HTTP rejections retain exact code/status/raw body with no fallback generation',async t=>{
 for(const [status,code] of [[429,'insufficient_quota'],[400,'invalid_json_schema'],[401,'invalid_api_key'],[500,'server_error']]){
  const f=await setup(t);provider=()=>new Response(JSON.stringify({error:{code,message:'OFFLINE '+code}}),{status,headers:{'x-request-id':'req_rejected'}})
  const result=await f.start();assert.equal(result.state,'failed');assert.equal(result.trace.httpStatus,status);assert.equal(result.trace.providerErrorCode,code);assert.equal(result.trace.providerRequestId,'req_rejected');assert.match(result.error,new RegExp(code));assert.ok(result.trace.rawResponseBody.includes(code));assert.equal(calls.length,1)
  assert.deepEqual(await f.start(),result);assert.equal(calls.length,1)
 }
})
test('completion still runs strict Recognition validation; invalid colors and incomplete/provider failures never create Analysis',async t=>{
 for(const status of ['completed','incomplete','failed','cancelled']){
  const f=await setup(t),bad=structuredClone(f.evidence);bad.observations[0].color='red/pink';provider=()=>response(status,status==='completed'?bad:null)
  const result=await f.start();assert.equal(result.usable,false);assert.equal(result.state,'failed');assert.equal((await f.api.dispatch('GET','visible3d/history')).analyses.length,0);if(status==='completed'){assert.equal(result.trace.parseStatus,'parsed');assert.equal(result.trace.validation.valid,false);assert.match(result.error,/#RRGGBB/)}
 }
 const f=await setup(t);provider=()=>new Response(JSON.stringify({id:'resp_broken_json',status:'completed',output:[{content:[{type:'output_text',text:'{not valid JSON'}]}]}));const broken=await f.start();assert.equal(broken.trace.parseStatus,'invalid_json');assert.equal(broken.state,'failed');assert.match(broken.error,/JSON 解析失败/);assert.equal((await f.api.dispatch('GET','visible3d/history')).analyses.length,0)
})
test('source/hash/response identity and concurrent-query locks protect recovery; a dead process lock is recoverable',async t=>{
 const f=await setup(t);provider=()=>response();await f.start();const before=calls.length
 await assert.rejects(f.resume(undefined,{sourceHash:'wrong'}),/来源不一致/);assert.equal(calls.length,before)
 let release,entered;const ready=new Promise(r=>entered=r);provider=()=>new Promise(r=>{release=()=>r(response('completed',f.evidence));entered()})
 const first=f.resume();await ready;await assert.rejects(f.resume(createMagneticIntake(f.dir)),/正在提交或查询/);assert.equal(calls.length,before+1);release();assert.equal((await first).usable,true)
 const lock=path.join(f.dir,'visible3d/requests',f.body.requestId+'.json.resume-lock');await writeFile(lock,JSON.stringify({pid:2147483647,at:Date.now()}));assert.equal((await f.resume()).usable,true)
})
test('refresh can discover submitting source scope and interrupted submission is unknown, never guessed as completed',async t=>{
 const f=await setup(t);let release,entered;const ready=new Promise(r=>entered=r);provider=()=>new Promise(r=>{release=()=>r(response());entered()});const pending=f.start();await ready
 let list=await createMagneticIntake(f.dir).dispatch('GET','visible3d/requests');assert.equal(analysisRequest(list,f.source,null,'latest').trace.background.state,'submitting')
 const at=Date.now();t.mock.method(Date,'now',()=>at+100000);list=await f.api.dispatch('GET','visible3d/requests');assert.equal(list[0].state,'unknown');assert.equal(list[0].trace.background.state,'unknown');t.mock.restoreAll();release();await pending;assert.equal(calls.length,1)
})
test('single-image path remains foreground/store:false and immediately uses the original validation chain',async t=>{
 const f=await setup(t),e=structuredClone(f.evidence);delete e.referenceImageId;e.observations.forEach(o=>delete o.imageEvidence);provider=()=>response('completed',e)
 const result=await f.api.dispatch('POST','visible3d/analyze',{requestId:randomUUID(),sourceId:f.sources[0].id,model:'gpt-6.1-sol'});assert.equal(result.usable,true);assert.equal(calls.length,1);assert.equal(calls[0].body.background,undefined);assert.equal(calls[0].body.store,false);assert.equal(calls[0].body.text.format.type,'json_object');assert.equal(result.trace.background,undefined)
})
test('new completions retain alias diagnostics and raw output while saving a strictly valid Review projection',async t=>{
 const f=await setup(t),raw=structuredClone(f.evidence)
 raw.observations.forEach(o=>o.imageEvidence[0].features=[])
 provider=()=>response('completed',raw)
 const result=await f.start()
 assert.equal(result.usable,true);assert.equal(result.state,'complete');assert.equal(result.trace.validation.valid,true)
 assert.equal(result.trace.validation.state,'reviewable');assert.equal(result.record.analysisValidation.diagnostics.length,raw.observations.length)
 assert.deepEqual(JSON.parse(result.trace.rawOutput),raw);assert.deepEqual(result.record.rawEvidence,raw)
 assert.deepEqual(result.record.evidence.observations[0].imageEvidence[0].features,raw.observations[0].features)
 const r=await f.api.dispatch('POST','visible3d/reviews',{analysisId:result.record.id,review:f.review,expectedRevision:0})
 assert.equal(r.record.analysisHash,result.record.hash);assert.equal(calls.length,1)
})
test('foreground postprocessing failure keeps the complete request Trace and usage in history',async t=>{
 const f=await setup(t),raw=structuredClone(f.evidence)
 delete raw.referenceImageId;raw.observations.forEach(o=>delete o.imageEvidence)
 raw.observations[0].profileCandidates[0].profileId='not-in-registry'
 provider=()=>response('completed',raw)
 const result=await f.api.dispatch('POST','visible3d/analyze',{requestId:randomUUID(),sourceId:f.sources[0].id,model:'gpt-6.1-sol'})
 assert.equal(result.state,'failed');assert.match(result.error,/候选 Profile 不在 Registry/)
 assert.deepEqual(JSON.parse(result.trace.rawOutput),raw);assert.equal(result.trace.usageMetadata.total_tokens,126)
 assert.equal((await f.api.dispatch('GET','visible3d/requests')).find(r=>r.id===result.id).trace.id,result.trace.id)
 assert.equal((await f.api.dispatch('GET','visible3d/history')).analyses.length,0);assert.equal(calls.length,1)
})
test('both real failed traces remain byte-for-byte unchanged and are never submitted during offline tests',async()=>{
 const files=['9be836a5-870c-448e-a89f-f7e8f3cc0688','9cc581af-e87a-40e5-b336-6b32dedbd2e2'];const sha=b=>createHash('sha256').update(b).digest('hex')
 for(const id of files){const file=new URL('../generated/magnetic-intake/visible3d/model-traces/'+id+'.json',import.meta.url);let raw;try{raw=await readFile(file)}catch(e){if(e.code==='ENOENT')continue;throw e}const t=JSON.parse(raw);assert.equal(t.background,undefined);assert.equal(t.request.store,false);if(id===files[0])assert.equal(sha(raw),'5c56c593dad449794eb816422d626dacb64d9ef1eafe120f7bab021c79a8cf41');else{assert.equal(t.transportError,'TimeoutError');assert.equal(t.elapsedMs,180032)}assert.equal(sha(await readFile(file)),sha(raw))}
})

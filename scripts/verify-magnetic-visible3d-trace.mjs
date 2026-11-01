import {openSavedImageSources} from './magnetic-studio-browser.mjs'
// Real saved model records + explicitly replayed UI request fixtures. All writes
// target a temporary API; POST model requests are intercepted, never executed.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createMagneticTraceFiles} from '../server/magnetic-trace-files.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,readdir,cp,rm} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const filesTest=process.argv.includes('--files'),root=fileURLToPath(new URL('..',import.meta.url)),official=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'visible3d-trace-')),out=filesTest?'/tmp/magnetic-trace-files-browser':'/tmp/magnetic-visible3d-trace',hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
let server,browser,page,releasePlan,releaseTrace,holdTrace=false
try{
 await mkdir(out,{recursive:true})
 for(const kind of ['sources','assets','profile-registry'])await cp(path.join(official,kind),path.join(dir,kind),{recursive:true})
 for(const kind of ['analyses','reviews','plans','executions','heads','model-traces','requests'])await cp(path.join(official,'visible3d',kind),path.join(dir,'visible3d',kind),{recursive:true})
 const rose=JSON.parse(await readFile(path.join(root,'test/fixtures/magnetic-intake/rose-relative-size.json'),'utf8'))
 for(const [kind,id] of [['analyses',rose.analysisId],['reviews',rose.reviewId]]){await mkdir(path.join(dir,kind),{recursive:true});await cp(path.join(official,kind,id+'.json'),path.join(dir,kind,id+'.json'))}
 const api=createMagneticIntake(dir),history=await api.dispatch('GET','visible3d/history'),requests=await api.dispatch('GET','visible3d/requests'),failed=requests.find(r=>r.kind==='plan'&&!r.record&&r.trace?.status==='invalid_plan');assert.ok(failed,'saved failed Planning request required')
 const failedRef=failed.trace.sources[0],orangeReview=history.reviews.find(r=>r.id===failedRef.reviewId),orangeAnalysis=history.analyses.find(a=>a.id===orangeReview.analysisId),orangeSource=await api.dispatch('GET','sources/'+orangeReview.sourceId)
 const execution=history.executions.find(x=>x.candidates.length===4),plan=history.plans.find(p=>p.id===execution.planId),review=history.reviews.find(r=>r.id===plan.reviewId),analysis=history.analyses.find(a=>a.id===review.analysisId),source=await api.dispatch('GET','sources/'+review.sourceId),realTrace=await api.dispatch('GET','visible3d/trace/'+plan.traceId)
 const officialFiles=[['requests',failed.id],['model-traces',failed.trace.id],['plans',plan.id],['executions',execution.id]].map(([kind,id])=>path.join(official,'visible3d',kind,id+'.json')),before=await Promise.all(officialFiles.map(f=>readFile(f,'utf8')))
 const calls=[],errors=[],consoleErrors=[],revealed=[],debugFailures=[]
 const localFiles=createMagneticTraceFiles({projectRoot:dir,directory:dir,intake:api,enabled:true,reveal:async file=>{revealed.push(file);return {selected:true,message:'Offline file-manager spy accepted selection'}}})
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-visible-trace',configureServer(s){s.middlewares.use('/api/magnetic-trace-files',async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const data=await localFiles.dispatch(req,req.url.slice(1),JSON.parse(raw));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))}catch(e){res.statusCode=e.statusCode??500;res.end(JSON.stringify({error:e.message}))}});s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route})
  try{
   let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};let result
   if(req.method==='POST'&&route==='visible3d/plan'){
    // Offline response replay exercises Running -> rejected contract, with no provider.
    const r=(await api.dispatch('GET','visible3d/reviews/'+body.reviewId)).record,t={...structuredClone(failed.trace),id:randomUUID(),sources:[{sourceId:r.sourceId,sourceHash:r.sourceHash,reviewId:r.id,reviewHash:r.hash}],fixture:'offline replay, not a new model result'}
    await new Promise(resolve=>{releasePlan=resolve});await writeFile(path.join(dir,'visible3d/model-traces',t.id+'.json'),JSON.stringify(t))
    result={id:body.requestId,kind:'plan',state:'complete',usable:false,createdAt:new Date().toISOString(),trace:t};await writeFile(path.join(dir,'visible3d/requests',result.id+'.json'),JSON.stringify(result))
   }else{
    if(req.method!=='GET')throw Error('Non-fixture writes forbidden')
    if(holdTrace&&route==='visible3d/trace/'+plan.traceId){holdTrace=false;await new Promise(resolve=>{releaseTrace=resolve})}
    result=await api.dispatch(req.method,route)
    if(route==='visible3d/status')result={...result,providers:Object.fromEntries(Object.keys(result.providers).map(k=>[k,true]))}
   }
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen()
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1650,height:1050}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){if(filesTest&&m.location().url.includes('/api/magnetic-trace-files/'))debugFailures.push(m.text());else consoleErrors.push(m.text())}})
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html`,field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),dialog=()=>page.getByRole('dialog',{name:'Magnetic Tiles Trace',exact:true}),state=id=>page.getByTestId(id)
 async function openSource(s,a,r){
  await stage(page,'source','inspector');await openSavedImageSources(page);await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${s.id}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(s.id)
  await page.locator('select[aria-label="3D Analysis 历史"]').locator(`option[value="${a.id}"]`).waitFor({state:'attached'});await field('3D Analysis 历史').selectOption(a.id);await field('3D Review 历史').selectOption(r.id);await stage(page,'reconstruction','inspector')
 }
 async function trace(tab='Spatial Planning'){
  await button('Trace / Raw').click();await dialog().getByRole('button',{name:tab,exact:true}).click();return readTrace()
 }
 async function readTrace(){await page.waitForFunction(()=>{try{return JSON.parse(document.querySelector('dialog[open] textarea[aria-label="Trace JSON"]').value).references!==undefined}catch{return false}});return JSON.parse(await dialog().getByLabel('Trace JSON',{exact:true}).inputValue())}
 async function copyPath(expected){
  await dialog().getByRole('button',{name:'复制完整路径',exact:true}).click();await dialog().getByRole('status').filter({hasText:'已复制完整路径：'+expected}).waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),expected);assert.equal((await readFile(expected)).length>0,true)
 }
 async function close(){await dialog().getByRole('button',{name:'关闭 Trace',exact:true}).click()}
 async function assertTone(id,tone){await page.waitForFunction(({id,tone})=>document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-tone')===tone,{id,tone});if(tone==='error')assert.equal(await state(id).evaluate(e=>getComputedStyle(e).color),'rgb(161, 38, 38)')}
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.goto(base+'?stage=source');await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor();await studioMode(page,'3d');await openSource(orangeSource,orangeAnalysis,orangeReview)
 await assertTone('visible3d-planning-state','error');assert.match(await state('visible3d-planning-state').innerText(),new RegExp(failed.trace.validation.issues[0]));await assertTone('visible3d-execution-state','neutral');assert.match(await state('visible3d-execution-state').innerText(),/等待 Plan/)
 const top=await page.locator('.visible3d-reconstruction-heading .trace-open').boundingBox();assert.ok(top.y<200,'Trace is beside the top Reconstruction heading')
 let data=await trace();assert.equal(data.request.id,failed.id);assert.deepEqual(data.trace,await api.dispatch('GET','visible3d/trace/'+failed.trace.id));for(const key of ['request','requestInput','rawOutput','rawResponseBody','plan','validation','model','usageMetadata','error'])assert.ok(Object.hasOwn(data.trace,key),key+' remains available');assert.equal(data.trace.id,failed.trace.id);assert.deepEqual(data.wire,await api.dispatch('GET','visible3d/trace/'+failed.trace.id+'/wire'));assert.equal(data.wire.request.available,true);assert.equal(data.wire.response.available,true);if(filesTest){
  await copyPath(path.join(dir,'visible3d/model-traces',failed.trace.id+'.json'));await dialog().getByRole('button',{name:'打开所在目录',exact:true}).click();await dialog().getByRole('status').filter({hasText:'Offline file-manager spy'}).waitFor();assert.equal(revealed.at(-1),path.join(dir,'visible3d/model-traces',failed.trace.id+'.json'))
  await dialog().getByRole('button',{name:'Parts / Review',exact:true}).click();await readTrace();await copyPath(path.join(dir,'visible3d/reviews',orangeReview.id+'.json'))
  await dialog().getByRole('button',{name:'Geometry Execution',exact:true}).click();await readTrace();await dialog().getByRole('button',{name:'打开所在目录',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'尚无已保存'}).waitFor();assert.equal(revealed.length,1)
 }
 await page.screenshot({path:out+'/actual-failed-plan-trace.png'});await close()
 await page.reload();await state('visible3d-planning-state').waitFor();await assertTone('visible3d-planning-state','error');assert.equal((await trace()).trace.id,failed.trace.id);await close()
 // A different Review must not inherit the failed request/Trace.
 const head=await api.dispatch('GET','visible3d/head/'+orangeSource.id),newReview=(await api.dispatch('POST','visible3d/reviews',{analysisId:orangeAnalysis.id,review:{...orangeReview.input.review,pieces:orangeReview.input.review.pieces.map((p,i)=>({...p,confirmed:i===0,excluded:false}))},thickness:.06,expectedRevision:head.revision})).record
 await button('刷新 3D 历史').click();await field('3D Review 历史').locator(`option[value="${newReview.id}"]`).waitFor({state:'attached'});await field('3D Review 历史').selectOption(newReview.id);await assertTone('visible3d-planning-state','neutral');data=await trace();assert.equal(data.trace,null);assert.match(data.availability,/尚无 Trace/);assert.equal(data.request,null);await close()
 await button('Spatial Planning（调用模型）').click();await assertTone('visible3d-planning-state','running');assert.equal(await button('Spatial Planning（调用模型）').isDisabled(),true);assert.ok(releasePlan);releasePlan();await assertTone('visible3d-planning-state','error');data=await trace();assert.equal(data.references.reviewId,newReview.id);assert.notEqual(data.trace.id,failed.trace.id);assert.equal(data.trace.fixture,'offline replay, not a new model result');await close()
 // Selected model Plan and manual Plan remain distinct, including late trace responses.
 await openSource(source,analysis,review);await field('Spatial Planning History').selectOption(plan.id);await assertTone('visible3d-planning-state','review');assert.match(await state('visible3d-planning-state').innerText(),/照片语义正确性尚未验证/);await assertTone('visible3d-execution-state','neutral')
 data=await trace();assert.equal(data.trace.id,plan.traceId);assert.deepEqual(data.trace,realTrace);if(filesTest)await copyPath(path.join(dir,'visible3d/model-traces',plan.traceId+'.json'));await close()
 const manual=await api.dispatch('POST','visible3d/manual-plan',{reviewId:review.id,plan:plan.plan});await button('刷新 3D 历史').click();await field('Spatial Planning History').locator(`option[value="${manual.id}"]`).waitFor({state:'attached'})
 holdTrace=true;await button('Trace / Raw').click();await page.waitForFunction(()=>document.querySelector('dialog[open] textarea')?.value==='读取中…');for(let i=0;i<100&&!releaseTrace;i++)await new Promise(r=>setTimeout(r,10));assert.ok(releaseTrace,'Trace request reached the read-only fixture API');await close();await field('Spatial Planning History').selectOption(manual.id);data=await trace();assert.equal(data.trace,null);assert.equal(data.references.planId,manual.id);if(filesTest)await copyPath(path.join(dir,'visible3d/plans',manual.id+'.json'));releaseTrace();await page.waitForTimeout(50);assert.equal((await readTrace()).trace,null,'late response cannot replace a different Plan Trace');await close()
 await field('Spatial Planning History').selectOption(plan.id);await field('Geometry Execution History').selectOption(execution.id);await assertTone('visible3d-execution-state','valid');data=await trace('Geometry Execution');assert.equal(data.references.executionId,execution.id);assert.deepEqual(data.execution.record,execution);assert.deepEqual(data.candidateValidator,execution.candidates[0].geometry);if(filesTest)await copyPath(path.join(dir,'visible3d/executions',execution.id+'.json'));await close()
 const exhausted=(await api.dispatch('POST','visible3d/execute',{planId:plan.id,requestId:randomUUID(),options:{maxAssignments:0,maxGeometryChecks:0}})).record
 // Presentation-only fixtures exercise failure/contradiction states without altering an engine.
 async function copyExecution(update){const {hash:_hash,...payload}=structuredClone(execution),p={...payload,id:randomUUID(),createdAt:new Date().toISOString(),...update},x={...p,hash:hash(p)};await writeFile(path.join(dir,'visible3d/executions',x.id+'.json'),JSON.stringify(x));return x}
 const invalid=await copyExecution({status:'no_valid_candidate',candidates:[],diagnostics:['OFFLINE_UI_FIXTURE: no legal connection combination']}),contradicted=await copyExecution({candidates:execution.candidates.map(c=>({...c,interpretation:'OFFLINE_UI_FIXTURE: spatial contradiction',spatialConsistency:{...c.spatialConsistency,status:'contradicted'}}))})
 await button('刷新 3D 历史').click();await field('Geometry Execution History').locator(`option[value="${invalid.id}"]`).waitFor({state:'attached'})
 for(const x of [exhausted,invalid]){await field('Geometry Execution History').selectOption(x.id);await assertTone('visible3d-execution-state','error');data=await trace('Geometry Execution');assert.equal(data.execution.record.id,x.id);if(filesTest)await copyPath(path.join(dir,'visible3d/executions',x.id+'.json'));await close();assert.ok(await page.getByRole('list',{name:'执行失败原因',exact:true}).isVisible()||!x.diagnostics.length)}
 await field('Geometry Execution History').selectOption(contradicted.id);assert.ok(await page.getByRole('alert').filter({hasText:'候选违反已审核空间关系'}).isVisible());assert.equal(await button('采用候选到 3D Assembly Editor').isDisabled(),true)
 await field('Geometry Execution History').selectOption(execution.id)
 for(const width of [1650,680]){await page.setViewportSize({width,height:1000});await stage(page,'reconstruction','inspector');await page.locator('.studio-inspector').evaluate(e=>e.scrollTop=e.scrollHeight);const b=await page.locator('.visible3d-reconstruction-heading .trace-open').boundingBox();assert.ok(b.y>=0&&b.y+b.height<200,'Trace stays reachable while Inspector scrolls');data=await trace();assert.equal(data.trace.id,plan.traceId);const d=await dialog().boundingBox();assert.ok(d.x>=0&&d.x+d.width<=width+1);await page.screenshot({path:`${out}/trace-${width}.png`});await close()}
 await page.setViewportSize({width:1650,height:1050});const current=await api.dispatch('GET','visible3d/head/'+source.id);await api.dispatch('POST','visible3d/reviews',{analysisId:analysis.id,review:review.input.review,thickness:.06,expectedRevision:current.revision});await button('刷新 3D 历史').click();await page.getByRole('alert').filter({hasText:'Outdated：来源、Review 或 Plan'}).waitFor();assert.equal(await button('采用候选到 3D Assembly Editor').isDisabled(),true)
 // Existing 2D uses the same dialog with its original endpoint and tab semantics.
 await studioMode(page,'2d');await page.goto(base+`?stage=reconstruction&sourceId=${rose.sourceId}&analysisId=${rose.analysisId}&reviewId=${rose.reviewId}`);await page.locator('.reconstruction-controls .trace-open').waitFor();await button('Trace / Raw').click();await page.waitForFunction(()=>{try{return JSON.parse(document.querySelector('dialog[open] textarea').value).analysis?.id}catch{return false}});data=JSON.parse(await dialog().getByLabel('Trace JSON',{exact:true}).inputValue());assert.equal(data.analysis.id,rose.analysisId);if(filesTest)await copyPath(path.join(dir,'reviews',rose.reviewId+'.json'));await dialog().getByRole('button',{name:'Spatial Planning',exact:true}).click();await page.waitForFunction(()=>{try{return JSON.parse(document.querySelector('dialog[open] textarea').value).planning?.modelGenerated===false}catch{return false}});if(filesTest){await dialog().getByRole('button',{name:'打开所在目录',exact:true}).click();await dialog().getByRole('alert').filter({hasText:'运行时证据推导'}).waitFor()}await close()
 assert.deepEqual(await Promise.all(officialFiles.map(f=>readFile(f,'utf8'))),before);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.equal(calls.filter(c=>c.method==='POST').length,1)
 const result={passed:true,savedFailure:orangeSource.name,trace:'complete saved Request, Raw Response, parsed output, model, Usage, error, validation; history IDs and late response isolation',states:'idle / running (offline replay) / failed / review required / waiting / valid candidates / budget exhaustion / no candidates / spatial contradiction / stale source',twoD:'original shared Trace Viewer endpoints and tabs',fileTools:filesTest?{tabs:'current file paths, clipboard, related files, missing runtime files; selected history isolated',revealed:revealed.length,expectedMissingResponses:debugFailures.length}:null,widths:[1650,680],paidCalls:0,productionWrites:0,errors,consoleErrors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){releasePlan?.();releaseTrace?.();if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

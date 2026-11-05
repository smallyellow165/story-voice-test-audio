// Display-only QA: real immutable fixture records, different browser/server
// time zones, native selects and read-only history. No provider calls.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {multiFixture} from '../test/magnetic-multi-image-fixtures.mjs'
import {stage} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-history-ui-')),out='/tmp/magnetic-history-ui',oldZone=process.env.TZ
process.env.TZ='America/Los_Angeles'
let browser,server,page
try{
 await mkdir(out,{recursive:true});const f=await multiFixture(dir),project=randomUUID(),prefix='visible3d/project/'+project+'/',post=(route,body)=>f.api.dispatch('POST',prefix+route,body)
 const finalName='Truck-Ramp/2-with-a-very-long-reference-image-name.png',source=await f.api.dispatch('POST','source-sets',{images:f.source.images.slice(0,2).map((image,i)=>({...image,name:i?finalName:'Truck-Ramp/1.png',role:i?'Final':'Step'}))})
 const evidence=structuredClone(f.evidence),allowed=new Set(source.images.map(i=>i.sourceId));evidence.referenceImageId=source.primaryImageId
 for(const o of evidence.observations){o.imageEvidence=o.imageEvidence.filter(i=>allowed.has(i.imageId));const primary=o.imageEvidence.find(i=>i.imageId===source.primaryImageId);o.bbox=primary.bbox;o.features=primary.features}
 const analysis=await post('annotate',{sourceId:source.id,evidence});await post('selected',{sourceId:source.id,stage:'analysis',id:analysis.id,hash:analysis.hash,expectedRevision:0})
 const review=await post('reviews',{analysisId:analysis.id,review:f.review,expectedRevision:0}),plan=await post('manual-plan',{reviewId:review.record.id,plan:f.plan}),execution=await post('execute',{requestId:randomUUID(),planId:plan.id});assert.equal(execution.state,'complete')
 const traceId=randomUUID(),trace={id:traceId,status:'plan_ready_for_review',validation:{valid:true},sources:[{sourceId:source.id,sourceHash:source.hash}]},requestId=randomUUID(),failedId=randomUUID(),createdAt='2026-11-05T07:29:01.558Z'
 await mkdir(path.join(dir,'visible3d/requests'),{recursive:true});await mkdir(path.join(dir,'visible3d/model-traces'),{recursive:true});await writeFile(path.join(dir,'visible3d/model-traces',traceId+'.json'),JSON.stringify(trace))
 await writeFile(path.join(dir,'visible3d/requests',requestId+'.json'),JSON.stringify({id:requestId,kind:'analyze',projectId:project,sourceId:source.id,sourceHash:source.hash,createdAt,state:'complete',usable:true,record:analysis,trace}))
 await writeFile(path.join(dir,'visible3d/requests',failedId+'.json'),JSON.stringify({id:failedId,kind:'analyze',projectId:project,sourceId:source.id,sourceHash:source.hash,createdAt:'2026-11-05T07:31:00.000Z',state:'complete',usable:false,trace:{id:randomUUID(),status:'validation_failed',validation:{valid:false},sources:trace.sources}}))
 const before=JSON.stringify(await f.api.dispatch('GET',prefix+'history')),headBefore=await f.api.dispatch('GET',prefix+'head/'+source.id),bytes=new Map()
 for(const kind of ['analyses','reviews','plans','executions','requests'])for(const name of await readdir(path.join(dir,'visible3d',kind))){const file=path.join(dir,'visible3d',kind,name);bytes.set(file,await readFile(file))}
 const errors=[],calls=[]
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'history-display-only',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route});try{if(req.method!=='GET'&&![prefix+'selected','library-image'].includes(route))throw Error('Unexpected write or provider call: '+route);let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await f.api.dispatch(req.method,route,raw?JSON.parse(raw):{})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1734,height:1150},timezoneId:'Asia/Tokyo'});page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message))
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/`,field=name=>page.getByLabel(name,{exact:true}).filter({visible:true}),option=(name,id)=>field(name).locator(`option[value="${id}"]`)
 await page.goto(base+`magnetic-tiles.html?workspace=create&workspaceId=${project}&stage=source`);await option('Analysis History',analysis.id).waitFor({state:'attached'});await field('Analysis History').selectOption(analysis.id);await stage(page,'reconstruction')
 await page.waitForFunction(id=>document.querySelector('[aria-label="Geometry Execution History"]')?.value===id,execution.record.id)
 const titles=await page.locator('.studio-history').evaluateAll(es=>es.map(e=>e.firstChild.textContent.trim()));assert.deepEqual(titles,['Analysis / 识别记录','Review / 审核记录','Planning / 空间规划','Reconstruction / 几何重建'])
 assert.equal(await option('Analysis History',analysis.id).innerText(),'11/04 23:29 · 2图 · Final: 2-with-a-very-long-reference-image-name.png · 待审核')
 assert.equal(await option('Analysis History',failedId).innerText(),'11/04 23:31 · 2图 · Final: 2-with-a-very-long-reference-image-name.png · 校验失败')
 const localTime=iso=>{const d=new Date(iso),pad=n=>String(n).padStart(2,'0');return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`}
 assert.equal(await option('3D Review 历史',review.record.id).innerText(),localTime(review.record.createdAt)+' · 2实例 · 已保存')
 assert.equal(await option('Spatial Planning History',plan.id).innerText(),localTime(plan.createdAt)+' · 2实例 · 已完成')
 assert.equal(await option('Geometry Execution History',execution.record.id).innerText(),localTime(execution.record.createdAt)+' · 2/2块 · Geometry Valid')
 for(const text of await page.locator('.studio-history option').allTextContents()){assert.ok(!/[\r\n]/.test(text));assert.ok(!/[a-f0-9]{8}-[a-f0-9-]{27,}|[a-f0-9]{64}|T\d{2}:.*Z/.test(text),text)}
 const valuesBefore=await page.locator('.studio-history select').evaluateAll(es=>es.map(e=>({value:e.value,options:[...e.options].map(o=>o.value)})))
 for(const width of [1734,1100,760]){
  await page.setViewportSize({width,height:1000})
  if(width<=760)await page.getByRole('button',{name:'工作阶段',exact:true}).filter({visible:true}).click()
  for(const select of await page.locator('.studio-history select').all()){const css=await select.evaluate(e=>({width:e.getBoundingClientRect().width,parent:e.parentElement.getBoundingClientRect().width,whiteSpace:getComputedStyle(e).whiteSpace,overflow:getComputedStyle(e).textOverflow}));assert.ok(css.width<=css.parent+1);assert.equal(css.whiteSpace,'nowrap');assert.equal(css.overflow,'ellipsis')}
  await page.screenshot({path:out+`/history-${width}.png`})
 }
 await page.setViewportSize({width:1734,height:1150});await page.reload();await stage(page,'reconstruction');await page.waitForFunction(id=>document.querySelector('[aria-label="Geometry Execution History"]')?.value===id,execution.record.id);assert.deepEqual(await page.locator('.studio-history select').evaluateAll(es=>es.map(e=>({value:e.value,options:[...e.options].map(o=>o.value)}))),valuesBefore)
 // Request success and actual reviewability remain distinct; selecting a failed
 // request keeps its exact request ID and the existing immutable Selected head.
 await field('Analysis History').selectOption(failedId);assert.equal(await field('Analysis History').inputValue(),failedId);await page.reload();await field('Analysis History').waitFor();await page.waitForFunction(id=>document.querySelector('[aria-label="Analysis History"]')?.value===id,failedId)
 assert.equal(JSON.stringify(await f.api.dispatch('GET',prefix+'history')),before);assert.deepEqual(await f.api.dispatch('GET',prefix+'head/'+source.id),headBefore);for(const [file,original]of bytes)assert.ok(original.equals(await readFile(file)),file+' changed')
 assert.deepEqual(errors,[])
 const result={passed:true,serverTimeZone:'America/Los_Angeles',browserTimeZone:'Asia/Tokyo',checks:['server-local MM/DD HH:mm despite different browser zone','four compact titles','input/instance/coverage labels without technical IDs','completed failure stays non-reviewable','native selects single-line ellipsis at 1734/1100/760px','option values/order and restored selections unchanged','immutable records, timestamps and Selected/CAS bytes unchanged'],providerCalls:0,productionWrites:0,errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true});if(oldZone===undefined)delete process.env.TZ;else process.env.TZ=oldZone}

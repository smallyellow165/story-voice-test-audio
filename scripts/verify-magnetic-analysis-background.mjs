// Real UI + real workflow/transport, intercepted provider HTTP and temporary data.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {multiFixture} from '../test/magnetic-multi-image-fixtures.mjs'
import {stage,studioMode,openSavedImageSources} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'analysis-background-browser-')),out='/tmp/magnetic-analysis-background-browser',oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY
const f=await multiFixture(dir),calls=[],errors=[],http=[],consoleErrors=[]
let browser,server,page,complete=false,disconnect=false
process.env.OPENAI_API_KEY='offline-browser-test-only'
globalThis.fetch=async(url,init)=>{
 if(!String(url).startsWith('https://api.openai.com/v1/responses'))return oldFetch(url,init)
 calls.push({method:init.method,url:String(url)});if(disconnect){disconnect=false;throw new TypeError('OFFLINE query network interruption')}
 const status=init.method==='POST'?'queued':complete?'completed':'in_progress'
 return new Response(JSON.stringify({id:'resp_offline_browser_recover',model:'gpt-6.1-sol',status,output:status==='completed'?[{content:[{type:'output_text',text:JSON.stringify(f.evidence)}]}]:[],usage:status==='completed'?{total_tokens:126,input_tokens:42,output_tokens:84}:null}),{headers:{'x-request-id':'req_offline_browser','Content-Type':'application/json'}})
}
try{
 await mkdir(out,{recursive:true})
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'offline-background-browser',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];http.push({method:req.method,route});try{let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};if(req.method==='POST'&&!['visible3d/analyze','visible3d/resume-analyze','visible3d/selected','library-image'].includes(route))throw Error('Unrelated data writes forbidden in this test')
   let result=await f.api.dispatch(req.method,route,body);if(route==='status'||route==='visible3d/status')result={...result,providers:{...result.providers,openai:true}}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))
  }catch(e){console.error('Offline API failure',route,e.message);res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen();browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1650,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
 const button=name=>(name==='进入 Review'?page.locator('.analysis-toolbar'):page.locator('.studio-inspector')).getByRole('button',{name,exact:true}),state=()=>page.getByTestId('visible3d-analysis-state')
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=source`);await studioMode(page,'3d');await openSavedImageSources(page);const picker=page.getByLabel('已有图片来源',{exact:true}).filter({visible:true});await picker.focus();await picker.locator('option[value="'+f.source.id+'"]').waitFor({state:'attached'});await picker.selectOption(f.source.id)
 await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Analyze Visible 3D（调用模型）');return b&&!b.disabled})
 assert.equal(calls.length,0);await button('Analyze Visible 3D（调用模型）').click();await state().getByText('Running · 后台识别中',{exact:true}).waitFor();assert.equal(await button('进入 Review').isDisabled(),true);assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(await button('Analyze Visible 3D（调用模型）').isDisabled(),true)
 const [savedRequest]=await f.api.dispatch('GET','visible3d/requests');await page.getByLabel('Analysis History',{exact:true}).selectOption(savedRequest.id);assert.equal(calls.filter(c=>c.method==='POST').length,1)
 await page.waitForResponse(r=>r.url().endsWith('/visible3d/resume-analyze')&&r.status()===200,{timeout:15000});assert.ok(calls.some(c=>c.method==='GET'),'automatic polling retrieves the original response')
 await page.screenshot({path:out+'/running-wide.png'});await stage(page,'review','inspector');await stage(page,'source','inspector');await state().getByText('Running · 后台识别中',{exact:true}).waitFor();await page.reload();await stage(page,'source','inspector');await state().getByText('Running · 后台识别中',{exact:true}).waitFor()
 // A transient retrieval failure pauses only polling. The provider ID persists.
 disconnect=true;await button('查询 / 恢复已有识别任务').click();await state().getByText('Unknown · 执行状态未知',{exact:true}).waitFor();assert.equal(await state().getAttribute('data-tone'),'neutral');assert.equal(calls.filter(c=>c.method==='POST').length,1)
 await page.reload();await stage(page,'source','inspector');await state().getByText('Unknown · 执行状态未知',{exact:true}).waitFor();complete=true;await button('查询 / 恢复已有识别任务').click();await state().getByText('Completed · 待人工 Review',{exact:true}).waitFor()
 assert.equal(await button('进入 Review').isEnabled(),true);assert.equal(await page.locator('.studio-inspector').getByRole('button',{name:'进入 Review',exact:true}).count(),0);assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.ok(calls.filter(c=>c.method==='GET').every(c=>c.url.endsWith('/resp_offline_browser_recover')))
 await button('Trace / Raw').click();const dialog=page.getByRole('dialog',{name:'Magnetic Tiles Trace',exact:true});await page.waitForFunction(()=>document.querySelector('dialog[open] textarea[aria-label="Trace JSON"]')?.value.includes('resp_offline_browser_recover'));const trace=JSON.parse(await dialog.getByLabel('Trace JSON',{exact:true}).inputValue());assert.equal(trace.trace.background.state,'completed');assert.equal(trace.trace.usageMetadata.total_tokens,126);assert.equal(JSON.parse(trace.wire.response.text).status,'completed');await dialog.getByRole('button',{name:'关闭 Trace',exact:true}).click()
 const saved=(await f.api.dispatch('GET','visible3d/history')).analyses;assert.equal(saved.length,1);const bytes=await readFile(path.join(dir,'visible3d/model-traces',saved[0].traceId+'.json'))
 await page.reload();await stage(page,'source','inspector');await state().getByText('Completed · 待人工 Review',{exact:true}).waitFor();await button('进入 Review').click();await stage(page,'review','workspace');await page.getByLabel('3D Review Profile',{exact:true}).waitFor();await stage(page,'source','inspector')
 for(const width of [1100,680]){await page.setViewportSize({width,height:950});await stage(page,'source','inspector');const overflow=await page.locator('.studio-inspector').evaluate(e=>e.scrollWidth-e.clientWidth);assert.ok(overflow<=2);await page.screenshot({path:out+`/completed-${width}.png`})}
 await studioMode(page,'2d');await stage(page,'source','inspector');assert.equal(await page.getByTestId('visible3d-analysis-state').filter({visible:true}).count(),0);assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.deepEqual(await readFile(path.join(dir,'visible3d/model-traces',saved[0].traceId+'.json')),bytes)
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);const result={passed:true,modelCalls:0,productionWrites:0,providerFixture:{submits:calls.filter(c=>c.method==='POST').length,retrievals:calls.filter(c=>c.method==='GET').length},checks:['real four image inputs','submit once','running/unknown/completed states','workflow switch','refresh recovery','network failure -> same ID','canonical result -> Review','Trace/wire/usage','immutable finalized Trace','1650/1100/680 layout','2D isolation']};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}finally{await browser?.close();await server?.close();globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;await rm(dir,{recursive:true,force:true})}

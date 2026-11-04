// New Create workflow, real image preparation/API and deterministic offline
// model output. No production data, legacy adaptation or provider traffic.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {visibleFixture} from '../test/magnetic-visible3d-fixtures.mjs'
import {upgradeVisibleFixture} from '../test/magnetic-visible3d-v2-fixtures.mjs'
import {stage,sourceImageAction} from './magnetic-studio-browser.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'project-lifecycle-ui-')),lib=path.join(dir,'images'),store=path.join(dir,'store'),out='/tmp/magnetic-project-lifecycle-browser',errors=[],calls=[],modelInputs=[]
const fixture=upgradeVisibleFixture(await visibleFixture()),api=createMagneticIntake(store,{libraryDirectory:lib})
const workflow=createVisible3DWorkflow(path.join(store,'visible3d'),{readSource:id=>api.dispatch('GET','sources/'+id),readImage:s=>api.dispatch('GET','image/'+s.id),readImages:s=>Promise.all(s.images.map(async e=>({...e,...await api.dispatch('GET','image/'+e.sourceId)}))),getRegistry:()=>api.dispatch('GET','profiles'),runModel:async(prepared,options)=>{
 modelInputs.push(prepared.input);const value=structuredClone(fixture.evidence)
 if(prepared.source.images.length>1){
  value.referenceImageId=prepared.source.primaryImageId;while(value.observations.length<25)value.observations.push({...structuredClone(value.observations[0]),id:'tile-'+value.observations.length})
  for(const o of value.observations)o.imageEvidence=prepared.source.images.map(e=>({imageId:e.sourceId,bbox:structuredClone(o.bbox),features:structuredClone(o.features),occlusion:o.occlusion,evidence:'OFFLINE fixture annotations; not actual model perception',uncertainty:o.uncertainty}))
 }
 const id=randomUUID(),trace={id,status:'plan_ready_for_review',parseStatus:'parsed',validation:{valid:true},wireStatus:'response_saved',finishReason:'completed',sources:options.sources,requestInput:prepared.input,plan:value,rawOutput:JSON.stringify(value),usageMetadata:{fixture:true}}
 await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,id+'.json'),JSON.stringify(trace));return trace
}})
let server,browser,page
try{
 await mkdir(path.join(lib,'Truck-Ramp'),{recursive:true});await mkdir(out,{recursive:true})
 for(const [i,name] of ['car-1.png','car-2.png','car-3.png'].entries())await copyFile(path.join(root,'public/test-images/maganetic',name),path.join(lib,'Truck-Ramp',`${i+1}.png`))
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'project-lifecycle-offline',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push(route);try{let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};if(route.includes('resume-analyze')||route.includes('/plan'))throw Error('Provider polling/planning forbidden');let result=route.startsWith('visible3d/')?await workflow.dispatch(req.method,route.slice(10),body):await api.dispatch(req.method,route,body);if(route.endsWith('/status'))result={...result,providers:{openai:true}};res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})}}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1660,height:1050}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/`,button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),history=()=>field('Analysis History')
 async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI did not settle')}
 const context=()=>page.evaluate(()=>{const id=new URL(location.href).searchParams.get('workspaceId');return JSON.parse(localStorage.getItem('magnetic-studio.workspace.v1.create.'+id+'.magnetic-visible3d-context.v2')??'null')})
 async function readyInput(count){await page.getByText('本次 Analysis · '+count+'/4',{exact:true}).waitFor();await until(()=>button('Analyze Visible 3D（调用模型）').isEnabled())}
 async function role(name,value){const response=page.waitForResponse(r=>r.url().endsWith('/source-sets')&&r.status()===200);await field('图片角色 '+name).selectOption(value);const saved=await(await response).json();await until(async()=>(await context())?.inputSourceId===saved.id);await readyInput(saved.images.length)}
 async function newProject(){await page.goto(base+'magnetic-gallery.html');await page.getByRole('link',{name:'家长制作入口 / Create New',exact:true}).click();await page.getByTestId('studio-workspace-context').waitFor();await stage(page,'source','inspector');await button('打开文件夹 Truck-Ramp').waitFor();return new URL(page.url()).searchParams.get('workspaceId')}
 const owner=await newProject(),url=page.url();assert.equal(await page.getByTestId('selected-project').getAttribute('title'),owner)
 await button('打开文件夹 Truck-Ramp').click()
 for(const n of [1,2,3]){await field('加入 Truck-Ramp/'+n+'.png').click();await readyInput(n);assert.equal(await page.getByTestId('selected-project').getAttribute('title'),owner)}
 await role('Truck-Ramp/1.png','Step');await role('Truck-Ramp/2.png','Step');await role('Truck-Ramp/3.png','Final')
 const originalInput=(await context()).inputSourceId,sourceThree=await api.dispatch('GET','sources/'+originalInput)
 await button('Analyze Visible 3D（调用模型）').click();await stage(page,'review','workspace');await until(async()=>await page.locator('.review-parts-table tbody tr').count()===25)
 const h1=await workflow.dispatch('GET',`project/${owner}/history`),a=h1.analyses[0];assert.equal(a.evidence.observations.length,25)
 const saved=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.status()===200);await button('保存 3D Review').click();await saved
 await stage(page,'source','inspector');await sourceImageAction(page,'Truck-Ramp/3.png','移除');await readyInput(2);await role('Truck-Ramp/2.png','Final')
 const twoInput=(await context()).inputSourceId;assert.notEqual(twoInput,originalInput);assert.equal(await page.getByTestId('selected-project').getAttribute('title'),owner);assert.equal(await history().locator(`option[value="${a.id}"]`).count(),1)
 await history().selectOption(a.id);await until(async()=>page.locator('.analysis-toolbar-info').innerText().then(t=>t.includes('Truck-Ramp/3.png')));assert.equal((await context()).inputSourceId,twoInput);assert.equal(await page.locator('.source-set-table tbody tr').count(),2);assert.equal(await page.locator('.source-frame-strip button').filter({visible:true}).count(),3);await page.getByRole('status').filter({hasText:'正在查看历史输入'}).waitFor()
 await page.reload();await stage(page,'source','inspector');await until(async()=>(await context())?.sourceId===originalInput);await page.getByRole('status').filter({hasText:'正在查看历史输入'}).waitFor();assert.equal((await context()).inputSourceId,twoInput)
 await button('查看当前输入').click();await until(async()=>(await context())?.sourceId===twoInput);await button('Analyze Visible 3D（调用模型）').click();await stage(page,'review','workspace');await until(async()=>await page.locator('.review-parts-table tbody tr').count()===25)
 const h2=await workflow.dispatch('GET',`project/${owner}/history`),b=h2.analyses.find(r=>r.id!==a.id);assert.equal(h2.analyses.length,2);assert.equal(b.projectId,a.projectId);assert.equal(b.sourceId,twoInput);assert.equal(a.sourceHash,sourceThree.hash)
 await stage(page,'source','inspector');assert.equal(await history().locator('option').count(),3);await history().selectOption(a.id);await until(async()=>(await context())?.sourceId===originalInput);await history().selectOption(b.id);await until(async()=>(await context())?.sourceId===twoInput);assert.equal(await page.locator('.source-frame-strip button').filter({visible:true}).count(),2);assert.equal(await page.getByRole('status').filter({hasText:'正在查看历史输入'}).count(),0)
 await page.reload();await stage(page,'source','inspector');await history().locator(`option[value="${b.id}"]`).waitFor({state:'attached'});assert.equal((await context()).inputSourceId,twoInput);await page.screenshot({path:out+'/two-inputs-one-project.png'})
 const other=await newProject();assert.notEqual(other,owner);assert.equal(await history().locator('option').count(),1);assert.equal(await page.getByText('本次 Analysis · 0/4',{exact:true}).count(),1)
 await button('打开文件夹 Truck-Ramp').click();await field('加入 Truck-Ramp/1.png').click();await readyInput(1);await button('Analyze Visible 3D（调用模型）').click();await stage(page,'review','workspace');await until(async()=>await page.locator('.review-parts-table tbody tr').count()===2);const single=await workflow.dispatch('GET',`project/${other}/history`);assert.equal(single.analyses.length,1);assert.equal(single.analyses[0].projectId,other)
 await page.goto(url);await stage(page,'source','inspector');await history().locator(`option[value="${a.id}"]`).waitFor({state:'attached'});assert.equal(await history().locator('option').count(),3)
 assert.equal(modelInputs.length,3);assert.deepEqual(modelInputs.map(i=>i.projectId),[owner,owner,other]);assert.ok(!calls.includes('visible3d/workspace-history'));assert.ok(!calls.includes('visible3d/history'));assert.deepEqual(errors,[])
 console.log(JSON.stringify({passed:true,modelCalls:0,offlineFixtures:3,checks:['stable workspace Project from empty Create','3 image -> 25 observations','remove photo/change Final -> same Project','history retains both snapshots','historical input view preserves current input','Review hash/source isolation','refresh both view and input','fresh client history','new Project isolation','single image path']},null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}console.error({lastCalls:calls.slice(-12),errors});throw e}finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

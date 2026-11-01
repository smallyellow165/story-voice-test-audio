// Real Chromium + isolated data + deterministic provider fixture. Never calls a paid model.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {buildVisibleRequest,visiblePromptVersion} from '../server/magnetic-visible3d-vision.mjs'
import {multiImagePromptVersion} from '../server/magnetic-multi-image-vision.mjs'
import {sourceImages} from '../src/magnetic-tiles/intake/image-set.ts'
import {visibleFixture} from '../test/magnetic-visible3d-fixtures.mjs'
import {upgradeVisibleFixture} from '../test/magnetic-visible3d-v2-fixtures.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'multi-image-browser-')),out='/tmp/magnetic-multi-image-browser',api=createMagneticIntake(dir),fixture=upgradeVisibleFixture(await visibleFixture()),calls=[],requests=[],errors=[],consoleErrors=[]
const workflow=createVisible3DWorkflow(path.join(dir,'visible3d'),{readSource:id=>api.dispatch('GET','sources/'+id),readImage:s=>api.dispatch('GET','image/'+s.id),readImages:s=>Promise.all(sourceImages(s).map(async e=>({...e,...await api.dispatch('GET','image/'+e.sourceId)}))),getRegistry:()=>api.dispatch('GET','profiles'),runModel:async(prepared,options,kind)=>{
 calls.push(kind);let value
 if(kind==='analysis'){
  value=structuredClone(fixture.evidence)
  if(prepared.images.length>1){value.referenceImageId=prepared.source.primaryImageId;for(const o of value.observations){o.imageEvidence=prepared.images.map((image,i)=>({imageId:image.sourceId,bbox:[.1+i*.1,.15,.35+i*.1,.6],features:[{id:'edge',points:[[.1+i*.1,.15],[.35+i*.1,.15]],visibility:'visible',note:'Offline coordinate fixture, not real photo perception'}],occlusion:'partial',evidence:'Offline same-instance fixture',uncertainty:'No model accuracy claim'}));const e=o.imageEvidence.find(e=>e.imageId===value.referenceImageId);o.bbox=e.bbox;o.features=e.features}}
 }else value=fixture.plan
 const id=randomUUID(),trace={id,task:'magnetic-visible3d-'+kind,promptVersion:kind==='analysis'&&prepared.images.length>1?multiImagePromptVersion:visiblePromptVersion,status:'plan_ready_for_review',parseStatus:'parsed',validation:{valid:true,issues:[]},wireStatus:'response_saved',finishReason:'completed',requestInput:prepared.input,request:buildVisibleRequest(options.model,prepared,kind),plan:value,rawOutput:JSON.stringify(value),usageMetadata:{fixture:true,totalTokens:0}}
 await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,id+'.json'),JSON.stringify(trace));return trace
}})
let browser,server,page
try{
 await mkdir(out,{recursive:true})
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'multi-image-offline-browser',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];requests.push({method:req.method,route});try{let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};if(req.method==='POST'&&route==='recognize')throw Error('Paid 2D recognition forbidden in this fixture')
   let value=route==='visible3d/analyze'||route==='visible3d/plan'?await workflow.dispatch(req.method,route.slice(10),body):await api.dispatch(req.method,route,body)
   if(route==='status'||route==='visible3d/status')value={...value,providers:{...value.providers,openai:true}}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1660,height:1050}});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html`
 await page.goto(base+'?stage=source');await studioMode(page,'3d');await stage(page,'source','inspector')
 const inspector=()=>page.locator('.studio-inspector'),field=name=>(name==='上传磁力片图片文件'?inspector().locator('.source-inspector:visible'):inspector()).getByLabel(name,{exact:true}),button=name=>inspector().getByRole('button',{name,exact:true})
 async function idle(){await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Analyze Visible 3D（调用模型）');return b&&!b.disabled})}
 async function currentSource(){const id=await page.evaluate(()=>JSON.parse(localStorage.getItem('magnetic-visible3d-context.v1')||'{}').sourceId);return api.dispatch('GET','sources/'+id)}
 async function setMetadata(name,role,direction){const details=inspector().locator('.source-set-list li').filter({hasText:name}).locator('details');if(!await details.evaluate(d=>d.open))await details.locator('summary').click();await field('图片角色 '+name).selectOption(role);await idle();await field('拍摄方向 '+name).selectOption(direction);await idle()}
 assert.equal(await field('3D Vision 模型').inputValue(),'gpt-6.1-sol');assert.equal(await inspector().getByRole('heading',{name:'图片与识别（Analysis） · Visible 3D'}).count(),0)
 await inspector().getByRole('tab',{name:'服务器图片',exact:true}).click();await field('搜索服务器图片').fill('car-');await field('加入 car-all.png').waitFor();await field('加入 car-all.png').click();await idle();await field('加入 car-1.png').click();await idle();assert.equal((await currentSource()).images.length,2)
 await inspector().getByRole('tab',{name:'上传图片',exact:true}).click();await field('上传磁力片图片文件').setInputFiles(['car-2.png','car-3.png'].map(n=>path.join(root,'public/test-images/maganetic',n)));await idle();assert.equal((await currentSource()).images.length,4)
 await setMetadata('car-all.png','Final','Front');await setMetadata('car-1.png','Step','Back');await setMetadata('car-2.png','Step','Oblique');await setMetadata('car-3.png','Step','Front')
 await field('图片备注 car-2.png').fill('绿色斜坡展开状态；不要重复计数');await field('图片备注 car-2.png').press('Tab');await idle();await button('上移 car-3.png').click();await idle();await button('下移 car-3.png').click();await idle()
 let source=await currentSource();assert.deepEqual(source.images.map(e=>e.name),['car-all.png','car-1.png','car-2.png','car-3.png']);assert.equal(source.images[2].note,'绿色斜坡展开状态；不要重复计数');assert.deepEqual(source.images.map(e=>e.origin),['server','server','upload','upload']);assert.deepEqual(calls,[])
 await page.reload();await stage(page,'source','inspector');await idle();assert.equal((await currentSource()).id,source.id);assert.equal(await field('图片备注 car-2.png').inputValue(),source.images[2].note)
 await page.screenshot({path:out+'/analysis-wide.png'})
 await button('Analyze Visible 3D（调用模型）').click();await stage(page,'review','inspector');await page.getByLabel('3D Review Profile',{exact:true}).waitFor();assert.deepEqual(calls,['analysis'])
 const workspace=()=>page.locator('.studio-workspace'),view=()=>workspace().getByRole('img',{name:'Visible 3D 原图与观察证据',exact:true})
 for(const [index,name] of ['car-all.png','car-1.png','car-2.png','car-3.png'].entries()){
  await stage(page,'review','workspace');await workspace().getByRole('button',{name:new RegExp('^'+(index+1)+' · '+name)}).click();await view().locator('image').waitFor();await page.waitForFunction(()=>!!document.querySelector('.visible3d-image svg image')?.getAttribute('href'))
  const geometry=await view().locator('[data-observation]').first().locator('rect').evaluate(r=>({x:r.x.baseVal.value/r.ownerSVGElement.viewBox.baseVal.width,scroll:r.closest('.visible3d-image').scrollWidth-r.closest('.visible3d-image').clientWidth}));assert.ok(Math.abs(geometry.x-(.1+index*.1))<1e-6);assert.ok(geometry.scroll<=1)
 }
 // Confirm existing canonical tiles once via Profile choice; no duplicate review flow.
 for(const id of fixture.review.pieces.map(p=>p.id)){await stage(page,'review','workspace');await workspace().getByRole('row').filter({hasText:id}).first().click();await stage(page,'review','inspector');await field('3D Review Profile').selectOption('square@1')}
 await stage(page,'review','workspace');await workspace().getByRole('button',{name:'保存 3D Review',exact:true}).click();await workspace().getByRole('button',{name:'进入 3D Reconstruction',exact:true}).click();await stage(page,'reconstruction','inspector')
 await button('Spatial Planning（调用模型）').click();await button('Geometry Execution（不调用模型）').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('button')?.disabled);await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Geometry Execution（不调用模型）'&&!b.disabled));await button('Geometry Execution（不调用模型）').click();await field('3D Reconstruction Candidate').locator('option[value="candidate-1"]').waitFor({state:'attached'});
 assert.deepEqual(calls,['analysis','plan']);const h=await api.dispatch('GET','visible3d/history');assert.equal(h.executions.length,1);assert.equal(h.executions[0].candidates.length,1)
 await button('Trace / Raw').click();await page.getByRole('button',{name:'Spatial Planning',exact:true}).click();await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Trace JSON"]')?.value.includes('referenceImageId'));await page.getByRole('button',{name:'关闭 Trace',exact:true}).click()
 await field('已对照照片审核候选').check();page.once('dialog',d=>d.accept());await button('采用候选到 3D Assembly Editor').click();await page.waitForFunction(()=>document.querySelector('[data-stage="assembly"]')?.getAttribute('aria-current')==='step');assert.equal(await page.locator('.studio-workspace canvas:visible').count(),1);
 await stage(page,'source','inspector');await button('移除 car-3.png').click();await idle();assert.equal((await currentSource()).images.length,3);assert.equal(await page.getByLabel('3D Analysis 历史',{exact:true}).inputValue(),'','changing collection clears old selected result');assert.deepEqual(calls,['analysis','plan'])
 // Multi-upload also works without server selections, with tab/state separation from 2D.
 await studioMode(page,'2d');await stage(page,'source','inspector');await field('上传磁力片图片文件').setInputFiles(['car-all.png','car-1.png'].map(n=>path.join(root,'public/test-images/maganetic',n)));await page.waitForFunction(()=>new URL(location.href).searchParams.has('sourceId'));assert.equal(await inspector().getByText(/本次 Analysis · 2\/4/).count(),1)
 await studioMode(page,'3d');await stage(page,'source','inspector');await idle();assert.equal((await currentSource()).images.length,3)
 for(const width of [1100,680]){await page.setViewportSize({width,height:980});await stage(page,'source','inspector');const overflow=await inspector().evaluate(e=>e.scrollWidth-e.clientWidth);assert.ok(overflow<=2,`Inspector overflow at ${width}: ${overflow}`);await page.screenshot({path:out+`/analysis-${width}.png`});await stage(page,'source','workspace');assert.equal(await view().count(),1)}
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);const result={passed:true,realImages:['car-all.png','car-1.png','car-2.png','car-3.png'],modelCalls:0,offlineProviderFixtureCalls:calls,checks:['server searchable multi-selection','two-file upload','mixed sources','metadata and order persistence','refresh restoration','per-frame annotations','Review -> Planning -> Execution','Trace','changed set invalidates selection','2D/3D isolation','1660/1100/680 layout'],productionWrites:0};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

import {openSavedImageSources} from './magnetic-studio-browser.mjs'
// Actual Review UI + temporary persisted API; providers are in-process spies.
// Synthetic evidence and traces are labelled fixtures, never real model results.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {upgradeVisibleFixture} from '../test/magnetic-visible3d-v2-fixtures.mjs'
import {visibleFixture,png} from '../test/magnetic-visible3d-fixtures.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'visible-confirm-ui-')),out='/tmp/magnetic-visible3d-confirmation'
let server,browser,page
try{
 await mkdir(out,{recursive:true});const api=createMagneticIntake(dir),f=upgradeVisibleFixture(await visibleFixture('closed-cube')),source=await api.dispatch('POST','sources',{name:'offline-six-visible.png',original:png,view:png}),planningCalls=[],requests=[],errors=[],consoleErrors=[]
 const workflow=createVisible3DWorkflow(path.join(dir,'visible3d'),{readSource:id=>api.read('sources',id),readImage:async()=>png,getRegistry:()=>api.dispatch('GET','profiles'),runModel:async(prepared,options,kind)=>{
  const confirmed=prepared.input.geometryInput?.review.pieces.filter(p=>p.confirmed&&!p.excluded)
  if(kind==='plan')planningCalls.push(prepared)
  const output=kind==='analysis'?f.evidence:{version:1,parts:confirmed.map(p=>({id:p.id,profileId:p.profileId,profileVersion:p.profileVersion,orientationEvidence:'offline partial membership fixture'})),connections:[],alternatives:[],relations:[],unknowns:['Offline fixture, no photograph accuracy claim']}
  const trace={id:randomUUID(),status:'plan_ready_for_review',sources:options.sources,requestInput:prepared.input,parseStatus:'parsed',validation:{valid:true},wireStatus:'response_saved',finishReason:'completed',rawOutput:JSON.stringify(output),plan:output,model:'offline-spy',usageMetadata:{fixture:true},fixture:'Synthetic test record; no provider HTTP request'};await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,trace.id+'.json'),JSON.stringify(trace));return trace
 }})
 const analyzed=await workflow.dispatch('POST','analyze',{sourceId:source.id,requestId:randomUUID(),model:'gpt-4.1'});assert.equal(analyzed.usable,true)
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-review-confirmation',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];requests.push({method:req.method,route})
  try{let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};if(req.method!=='GET'&&!['visible3d/reviews','visible3d/plan'].includes(route))throw Error('Non-fixture writes and Vision calls forbidden')
   let result=route==='visible3d/plan'?await workflow.dispatch(req.method,'plan',body):await api.dispatch(req.method,route,body)
   if(route==='visible3d/status')result={...result,providers:Object.fromEntries(Object.keys(result.providers).map(k=>[k,true]))}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen()
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1650,height:1050}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html`,field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),ids=f.review.pieces.map(p=>p.id),first=ids[0],second=ids[1]
 async function choose(id){await stage(page,'review','workspace');await page.locator(`[data-review-id="${id}"]`).filter({visible:true}).click();await stage(page,'review','inspector')}
 async function save(){await stage(page,'review','workspace');const response=page.waitForResponse(r=>r.url().endsWith('/visible3d/reviews')&&r.request().method()==='POST');await button('保存 3D Review').click();const r=await(await response).json();await page.getByRole('status').filter({hasText:'3D Review 已保存'}).waitFor();return r.record}
 async function participation(){return page.getByTestId('visible3d-planning-participation')}
 async function reviewProgress(confirmed,expected,pending,excluded){
  await stage(page,'review','workspace');const progress=page.getByTestId('review-confirmation-progress').filter({visible:true})
  await progress.getByText(`已确认 ${confirmed}/${expected}`,{exact:true}).waitFor();assert.match(await progress.innerText(),new RegExp(`尚未确认 ${pending}`));assert.match(await progress.innerText(),new RegExp(`已排除 ${excluded}`));assert.equal(await progress.getAttribute('role'),confirmed===0?'alert':'status')
  if(!confirmed)assert.match(await progress.innerText(),/无法执行 Spatial Planning/);else if(pending)assert.match(await progress.innerText(),/未确认实例不参与.*部分重建/s);else assert.match(await progress.innerText(),/全部应审核实例已确认/)
  const states=page.locator('.review-parts-table [data-confirmation-state]').filter({visible:true});assert.equal(await states.count(),expected+excluded)
  assert.equal(await states.filter({hasText:'等待人工确认'}).count(),pending)
  for(const mark of await states.all()){const pending=await mark.getAttribute('data-confirmation-state')==='pending';assert.equal(await mark.evaluate(e=>getComputedStyle(e).color),pending?'rgb(161, 38, 38)':'rgb(91, 109, 99)');assert.equal(await mark.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)')}
  assert.equal(await progress.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');if(!pending&&confirmed>0)assert.equal(await progress.locator('.review-confirmation-blocker').count(),0)
  await stage(page,'review','inspector')
 }
 await page.goto(base+'?stage=source');await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor();await studioMode(page,'3d');await stage(page,'source','inspector');await openSavedImageSources(page);await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${source.id}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(source.id);await field('3D Analysis 历史').locator(`option[value="${analyzed.record.id}"]`).waitFor({state:'attached'});await field('3D Analysis 历史').selectOption(analyzed.record.id)
 for(const id of ids){await choose(id);assert.equal(await field('确认可见实例').isChecked(),false);assert.equal(await field('3D Review Profile').inputValue(),'')}
 await reviewProgress(0,6,6,0);await stage(page,'review','workspace');assert.match(await page.locator(`[data-review-id="${first}"]`).innerText(),/Unknown.*等待人工确认/s);await page.screenshot({path:out+'/review-unknown-blockers.png'});await stage(page,'review','inspector')
 await choose(first);assert.equal(await button('采用 AI 形状判断').count(),0);assert.equal(await field('3D 人工 Shape Family').count(),0);assert.equal(await field('确认可见实例').isChecked(),false);await field('3D Review Profile').focus();assert.equal(await field('确认可见实例').isChecked(),false)
 await button('采用 AI 建议 square@1').click();assert.equal(await field('确认可见实例').isChecked(),false);await field('确认可见实例').check();await field('确认可见实例').uncheck();assert.equal(await field('确认可见实例').isChecked(),false)
 await reviewProgress(0,6,6,0);await stage(page,'review','workspace');assert.match(await page.locator(`[data-review-id="${first}"]`).innerText(),/Known.*等待人工确认/s);await stage(page,'review','inspector')
 await choose(second);await field('3D Review Profile').selectOption('square@1');assert.equal(await field('确认可见实例').isChecked(),false);await field('排除实例（保留证据）').check();assert.equal(await field('确认可见实例').isChecked(),false);assert.equal(await field('确认可见实例').isDisabled(),true);await button('采用 AI 建议 square@1').click();assert.equal(await field('排除实例（保留证据）').isChecked(),true);assert.equal(await field('确认可见实例').isChecked(),false);await field('排除实例（保留证据）').uncheck();assert.equal(await field('确认可见实例').isChecked(),false)
 await field('排除实例（保留证据）').check();await reviewProgress(0,5,5,1);await field('排除实例（保留证据）').uncheck();await choose(ids[2]);await field('排除实例（保留证据）').check();await reviewProgress(0,5,5,1);await field('排除实例（保留证据）').uncheck();await reviewProgress(0,6,6,0)
 // Reproduce Known 6 / confirmed 0 without granting trust from Profile presence.
 for(const id of ids){await choose(id);await button('采用 AI 建议 square@1').click();assert.equal(await field('确认可见实例').isChecked(),false);await field('确认可见实例').check()}
 await reviewProgress(6,6,0,0);await stage(page,'review','workspace');await page.screenshot({path:out+'/review-all-confirmed.png'});await stage(page,'review','inspector')
 for(const id of ids){await choose(id);await field('确认可见实例').uncheck()}
 await reviewProgress(0,6,6,0);await stage(page,'review','workspace');await page.screenshot({path:out+'/review-known-blockers.png'})
 const zero=await save();assert.equal(zero.input.review.pieces.length,6);assert.ok(zero.input.review.pieces.every(p=>p.profileId==='square'&&!p.confirmed))
 await stage(page,'reconstruction','inspector');assert.equal(await button('Spatial Planning（调用模型）').isDisabled(),true);assert.match(await(await participation()).innerText(),/0\/6 个实例已确认/);assert.equal(await(await participation()).getAttribute('role'),'alert');assert.equal(requests.filter(r=>r.route==='visible3d/plan').length,0);assert.equal(planningCalls.length,0)
 await page.screenshot({path:out+'/zero-confirmed.png'});const direct=await page.request.post(`http://127.0.0.1:${server.httpServer.address().port}/api/magnetic-intake/visible3d/plan`,{data:{reviewId:zero.id,requestId:randomUUID(),model:'gpt-4.1'}}),rejected=await direct.json();assert.equal(rejected.state,'failed');assert.match(rejected.error,/0\/6/);assert.equal(planningCalls.length,0,'server blocks a direct bypass before calling any model')
 await page.reload();await page.waitForFunction(id=>document.querySelector('select[aria-label="3D Review 历史"]')?.value===id,zero.id);assert.equal(await button('Spatial Planning（调用模型）').isDisabled(),true)
 await choose(first);assert.equal(await field('确认可见实例').isChecked(),false);await button('采用 AI 建议 square@1').click();assert.equal(await field('确认可见实例').isChecked(),false);await field('确认可见实例').check();await stage(page,'reconstruction','inspector');assert.equal(await button('Spatial Planning（调用模型）').isDisabled(),true,'saved zero-confirmation Review remains authoritative until save');assert.ok(await page.getByRole('alert').filter({hasText:'Review 有未保存修改'}).isVisible())
 await reviewProgress(1,6,5,0);await stage(page,'review','workspace');await page.screenshot({path:out+'/review-partial.png'})
 const one=await save();await stage(page,'reconstruction','inspector');assert.match(await(await participation()).innerText(),/1\/6 个实例已确认并参与/);assert.equal(await(await participation()).getAttribute('role'),'status');assert.equal(await button('Spatial Planning（调用模型）').isDisabled(),false);assert.equal(await(await participation()).evaluate(e=>getComputedStyle(e).color),'rgb(36, 62, 58)')
 await page.reload();await page.waitForFunction(id=>document.querySelector('select[aria-label="3D Review 历史"]')?.value===id,one.id);await choose(first);assert.equal(await field('确认可见实例').isChecked(),true);await choose(second);assert.equal(await field('确认可见实例').isChecked(),false);await stage(page,'reconstruction','inspector')
 await reviewProgress(1,6,5,0);await stage(page,'reconstruction','inspector')
 await button('Spatial Planning（调用模型）').click();await page.waitForFunction(()=>document.querySelector('[data-testid="visible3d-planning-state"]')?.getAttribute('data-tone')==='review');assert.equal(planningCalls.length,1);assert.deepEqual(planningCalls[0].input.geometryInput,one.input);assert.deepEqual(planningCalls[0].input.geometryInput.review.pieces.filter(p=>p.confirmed&&!p.excluded).map(p=>p.id),[first]);assert.equal(await page.getByTestId('visible3d-planning-state').evaluate(e=>getComputedStyle(e).color),'rgb(36, 62, 58)')
 const history=await api.dispatch('GET','visible3d/history');assert.deepEqual(history.plans[0].plan.parts.map(p=>p.id),[first]);assert.deepEqual((await api.dispatch('GET','visible3d/reviews/'+zero.id)).record,zero);assert.deepEqual((await api.dispatch('GET','visible3d/reviews/'+one.id)).record,one)
 await field('3D Review 历史').selectOption(zero.id);assert.equal(await button('Spatial Planning（调用模型）').isDisabled(),true);await page.getByRole('alert').filter({hasText:'Outdated：当前 Review'}).waitFor();await field('3D Review 历史').selectOption(one.id);assert.match(await(await participation()).innerText(),/1\/6/);assert.equal(await button('Spatial Planning（调用模型）').isDisabled(),false)
 await field('3D Review 历史').selectOption(zero.id);await reviewProgress(0,6,6,0);await field('3D Review 历史').selectOption(one.id);await reviewProgress(1,6,5,0)
 for(const id of ids){await choose(id);await field('排除实例（保留证据）').check()};await reviewProgress(0,0,0,6)
 await field('3D Review 历史').selectOption(one.id);await reviewProgress(1,6,5,0)
 await page.setViewportSize({width:680,height:900});await reviewProgress(1,6,5,0);await stage(page,'review','workspace');await page.screenshot({path:out+'/review-partial-680.png'})
 // Family recognition alone is not a geometry specification, even on single-image records.
 await page.setViewportSize({width:1650,height:1050});await stage(page,'review','workspace')
 const familyOnly=await workflow.dispatch('POST','annotate',{sourceId:source.id,evidence:{version:2,spatialInterpretation:{camera:f.evidence.spatialInterpretation.camera,faces:[],connections:[],overallShapeHypotheses:[],hiddenStructureHypotheses:[],alternatives:[],unknowns:[]},observations:[{...structuredClone(f.evidence.observations[0]),profileCandidates:[]}],unknowns:['OFFLINE family-only suggestion; exact size unknown']}})
 await button('刷新 3D 历史').click();await field('3D Analysis 历史').locator(`option[value="${familyOnly.id}"]`).waitFor({state:'attached'});await field('3D Analysis 历史').selectOption(familyOnly.id);await choose(first)
 assert.equal(await field('3D Review Profile').inputValue(),'');assert.equal(await field('确认可见实例').isChecked(),false);assert.equal(await button('采用 AI 建议 square@1').count(),0);assert.match(await page.locator('.visible3d-shape').filter({visible:true}).innerText(),/正方形.*无明确的 Exact Profile 建议/s)
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);const result={passed:true,confirmation:'Profile suggestion/manual edit never confirms existence; explicit checkbox only; exclusion wins; manual cancel retained',preflight:'Known 6 / confirmed 0 blocked in UI and direct server call with zero provider invocations; saved partial 1/6 plans only that instance',persistence:'saved Review, refresh, history and stale source checks',colors:'only blockers red; non-blocking states neutral',paidCalls:0,mockedPlanningCalls:1,productionWrites:0,errors,consoleErrors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

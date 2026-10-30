// Real production UI and immutable rose history; no Recognition / LLM calls.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {stage,rightTab,reviewDetails} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-workflow-ui'
const sourceId='5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f'
const get=async route=>{const r=await fetch(base+'/api/magnetic-intake/'+route);assert.equal(r.status,200);return r.json()}
const refs=await get('selected/'+sourceId),selected=kind=>refs.find(r=>r.stage===kind&&r.valid)?.snapshotId
assert.ok(selected('analysis')&&selected('review'),'rose needs existing Selected snapshots')
const review=await get('reviews/'+selected('review')),analysis=await get('analyses/'+review.analysisId)
const link=path+`?stage=review&sourceId=${sourceId}&analysisId=${analysis.id}&reviewId=${review.id}&observationId=p1&rightTab=inspector`
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[],posts=[],paid=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
context.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/magnetic-intake/'))posts.push({url:r.url(),body:r.postDataJSON()})})
await context.route('**/api/magnetic-intake/recognize',r=>{paid.push(r.request().url());return r.abort()})
const page=await context.newPage(),left=page.locator('.studio-workflow'),right=page.locator('.studio-inspector'),matcher=page.getByRole('region',{name:'Find Matching Profile',exact:true})
const idle=p=>p.waitForFunction(()=>{const e=document.querySelector('select[aria-label="当前图片"]');return e&&!e.disabled})
const labels={source:'图片与识别（Analysis）',review:'识别审核（Review）',reconstruction:'几何重建（Reconstruction）',assembly:'作品编辑（Assembly）',build:'搭建教程（Build）'}
const owns=async (id)=>{
 for(const [aria,owner] of [['图片来源','source'],['识别模型','source'],['几何重建作品模式','reconstruction'],['教程来源作品','build']]){
  const locator=page.getByLabel(aria,{exact:true});assert.equal(await locator.count(),1,aria+' has one owner');assert.equal(await locator.isVisible(),owner===id,aria+' visible in its stage only')
 }
 for(const name of ['当前图片','历史 Analysis','历史 Review','历史 Reconstruction'])assert.equal(await left.getByLabel(name,{exact:true}).isVisible(),true)
 assert.equal(await left.getByRole('region',{name:'History',exact:true}).count(),1)
 assert.equal(await left.getByLabel('当前图片',{exact:true}).inputValue(),sourceId)
 assert.equal(await page.getByRole('button',{name:'识别图片（调用模型）',exact:true}).isVisible(),id==='source')
 assert.equal(await page.getByRole('button',{name:'生成几何重建',exact:true}).isVisible(),id==='reconstruction')
 assert.equal(await left.getByLabel('识别模型',{exact:true}).count(),0)
 assert.equal(await left.getByRole('button',{name:'识别图片（调用模型）',exact:true}).count(),0)
}
try{
 await mkdir(out,{recursive:true});await page.goto(link);await idle(page)
 for(const [id,label] of Object.entries(labels))assert.equal(await page.locator(`[data-stage=${id}]`).locator('span').getAttribute('title'),label)
 assert.equal(await left.getByLabel('历史 Review',{exact:true}).inputValue(),review.id)
 assert.match(await left.getByLabel('历史 Review',{exact:true}).locator('option:not([value=""])').first().innerText(),/★ Selected/)
 assert.equal(await page.locator('.review-inspector').getByLabel('几何重建作品模式',{exact:true}).count(),0)
 await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).click()
 const metrics=await matcher.locator('[data-match-profile]').first().innerText()
 await reviewDetails(page,'零件证据与轮廓编辑')
 const color=await page.getByLabel('修正颜色',{exact:true}).inputValue(),changed=color==='#13579b'?'#2468ac':'#13579b'
 await page.getByLabel('修正颜色',{exact:true}).fill(changed)
 await page.waitForFunction(()=>document.querySelector('select[aria-label="历史 Review"]').value==='')
 for(const id of ['source','review','reconstruction','assembly','build','review']){
  await stage(page,id,'inspector');await owns(id)
  await rightTab(page,'catalog');assert.equal(await page.locator('[data-catalog-profile]').count(),5);await rightTab(page,'inspector')
  assert.equal(await page.locator('main').getAttribute('data-active-stage'),id)
  if(id==='build'){assert.equal(await page.getByRole('region',{name:'搭建教程播放器',exact:true}).count(),0,'view switch must not generate a tutorial');assert.equal(await page.getByRole('button',{name:'保存教程',exact:true}).isDisabled(),true);await page.screenshot({path:out+'/build.png'})}
  if(id==='reconstruction')assert.equal(await page.getByRole('button',{name:'生成几何重建',exact:true}).isDisabled(),true,'unsaved draft cannot reconstruct')
 }
 assert.deepEqual(posts,[],'view switches do not execute or save business operations')
 assert.equal(await page.locator('tr[aria-selected=true]').getAttribute('data-review-id'),'p1')
 assert.equal(await page.getByLabel('修正颜色',{exact:true}).inputValue(),changed)
 assert.equal(await matcher.locator('[data-match-profile]').first().innerText(),metrics)
 assert.match(await page.locator('.review-title-row').innerText(),/未保存/)
 await page.screenshot({path:out+'/review.png'})
 // Refresh uses the existing explicit draft-recovery action and preserves Selected.
 await page.reload();await idle(page);await page.getByRole('button',{name:'恢复本地审核草稿',exact:true}).click()
 await page.locator('[data-review-id=p1]').click();await reviewDetails(page,'零件证据与轮廓编辑')
 assert.equal(await page.getByLabel('修正颜色',{exact:true}).inputValue(),changed)
 const saving=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/magnetic-intake/reviews'))
 await page.getByRole('button',{name:'保存审核快照',exact:true}).click();const saved=await(await saving).json();await idle(page)
 assert.equal(saved.analysisId,analysis.id);assert.notEqual(saved.id,review.id)
 assert.deepEqual(await get('selected/'+sourceId),refs,'saving does not change Selected')
 const savedUrl=page.url();await stage(page,'reconstruction','inspector')
 assert.equal(await page.getByRole('button',{name:'生成几何重建',exact:true}).isEnabled(),true)
 await page.getByLabel('几何重建作品模式',{exact:true}).selectOption('flat-mosaic')
 const reconstructing=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/magnetic-intake/reconstruct'))
 await page.getByRole('button',{name:'生成几何重建',exact:true}).click();const reconstruction=await(await reconstructing).json();await idle(page)
 assert.ok(reconstruction.id);assert.equal(reconstruction.reviewId,saved.id);assert.equal(reconstruction.mode,'flat-mosaic')
 assert.deepEqual(posts.find(r=>r.url.endsWith('/reconstruct')).body,{reviewId:saved.id,reviewHash:saved.hash,mode:'flat-mosaic'})
 await page.screenshot({path:out+'/reconstruction.png'})
 const beforeSwitch=posts.length
 await stage(page,'source','inspector');await page.getByLabel('图片来源',{exact:true}).selectOption('server')
 await page.getByRole('button',{name:'刷新 Server Library',exact:true}).click();await idle(page)
 await page.getByLabel('服务器图片',{exact:true}).locator('option[value="connetix-rose.png"]').waitFor({state:'attached'})
 assert.equal(posts.length,beforeSwitch,'library refresh does not create or recognize a source')
 const sourceResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/magnetic-intake/sources'))
 await page.getByLabel('服务器图片',{exact:true}).selectOption('connetix-rose.png');assert.equal((await(await sourceResponse).json()).id,sourceId);await idle(page)
 assert.equal(new URL(page.url()).searchParams.get('sourceType'),'server')
 await page.screenshot({path:out+'/analysis.png'})
 const uploadResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/magnetic-intake/sources'))
 await page.getByTestId('intake-upload').setInputFiles(new URL('../public/test-images/maganetic/connetix-rose.png',import.meta.url).pathname)
 assert.equal((await(await uploadResponse).json()).id,sourceId);await idle(page)
 assert.equal(new URL(page.url()).searchParams.get('sourceType'),'uploaded')
 // Explicit Current URL still wins over Selected, including new tab and navigation.
 await page.goto(savedUrl);await idle(page);const tab=await context.newPage();await tab.goto(savedUrl);await idle(tab)
 assert.equal(await tab.getByLabel('历史 Review',{exact:true}).inputValue(),saved.id)
 await stage(page,'source','inspector');await stage(page,'review','inspector');await page.goBack();await idle(page)
 assert.equal(await page.locator('main').getAttribute('data-active-stage'),'source')
 assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),saved.id)
 await page.goForward();await idle(page);assert.equal(await page.locator('main').getAttribute('data-active-stage'),'review')
 await page.reload();await idle(page);assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),saved.id)
 // Compact left context and stage actions remain within narrow columns / mobile viewport.
 await page.setViewportSize({width:1024,height:700});await owns('review')
 assert.ok(await left.evaluate(e=>e.scrollWidth<=e.clientWidth+1))
 await page.screenshot({path:out+'/narrow.png'})
 await page.setViewportSize({width:430,height:900});await stage(page,'source','inspector');await page.screenshot({path:out+'/mobile-analysis.png'})
 assert.ok(await right.evaluate(e=>e.scrollWidth<=e.clientWidth+1))
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1))
 assert.deepEqual(await get('analyses/'+analysis.id),analysis);assert.deepEqual(await get('reviews/'+review.id),review);assert.deepEqual(await get('selected/'+sourceId),refs)
 assert.deepEqual(errors,[]);assert.deepEqual(paid,[])
 assert.equal(posts.filter(r=>r.url.endsWith('/reconstruct')).length,1)
 assert.equal(posts.filter(r=>r.url.endsWith('/reviews')).length,1)
 assert.equal(posts.filter(r=>r.url.endsWith('/sources')).length,2)
 await writeFile(out+'/result.json',JSON.stringify({status:'PASS',sourceId,selected:refs,current:saved.id,reconstruction:reconstruction.id,candidates:reconstruction.candidates.length,metrics,paidCalls:paid.length,posts:posts.map(r=>r.url)},null,2))
 console.log('PASS: five consistent workflow terms; shared compact Source/History; source-only manager/model/recognition; reconstruction-only controls and real request; Build-only config; draft/matcher/selection survives stages and Catalog; refresh/new tab/Back/Forward; append-only Review; unchanged Selected/Analysis/history; server library/upload; narrow/mobile; zero automatic executions and paid calls. '+out)
}finally{await browser.close()}

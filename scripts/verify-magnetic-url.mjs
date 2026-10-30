import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {stage,studioButton,reviewDetails} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html'
const h=await(await fetch(base+'/api/magnetic-intake/history')).json(),a=h.analyses.find(a=>a.evidence?.observations.length===14&&a.evidence.observations.filter(o=>o.profileId==='unknown').length===6),duck=h.reconstructions.find(r=>r.candidates?.[0]?.assembly.instances.length===17);assert.ok(a&&duck)
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1800,height:1050}}),errors=[],forbidden=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
await context.route('**/api/magnetic-intake/recognize',r=>{forbidden.push(r.request().url());return r.abort()})
await context.route('**/api/magnetic-intake/reconstruct',r=>{forbidden.push(r.request().url());return r.abort()})
const page=await context.newPage(),idle=p=>p.waitForFunction(()=>{const s=document.querySelector('select[aria-label="已保存图片"]');return s&&!s.disabled}),button=n=>studioButton(page,n)
try{
 await page.goto(path+'?stage=review&sourceId='+a.sourceId+'&analysisId='+a.id+'&observationId=p6');await idle(page)
 assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),'unknown')
 assert.equal(await page.locator('.review-title-row button').count(),2);assert.equal(await page.locator('.studio-inspector').getByRole('button',{name:'保存审核快照',exact:true}).count(),0)
 for(const id of ['p4','p5','p6']){await page.locator(`[data-review-id="${id}"]`).click();await page.getByLabel('修正形状',{exact:true}).selectOption('equilateral-triangle@1')}
 assert.match(await page.locator('.review-title-row').innerText(),/未保存/)
 const response=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');await button('保存审核快照').click();const review=await(await response).json();await idle(page)
 assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),review.id)
 const link=page.url();assert.equal(new URL(link).searchParams.get('reviewId'),review.id);console.log('ROSE_DEEP_LINK='+link)
 const tab=await context.newPage();await tab.goto(link);await idle(tab)
 for(const p of [tab,page]){assert.equal(await p.getByLabel('历史 Review',{exact:true}).inputValue(),review.id);assert.equal(await p.locator('tr[aria-selected=true]').getAttribute('data-review-id'),'p6');assert.equal(await p.getByLabel('修正形状',{exact:true}).inputValue(),'equilateral-triangle@1')}
 await tab.reload();await idle(tab);assert.equal(await tab.locator('tr[aria-selected=true]').getAttribute('data-review-id'),'p6')
 await page.locator('[data-review-id="p4"]').click();assert.equal(new URL(page.url()).searchParams.get('observationId'),'p4')
 await stage(page,'catalog');await stage(page,'build');await page.goBack();await idle(page);assert.equal(await page.locator('main').getAttribute('data-active-stage'),'review');assert.equal(await page.getByRole('tab',{name:'Tiles Catalog',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await page.locator('tr[aria-selected=true]').getAttribute('data-review-id'),'p4');await page.goForward();await page.waitForFunction(()=>document.querySelector('main').dataset.activeStage==='build')
 await page.goto(link);await idle(page);await reviewDetails(page,'零件证据与轮廓编辑');await page.getByLabel('修正颜色',{exact:true}).fill('#123456');await page.getByLabel('修正颜色',{exact:true}).dispatchEvent('change');await page.waitForFunction(()=>!new URL(location.href).searchParams.has('reviewId'));await page.goto(link);await idle(page);assert.equal(await page.getByLabel('修正颜色',{exact:true}).inputValue(),review.evidence.observations.find(o=>o.id==='p6').color.toLowerCase());await button('恢复本地审核草稿').click();assert.equal(await page.getByLabel('修正颜色',{exact:true}).inputValue(),'#123456');assert.equal(new URL(page.url()).searchParams.has('reviewId'),false)
 const duckLink=path+'?stage=reconstruction&sourceId='+duck.sourceId+'&reconstructionId='+duck.id+'&candidateId='+duck.candidates[0].id
 await page.goto(duckLink);await idle(page);assert.equal(await page.getByLabel('重建候选',{exact:true}).inputValue(),duck.candidates[0].id);assert.equal(await page.locator('[aria-label="重建候选预览"] [data-preview-piece]').count(),17);await page.reload();await idle(page)
 await page.getByLabel('已对照原图',{exact:true}).check();await button('在作品编辑器中打开').click();await idle(page);await button('保存作品快照').click();const assemblyId=new URL(page.url()).searchParams.get('assemblyId');assert.ok(assemblyId)
 await page.reload();await idle(page);assert.equal(await page.locator('[data-tile-id]').count(),17)
 const assemblyLink=page.url(),savedName=await page.getByLabel('作品名称',{exact:true}).inputValue()
 await page.getByLabel('作品名称',{exact:true}).fill('URL 测试未保存草稿');await page.getByLabel('作品名称',{exact:true}).press('Tab')
 assert.equal(new URL(page.url()).searchParams.has('assemblyId'),false)
 await page.goto(assemblyLink);await idle(page);assert.equal(await page.getByLabel('作品名称',{exact:true}).inputValue(),savedName)
 await button('恢复 URL 打开前的作品草稿').click();assert.equal(await page.getByLabel('作品名称',{exact:true}).inputValue(),'URL 测试未保存草稿')
 await stage(page,'build');await button('生成搭建步骤').click();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='导出教程 JSON').disabled);await button('保存教程').click();await page.waitForFunction(()=>new URL(location.href).searchParams.has('buildId'));const buildLink=page.url();await page.reload();await idle(page);await page.waitForFunction(()=>!!document.querySelector('[data-build-tile]'));assert.match(await page.getByTestId('build-playback-source').innerText(),/17块|17 块/)
 // New tab shares persisted library, not the original page's component memory.
 await tab.goto(buildLink);await idle(tab);await tab.waitForFunction(()=>!!document.querySelector('[data-build-tile]'))
 await stage(page,'assembly');await page.goBack();await page.waitForFunction(()=>document.querySelector('main').dataset.activeStage==='build');await page.waitForFunction(()=>!!document.querySelector('[data-build-tile]'));assert.equal(new URL(page.url()).searchParams.get('buildId'),new URL(buildLink).searchParams.get('buildId'))
 const badLinks=[path+'?stage=review&analysisId=missing',path+'?stage=review&sourceId='+duck.sourceId+'&analysisId='+a.id,path+'?stage=review&sourceId=..%2F.env',path+'?stage=reconstruction&reconstructionId='+duck.id+'&candidateId=missing']
 for(const u of badLinks){await tab.goto(u);await tab.getByText(/URL 恢复失败/).waitFor();assert.ok(tab.url().includes('?'))}
 assert.deepEqual((await(await fetch(base+'/api/magnetic-intake/analyses/'+a.id)).json()).evidence,a.evidence)
 await page.goto(link);await idle(page);await page.screenshot({path:'/tmp/magnetic-url-review.png'});assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[])
 console.log('PASS: top save; real rose edits; copied full URL/new tab/refresh/P6; history navigation; local draft recovery; real 17-piece candidate, saved Assembly and Build deep links; invalid/mismatched IDs; zero recognition/reconstruction calls.')
}finally{await browser.close()}

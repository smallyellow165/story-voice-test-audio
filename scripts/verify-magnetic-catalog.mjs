// Global Catalog tab acceptance through production UI and existing real rose history.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {stage,studioButton,rightTab,reviewDetails} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-catalog-tab'
const {profiles}=JSON.parse(await readFile(new URL('../src/magnetic-tiles/profiles.json',import.meta.url),'utf8')),fixture=JSON.parse(await readFile(new URL('../test/fixtures/magnetic-intake/rose-relative-size.json',import.meta.url),'utf8'))
const json=async(route)=>{const response=await fetch(base+'/api/magnetic-intake/'+route);assert.equal(response.status,200);return response.json()}
const analysis=await json('analyses/'+fixture.analysisId),review=await json('reviews/'+fixture.reviewId),selectedBefore=await json('selected/'+fixture.sourceId)
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[],writes=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
context.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/magnetic-intake/'))writes.push(r.url())})
await context.route('**/api/magnetic-intake/recognize',r=>r.abort())
const page=await context.newPage(),catalog=page.getByRole('region',{name:'Tiles Catalog',exact:true}),rows=catalog.locator('[data-catalog-profile]'),right=page.locator('.studio-inspector')
const idle=p=>p.waitForFunction(()=>{const s=document.querySelector('select[aria-label="已保存图片"]');return s&&!s.disabled})
const catalogActive=p=>p.getByRole('tab',{name:'Tiles Catalog',exact:true}).getAttribute('aria-selected')
const rose=path+`?stage=review&sourceId=${fixture.sourceId}&analysisId=${fixture.analysisId}&reviewId=${fixture.reviewId}&observationId=p1`
const key=p=>p.id+'@'+p.version
await mkdir(out,{recursive:true})
try{
 await page.goto(path+'?stage=assembly&rightTab=inspector');await studioButton(page,'添加正方形').click()
 const assemblyBefore=await page.locator('[data-tile-id]').evaluateAll(es=>es.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points')})))
 const lengthBefore=await page.evaluate(()=>history.length)
 await rightTab(page,'catalog')
 assert.equal(await page.evaluate(()=>history.length),lengthBefore,'auxiliary tab replaces URL state without adding workflow navigation')
 assert.equal(await page.locator('[data-stage=catalog]').count(),0)
 assert.equal(await page.getByRole('button',{name:'Supported Tiles / 磁力片目录',exact:true}).count(),0)
 assert.equal(await page.locator('nav[aria-label="工作阶段"] [data-stage]').count(),5)
 assert.equal(await page.locator('main').getAttribute('data-active-stage'),'assembly')
 assert.equal(await page.locator('.studio-workspace .tiles-catalog,.studio-workflow .tiles-catalog').count(),0)
 assert.equal(await rows.count(),5)
 for(const p of profiles){
  const row=rows.filter({has:page.locator(`svg[aria-label="${p.name}真实几何"]`)})
  await row.click();assert.equal(await row.getAttribute('aria-pressed'),'true')
  assert.equal(await row.locator('polygon').getAttribute('points'),p.vertices.map(v=>v.join(',')).join(' '))
  assert.equal(await row.locator('line').count(),p.connectableEdges.length)
  const lengths=p.vertices.map((v,i)=>{const b=p.vertices[(i+1)%p.vertices.length];return Number(Math.hypot(b[0]-v[0],b[1]-v[1]).toFixed(6))}).join(' / ')
  assert.ok((await row.innerText()).includes(lengths));assert.ok((await row.getAttribute('title')).includes(key(p)))
  assert.ok((await row.boundingBox()).height<=70,'profiles use compact rows')
  const info=page.getByRole('region',{name:'Profile 规格',exact:true}),text=await info.innerText()
  assert.ok(text.includes(p.id)&&text.includes('Version：'+p.version))
  for(const v of p.vertices)assert.ok(text.includes(v.join(', ')))
  assert.equal(await info.locator('tbody tr').count(),p.vertices.length)
  if(p.sizeEvidence)assert.match(await info.getByTestId('profile-size-source').innerText(),/Estimated.*V1 Estimated Geometry/)
  assert.equal(new URL(page.url()).searchParams.get('catalogProfile'),key(p))
 }
 await page.getByRole('tab',{name:'Tiles Catalog',exact:true}).focus();await page.keyboard.press('ArrowLeft');assert.equal(await catalogActive(page),'false');await page.keyboard.press('ArrowRight');assert.equal(await catalogActive(page),'true')
 await rightTab(page,'inspector');assert.deepEqual(await page.locator('[data-tile-id]').evaluateAll(es=>es.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points')}))),assemblyBefore)
 await studioButton(page,'生成搭建步骤').click();await page.getByRole('button',{name:'保存教程',exact:true}).waitFor({state:'visible'})
 const buildCount=await page.locator('[data-build-tile]').count();assert.equal(buildCount,1)
 await rightTab(page,'catalog');assert.equal(await page.locator('[data-build-tile]').count(),buildCount);await rightTab(page,'inspector');assert.equal(await page.locator('[data-build-tile]').count(),buildCount);await rightTab(page,'catalog')
 for(const id of ['source','review','reconstruction','assembly','build']){await stage(page,id);assert.equal(await page.locator('main').getAttribute('data-active-stage'),id);assert.equal(await catalogActive(page),'true');assert.equal(await rows.count(),5);assert.equal(await page.locator('.studio-workspace .tiles-catalog').count(),0)}
 // Existing Assembly → Build navigation deliberately returns to the source preview.
 await rightTab(page,'inspector');await page.getByRole('button',{name:'继续上次教程',exact:true}).click();assert.equal(await page.locator('[data-build-tile]').count(),buildCount)
 // Matching UI and unsaved edits remain mounted across auxiliary tab switches.
 await page.goto(rose+'&rightTab=inspector');await idle(page)
 const matcher=page.getByRole('region',{name:'Find Matching Profile',exact:true})
 await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).click()
 const first=matcher.locator('[data-match-profile]').first(),scores=await first.innerText()
 assert.match(scores,/87\.8%/);assert.match(scores,/92\.3%/)
 await reviewDetails(page,'零件证据与轮廓编辑');await page.getByLabel('修正颜色',{exact:true}).fill('#13579b')
 await page.waitForFunction(()=>document.querySelector('select[aria-label="历史 Review"]').value==='')
 const contextBefore=new URL(page.url()),points=await page.locator('[data-observation=p1]').getAttribute('points')
 await rightTab(page,'catalog');await page.locator('[data-catalog-profile="large-equilateral-triangle@1"]').click()
 const contextAfter=new URL(page.url());for(const field of ['sourceId','analysisId','reviewId','observationId','candidateId','reconstructionId','assemblyId','buildId'])assert.equal(contextAfter.searchParams.get(field),contextBefore.searchParams.get(field))
 await rightTab(page,'inspector')
 assert.equal(await page.locator('tr[aria-selected=true]').getAttribute('data-review-id'),'p1')
 assert.equal(await page.getByLabel('修正颜色',{exact:true}).inputValue(),'#13579b')
 assert.equal(await page.locator('[data-observation=p1]').getAttribute('points'),points)
 assert.equal(await matcher.locator('[data-match-profile]').first().innerText(),scores)
 assert.match(await page.locator('.review-title-row').innerText(),/未保存/)
 await rightTab(page,'catalog');await page.screenshot({path:out+'/review-catalog.png'})
 await page.reload();await idle(page);assert.equal(await catalogActive(page),'true');assert.equal(await page.locator('[data-catalog-profile="large-equilateral-triangle@1"]').getAttribute('aria-pressed'),'true')
 // Reload follows the existing explicit local-draft recovery mechanism.
 await page.getByRole('button',{name:'恢复本地审核草稿',exact:true}).click();await rightTab(page,'inspector');await page.locator('[data-review-id=p1]').click();await reviewDetails(page,'零件证据与轮廓编辑');assert.equal(await page.getByLabel('修正颜色',{exact:true}).inputValue(),'#13579b')
 // Saved-context URL can be copied, while tab/profile parameters override newer local UI preferences.
 await page.goto(rose+'&rightTab=catalog&catalogProfile=large-equilateral-triangle%401');await idle(page)
 const copied=page.url();await rightTab(page,'inspector')
 const tab=await context.newPage();await tab.goto(copied);await idle(tab)
 assert.equal(await catalogActive(tab),'true');assert.equal(await tab.getByLabel('历史 Review',{exact:true}).inputValue(),fixture.reviewId)
 assert.equal(await tab.locator('tr[aria-selected=true]').getAttribute('data-review-id'),'p1')
 assert.equal(await tab.locator('[data-catalog-profile="large-equilateral-triangle@1"]').getAttribute('aria-pressed'),'true')
 const plain=await context.newPage();await plain.goto(rose);await idle(plain);assert.equal(await catalogActive(plain),'true');assert.equal(await plain.locator('[data-catalog-profile="large-equilateral-triangle@1"]').getAttribute('aria-pressed'),'true')
 // Legacy Catalog links resolve the work stage from the unchanged snapshot identities.
 const legacy=await context.newPage();await legacy.goto(rose.replace('stage=review','stage=catalog'));await idle(legacy)
 assert.equal(await legacy.locator('main').getAttribute('data-active-stage'),'review');assert.equal(await catalogActive(legacy),'true')
 assert.equal(new URL(legacy.url()).searchParams.get('stage'),'review');assert.equal(await legacy.getByLabel('历史 Review',{exact:true}).inputValue(),fixture.reviewId)
 await legacy.goto(path+'?stage=catalog');await idle(legacy);assert.equal(await catalogActive(legacy),'true');assert.notEqual(await legacy.locator('main').getAttribute('data-active-stage'),'catalog')
 // Right scrolling and the center's existing vertical split remain independent.
 await page.goto(copied);await idle(page);await page.setViewportSize({width:1024,height:600});assert.ok(await catalog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:out+'/minimum-right.png'})
 await page.locator('[data-catalog-profile="tall-right-triangle@1"]').click()
 const centerScroll=await page.locator('.review-table-scroll').evaluate(e=>e.scrollTop)
 await right.hover();await page.mouse.wheel(0,600);await page.waitForFunction(()=>document.querySelector('.studio-inspector').scrollTop>0)
 assert.equal(await page.locator('.review-table-scroll').evaluate(e=>e.scrollTop),centerScroll);assert.equal(await page.evaluate(()=>scrollY),0)
 const catalogScroll=await right.evaluate(e=>e.scrollTop);await rightTab(page,'inspector');await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).click();await right.evaluate(e=>{e.scrollTop=140});const inspectorScroll=await right.evaluate(e=>e.scrollTop)
 await rightTab(page,'catalog');assert.ok(Math.abs(await right.evaluate(e=>e.scrollTop)-catalogScroll)<2)
 await rightTab(page,'inspector');assert.ok(Math.abs(await right.evaluate(e=>e.scrollTop)-inspectorScroll)<2)
 await rightTab(page,'catalog')
 const separator=page.getByRole('separator',{name:'调整零件表与原图高度'}),s=await separator.boundingBox(),partBefore=await page.locator('.review-parts').boundingBox()
 await page.mouse.move(s.x+s.width/2,s.y+s.height/2);await page.mouse.down();await page.mouse.move(s.x+s.width/2,s.y-50,{steps:8});await page.mouse.up();assert.ok((await page.locator('.review-parts').boundingBox()).height<partBefore.height-20)
 const resize=page.getByRole('separator',{name:'调整中栏与右栏宽度'}),b=await resize.boundingBox(),widthBefore=(await right.boundingBox()).width
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x-60,b.y+b.height/2,{steps:8});await page.mouse.up();assert.ok((await right.boundingBox()).width>widthBefore+20)
 assert.ok(await catalog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1))
 await page.screenshot({path:out+'/narrow.png'})
 await page.setViewportSize({width:430,height:900});await rightTab(page,'catalog')
 const tabs=await page.getByRole('tablist',{name:'右栏工具'}).evaluate(el=>[...el.querySelectorAll('[role=tab]')].map(e=>e.getBoundingClientRect().y));assert.ok(Math.abs(tabs[0]-tabs[1])<1)
 assert.ok(await catalog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1))
 await page.screenshot({path:out+'/mobile.png'})
 assert.deepEqual(await json('analyses/'+analysis.id),analysis);assert.deepEqual(await json('reviews/'+review.id),review);assert.deepEqual(await json('selected/'+fixture.sourceId),selectedBefore)
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[])
 await writeFile(out+'/result.json',JSON.stringify({status:'PASS',copiedUrl:copied,profiles:profiles.map(key),paidCalls:0,snapshotWrites:0},null,2))
 console.log('PASS: global two-tab panel across five stages; compact exact Catalog geometry/details; no old entry or middle page; keyboard tabs; unchanged Assembly/Build; P1 matching/draft/selection preserved; separate tab scroll; URL/local UI preferences/refresh/new tab/legacy links; center split/columns/mobile; original snapshots and Selected unchanged; zero writes/models. Screenshots '+out)
}finally{await browser.close()}

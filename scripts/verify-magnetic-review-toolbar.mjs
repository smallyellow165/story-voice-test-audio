// Saved rose snapshots + production UI/API, no Vision/LLM or Selected writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {stage,reviewDetails} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-review-toolbar'
const sid='5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f',get=async route=>{const response=await fetch(base+'/api/magnetic-intake/'+route);assert.equal(response.status,200);return response.json()}
const refs=await get('selected/'+sid),original=await get('reviews/'+(process.env.MAGNETIC_REVIEW_ID||'7da2f5fb-1fb1-4b70-9d6d-fe62bf2f579c')),analysis=await get('analyses/'+original.analysisId)
assert.equal(original.evidence.sourceKind,'unsupported')
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[],posts=[],paid=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
context.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/magnetic-intake/'))posts.push(r.url())})
await context.route('**/api/magnetic-intake/recognize',r=>{paid.push(r.request().url());return r.abort()})
const page=await context.newPage(),tools=page.locator('.review-table-tools'),kind=tools.getByLabel('输入类别',{exact:true}),status=page.getByTestId('review-save-status'),save=tools.getByRole('button',{name:'保存审核快照',exact:true})
const idle=p=>p.waitForFunction(()=>{const e=document.querySelector('select[aria-label="当前图片"]');return e&&!e.disabled})
const reviewResponse=()=>page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reviews')&&r.request().method()==='POST')
try{
 await mkdir(out,{recursive:true});await page.goto(path+`?stage=review&sourceId=${sid}&analysisId=${analysis.id}&reviewId=${original.id}&observationId=p1&rightTab=inspector`);await idle(page)
 assert.equal(await kind.isVisible(),true);assert.equal(await save.isVisible(),true);assert.equal(await status.innerText(),'已保存')
 assert.equal(await page.locator('.studio-inspector').getByLabel('输入类别',{exact:true}).count(),0)
 assert.deepEqual(await kind.locator('option').evaluateAll(es=>es.map(e=>e.value)),['unsupported','flat_photo','diagram'])
 const heading=page.locator('.studio-workspace').getByRole('heading',{name:'识别审核（Review）',exact:true})
 assert.equal(await heading.count(),1);assert.equal(await tools.locator('h3').count(),0);assert.ok(!(await tools.innerText()).includes('14/14'))
 const centerY=async el=>{const b=await el.boundingBox();return b.y+b.height/2}
 for(const el of [save,status,tools.getByRole('button',{name:'新增零件',exact:true})])assert.ok(Math.abs(await centerY(el)-await centerY(heading))<2,'Review title and operations share the first row')
 const filters=tools.locator('.review-filters'),filterButtons=filters.getByRole('button')
 assert.ok(Math.abs(await centerY(kind)-await centerY(filterButtons.first()))<2,'category and filters share the second row')
 assert.ok((await kind.boundingBox()).x>=(await filters.boundingBox()).x+(await filters.boundingBox()).width,'category stays at the right end')
 assert.ok((await kind.boundingBox()).y>=(await save.boundingBox()).y+(await save.boundingBox()).height)
 const hint=tools.getByRole('button',{name:'二维重建输入说明',exact:true})
 await hint.hover();assert.match(await page.getByRole('region',{name:'二维重建输入说明',exact:true}).innerText(),/保存审核快照.*输入类别与所有零件修改/)
 await page.mouse.move(800,40);await page.keyboard.press('Escape')
 await kind.selectOption('diagram');assert.equal(await kind.getAttribute('title'),'已确认 · 平面示意图');assert.match(await status.innerText(),/未保存/);assert.deepEqual(posts,[])
 await reviewDetails(page,'零件证据与轮廓编辑')
 const colorInput=page.getByLabel('修正颜色',{exact:true}),old=await colorInput.inputValue(),color=old==='#2468ac'?'#13579b':'#2468ac'
 await colorInput.fill(color);assert.match(await status.innerText(),/未保存/)
 assert.equal(await kind.inputValue(),'diagram');await page.screenshot({path:out+'/unsaved.png'})
 const pending=reviewResponse();await save.click();const saved=await(await pending).json();await idle(page)
 const expected=structuredClone(original.evidence);expected.sourceKind='diagram';expected.observations.find(o=>o.id==='p1').color=color
 assert.deepEqual(saved.evidence,expected);assert.equal(saved.analysisId,analysis.id);assert.notEqual(saved.id,original.id);assert.equal(await status.innerText(),'已保存')
 const savedUrl=page.url();assert.equal(new URL(savedUrl).searchParams.get('reviewId'),saved.id);assert.deepEqual(await get('selected/'+sid),refs)
 await stage(page,'reconstruction','inspector');await page.getByLabel('几何重建作品模式',{exact:true}).selectOption('flat-mosaic')
 const reconstructing=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'生成几何重建',exact:true}).click();const reconstruction=await(await reconstructing).json();await idle(page)
 assert.equal(reconstruction.reviewId,saved.id);assert.ok(reconstruction.explored>0&&reconstruction.trials>0);assert.ok(!reconstruction.diagnostics.some(d=>d.includes('unsupported')))
 await stage(page,'review','workspace');assert.equal(await kind.inputValue(),'diagram');assert.equal(await status.innerText(),'已保存')
 // Category and other draft edits use the existing explicit local recovery.
 await kind.selectOption('flat_photo');assert.match(await status.innerText(),/未保存/);assert.equal(posts.length,2)
 await page.reload();await idle(page);await page.getByRole('button',{name:'恢复本地审核草稿',exact:true}).click()
 assert.equal(await kind.inputValue(),'flat_photo');assert.match(await status.innerText(),/未保存/)
 await page.locator('[data-review-id=p1]').click();await reviewDetails(page,'零件证据与轮廓编辑');assert.equal(await colorInput.inputValue(),color)
 // Preserve-before-history-switch remains unchanged: retain the unsaved whole draft as a separate snapshot.
 const preserving=reviewResponse();await page.getByLabel('历史 Review',{exact:true}).selectOption(original.id);const protectedDraft=await(await preserving).json();await idle(page)
 assert.deepEqual(protectedDraft.evidence,{...expected,sourceKind:'flat_photo'});assert.equal(await kind.inputValue(),'unsupported');assert.equal(await status.innerText(),'已保存')
 await page.getByLabel('历史 Review',{exact:true}).selectOption(saved.id);await idle(page);assert.equal(await kind.inputValue(),'diagram')
 await page.getByLabel('搜索审核零件',{exact:true}).fill('p1');assert.ok(await page.locator('[data-review-id]').count()<14);assert.equal(await page.locator('[data-review-id=p1]').count(),1);await page.getByLabel('搜索审核零件',{exact:true}).fill('')
 const matcher=page.getByRole('region',{name:'Find Matching Profile',exact:true});await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).click();assert.match(await matcher.locator('[data-match-profile]').first().innerText(),/87\.8%/)
 const tab=await context.newPage();await tab.goto(savedUrl);await idle(tab);assert.equal(await tab.getByLabel('输入类别',{exact:true}).inputValue(),'diagram');assert.equal(await tab.getByTestId('review-save-status').innerText(),'已保存')
 await tab.reload();await idle(tab);assert.equal(await tab.getByLabel('历史 Review',{exact:true}).inputValue(),saved.id)
 await page.screenshot({path:out+'/saved.png'})
 const handle=page.getByRole('separator',{name:'调整中栏与右栏宽度',exact:true}),hb=await handle.boundingBox()
 await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();await page.mouse.move(hb.x-240,hb.y+hb.height/2,{steps:10});await page.mouse.up()
 assert.ok(await tools.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'resized toolbar must fit the center column')
 await page.setViewportSize({width:1024,height:700});assert.ok(await tools.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:out+'/narrow.png'})
 await page.setViewportSize({width:430,height:900});await stage(page,'review','workspace');assert.equal(await kind.isVisible(),true);assert.equal(await save.isVisible(),true);await page.waitForFunction(()=>document.querySelector('.review-parts').getBoundingClientRect().height>300);const mobile=await page.locator('.review-parts').boundingBox(),field=await kind.boundingBox(),button=await save.boundingBox();assert.ok(field.y>=mobile.y&&field.y+field.height<=mobile.y+mobile.height);assert.ok(button.y>=mobile.y&&button.y+button.height<=mobile.y+mobile.height);assert.ok((await page.locator('.review-table-scroll').boundingBox()).height>50);assert.ok((await page.locator('.review-evidence-scroll').boundingBox()).height>50);await page.screenshot({path:out+'/mobile-workspace.png'})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1))
 await stage(page,'review','inspector');assert.equal(await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).isVisible(),true);assert.equal(await page.locator('.studio-inspector').getByLabel('输入类别',{exact:true}).count(),0)
 assert.deepEqual(await get('selected/'+sid),refs);assert.deepEqual(await get('reviews/'+original.id),original);assert.deepEqual(await get('analyses/'+analysis.id),analysis)
 assert.deepEqual(errors,[]);assert.deepEqual(paid,[]);assert.equal(posts.length,3)
 await writeFile(out+'/result.json',JSON.stringify({status:'PASS',savedReview:saved.id,protectedDraft:protectedDraft.id,reconstruction:reconstruction.id,savedUrl,selectedUnchanged:true,paidCalls:0},null,2))
 console.log('PASS: compact two-row Review toolbar; one Review title and no duplicate count; filters/category on one row; draggable narrow columns; no duplicate in Inspector; immediate unsaved feedback/no autosave; complete draft/category/color save; real Reconstruction consumes class; existing local and history draft protection; original unsupported/Selected unchanged; filters/matcher; copied URL/reload; 1024/430 layout. '+out)
}finally{await browser.close()}

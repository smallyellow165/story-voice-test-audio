// Production UI against existing real rose records. No Vision / LLM requests.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {stage,studioButton,reviewDetails} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-review-ui'
const fixture=JSON.parse(await readFile(new URL('../test/fixtures/magnetic-intake/rose-relative-size.json',import.meta.url),'utf8'))
const get=async(kind,id)=>{const r=await fetch(base+'/api/magnetic-intake/'+kind+'/'+id);assert.equal(r.status,200);return r.json()}
const original=await get('analyses',fixture.analysisId),previous=await get('reviews',fixture.reviewId)
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1600,height:950}}),errors=[],forbidden=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
await context.route('**/api/magnetic-intake/recognize',r=>{forbidden.push(r.request().url());return r.abort()})
const page=await context.newPage(),inspector=page.locator('.studio-inspector'),rows=page.locator('[data-review-id]'),matcher=page.getByRole('region',{name:'Find Matching Profile',exact:true})
const idle=p=>p.waitForFunction(()=>{const s=document.querySelector('select[aria-label="当前图片"]');return s&&!s.disabled})
async function save(){const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reviews')&&r.request().method()==='POST');await studioButton(page,'保存审核快照').click();const r=await(await response).json();await idle(page);assert.ok(r.id);return r}
async function selected(){return page.locator('tr[aria-selected=true]').getAttribute('data-review-id')}
async function remove(){await page.getByRole('button',{name:'删除零件',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click()}
const snapshots=[]
try{
 await page.goto(path+`?stage=review&sourceId=${fixture.sourceId}&analysisId=${fixture.analysisId}&reviewId=${fixture.reviewId}&observationId=p1`);await idle(page)
 assert.equal(await rows.count(),14)
 assert.equal(await inspector.getByRole('button',{name:'新增零件',exact:true}).count(),0)
 assert.equal(await page.locator('.review-title-row').getByRole('button',{name:'新增零件',exact:true}).count(),1)
 assert.equal(await page.locator('.review-title-row').getByRole('button',{name:'保存审核快照',exact:true}).count(),1)
 assert.equal(await page.locator('.review-inspector input[type=checkbox]').count(),0)
 assert.equal(await page.locator('.review-advanced').evaluate(e=>e.open),false)
 assert.equal(await page.locator('.review-table-tools').getByLabel('输入类别',{exact:true}).isVisible(),true);assert.equal(await inspector.getByLabel('输入类别',{exact:true}).count(),0)
 const primary=matcher.getByRole('button',{name:'Find Matching Profile',exact:true}),box=await primary.boundingBox()
 assert.ok(box.y<330&&box.y+box.height<950,'primary action is visible without scrolling')
 const help=matcher.getByRole('button',{name:'Profile 匹配说明',exact:true})
 await help.hover();await matcher.getByRole('region',{name:'Profile 匹配说明',exact:true}).waitFor({state:'visible'})
 assert.match(await matcher.getByRole('region',{name:'Profile 匹配说明',exact:true}).innerText(),/Shape Score.*Relative Size Score/s)
 await page.mouse.move(800,50);await page.keyboard.press('Escape')
 const metrics={}
 for(const [id,profile,shape,size] of [['p1','tall-right-triangle','87.8%','92.3%'],['p2','large-equilateral-triangle','100.0%','100.0%'],['p3','tall-right-triangle','86.3%','92.6%']]){
  await page.locator(`[data-review-id="${id}"]`).click();await primary.click()
  assert.equal(await matcher.getByRole('checkbox').count(),0);assert.match(await matcher.innerText(),/Warning.*仅供参考/)
  const c=matcher.locator('[data-match-profile]').first();assert.equal(await c.getAttribute('data-match-profile'),profile)
  assert.equal(await c.getByTestId('shape-score').innerText(),'Shape Score：'+shape)
  assert.equal(await c.getByTestId('size-score').innerText(),'Relative Size Score：'+size)
  assert.equal(await c.getByRole('button').isEnabled(),true)
  assert.equal(await matcher.locator('.profile-scale-details').evaluate(e=>e.open),false)
  metrics[id]={profile,shape,size}
 }
 await page.locator('[data-review-id="p1"]').click();await primary.click();await page.screenshot({path:out+'/p1.png'})
 assert.equal(await inspector.getByRole('button',{name:'删除零件',exact:true}).count(),0,'original evidence cannot be deleted')
 await page.getByRole('button',{name:'排除零件',exact:true}).click()
 assert.equal(await page.locator('[data-observation="p1"]').count(),0)
 await page.getByRole('button',{name:'Excluded 1',exact:true}).click();assert.equal(await rows.count(),1)
 await page.getByRole('button',{name:'撤销排除 p1',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'Excluded 0',exact:true}).count(),1)
 assert.equal(new URL(page.url()).searchParams.get('reviewId'),previous.id,'undo restores saved status and URL')
 await page.getByRole('button',{name:'全部 14',exact:true}).click()
 await page.locator('[data-review-id="p1"]').click();await page.getByRole('button',{name:'排除零件',exact:true}).click()
 const excluded=await save();snapshots.push(excluded)
 assert.deepEqual(excluded.evidence.relations,previous.evidence.relations)
 assert.deepEqual(excluded.evidence.observations.find(o=>o.id==='p1'),{...previous.evidence.observations.find(o=>o.id==='p1'),excluded:true})
 const excludedUrl=page.url();await page.reload();await idle(page)
 assert.equal(await page.getByRole('button',{name:'恢复零件',exact:true}).count(),1)
 await page.getByRole('button',{name:'Excluded 1',exact:true}).click();assert.equal(await rows.count(),1)
 await page.getByRole('button',{name:'恢复零件',exact:true}).click()
 const restored=await save();snapshots.push(restored);assert.deepEqual(restored.evidence,previous.evidence)
 // Adding from a hidden/search-filtered table clears its filters and selects the new row.
 await page.getByRole('button',{name:'全部 14',exact:true}).click();await page.getByLabel('搜索审核零件').fill('no-such-part')
 assert.equal(await rows.count(),0);await studioButton(page,'新增零件').click()
 const manual=await selected();assert.match(manual,/^manual-/);assert.equal(await rows.count(),15)
 assert.equal(await page.getByLabel('搜索审核零件').inputValue(),'')
 assert.equal(await page.locator(`[data-observation="${manual}"]`).getAttribute('class'),'observation selected')
 assert.match(await page.locator('.review-title-row').innerText(),/未保存/)
 await primary.click();assert.match(await matcher.innerText(),/Warning/);assert.match(await matcher.getByTestId('shape-score').first().innerText(),/[0-9]+\.[0-9]%/)
 await reviewDetails(page,'连接关系编辑');await page.getByLabel('连接到',{exact:true}).selectOption('p1');await page.getByLabel('关系意图',{exact:true}).selectOption('uncertain');await studioButton(page,'设置关系').click()
 const added=await save();snapshots.push(added)
 assert.equal(added.evidence.observations.find(o=>o.id===manual).origin,'manual')
 assert.ok(added.evidence.relations.some(r=>r.from===manual||r.to===manual))
 const addedUrl=page.url();await page.reload();await idle(page);assert.equal(await selected(),manual)
 await page.getByRole('button',{name:'删除零件',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await rows.count(),15)
 await remove();assert.equal(await rows.count(),14);assert.notEqual(await selected(),manual);assert.notEqual(new URL(page.url()).searchParams.get('observationId'),manual)
 assert.equal(await page.locator(`[data-observation="${manual}"]`).count(),0)
 await page.getByRole('button',{name:`撤销删除 ${manual}`,exact:true}).click();assert.equal(await rows.count(),15);assert.equal(await selected(),manual)
 assert.equal(new URL(page.url()).searchParams.get('reviewId'),added.id)
 await remove();const deleted=await save();snapshots.push(deleted)
 assert.deepEqual(deleted.evidence,previous.evidence,'manual deletion also removes all its incident relations')
 assert.equal(await inspector.getByRole('button',{name:/^撤销删除 /}).count(),0,'save ends single-step undo')
 // New-tab URLs recover both a retained manual part and an excluded original.
 const tab=await context.newPage()
 await tab.goto(addedUrl);await idle(tab);assert.equal(await tab.locator('tr[aria-selected=true]').getAttribute('data-review-id'),manual);assert.equal(await tab.getByRole('button',{name:'删除零件',exact:true}).count(),1)
 await tab.goto(excludedUrl);await idle(tab);assert.equal(await tab.getByRole('button',{name:'恢复零件',exact:true}).count(),1)
 await tab.goto(page.url());await idle(tab);assert.equal(await tab.locator('[data-review-id]').count(),14)
 await tab.reload();await idle(tab);assert.equal(await tab.locator('[data-review-id]').count(),14)
 // Expanding advanced editing does not obscure the primary action for the next selection.
 await reviewDetails(page,'高级信息 / 编辑');assert.equal(await page.getByLabel('输入类别',{exact:true}).inputValue(),previous.evidence.sourceKind)
 assert.equal(await page.getByLabel('输入说明 / 修正理由',{exact:true}).inputValue(),previous.evidence.reason)
 await page.getByLabel('输入说明 / 修正理由',{exact:true}).scrollIntoViewIfNeeded()
 await page.locator('[data-review-id="p1"]').click();assert.ok((await primary.boundingBox()).y<330)
 // Keep the existing resizable three columns and vertical table/image split.
 const handles=page.getByRole('separator');assert.equal(await handles.count(),3)
 const vertical=page.getByRole('separator',{name:'调整零件表与原图高度'}),vb=await vertical.boundingBox()
 const before=await page.locator('.review-parts').boundingBox()
 await page.mouse.move(vb.x+vb.width/2,vb.y+vb.height/2);await page.mouse.down();await page.mouse.move(vb.x+vb.width/2,vb.y-80,{steps:10});await page.mouse.up()
 assert.ok((await page.locator('.review-parts').boundingBox()).height<before.height-30)
 const col=page.locator('.studio-workflow'),widthBefore=(await col.boundingBox()).width
 const first=handles.first(),hb=await first.boundingBox();await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();await page.mouse.move(hb.x+hb.width/2+40,hb.y+hb.height/2,{steps:8});await page.mouse.up()
 assert.ok(Math.abs((await col.boundingBox()).width-widthBefore)>20)
 await primary.click();await page.screenshot({path:out+'/desktop.png'})
 await page.setViewportSize({width:430,height:900});await stage(page,'review','inspector');assert.ok((await primary.boundingBox()).y<350)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1))
 await page.screenshot({path:out+'/mobile.png'})
 assert.deepEqual(await get('analyses',original.id),original)
 assert.deepEqual(await get('reviews',previous.id),previous)
 for(const r of snapshots)assert.deepEqual(await get('reviews',r.id),r)
 assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[])
 await writeFile(out+'/result.json',JSON.stringify({metrics,snapshots:snapshots.map(r=>r.id),deepLink:page.url(),paidCalls:forbidden.length},null,2))
 console.log(JSON.stringify({status:'PASS',metrics,snapshots:snapshots.map(r=>r.id),screenshots:out,checks:'primary action above fold; no confirmation checkbox; warning-only uncertainty; hover help; collapsed evidence; exact rose scores; toolbar add; delete confirmation/cancel/undo; relation cleanup; original exclude/restore/undo; immutable snapshots; saved state and URLs/new tab/refresh; layout resize; mobile; zero paid calls'},null,2))
}finally{await browser.close()}

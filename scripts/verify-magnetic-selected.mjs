// Real saved rose snapshots + real Selected API; no new recognition or fabricated snapshots.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {stage,reviewDetails,studioButton} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-selected'
const fixture=JSON.parse(await readFile(new URL('../test/fixtures/magnetic-intake/rose-relative-size.json',import.meta.url),'utf8'))
const json=async route=>{const response=await fetch(base+'/api/magnetic-intake/'+route);assert.equal(response.status,200);return response.json()}
const history=await json('history'),a=history.analyses.find(a=>a.id===fixture.analysisId),b=history.analyses.find(s=>s.sourceId===a.sourceId&&s.id!==a.id&&s.status==='complete'),r=history.reviews.find(r=>r.id===fixture.reviewId),r2=history.reviews.find(s=>s.analysisId===a.id&&s.id!==r.id);assert.ok(a&&b&&r&&r2)
const originalColor=r2.evidence.observations.find(o=>o.id==='p1').color
const colorWithMask=mask=>'#'+(parseInt(originalColor.slice(1),16)^mask).toString(16).padStart(6,'0')
const firstColor=colorWithMask(0xffffff),draftColor=colorWithMask(0xaaaaaa)
const originals=await Promise.all([['analyses',a.id],['analyses',b.id],['reviews',r.id],['reviews',r2.id]].map(async([kind,id])=>({kind,id,value:await json(kind+'/'+id)})))
const baseline=await json('selected/'+a.sourceId),owned=new Map();assert.ok(baseline.every(s=>s.valid))
const link=(stage,extra='')=>path+`?stage=${stage}&sourceId=${a.sourceId}${extra}`
const explicit=(id,reviewId)=>link('review',`&analysisId=${id}${reviewId?'&reviewId='+reviewId:''}&observationId=${id===a.id?'p1':b.evidence.observations[0]?.id||''}`).replace(/&observationId=$/,'')
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[],forbidden=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
await context.route('**/api/magnetic-intake/recognize',route=>{forbidden.push(route.request().url());return route.abort()})
const page=await context.newPage(),idle=p=>p.waitForFunction(()=>{const e=document.querySelector('select[aria-label="已保存图片"]');return e&&!e.disabled}),row=(p,kind)=>p.locator(`[data-snapshot-stage="${kind}"]`)
async function record(kind,id){const s=(await json('selected/'+a.sourceId)).find(s=>s.stage===kind);assert.equal(s.snapshotId,id);owned.set(kind,s);return s}
async function choose(p,kind,id){await p.getByLabel('历史 '+(kind==='analysis'?'Analysis':'Review'),{exact:true}).selectOption(id);await idle(p)}
async function mark(p,kind,id){await row(p,kind).getByRole('button',{name:`设为 Selected ${kind==='analysis'?'Analysis':'Review'}`,exact:true}).click();await idle(p);return record(kind,id)}
async function unmark(p,kind){await row(p,kind).getByRole('button',{name:`取消 Selected ${kind==='analysis'?'Analysis':'Review'}`,exact:true}).click();await idle(p);return record(kind,null)}
const artifacts={}
await mkdir(out,{recursive:true})
try{
 await page.goto(explicit(a.id,r.id));await idle(page)
 // Establish a known starting state using the actual controls, without changing Current.
 for(const kind of ['analysis','review']){const initial=baseline.find(s=>s.stage===kind);if(initial.snapshotId){await choose(page,kind,initial.snapshotId);await unmark(page,kind)}}
 await page.goto(explicit(a.id,r.id));await idle(page)
 const urls=page.url();await mark(page,'analysis',a.id);assert.equal(page.url(),urls)
 assert.match(await row(page,'analysis').locator('option').nth(1).innerText(),/^★ Selected/)
 assert.equal(await row(page,'analysis').getByRole('button',{name:'取消 Selected Analysis',exact:true}).getAttribute('aria-pressed'),'true')
 await choose(page,'analysis',b.id);await record('analysis',a.id)
 assert.equal(await row(page,'analysis').getByRole('button',{name:'设为 Selected Analysis',exact:true}).count(),1)
 await mark(page,'analysis',b.id);assert.equal((await json('selected/'+a.sourceId)).filter(s=>s.stage==='analysis'&&s.snapshotId).length,1)
 await unmark(page,'analysis');assert.equal(await page.getByLabel('历史 Analysis',{exact:true}).inputValue(),b.id)
 await mark(page,'analysis',b.id)
 // The Review dropdown includes every Review of this Source, even across Analysis parents.
 await choose(page,'review',r.id);assert.equal(await page.getByLabel('历史 Analysis',{exact:true}).inputValue(),a.id)
 await mark(page,'review',r.id);await record('analysis',b.id)
 assert.equal(await row(page,'review').locator('label .snapshot-warning').count(),1)
 await row(page,'review').getByRole('button',{name:'Selected Review说明',exact:true}).click()
 assert.match(await row(page,'review').getByRole('region',{name:'Selected Review说明',exact:true}).innerText(),/与 Selected Analysis.*不同/)
 await page.keyboard.press('Escape');await page.screenshot({path:out+'/source-mismatch.png'})
 await choose(page,'review',r2.id);await record('review',r.id)
 await mark(page,'review',r2.id);await unmark(page,'review');await mark(page,'review',r2.id)
 await choose(page,'review',r.id);await mark(page,'review',r.id)
 const beforeSave=await json('selected/'+a.sourceId)
 await choose(page,'review',r2.id);await reviewDetails(page,'零件证据与轮廓编辑');await page.getByLabel('修正颜色',{exact:true}).fill(firstColor)
 await page.waitForFunction(()=>document.querySelector('select[aria-label="历史 Review"]').value==='');assert.equal(await row(page,'review').getByRole('button',{name:'设为 Selected Review',exact:true}).isDisabled(),true,'Draft is not a snapshot')
 const savedResponse=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');await studioButton(page,'保存审核快照').click();const saved=await(await savedResponse).json();await idle(page)
 assert.deepEqual(await json('selected/'+a.sourceId),beforeSave)
 assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),saved.id)
 assert.match(await row(page,'review').locator('option').nth(1).innerText(),/^★ Selected/)
 const savedLink=page.url();await page.reload();await idle(page);assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),saved.id)
 const tab=await context.newPage();await tab.goto(savedLink);await idle(tab);assert.equal(await tab.getByLabel('历史 Review',{exact:true}).inputValue(),saved.id);assert.match(await row(tab,'review').locator('option').nth(1).innerText(),/^★ Selected/)
 // Explicit URL wins; absent historical identities restore the corresponding Selected.
 await page.goto(link('source'));await idle(page);assert.equal(await page.getByLabel('历史 Analysis',{exact:true}).inputValue(),b.id);assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),'')
 await page.goto(link('review'));await idle(page);assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),r.id);assert.equal(await page.getByLabel('历史 Analysis',{exact:true}).inputValue(),a.id)
 assert.equal(new URL(page.url()).searchParams.get('reviewId'),r.id)
 // Current changes do not mutate Selected and Back/Forward preserve the explicit identity.
 await page.goto(explicit(a.id,r2.id));await idle(page);await stage(page,'source');await stage(page,'review');await page.goBack();await idle(page);assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),r2.id);await page.goForward();await idle(page);assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),r2.id);await record('review',r.id)
 // Keep unsaved content protected even when another Selected Review is available.
 await reviewDetails(page,'零件证据与轮廓编辑');await page.getByLabel('修正颜色',{exact:true}).fill(draftColor)
 await page.goto(link('review'));await idle(page)
 assert.equal(await page.getByLabel('历史 Analysis',{exact:true}).inputValue(),a.id)
 assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),'')
 await page.getByRole('button',{name:'恢复本地审核草稿',exact:true}).click();await page.locator('[data-review-id="p1"]').click();await reviewDetails(page,'零件证据与轮廓编辑');assert.equal(await page.getByLabel('修正颜色',{exact:true}).inputValue(),draftColor)
 await choose(page,'analysis',b.id);await record('review',r.id)
 // Switching away saved the draft through the pre-existing protection path; no stale draft blocks defaults.
 await page.goto(link('review'));await idle(page);assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),r.id)
 // Stale-tab CAS conflict reports the issue, refreshes Selected, and preserves Current.
 await page.goto(explicit(a.id,r.id));await idle(page)
 await tab.goto(explicit(b.id));await idle(tab)
 const priorRevision=(await json('selected/'+a.sourceId)).find(s=>s.stage==='analysis').revision
 await mark(page,'analysis',a.id)
 await row(tab,'analysis').getByRole('button',{name:'取消 Selected Analysis',exact:true}).click();await idle(tab)
 await tab.getByRole('alert').filter({hasText:'Selected 已被其他操作更新'}).waitFor()
 assert.equal(await tab.getByLabel('历史 Analysis',{exact:true}).inputValue(),b.id)
 const afterConflict=await record('analysis',a.id);assert.equal(afterConflict.revision,priorRevision+1)
 // Compact controls remain a single 40px row, including at minimum left width.
 await page.goto(explicit(a.id,r.id));await idle(page)
 for(const kind of ['analysis','review']){const dimensions=await row(page,kind).evaluate(el=>({height:el.getBoundingClientRect().height,width:el.clientWidth,scroll:el.scrollWidth,select:el.querySelector('select').getBoundingClientRect(),button:el.querySelector('button').getBoundingClientRect()}));assert.ok(dimensions.height<=44);assert.ok(dimensions.scroll<=dimensions.width+1);assert.ok(Math.abs(dimensions.select.y-dimensions.button.y)<=5)}
 await page.screenshot({path:out+'/desktop.png'})
 const handle=page.getByRole('separator',{name:'调整左栏与中栏宽度'}),hbox=await handle.boundingBox();await page.mouse.move(hbox.x+hbox.width/2,hbox.y+hbox.height/2);await page.mouse.down();await page.mouse.move(185,hbox.y+hbox.height/2,{steps:12});await page.mouse.up()
 for(const kind of ['analysis','review'])assert.ok(await row(page,kind).evaluate(el=>el.scrollWidth<=el.clientWidth+1))
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 await page.screenshot({path:out+'/narrow-column.png'})
 await page.setViewportSize({width:430,height:900});await stage(page,'source');await page.getByRole('button',{name:'工作阶段',exact:true}).filter({visible:true}).click();assert.equal(await row(page,'review').isVisible(),true)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1))
 await page.screenshot({path:out+'/mobile.png'})
 for(const snapshot of originals)assert.deepEqual(await json(snapshot.kind+'/'+snapshot.id),snapshot.value)
 assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[])
 artifacts.review=saved.id;artifacts.selectedBeforeCleanup=await json('selected/'+a.sourceId);artifacts.paidCalls=0
 console.log('PASS: real rose Analysis/Review set/replace/cancel; one per stage; Current independence; immutable snapshots; ★ sorted first; source mismatch; Draft/save protection; refresh/new tab/defaults/explicit URL/Back/Forward; stale-tab conflict; compact 40px rows/minimum width/mobile; zero paid calls.')
}finally{
 // Restore the user's previous Selected references, unless another actor changed them.
 for(const kind of ['analysis','review']){
  const current=(await json('selected/'+a.sourceId)).find(s=>s.stage===kind),last=owned.get(kind),initial=baseline.find(s=>s.stage===kind)
  if(last&&current.revision===last.revision&&current.snapshotId===last.snapshotId){const response=await fetch(base+'/api/magnetic-intake/selected',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId:a.sourceId,stage:kind,snapshotId:initial.snapshotId,expectedRevision:current.revision})});assert.equal(response.status,200)}
 }
 artifacts.afterCleanup=await json('selected/'+a.sourceId);await writeFile(out+'/result.json',JSON.stringify(artifacts,null,2));await browser.close()
}

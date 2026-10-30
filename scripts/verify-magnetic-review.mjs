import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {stage,studioButton,reviewDetails} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173'
const history=await(await fetch(base+'/api/magnetic-intake/history')).json(),a=history.analyses.find(a=>a.evidence?.observations.length===14&&a.evidence.observations.filter(o=>o.profileId==='unknown').length===6);assert.ok(a)
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/magnetic-intake/recognize',()=>{throw Error('Paid calls forbidden')})
const rows=page.locator('[data-review-id]'),idle=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='刷新图片历史'&&!b.disabled))
async function open(){await stage(page,'source');await idle();await page.getByLabel('当前图片',{exact:true}).selectOption(a.sourceId);await idle();await page.getByLabel('历史 Analysis',{exact:true}).selectOption(a.id);await idle();await stage(page,'review')}
const ratio=()=>page.locator('.review-workspace > [data-panel]').evaluateAll(es=>es[0].getBoundingClientRect().height/(es[0].getBoundingClientRect().height+es[1].getBoundingClientRect().height))
try{
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await open();assert.equal(await rows.count(),14);assert.ok(Math.abs(await ratio()-.65)<.02)
 await page.screenshot({path:'/tmp/magnetic-review-table.png'})
 await page.getByRole('button',{name:'Unknown 6',exact:true}).click();assert.equal(await rows.count(),6)
 const u=a.evidence.observations.find(o=>o.profileId==='unknown'),k=a.evidence.observations.find(o=>o.profileId!=='unknown')
 await page.locator(`[data-review-id="${u.id}"]`).click();assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),'unknown');assert.ok((await page.locator(`[data-observation="${u.id}"]`).getAttribute('class')).includes('selected'))
 assert.match(await page.locator(`[data-review-id="${u.id}"]`).innerText(),/非物理尺寸/)
 // Keyboard activation uses the existing image outline handler, sharing selection.
 await page.locator(`[data-observation="${k.id}"]`).focus();const point=await page.locator(`[data-observation="${k.id}"]`).evaluate(el=>{const vs=el.getAttribute('points').split(' ').map(p=>p.split(',').map(Number));const p=new DOMPoint(vs.reduce((s,v)=>s+v[0],0)/vs.length,vs.reduce((s,v)=>s+v[1],0)/vs.length).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y}});await page.mouse.click(point.x,point.y);assert.match(await page.locator('.review-table-tools').innerText(),/被筛选隐藏/)
 await page.getByRole('button',{name:'显示全部零件',exact:true}).click();assert.equal(await page.locator(`[data-review-id="${k.id}"]`).getAttribute('aria-selected'),'true')
 await reviewDetails(page,'零件证据与轮廓编辑');const color=page.getByLabel('修正颜色',{exact:true});await color.fill('#123456');assert.match(await page.locator(`[data-review-id="${k.id}"]`).innerText(),/#123456/)
 await page.getByLabel('角 1 x',{exact:true}).fill('0.25');assert.ok((await page.locator(`[data-observation="${k.id}"]`).getAttribute('points')).startsWith(String(.25*history.sources.find(s=>s.id===a.sourceId).view.width)))
 await page.locator(`[data-review-id="${u.id}"]`).click();await page.getByLabel('修正形状',{exact:true}).selectOption('square@1');assert.match(await page.locator(`[data-review-id="${u.id}"]`).innerText(),/正方形.*square/s)
 await page.getByRole('button',{name:'排除零件',exact:true}).click();await page.getByRole('button',{name:'Excluded 1',exact:true}).click();assert.equal(await rows.count(),1)
 await page.getByRole('button',{name:'全部 14',exact:true}).click();await page.getByLabel('搜索审核零件').fill(k.id);assert.ok(await rows.count()<14);await page.getByLabel('搜索审核零件').fill('');await page.getByLabel('审核零件排序').selectOption('confidence')
 const handle=page.getByRole('separator',{name:'调整零件表与原图高度'}),b=await handle.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y-150,{steps:15});await page.mouse.up();const savedRatio=await ratio();assert.ok(savedRatio<.60);await stage(page,'assembly');await stage(page,'review');assert.ok(Math.abs(await ratio()-savedRatio)<.02,'stage changes retain review ratio')
 const table=page.locator('.review-table-scroll'),evidence=page.locator('.review-evidence-scroll');await table.hover();await page.mouse.wheel(0,600);await page.waitForFunction(()=>document.querySelector('.review-table-scroll').scrollTop>0);assert.equal(await evidence.evaluate(e=>e.scrollTop),0)
 await table.evaluate(el=>new Promise(resolve=>{let last=el.scrollTop,stable=0;const tick=()=>{const now=el.scrollTop;stable=now===last?stable+1:0;last=now;if(stable>=8)resolve(null);else requestAnimationFrame(tick)};requestAnimationFrame(tick)}));const scroll=await table.evaluate(e=>e.scrollTop);await page.getByLabel('审核原图缩放').selectOption('300');await evidence.hover();await page.mouse.wheel(0,600);await page.waitForFunction(()=>document.querySelector('.review-evidence-scroll').scrollTop>0);assert.equal(await table.evaluate(e=>e.scrollTop),scroll);assert.equal(await page.evaluate(()=>scrollY),0)
 const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reviews')&&r.request().method()==='POST');await studioButton(page,'保存审核快照').click();const review=await(await response).json();await idle();assert.ok(review.id)
 await page.reload();await open();assert.ok(Math.abs(await ratio()-savedRatio)<.02);await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await idle();assert.equal(await rows.count(),14);assert.equal(review.evidence.observations.find(o=>o.id===k.id).color,'#123456')
 await page.setViewportSize({width:430,height:900});await stage(page,'review');assert.equal(await rows.count(),14);assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));await page.screenshot({path:'/tmp/magnetic-review-narrow.png'})
 const original=await(await page.request.get(base+'/api/magnetic-intake/analyses/'+a.id)).json();assert.deepEqual(original.evidence,a.evidence);assert.deepEqual(errors,[])
 console.log('PASS: historical rose 14/8/6; filters/search/sort; table-image-Inspector selection; edits and saved Review; vertical resize/persistence; independent scrolling; 430px layout; unchanged Analysis; zero paid calls.')
}finally{await browser.close()}

import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {stage,studioButton} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',h=await(await fetch(base+'/api/magnetic-intake/history')).json(),a=h.analyses.find(a=>a.evidence?.observations.length===14&&a.evidence.observations.filter(o=>o.profileId==='unknown').length===6);assert.ok(a)
const original=await(await fetch(base+'/api/magnetic-intake/analyses/'+a.id)).json()
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1800,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/magnetic-intake/recognize',()=>{throw Error('Paid calls forbidden')})
const idle=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='刷新图片历史'&&!b.disabled))
async function open(){await stage(page,'source');await idle();await page.getByLabel('已保存图片',{exact:true}).selectOption(a.sourceId);await idle();await page.getByLabel('历史 Analysis',{exact:true}).selectOption(a.id);await idle();await stage(page,'review')}
const matcher=page.getByRole('region',{name:'Find Matching Profile',exact:true})
try{
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await open()
 for(const o of a.evidence.observations.filter(o=>o.profileId==='unknown')){
  await page.locator(`[data-review-id="${o.id}"]`).click();await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).click()
  assert.equal(await matcher.locator('[data-match-profile]').count(),3);assert.match(await matcher.innerText(),/暂不能可靠评分/)
  assert.equal(await matcher.getByRole('button',{name:'确认应用 等边三角形',exact:true}).isDisabled(),true)
  assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),'unknown')
 }
 // Evidence confirmation is a UI-only prerequisite; does not assign Profile.
 await page.locator('[data-review-id="p4"]').click();await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).click();await matcher.getByRole('checkbox').check()
 assert.equal(await matcher.locator('[data-match-profile]').first().getAttribute('data-match-profile'),'equilateral-triangle');assert.match(await matcher.innerText(),/85\.1%/)
 assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),'unknown');assert.match(await page.locator('[data-review-id="p4"]').innerText(),/85\.1%/)
 await page.screenshot({path:'/tmp/magnetic-profile-match.png'})
 await matcher.getByRole('button',{name:'确认应用 等边三角形',exact:true}).click();assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),'equilateral-triangle@1');assert.match(await page.locator('[data-review-id="p4"]').innerText(),/Known/)
 const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reviews')&&r.request().method()==='POST');await studioButton(page,'保存审核快照').click();const review=await(await response).json();await idle()
 assert.deepEqual(review.evidence.observations.find(o=>o.id==='p4').outline,a.evidence.observations.find(o=>o.id==='p4').outline)
 for(const id of ['p1','p2','p3','p5','p6'])assert.equal(review.evidence.observations.find(o=>o.id===id).profileId,'unknown')
 await page.reload();await open();await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await idle();await page.locator('[data-review-id="p4"]').click();assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),'equilateral-triangle@1')
 assert.deepEqual(await(await page.request.get(base+'/api/magnetic-intake/analyses/'+a.id)).json(),original)
 assert.deepEqual(await(await page.request.get(base+'/api/magnetic-intake/reviews/'+review.id)).json(),review)
 await page.getByLabel('角 2 x',{exact:true}).fill(await page.getByLabel('角 1 x',{exact:true}).inputValue());await page.getByLabel('角 2 y',{exact:true}).fill(await page.getByLabel('角 1 y',{exact:true}).inputValue());await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).click();assert.match(await matcher.innerText(),/无法可靠评分/);assert.equal(await matcher.locator('[data-match-profile]').count(),0)
 assert.deepEqual(errors,[]);console.log('PASS: actual rose P1–P6 candidate rankings, evidence gate, explicit apply only, original outlines and Analysis unchanged, Review save/reload, invalid geometry rejection; zero model calls. Screenshot /tmp/magnetic-profile-match.png')
}finally{await browser.close()}

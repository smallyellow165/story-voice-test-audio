// Real persisted rose Source/Analysis/Review and production UI. No Vision calls.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {writeFile,mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {stage,studioButton} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html'
const h=await(await fetch(base+'/api/magnetic-intake/history')).json()
const source=h.sources.find(s=>s.name==='connetix-rose.png');assert.ok(source)
const a=h.analyses.find(a=>a.sourceId===source.id&&a.evidence?.observations.length===14);assert.ok(a)
const previous=h.reviews.find(r=>r.analysisId===a.id&&['p1','p2','p3'].every(id=>r.evidence.observations.find(o=>o.id===id)?.profileId==='unknown')&&['p4','p5','p6'].every(id=>r.evidence.observations.find(o=>o.id===id)?.profileId==='equilateral-triangle'));assert.ok(previous,'requires an existing manually reviewed rose')
const original=await(await fetch(base+'/api/magnetic-intake/analyses/'+a.id)).json()
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1800,height:1050}}),page=await context.newPage(),errors=[],forbidden=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message))
await context.route('**/api/magnetic-intake/recognize',r=>{forbidden.push(r.request().url());return r.abort()})
const idle=p=>p.waitForFunction(()=>{const s=document.querySelector('select[aria-label="已保存图片"]');return s&&!s.disabled})
const matcher=page.getByRole('region',{name:'Find Matching Profile',exact:true})
const candidate=id=>matcher.locator(`[data-match-profile="${id}"]`)
async function find(id){await page.locator(`[data-review-id="${id}"]`).click();await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).click();const box=matcher.getByRole('checkbox');if(await box.count()&&!await box.isChecked())await box.check()}
async function save(){const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reviews')&&r.request().method()==='POST');await studioButton(page,'保存审核快照').click();const review=await(await response).json();await idle(page);return review}
const output=process.env.MAGNETIC_SCREENSHOTS||'/tmp/magnetic-relative-size';await mkdir(output,{recursive:true})
try{
 await page.goto(path+'?stage=review&sourceId='+source.id+'&analysisId='+a.id+'&reviewId='+previous.id+'&observationId=p1');await idle(page)
 assert.equal(await page.locator('[data-review-id]').count(),14)
 const metrics={}
 for(const [id,profile,shape,size] of [['p1','tall-right-triangle','87.8%','92.3%'],['p2','large-equilateral-triangle','100.0%','100.0%'],['p3','tall-right-triangle','86.3%','92.6%']]){
  await find(id)
  assert.equal(await matcher.locator('[data-match-profile]').first().getAttribute('data-match-profile'),profile)
  assert.match(await candidate(profile).getByTestId('shape-score').innerText(),new RegExp(shape.replace('.','\\.')))
  assert.match(await candidate(profile).getByTestId('size-score').innerText(),new RegExp(size.replace('.','\\.')))
  assert.match(await matcher.innerText(),/4 个参考 s1、s2、s3、s4/)
  if(id==='p2'){
   assert.match(await candidate('equilateral-triangle').getByTestId('shape-score').innerText(),/100\.0%/)
   assert.match(await candidate('equilateral-triangle').getByTestId('size-score').innerText(),/0\.1%/)
   // A poor size match remains selectable and persists in an ordinary Review.
   assert.equal(await candidate('equilateral-triangle').getByRole('button').isEnabled(),true)
   await candidate('equilateral-triangle').getByRole('button').click()
   const low=await save();assert.equal(low.evidence.observations.find(o=>o.id==='p2').profileId,'equilateral-triangle')
   const lowLink=page.url();await page.reload();await idle(page);assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),'equilateral-triangle@1')
   assert.equal(new URL(lowLink).searchParams.get('reviewId'),low.id)
   await find('p2')
  }
  metrics[id]={profile,shape:await candidate(profile).getByTestId('shape-score').innerText(),size:await candidate(profile).getByTestId('size-score').innerText()}
  await candidate(profile).scrollIntoViewIfNeeded();await page.screenshot({path:output+'/'+id+'.png'})
  await candidate(profile).getByRole('button').click()
  assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),profile+'@1')
 }
 const review=await save(),link=page.url();assert.equal(new URL(link).searchParams.get('reviewId'),review.id)
 for(const id of ['p4','p5','p6'])assert.deepEqual(review.evidence.observations.find(o=>o.id===id),previous.evidence.observations.find(o=>o.id===id))
 for(const o of review.evidence.observations)assert.deepEqual(o.outline,previous.evidence.observations.find(old=>old.id===o.id).outline)
 const tab=await context.newPage();await tab.goto(link);await idle(tab)
 assert.equal(await tab.getByLabel('历史 Review',{exact:true}).inputValue(),review.id)
 assert.equal(await tab.locator('tr[aria-selected=true]').getAttribute('data-review-id'),'p3')
 assert.equal(await tab.getByLabel('修正形状',{exact:true}).inputValue(),'tall-right-triangle@1')
 await tab.reload();await idle(tab);assert.equal(await tab.getByLabel('修正形状',{exact:true}).inputValue(),'tall-right-triangle@1')
 // No reliable references: exclude every other tile through existing controls.
 for(const o of review.evidence.observations.filter(o=>o.id!=='p2')){await page.locator(`[data-review-id="${o.id}"]`).click();await page.getByLabel('不采用本片（误检或仅重建局部）',{exact:true}).check()}
 await find('p2');assert.match(await matcher.innerText(),/Size Unknown：没有可靠/)
 assert.match(await candidate('equilateral-triangle').getByTestId('size-score').innerText(),/Size Unknown/)
 assert.match(await candidate('large-equilateral-triangle').getByTestId('size-score').innerText(),/Size Unknown/)
 await page.screenshot({path:output+'/size-unknown.png'})
 // Restore the saved result; unsaved exclusions are never a historical rewrite.
 await page.goto(link);await idle(page)
 await stage(page,'catalog');assert.equal(await page.locator('.supported-tile').count(),5)
 for(const id of ['large-equilateral-triangle','tall-right-triangle']){await page.getByLabel('支持的磁力片',{exact:true}).selectOption(id+'@1');assert.match(await page.getByTestId('profile-size-source').innerText(),/Estimated.*V1 Estimated Geometry/)}
 await page.screenshot({path:output+'/catalog.png'})
 await stage(page,'review');await page.setViewportSize({width:430,height:900});await stage(page,'review','inspector')
 await matcher.getByRole('button',{name:'Find Matching Profile',exact:true}).click();assert.match(await matcher.innerText(),/Relative Size Score/)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1))
 await page.screenshot({path:output+'/narrow.png'})
 assert.deepEqual(await(await fetch(base+'/api/magnetic-intake/analyses/'+a.id)).json(),original)
 assert.deepEqual(await(await fetch(base+'/api/magnetic-intake/reviews/'+previous.id)).json(),previous)
 assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[])
 await writeFile(output+'/result.json',JSON.stringify({metrics,reviewId:review.id,deepLink:link,previousReviewId:previous.id,paidCalls:forbidden.length},null,2))
 console.log(JSON.stringify({status:'PASS',metrics,deepLink:link,screenshots:output,checks:'five catalog entries; estimated source; actual rose rankings; low-score manual apply/save/reload; P4/P5/P6 preserved; snapshot and copied URL/new tab/reload; Size Unknown; mobile layout; unchanged Analysis and historical Review; zero paid calls'},null,2))
}finally{await browser.close()}

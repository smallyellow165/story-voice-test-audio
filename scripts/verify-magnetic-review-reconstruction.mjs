// Existing unsupported rose Review + real API; append new snapshots, preserve current Selected.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises'
import {stage,rightTab} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-review-reconstruction'
const sourceId='5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f',get=async route=>{const response=await fetch(base+'/api/magnetic-intake/'+route);assert.equal(response.status,200);return response.json()}
const refs=await get('selected/'+sourceId),review=await get('reviews/'+(process.env.MAGNETIC_REVIEW_ID||'7da2f5fb-1fb1-4b70-9d6d-fe62bf2f579c')),analysis=await get('analyses/'+review.analysisId),history=await get('history')
assert.equal(review.evidence.sourceKind,'unsupported');assert.equal(analysis.evidence.sourceKind,'unsupported')
assert.equal(review.evidence.observations.length,14);assert.ok(review.evidence.observations.every(o=>o.profileId!=='unknown'&&!o.excluded))
const before=new Map()
for(const kind of ['analyses','reviews','reconstructions'])for(const file of await readdir(new URL('../generated/magnetic-intake/'+kind+'/',import.meta.url))){if(file.endsWith('.json')){const url=new URL('../generated/magnetic-intake/'+kind+'/'+file,import.meta.url);before.set(url.href,await readFile(url,'utf8'))}}
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[],paid=[],posts=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
context.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/magnetic-intake/'))posts.push({url:r.url(),body:r.postDataJSON()})})
await context.route('**/api/magnetic-intake/recognize',r=>{paid.push(r.request().url());return r.abort()})
const page=await context.newPage(),idle=p=>p.waitForFunction(()=>{const el=document.querySelector('select[aria-label="当前图片"]');return el&&!el.disabled})
const link=path+`?stage=reconstruction&sourceId=${sourceId}&analysisId=${analysis.id}&reviewId=${review.id}&observationId=p1&rightTab=inspector`
const modes=['connected-construction','flat-mosaic'],results={before:{},after:{}}
async function generate(mode){
 await page.getByLabel('几何重建作品模式',{exact:true}).selectOption(mode)
 const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'生成几何重建',exact:true}).click();const r=await(await response).json();await idle(page);assert.ok(r.id);assert.equal(r.mode,mode);return r
}
try{
 await mkdir(out,{recursive:true});await page.goto(link);await idle(page)
 // All Known alone is insufficient: no implicit planar reclassification or silent search.
 for(const mode of modes){const r=await generate(mode);assert.equal(r.explored,0);assert.equal(r.trials,0);assert.equal(r.candidates.length,0);assert.match(r.diagnostics.join('\n'),/当前 Review.*输入类别/);assert.ok(!r.diagnostics.join('\n').includes(analysis.evidence.reason));assert.match(await page.getByRole('region',{name:'几何重建结果',exact:true}).innerText(),/输入审核未完成/);results.before[mode]=r}
 await page.screenshot({path:out+'/input-unconfirmed.png'})
 await page.getByRole('button',{name:'确认重建输入',exact:true}).click()
 assert.equal(await page.locator('main').getAttribute('data-active-stage'),'review')
 const kind=page.locator('.review-table-tools').getByLabel('输入类别',{exact:true});assert.equal(await page.locator('.studio-inspector').getByLabel('输入类别',{exact:true}).count(),0);assert.equal(await kind.isVisible(),true);assert.equal(await kind.inputValue(),'unsupported')
 const matcher=page.getByRole('region',{name:'Find Matching Profile',exact:true})
 const action=matcher.getByRole('button',{name:'Find Matching Profile',exact:true});assert.ok((await action.boundingBox()).y<330)
 await action.click();const scores=await matcher.locator('[data-match-profile]').first().innerText();assert.match(scores,/87\.8%/);assert.match(scores,/92\.3%/)
 await kind.selectOption('diagram');assert.match(await page.getByTestId('review-save-status').innerText(),/未保存/)
 assert.equal(await matcher.locator('[data-match-profile]').first().innerText(),scores)
 await stage(page,'reconstruction','inspector');assert.equal(await page.getByRole('button',{name:'生成几何重建',exact:true}).isDisabled(),true,'classification must be saved in a new Review')
 await stage(page,'review','inspector')
 const saving=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reviews')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'保存审核快照',exact:true}).click();const corrected=await(await saving).json();await idle(page)
 assert.equal(await page.getByTestId('review-save-status').innerText(),'已保存');assert.notEqual(corrected.id,review.id);assert.deepEqual(corrected.evidence,{...review.evidence,sourceKind:'diagram'});assert.equal(corrected.analysisHash,analysis.hash)
 assert.deepEqual(await get('selected/'+sourceId),refs)
 await stage(page,'reconstruction','inspector')
 for(const mode of modes){
  const r=await generate(mode);assert.equal(r.reviewId,corrected.id);assert.equal(r.reviewHash,corrected.hash)
  assert.ok(r.explored>0&&r.trials>0);assert.equal(r.candidates.length,0);assert.equal(r.truncated,false)
  assert.match(r.diagnostics.join('\n'),/p3 对明确连接邻居 p6.*等长边对齐.*最小轮廓 RMS.*上限 0\.300/)
  assert.ok(!r.diagnostics.join('\n').includes('unsupported'));assert.ok(!r.diagnostics.join('\n').includes(analysis.evidence.reason))
  assert.match(await page.getByRole('region',{name:'几何重建结果',exact:true}).innerText(),new RegExp(r.trials+' 次对齐尝试'))
  results.after[mode]=r;await page.screenshot({path:out+'/'+mode+'.png'})
 }
 const currentUrl=page.url();await rightTab(page,'catalog');await rightTab(page,'inspector')
 assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),corrected.id)
 assert.equal(await page.getByLabel('历史 Reconstruction',{exact:true}).inputValue(),results.after['flat-mosaic'].id)
 await page.reload();await idle(page);assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),corrected.id)
 const tab=await context.newPage();await tab.goto(currentUrl);await idle(tab);assert.equal(await tab.getByLabel('历史 Review',{exact:true}).inputValue(),corrected.id);await stage(tab,'review','workspace');assert.equal(await tab.getByLabel('输入类别',{exact:true}).inputValue(),'diagram')
 assert.match(await tab.getByLabel('历史 Review',{exact:true}).locator(`option[value="${refs.find(s=>s.stage==='review').snapshotId}"]`).innerText(),/★ Selected/)
 await stage(page,'review','inspector');await page.goBack();await idle(page);assert.equal(await page.locator('main').getAttribute('data-active-stage'),'reconstruction');assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),corrected.id)
 await page.goForward();await idle(page);assert.equal(await page.getByLabel('输入类别',{exact:true}).inputValue(),'diagram')
 // Opening an old result restores its own immutable source Review, without rewriting the new Current.
 const legacy=history.reconstructions.find(r=>r.reviewId===review.id)
 assert.ok(legacy);await page.goto(link+'&reconstructionId='+legacy.id);await idle(page)
 assert.equal(await page.getByLabel('历史 Reconstruction',{exact:true}).inputValue(),legacy.id);await stage(page,'review','workspace');assert.equal(await page.getByLabel('输入类别',{exact:true}).inputValue(),'unsupported')
 await page.goto(currentUrl);await idle(page);await page.setViewportSize({width:430,height:900});await stage(page,'review','workspace');assert.equal(await kind.isVisible(),true);assert.equal(await page.getByRole('button',{name:'保存审核快照',exact:true}).isVisible(),true)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1));await page.screenshot({path:out+'/mobile-review.png'})
 for(const [url,bytes] of before)assert.equal(await readFile(new URL(url),'utf8'),bytes,'historical bytes changed: '+url)
 assert.deepEqual(await get('selected/'+sourceId),refs);assert.deepEqual(await get('analyses/'+analysis.id),analysis);assert.deepEqual(await get('reviews/'+review.id),review)
 assert.deepEqual(errors,[]);assert.deepEqual(paid,[]);assert.equal(posts.length,5);assert.equal(posts.filter(p=>p.url.endsWith('/reviews')).length,1);assert.equal(posts.filter(p=>p.url.endsWith('/reconstruct')).length,4)
 const report={status:'PASS',originalReview:review.id,correctedReview:corrected.id,analysis:analysis.id,currentUrl,selectedUnchanged:refs,historicalSnapshotsUnchanged:before.size,paidCalls:0,results}
 await writeFile(out+'/result.json',JSON.stringify(report,null,2))
 console.log(JSON.stringify({status:report.status,correctedReview:corrected.id,currentUrl,historicalSnapshotsUnchanged:before.size,paidCalls:0,results:Object.fromEntries(modes.map(m=>[m,{explored:results.after[m].explored,trials:results.after[m].trials,candidates:results.after[m].candidates.length,diagnostics:results.after[m].diagnostics}]))},null,2))
}finally{await browser.close()}

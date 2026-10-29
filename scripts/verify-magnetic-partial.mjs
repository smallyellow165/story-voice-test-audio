import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {stage,studioButton} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5187'
const history=await(await fetch(base+'/api/magnetic-intake/history')).json(),source=history.sources.find(s=>s.name==='connetix-rose.png'),analysis=history.analyses.find(a=>a.sourceId===source?.id&&a.status==='complete'&&a.evidence?.sourceKind==='unsupported'&&!a.evidence.observations.length);assert.ok(analysis)
const original=await(await fetch(base+'/api/magnetic-intake/analyses/'+analysis.id)).json()
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/magnetic-intake/recognize',()=>{throw Error('Paid call forbidden')})
const button=n=>studioButton(page,n),idle=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='刷新图片历史'&&!b.disabled))
async function open(){await stage(page,'source');await idle();await page.getByLabel('已保存图片',{exact:true}).selectOption(source.id);await idle();await page.getByLabel('历史 Analysis',{exact:true}).selectOption(analysis.id);await idle()}
async function save(){const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reviews')&&r.request().method()==='POST');await button('保存审核快照').click();const review=await(await response).json();await idle();assert.ok(review.id);return review}
async function reconstruct(){const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct'));await button('重建二维布局').click();const r=await(await response).json();await idle();return r}
try{
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await open();assert.match(await page.getByTestId('recognition-summary').innerText(),/无可用识别结果.*没有可恢复/)
 await button('补一块漏检零件').click();await button('补一块漏检零件').click();await page.getByLabel('修正形状',{exact:true}).selectOption('unknown')
 const review=await save();assert.equal(review.evidence.observations.length,2);assert.equal(review.evidence.observations[1].profileId,'unknown');assert.equal(await page.locator('[data-observation]').count(),2);assert.match(await page.getByTestId('review-summary').innerText(),/部分识别.*Known 1.*Unknown 1/)
 let result=await reconstruct();assert.equal(result.candidates.length,0);assert.ok(result.diagnostics.some(s=>s.includes('Unknown')))
 await page.reload();await open();await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await idle();await stage(page,'review');assert.match(await page.getByTestId('review-summary').innerText(),/Unknown 1/);assert.equal(await page.locator('[data-observation]').count(),2)
 const unknown=review.evidence.observations[1].id;await page.getByRole('button',{name:`识别零件 ${unknown}`,exact:true}).click();assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),'unknown')
 await page.screenshot({path:'/tmp/magnetic-partial-review.png'})
 await page.getByLabel('修正形状',{exact:true}).selectOption('square@1');const mapped=await save();assert.equal(mapped.evidence.observations[1].profileId,'square')
 await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await idle();await page.getByRole('button',{name:`识别零件 ${unknown}`,exact:true}).click();await page.getByLabel('不采用本片（误检或仅重建局部）',{exact:true}).check();await page.getByLabel('输入类别',{exact:true}).selectOption('diagram');await save();result=await reconstruct();assert.ok(result.candidates.length);assert.equal(result.candidates[0].assembly.instances.length,1);assert.match(await page.getByRole('status').filter({visible:true}).innerText(),/部分作品/)
 await page.getByLabel('已对照原图',{exact:true}).check();await button('在作品编辑器中打开').click();await idle();await button('生成搭建步骤').click();await page.locator('[data-build-tile]').waitFor();assert.equal(await page.locator('[data-build-tile]').count(),1)
 assert.deepEqual(await(await page.request.get(base+'/api/magnetic-intake/analyses/'+analysis.id)).json(),original)
 assert.deepEqual(await(await page.request.get(base+'/api/magnetic-intake/reviews/'+review.id)).json(),review)
 assert.deepEqual(errors,[])
 console.log('PASS: actual empty unsupported rose history; UI manual Known + Unknown evidence, numbered outlines, save/reload, strict rejection, remap without recognition, explicit subset reconstruction and Build; original Analysis/Review immutable. 0 model calls. Screenshot /tmp/magnetic-partial-review.png')
}finally{await browser.close()}

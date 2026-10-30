import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html'
const h=await(await fetch(base+'/api/magnetic-intake/history')).json(),a=h.analyses.find(a=>a.evidence?.observations.length===14),r=h.reviews.find(r=>r.analysisId===a.id)
assert.ok(a&&r)
const link=path+`?stage=review&sourceId=${a.sourceId}&analysisId=${a.id}&reviewId=${r.id}&observationId=p6`
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[],calls=[]
ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
await ctx.route('**/api/magnetic-intake/recognize',route=>{calls.push(route.request().url());return route.abort()})
const p=await ctx.newPage(),ready=p=>p.waitForFunction(()=>{const e=document.querySelector('[aria-label="识别模型"]');return e&&!e.disabled})
const source=p=>p.getByLabel('图片来源',{exact:true}),model=p=>p.getByLabel('识别模型',{exact:true})
try{
 await p.goto(link);await ready(p)
 await source(p).selectOption('server');await model(p).selectOption('gpt-6.1-sol')
 assert.equal(new URL(p.url()).searchParams.get('sourceType'),'server');assert.equal(new URL(p.url()).searchParams.get('model'),'gpt-6.1-sol')
 const copied=p.url();await p.reload();await ready(p);assert.equal(await source(p).inputValue(),'server');assert.equal(await model(p).inputValue(),'gpt-6.1-sol')
 await p.getByLabel('服务器图片',{exact:true}).locator('option[value="connetix-rose.png"]').waitFor({state:'attached'})
 const q=await ctx.newPage();await q.goto(copied);await ready(q);assert.equal(await source(q).inputValue(),'server');assert.equal(await model(q).inputValue(),'gpt-6.1-sol');assert.equal(await q.getByLabel('历史 Review',{exact:true}).inputValue(),r.id);assert.equal(await q.locator('tr[aria-selected=true]').getAttribute('data-review-id'),'p6')
 const historyLength=await q.evaluate(()=>history.length)
 await source(q).selectOption('upload');await model(q).selectOption('gpt-4.1');assert.equal(await q.evaluate(()=>history.length),historyLength)
 assert.equal(new URL(q.url()).searchParams.get('sourceType'),'uploaded');assert.equal(new URL(q.url()).searchParams.get('model'),'gpt-4.1');assert.equal(await q.getByLabel('历史 Analysis',{exact:true}).inputValue(),a.id)
 await p.goto(link);await ready(p);assert.equal(await source(p).inputValue(),'upload');assert.equal(await model(p).inputValue(),'gpt-4.1')
 // Explicit URL overrides newer local preference, including after asynchronous initialization.
 await p.goto(copied);await ready(p);assert.equal(await model(p).inputValue(),'gpt-6.1-sol')
 await p.getByRole('tab',{name:'Tiles Catalog',exact:true}).click();await p.locator('[data-stage="build"]').click();await p.goBack();await ready(p);assert.equal(await source(p).inputValue(),'server');assert.equal(await model(p).inputValue(),'gpt-6.1-sol');assert.equal(await p.locator('tr[aria-selected=true]').getAttribute('data-review-id'),'p6')
 await p.goto(link+'&sourceType=bad&model=unknown-model');await ready(p)
 assert.equal(await source(p).inputValue(),'');assert.equal(await model(p).inputValue(),'');assert.match(await p.locator('.studio-workflow').innerText(),/sourceType 无效/);assert.match(await p.locator('.studio-workflow').innerText(),/model 不可用/)
 assert.equal(new URL(p.url()).searchParams.get('model'),'unknown-model');assert.equal(await p.getByLabel('历史 Review',{exact:true}).inputValue(),r.id)
 await source(p).selectOption('upload');await model(p).selectOption('gpt-4.1');assert.equal(new URL(p.url()).searchParams.get('model'),'gpt-4.1')
 assert.deepEqual((await(await fetch(base+'/api/magnetic-intake/analyses/'+a.id)).json()).model,a.model)
 assert.deepEqual(errors,[]);assert.deepEqual(calls,[])
 console.log('PASS: URL/preferences/default precedence, actual registered models, refresh/new tab, library listing, replaceState, Back, invalid preferences without losing rose Review/P6, unchanged historical model; zero model calls.')
}finally{await browser.close()}

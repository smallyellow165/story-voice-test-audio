// Real rose snapshots, real deterministic execution, real production UI. No model calls or Selected writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises'
import {vertices,validate} from '../src/magnetic-tiles/geometry.ts'
import {alignmentInspection} from '../src/magnetic-tiles/intake/alignment-inspection.ts'
import {stage,rightTab} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',root=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-p2-connected'
const get=async route=>{const r=await fetch(base+'/api/magnetic-intake/'+route);assert.equal(r.status,200);return r.json()}
const review=await get('reviews/836c266b-1b94-40c9-aa96-a7631cd94d3d'),analysis=await get('analyses/'+review.analysisId),selected=await get('selected/'+analysis.sourceId),old=await get('reconstructions/bb305b8c-2b1b-436a-b50c-1c1b8941415d'),oldHash=old.hash,before=new Map()
for(const kind of ['analyses','reviews','reconstructions'])for(const f of await readdir(new URL('../generated/magnetic-intake/'+kind+'/',import.meta.url))){if(f.endsWith('.json')){const u=new URL('../generated/magnetic-intake/'+kind+'/'+f,import.meta.url);before.set(u.href,await readFile(u,'utf8'))}}
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']}),ctx=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[],paid=[],posts=[]
ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));ctx.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/magnetic-intake/'))posts.push(r.url())});await ctx.route('**/api/magnetic-intake/recognize',route=>{paid.push(route.request().url());return route.abort()})
const page=await ctx.newPage(),idle=p=>p.waitForFunction(()=>{const e=document.querySelector('select[aria-label="当前图片"]');return e&&!e.disabled}),url=root+`?stage=reconstruction&sourceId=${analysis.sourceId}&analysisId=${analysis.id}&reviewId=${review.id}&reconstructionId=${old.id}&candidateId=diagnostic-1&observationId=p2&rightTab=inspector`
const option=page.getByLabel('对齐比较方案',{exact:true}),summary=page.getByTestId('alignment-summary')
async function overlay(p=page){await p.getByRole('button',{name:'对齐 / 镜像叠加',exact:true}).click()}
async function pointsMatch(p,selector,tile,catalog){const pts=(await p.locator(selector).getAttribute('points')).split(' ').map(s=>s.split(',').map(Number)),expected=vertices(tile,catalog).map(([x,y])=>[x,-y]);assert.equal(pts.length,expected.length);pts.forEach((v,i)=>v.forEach((n,j)=>assert.ok(Math.abs(n-expected[i][j])<1e-12)))}
try{
 await mkdir(out,{recursive:true});await page.goto(url);await idle(page)
 assert.equal(await page.getByLabel('几何重建候选',{exact:true}).inputValue(),'diagnostic-1');await overlay();assert.match(await summary.innerText(),/1\.742852590.*pair valid true.*context valid true/)
 await page.screenshot({path:out+'/p2-saved-far.png'})
 await option.selectOption('independent');assert.match(await summary.innerText(),/非历史搜索尝试.*0\.001018166.*pair valid false.*context valid false.*未施加整边连接/)
 const rejections=await page.getByTestId('alignment-rejections').innerText();for(const id of ['p1','p3','p4','p5','p6'])assert.ok(rejections.includes(id));assert.ok(rejections.includes('OVERLAP'))
 const data=alignmentInspection(old,'diagnostic-1');await pointsMatch(page,'[data-alignment-pose]',data.independent.rigid.tile,data.catalog);assert.equal(await page.locator('[data-alignment-context]').count(),12);assert.equal(await page.locator('[data-alignment-edge]').count(),0)
 await page.screenshot({path:out+'/p2-near-overlap.png'})
 await option.selectOption('joint-0');assert.match(await summary.innerText(),/联合 RMS 0\.563520639/);assert.match(await summary.innerText(),/pair valid true/)
 await pointsMatch(page,'[data-alignment-pose]',data.freePair.poses[0].tiles[0],data.catalog);await pointsMatch(page,'[data-alignment-target-pose]',data.freePair.poses[0].tiles[1],data.catalog)
 await page.screenshot({path:out+'/p2-joint-free-bound.png'})
 assert.equal(await page.getByRole('button',{name:'在作品编辑器中打开',exact:true}).count(),0);assert.deepEqual(posts,[])
 // Append a new execution; historical records remain immutable. It must retain real search stats.
 await page.getByLabel('几何重建作品模式',{exact:true}).selectOption('connected-construction');const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct')&&r.request().method()==='POST');await page.getByRole('button',{name:'生成几何重建',exact:true}).click();const r=await(await response).json();await idle(page)
 assert.equal(r.explored,132);assert.equal(r.trials,23422);assert.equal(r.candidates.length,0);assert.equal(r.diagnosticCandidates[0].tiles.length,14);assert.equal(r.diagnosticCandidates[0].domainBlocked,true);assert.equal(r.trace.search.connectivityAudit.incompatible,true);assert.equal(r.trace.search.connectivityAudit.connectionModel,'whole-edge-v1');assert.equal(r.trace.search.parameters.connectionModel,'segmented-edge-v1');assert.deepEqual(r.trace.search.connectivityAudit.isolatedIds,['p2']);assert.equal(r.reviewHash,review.hash)
 assert.ok(r.diagnostics.some(s=>s.includes('p1 ≥ 0.563521')&&s.includes('p3 ≥ 0.563728')))
 await overlay();assert.match(await page.getByTestId('connectivity-audit').innerText(),/p2 无可行连接邻居/)
 await page.getByRole('button',{name:'Trace / Raw',exact:true}).click();await page.getByRole('button',{name:'Geometry Execution',exact:true}).click();await page.waitForFunction(()=>{try{return JSON.parse(document.querySelector('textarea[aria-label="Trace JSON"]').value).execution.trace.search.connectivityAudit.incompatible}catch{return false}});const raw=JSON.parse(await page.getByLabel('Trace JSON',{exact:true}).inputValue());assert.equal(raw.references.reconstruction.hash,r.hash);assert.deepEqual(raw.execution.trace.search.connectivityAudit,r.trace.search.connectivityAudit);await page.getByRole('button',{name:'关闭 Trace',exact:true}).click()
 const savedUrl=page.url();await rightTab(page,'catalog');await rightTab(page,'inspector');assert.equal(await option.inputValue(),'saved');await option.selectOption('independent')
 await page.reload();await idle(page);await overlay();assert.equal(await option.inputValue(),'saved');assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),review.id)
 const tab=await ctx.newPage();await tab.goto(savedUrl);await idle(tab);await overlay(tab);assert.match(await tab.getByTestId('connectivity-audit').innerText(),/p2 无可行连接邻居/)
 await page.getByRole('button',{name:'返回实际布局',exact:true}).click();const candidate=page.getByLabel('Diagnostic 几何摆放',{exact:true});assert.equal(await candidate.locator('polygon').count(),14)
 await stage(page,'review','workspace');await page.goBack();await idle(page);assert.equal(await page.getByLabel('历史 Reconstruction',{exact:true}).inputValue(),r.id);assert.equal(await page.getByLabel('几何重建候选',{exact:true}).inputValue(),'diagnostic-1')
 await page.setViewportSize({width:430,height:900});await stage(page,'reconstruction','workspace');await overlay();await option.selectOption('independent');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/mobile-near.png'})
 const api=JSON.parse((await get('trace/reconstructions/'+r.id+'/alignment/diagnostic-1')).text);assert.equal(api.references.review.id,review.id);assert.equal(api.alignment.actual.connection.connectionModel,'segmented-edge-v1');assert.ok(api.alignment.actual.edges.contact.length>0)
 assert.deepEqual(await get('selected/'+analysis.sourceId),selected);assert.deepEqual(await get('reviews/'+review.id),review);assert.deepEqual(await get('analyses/'+analysis.id),analysis);assert.equal((await get('reconstructions/'+old.id)).hash,oldHash)
 for(const [file,bytes] of before)assert.equal(await readFile(new URL(file),'utf8'),bytes)
 assert.deepEqual(errors,[]);assert.deepEqual(paid,[]);assert.equal(posts.length,1)
 await writeFile(out+'/result.json',JSON.stringify({status:'PASS',reconstructionId:r.id,url:savedUrl,states:r.explored,trials:r.trials,validCandidates:r.candidates.length,bounds:r.trace.search.connectivityAudit.parts.find(p=>p.id==='p2').bounds,unchangedSnapshots:before.size,selectedUnchanged:true,paidCalls:0},null,2));console.log('PASS: real historical P2 failure; near-image overlap and freely moving both pieces; complete edge/mirror pair bound; new persisted Trace/Top 10; reload/copied URL/Back/Catalog/430px; no adoption; historical bytes/Selected unchanged; 0 paid calls. '+out)
}finally{await browser.close()}

// Real historical rose evidence and actual deterministic searches. No model/Selected writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {vertices} from '../src/magnetic-tiles/geometry.ts'
import {stage,reviewDetails} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',path=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-trace-v1'
const get=async route=>{const response=await fetch(base+'/api/magnetic-intake/'+route);assert.equal(response.status,200);return response.json()}
const review=await get('reviews/'+(process.env.MAGNETIC_REVIEW_ID||'836c266b-1b94-40c9-aa96-a7631cd94d3d')),analysis=await get('analyses/'+review.analysisId),source=await get('sources/'+analysis.sourceId),refs=await get('selected/'+source.id),history=await get('history')
assert.equal(review.evidence.observations.length,14);assert.notEqual(review.evidence.sourceKind,'unsupported')
const before=new Map()
for(const kind of ['analyses','reviews','reconstructions'])for(const f of await readdir(new URL('../generated/magnetic-intake/'+kind+'/',import.meta.url))){if(f.endsWith('.json')){const u=new URL('../generated/magnetic-intake/'+kind+'/'+f,import.meta.url);before.set(u.href,await readFile(u,'utf8'))}}
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[],posts=[],paid=[]
ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));ctx.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/magnetic-intake/'))posts.push(r.url())})
await ctx.route('**/api/magnetic-intake/recognize',r=>{paid.push(r.request().url());return r.abort()})
const page=await ctx.newPage(),dialog=page.getByRole('dialog',{name:'Magnetic Tiles Trace',exact:true}),selector=page.getByLabel('几何重建候选',{exact:true})
const idle=p=>p.waitForFunction(()=>{const e=document.querySelector('select[aria-label="当前图片"]');return e&&!e.disabled})
const url=path+`?stage=source&sourceId=${source.id}&analysisId=${analysis.id}&reviewId=${review.id}&observationId=p3&rightTab=inspector`
async function openTrace(p=page){await p.getByRole('button',{name:'Trace / Raw',exact:true}).click()}
async function closeTrace(p=page){await p.getByRole('button',{name:'关闭 Trace',exact:true}).click()}
async function json(p,field){await p.waitForFunction(field=>{try{const d=JSON.parse(document.querySelector('textarea[aria-label="Trace JSON"]').value);return field.split('.').reduce((v,k)=>v?.[k],d)!==undefined}catch{return false}},field);return JSON.parse(await p.getByLabel('Trace JSON',{exact:true}).inputValue())}
async function tab(name,p=page){await p.getByRole('button',{name,exact:true}).click()}
async function assertPreview(p,entry){const svg=p.getByRole('img',{name:'Diagnostic 几何摆放',exact:true});const drawn=p.getByLabel('Diagnostic 几何摆放',{exact:true});assert.equal(await drawn.locator('[data-preview-piece]').count(),entry.tiles.length);for(const tile of entry.tiles){const points=(await drawn.locator(`[data-preview-piece="${tile.id}"]`).getAttribute('points')).split(' ').map(v=>v.split(',').map(Number));const expected=vertices(tile,profiles);assert.equal(points.length,expected.length);points.forEach((p,i)=>p.forEach((n,j)=>assert.ok(Math.abs(n-expected[i][j])<1e-12)))};assert.equal(await p.getByRole('button',{name:'在作品编辑器中打开',exact:true}).count(),0)}
const runs={}
try{
 await mkdir(out,{recursive:true});await page.goto(url);await idle(page)
 await openTrace();const raw=await json(page,'analysis');assert.equal(raw.analysis.id,analysis.id);assert.equal(raw.analysis.evidence.observations.length,14);assert.equal(raw.references.source.hash,source.hash);assert.ok(raw.savedFieldAvailability.rawOutput);assert.ok(!(await page.getByLabel('Trace JSON',{exact:true}).inputValue()).includes('data:image/png;base64,'));await closeTrace()
 await stage(page,'review','inspector');await openTrace();const parts=await json(page,'saved.review');assert.equal(parts.saved.review.hash,review.hash);assert.equal(parts.runtime.data.matching.candidates[0].profileId,'tall-right-triangle')
 await tab('Spatial Planning');const planning=await json(page,'planning');assert.equal(planning.planning.modelGenerated,false);assert.equal(planning.planning.observations.length,14)
 const pair=planning.planning.relations.find(r=>r.from==='p3'&&r.to==='p6');assert.equal(pair.intent,'connect');assert.equal(pair.verifiedConnection,false);assert.equal(pair.deltaPixels.length,2);assert.equal(planning.planning.observations.find(o=>o.id==='p3').mirrorHypothesis.mirrored,true)
 await page.screenshot({path:out+'/spatial-raw.png'});await closeTrace();assert.deepEqual(posts,[])
 await stage(page,'reconstruction','inspector')
 for(const [mode,states,trials] of [['connected-construction',132,23422],['flat-mosaic',16,264]]){
  await page.getByLabel('几何重建作品模式',{exact:true}).selectOption(mode)
  const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'生成几何重建',exact:true}).click();const r=await(await response).json();await idle(page)
  assert.ok(r.id);assert.equal(r.candidates.length,0);assert.equal(r.diagnosticCandidates.length,10);assert.equal(r.explored,states);assert.equal(r.trials,trials)
  assert.equal(r.algorithm,'planar-outline-v4');assert.equal(r.trace.search.parameters.mirroring,true);assert.equal(r.trace.references.reviewHash,review.hash)
  assert.equal(await selector.inputValue(),'diagnostic-1');await assertPreview(page,r.diagnosticCandidates[0])
  assert.match(await page.locator('.diagnostic-label').innerText(),new RegExp(r.diagnosticCandidates[0].layout==='partial'?'Partial.*Invalid':'Complete.*Invalid'))
  await page.screenshot({path:out+'/'+mode+'.png'})
  const layouts=new Set()
  for(const entry of r.diagnosticCandidates){await selector.selectOption(entry.id);await assertPreview(page,entry);layouts.add(await page.getByLabel('Diagnostic 几何摆放',{exact:true}).locator('[data-preview-piece]').evaluateAll(es=>es.map(e=>e.dataset.previewPiece+':'+e.getAttribute('points')).sort().join('|')))}
  assert.equal(layouts.size,10);await selector.selectOption('diagnostic-1')
  await openTrace();await tab('Geometry Execution');const execution=await json(page,'execution');assert.equal(execution.references.reconstruction.hash,r.hash);assert.deepEqual(execution.execution.trace.input.evidence,review.evidence);assert.deepEqual(execution.execution.diagnosticCandidates,r.diagnosticCandidates)
  await tab('Spatial Planning');const savedPlanning=await json(page,'planning');assert.equal(savedPlanning.references.reconstruction.id,r.id);assert.equal(savedPlanning.planning.fittedSeeds.length,14);assert.equal(savedPlanning.planning.modelGenerated,false);await closeTrace()
  runs[mode]=r
 }
 const copied=page.url(),latest=runs['flat-mosaic'];await page.reload();await idle(page);assert.equal(await selector.inputValue(),'diagnostic-1');await assertPreview(page,latest.diagnosticCandidates[0])
 const tabPage=await ctx.newPage();await tabPage.goto(copied);await idle(tabPage);await assertPreview(tabPage,latest.diagnosticCandidates[0]);await openTrace(tabPage);await tab('Geometry Execution',tabPage);assert.equal((await json(tabPage,'execution')).execution.id,latest.id);await closeTrace(tabPage)
 await selector.selectOption('diagnostic-2');await stage(page,'review','workspace');await page.goBack();await idle(page);assert.equal(await selector.inputValue(),'diagnostic-2');await assertPreview(page,latest.diagnosticCandidates[1])
 // Trace explicitly marks the unsaved draft and current matching as runtime-only.
 await stage(page,'review','inspector');await reviewDetails(page,'零件证据与轮廓编辑');await page.getByLabel('修正颜色',{exact:true}).fill('#987654');await page.waitForFunction(()=>!new URL(location.href).searchParams.has('reconstructionId')&&!new URL(location.href).searchParams.has('candidateId'));await openTrace();const draft=await json(page,'runtime');assert.equal(draft.runtime.persisted,false);assert.equal(draft.runtime.data.review,null);assert.equal(draft.runtime.data.draft.observations.find(o=>o.id==='p3').color,'#987654');await closeTrace()
 // Old results remain readable but missing attempts are never backfilled.
 const legacy=history.reconstructions.find(r=>r.reviewId===review.id&&!r.traceAvailable);assert.ok(legacy)
 await page.goto(url.replace('stage=source','stage=reconstruction')+'&reconstructionId='+legacy.id);await idle(page);assert.equal(await page.getByLabel('Diagnostic 几何摆放',{exact:true}).count(),0);await openTrace();await tab('Geometry Execution');const old=await json(page,'available');assert.equal(old.available,false);await closeTrace()
 await page.goto(copied);await idle(page);await page.setViewportSize({width:430,height:900});await stage(page,'reconstruction','workspace');await page.screenshot({path:out+'/mobile-diagnostic.png'});await stage(page,'reconstruction','inspector');await openTrace();await tab('Geometry Execution');await json(page,'execution');const b=await dialog.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=430);await page.screenshot({path:out+'/mobile-trace.png'});await closeTrace()
 for(const [file,bytes] of before)assert.equal(await readFile(new URL(file),'utf8'),bytes)
 assert.deepEqual(await get('selected/'+source.id),refs);assert.deepEqual(await get('reviews/'+review.id),review);assert.deepEqual(await get('analyses/'+analysis.id),analysis);assert.deepEqual(errors,[]);assert.deepEqual(paid,[]);assert.equal(posts.length,2)
 await writeFile(out+'/result.json',JSON.stringify({status:'PASS',reviewId:review.id,copiedUrl:copied,unchangedSnapshots:before.size,paidCalls:0,runs:Object.fromEntries(Object.entries(runs).map(([mode,r])=>[mode,{id:r.id,hash:r.hash,states:r.explored,trials:r.trials,diagnosticCount:r.diagnosticCandidates.length,first:r.diagnosticCandidates[0]}]))},null,2))
 console.log('PASS: actual Analysis/raw/Review/runtime matching; deterministic spatial evidence and P3/P6; persisted real Top 10, 10 distinct visualized layouts per mode; V3 mirror poses; diagnostic non-adoption; actual attempted 14/14 and partial 13/14; lazy redacted trace; full input/lineage; reload/copied URL/Back; old records unavailable; draft evidence; 430px; historical bytes/Selected unchanged; zero paid calls. '+out)
}finally{await browser.close()}

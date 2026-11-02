// Saved Front records in a disposable service. No model/execute HTTP endpoints
// and no formal history writes; the normal handoff's deterministic replay stays on.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {stage,studioMode,openSavedImageSources} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,cp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,official=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'magnetic-accepted-browser-')),out='/tmp/magnetic-review-module-inheritance/browser',originals=new Map(),calls=[],errors=[]
async function copy(relative){const file=path.join(official,relative),bytes=await readFile(file);originals.set(file,bytes);await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),bytes);return JSON.parse(bytes)}
async function sourceCopy(id){const s=await copy('sources/'+id+'.json');for(const hash of new Set([s.originalHash,s.view.hash]))await copy('assets/'+hash+'.json');return s}
let server,browser,page
try{
 await mkdir(out,{recursive:true})

 const oldReview=await copy('visible3d/reviews/118cdaf9-6288-449a-917d-1be73a11d1eb.json'),lost=await copy('visible3d/reviews/7f86bfcb-40a5-48ab-ac95-35241318fdd7.json'),analysis=await copy('visible3d/analyses/'+oldReview.analysisId+'.json'),source=await sourceCopy(oldReview.sourceId)
 for(const i of source.images)await sourceCopy(i.sourceId)
 await copy('visible3d/model-traces/'+analysis.traceId+'.json');await cp(path.join(official,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 const moduleHead=await copy('visible3d/module-heads/'+oldReview.id+'.json'),modules=await copy('visible3d/module-plans/'+moduleHead.recordId+'.json');if(modules.parent)await copy('visible3d/module-plans/'+modules.parent.id+'.json')
 await mkdir(path.join(dir,'visible3d/heads'),{recursive:true});await writeFile(path.join(dir,'visible3d/heads',source.id+'.json'),JSON.stringify({revision:3,reviewId:lost.id,reviewHash:lost.hash}))
 const api=createMagneticIntake(dir)
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-module-inheritance',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route});try{if(req.method!=='GET'&&!['visible3d/module-plans','visible3d/reviews'].includes(route))throw Error('Models and unrelated writes forbidden');let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})}}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1780,height:1100}});page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(18000)
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html`,field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),rows=()=>page.locator('.review-parts-table tbody tr')
 async function options(n){await page.waitForFunction(n=>document.querySelector('[aria-label="模块筛选"]')?.options.length===n,n)}
 async function openReview(id){await field('3D Review 历史').selectOption(id);await options(4)}
 async function groups(id){return (await api.dispatch('GET','visible3d/module-state/'+id)).record}
 const back=modules.modules.find(m=>m.name==='m_back'),front=modules.modules.find(m=>m.name==='m_front')
 // Reproduce the existing broken record, then repair by appending a source-bound Module Plan.
 assert.equal((await api.dispatch('GET','visible3d/module-state/'+lost.id)).record,null)
 const repaired=await api.dispatch('POST','visible3d/module-plans',{reviewId:lost.id,reviewHash:lost.hash,expectedRevision:0,expectedHash:null,command:{kind:'inherit',recordId:modules.id,recordHash:modules.hash}})
 assert.deepEqual(repaired.record.modules,modules.modules)
 await page.goto(base+'?stage=source');await studioMode(page,'3d');await openSavedImageSources(page);await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${source.id}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(source.id);await field('3D Analysis 历史').selectOption(analysis.id);await field('3D Review 历史').selectOption(lost.id);await stage(page,'review','workspace');await options(4)
 await field('模块筛选').selectOption(back.id);assert.equal(await rows().count(),14);await field('模块筛选').selectOption(front.id);assert.equal(await rows().count(),9);await page.reload();await stage(page,'review','workspace');await options(4);assert.equal(await field('模块筛选').inputValue(),front.id);assert.equal(await rows().count(),9)
 // Real UI edit from historical right-triangle Review, matching the reported reproduction.
 await openReview(oldReview.id);await field('模块筛选').selectOption(back.id);await page.locator('[data-review-id="p09"]').click();await stage(page,'review','inspector');await field('3D Review Profile').selectOption('equilateral-triangle@1')
 const saveResponse=page.waitForResponse(r=>r.url().endsWith('/visible3d/reviews')&&r.request().method()==='POST');await button('保存 3D Review').click();const response=await saveResponse;assert.equal(response.status(),200);const saved=await response.json();assert.notEqual(saved.record.id,oldReview.id);assert.deepEqual(saved.record.parentReview,{id:oldReview.id,hash:oldReview.hash})
 assert.equal(saved.record.input.review.pieces.find(p=>p.id==='p09').profileId,'equilateral-triangle');assert.deepEqual(saved.record.input.review.pieces.filter(p=>p.id!=='p09'),oldReview.input.review.pieces.filter(p=>p.id!=='p09'));assert.deepEqual((await groups(saved.record.id)).modules,modules.modules)
 await stage(page,'review','workspace');await options(4);assert.equal(await field('3D Review 历史').inputValue(),saved.record.id);await field('模块筛选').selectOption(back.id);assert.equal(await rows().count(),14);assert.match(await page.locator('[data-review-id="p09"]').innerText(),/equilateral-triangle/);await field('模块筛选').selectOption(front.id);assert.equal(await rows().count(),9)
 await page.reload();await stage(page,'review','workspace');await options(4);assert.equal(await field('3D Review 历史').inputValue(),saved.record.id);assert.equal(await field('模块筛选').inputValue(),front.id)
 await openReview(oldReview.id);await field('模块筛选').selectOption(back.id);await page.locator('[data-review-id="p09"]').click();await stage(page,'review','inspector');assert.equal(await field('3D Review Profile').inputValue(),'right-triangle@1')
 await openReview(saved.record.id);await stage(page,'reconstruction','workspace');await field('重建 Group').locator(`option[value="${back.id}"]`).waitFor({state:'attached'});await field('重建 Group').selectOption(back.id);assert.match(await page.getByTestId('reconstruction-scope-summary').innerText(),/14\/14/)
 await stage(page,'review','workspace');await page.screenshot({path:out+'/saved-groups.png'});for(const [file,bytes]of originals)assert.ok(bytes.equals(await readFile(file)),file+' changed');assert.deepEqual(errors,[])
 assert.ok(calls.filter(c=>c.method==='POST').every(c=>c.route==='visible3d/reviews'))
 const result={passed:true,legacyRepair:true,realOldReview:oldReview.id,realAffectedReview:lost.id,profileEdit:'p09 right-triangle → equilateral-triangle',groups:modules.modules.map(m=>({id:m.id,name:m.name,members:m.observationIds.length})),stableIdsAndMembership:true,other22PiecesUnchanged:true,saveRefreshAndHistory:true,oldProfilePreserved:true,reconstructionGroupScope:true,models:0,productionWrites:0,errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText()+'\n'+JSON.stringify(calls))}throw e}finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

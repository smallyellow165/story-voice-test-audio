// The reported new Project, copied verbatim to a disposable API. No Analysis
// submissions, provider calls, production writes or compatibility restoration.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {stage} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,cp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root=new URL('../',import.meta.url).pathname,official=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'review-project-browser-')),out='/tmp/magnetic-project-review-save',originals=new Map(),calls=[],errors=[]
const project='8115d686-9c17-450c-aa38-c12202d4542e',sourceId='64fdb4ea125fddf8db86e92e39db3d56a77d6fe1e73c620daea83876781b5b22',prefix=`visible3d/project/${project}/`
async function copy(relative){const file=path.join(official,relative),bytes=await readFile(file);originals.set(file,bytes);await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),bytes);return JSON.parse(bytes)}
async function copySource(id){const s=await copy('sources/'+id+'.json');for(const hash of new Set([s.originalHash,s.view.hash]))await copy('assets/'+hash+'.json');return s}
let server,browser,page,api,failSave=false
try{
 await mkdir(out,{recursive:true})
 const originalHead=await copy(`visible3d/heads/${project}/${sourceId}.json`),analysis=await copy(`visible3d/analyses/${originalHead.analysisId}.json`),review=await copy(`visible3d/reviews/${originalHead.reviewId}.json`),source=await copySource(sourceId)
 assert.equal(review.projectId,project);assert.equal(analysis.projectId,project);assert.equal(review.analysisHash,analysis.hash);assert.equal(review.sourceHash,source.hash);assert.equal(review.input.review.pieces.length,24);assert.equal(review.input.review.pieces.filter(p=>p.confirmed&&p.profileId&&!p.excluded).length,24)
 for(const image of source.images??[])await copySource(image.sourceId)
 await copy('visible3d/model-traces/'+analysis.traceId+'.json');await cp(path.join(official,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 let foreignModules=0
 for(const file of await readdir(path.join(official,'visible3d/module-plans'))){if(!file.endsWith('.json'))continue;const r=await copy('visible3d/module-plans/'+file);if(r.reviewId!==review.id)foreignModules++}
 assert.ok(foreignModules>0,'must reproduce shared-directory foreign module contamination')
 api=createMagneticIntake(dir)
 const moduleState=await api.dispatch('GET',prefix+'module-state/'+review.id);assert.equal(moduleState.record,null);assert.deepEqual(moduleState.history,[])
 assert.deepEqual((await api.dispatch('GET',prefix+'reviews/'+review.id)).record,review)
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'real-project-review-copy',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
   const route=req.url.slice(1).split('?')[0],entry={method:req.method,route,status:null};calls.push(entry)
   try{
    if(req.method!=='GET'&&route!=='library-image'&&!['reviews','selected'].some(action=>route===prefix+action))throw Error('Provider calls and unrelated writes forbidden: '+route)
    if(req.method==='POST'&&route===prefix+'reviews'&&failSave)throw Object.assign(Error('测试：暂时无法保存 Review'),{statusCode:503})
    let raw='';for await(const chunk of req)raw+=chunk
    const result=await api.dispatch(req.method,route,raw?JSON.parse(raw):{});entry.status=200;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))
   }catch(e){entry.status=e.statusCode??422;res.statusCode=entry.status;res.end(JSON.stringify({error:e.message}))}
  })
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1734,height:1244},timezoneId:'America/Los_Angeles'});page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/`,field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),key=`magnetic-studio.workspace.v1.create.${project}.workflow-draft.v1`
 const draft=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key)
 async function until(fn){for(let i=0;i<240;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI did not settle')}
 async function readyReview(){await stage(page,'review');await button('Known 24').waitFor();await until(()=>field('模块筛选').isEnabled());assert.equal(await field('3D Review 历史').inputValue(),(await draft()).head.reviewId);assert.equal(await page.getByRole('alert').filter({hasText:'记录不属于当前作品 Project'}).count(),0)}
 async function color(value){await stage(page,'review','inspector');await field('3D Review 颜色').fill(value);await until(async()=>(await draft()).form.pieces[0].color===value)}
 async function save(){await stage(page,'review');const response=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');await button('保存 3D Review').click();const r=await response;assert.equal(r.status(),200,await r.text());const saved=await r.json();await until(async()=>(await draft()).head.reviewId===saved.record.id);await readyReview();return saved}
 await page.goto(base+`magnetic-tiles.html?workspace=create&workspaceId=${project}&stage=source`)
 await field('Analysis History').locator(`option[value="${analysis.id}"]`).waitFor({state:'attached'});await field('Analysis History').selectOption(analysis.id);await readyReview();assert.equal((await draft()).head.reviewId,review.id);assert.deepEqual((await draft()).form,review.input.review)
 await color('#123456');const second=await save();assert.deepEqual(second.record.parentReview,{id:review.id,hash:review.hash});assert.equal(second.head.revision,originalHead.revision+1);assert.equal(second.record.sourceHash,source.hash);assert.equal(second.record.projectId,project)
 await button('进入 3D Reconstruction').click();await until(()=>page.locator('.studio').getAttribute('data-active-stage').then(s=>s==='reconstruction'));await field('重建 Group').waitFor();assert.match(await page.getByTestId('reconstruction-scope-summary').innerText(),/24\/24/)
 await page.goto(base+'magnetic-gallery.html');await page.locator(`[data-draft-project="${project}"]`).getByRole('link',{name:/Continue Editing/}).click();await until(async()=>(await draft())?.head.reviewId===second.record.id);await readyReview();await color('#234567');const third=await save();assert.deepEqual(third.record.parentReview,{id:second.record.id,hash:second.record.hash})
 await page.screenshot({path:out+'/after-save.png'})
 // A failed POST must not change the committed Review or the local form.
 await color('#345678');failSave=true;await stage(page,'review');const failure=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.status()===503);await button('保存 3D Review').click();await failure;assert.equal((await draft()).form.pieces[0].color,'#345678');assert.equal((await draft()).head.reviewId,third.record.id)
 api=createMagneticIntake(dir);await page.reload();await readyReview();assert.equal((await draft()).form.pieces[0].color,'#345678');failSave=false;const fourth=await save();assert.deepEqual(fourth.record.parentReview,{id:third.record.id,hash:third.record.hash})
 await color('#456789');const beforeConflict=await draft(),external=await api.dispatch('POST',prefix+'reviews',{analysisId:analysis.id,review:fourth.record.input.review,expectedRevision:fourth.head.revision,expectedSelectedRevision:fourth.head.selectedRevision,baseReview:{id:fourth.record.id,hash:fourth.record.hash}})
 await stage(page,'review');const conflict=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.status()===409);await button('保存 3D Review').click();await conflict;assert.equal((await draft()).head.reviewId,beforeConflict.head.reviewId);assert.equal((await draft()).form.pieces[0].color,'#456789')
 api=createMagneticIntake(dir);await page.reload();await readyReview();assert.equal((await draft()).head.reviewId,fourth.record.id);assert.equal((await draft()).form.pieces[0].color,'#456789');assert.equal((await api.dispatch('GET',prefix+'head/'+sourceId)).reviewId,external.record.id)
 assert.ok(calls.filter(c=>c.route.includes('/module-state/')).length>=4);assert.ok(calls.filter(c=>c.route.includes('/module-state/')).every(c=>c.status===200));assert.ok(calls.filter(c=>c.method==='POST').every(c=>c.route.startsWith(prefix)||c.route==='library-image'))
 for(const [file,bytes]of originals)assert.ok(bytes.equals(await readFile(file)),file+' was changed')
 assert.deepEqual(errors,[])
 const report={passed:true,project,sourceId,analysisId:analysis.id,originalReviewId:review.id,known:24,confirmed:24,foreignModulePlans:foreignModules,originalRecordsUnchanged:true,checks:['actual saved Review/Analysis/Source/Selected agree','foreign module files do not block own module state','UI edit and repeat save keep Project and parent/CAS','Reconstruction available with 24/24','Draft Continue Editing preserves exact source and Review','failed POST retains all reviewed pieces','server restart restores unsaved form','409 preserves committed Review and unsaved local draft','no Analysis or paid model calls'],productionWrites:0,providerCalls:0,errors}
 await writeFile(out+'/after-fix.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>'')+'\n'+JSON.stringify(calls.slice(-20)))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

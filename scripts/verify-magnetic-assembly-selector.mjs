// Disposable copy of the car Project. No model calls or official writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {carLibraryFixture} from '../test/magnetic-car-library-fixture.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'assembly-selector-browser-')),out='/tmp/magnetic-assembly-selector',f=await carLibraryFixture(dir),api=f.api,calls=[],errors=[]
let browser,server,page,acceptDialogs=true
try{
 await mkdir(out,{recursive:true});server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'assembly-selector-isolated',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push([req.method,route]);try{
   if(req.method!=='GET'&&!route.startsWith('assembly3d/')&&!route.startsWith('assembly3d-review/')&&!['visible3d/selected','visible3d/adopt','visible3d/build-check'].includes(route))throw Error('Models/Planning/Execution/unrelated writes forbidden')
   let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{},{request:req})))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1760,height:1100},acceptDownloads:true});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>acceptDialogs?d.accept():d.dismiss())
 await page.addInitScript(({a,sidecar,sourceId})=>{if(sessionStorage.getItem('assembly-library-seed'))return;localStorage.setItem('magnetic-tiles.assembly3d-draft.v1',JSON.stringify(a));localStorage.setItem('magnetic-tiles.assembly3d-origin.v1',JSON.stringify(sidecar));localStorage.setItem('magnetic-visible3d-context.v1',JSON.stringify({sourceId}));sessionStorage.setItem('assembly-library-seed','yes')},{a:f.rear,sidecar:f.sidecar,sourceId:f.source.id})
 const field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),row=id=>page.locator(`[data-assembly-row="${id}"]`),editingId=()=>page.locator('.assembly-list li[aria-current="true"]').getAttribute('data-assembly-row')
 async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out waiting for Assembly UI')}
 async function exported(){await stage(page,'assembly','workspace');const d=page.locator('.magnetic-3d-load');if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click();const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 async function choose(id){await stage(page,'assembly','workspace');await button('编辑作品 '+id).click();await until(async()=>await editingId()===id);await until(async()=>await button('保存 3D Draft').isEnabled())}
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`
 await page.goto(url);await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor({state:'attached'});await studioMode(page,'3d');await stage(page,'assembly','workspace')
 await button('编辑作品 '+f.rear.id).waitFor();await until(async()=>await editingId()===f.rear.id);assert.deepEqual(await exported(),f.rear)
 await page.getByTestId('human-collision-approved').waitFor();assert.equal(await button('Edit Draft').getAttribute('aria-pressed'),'true');assert.equal(await button('3D Undo').isDisabled(),true)
 const rearSaved=await api.dispatch('GET','assembly3d/records/'+f.rear.id);assert.equal(rearSaved.version,1);assert.equal(rearSaved.snapshot.assembly.pieces.length,12);assert.equal(rearSaved.snapshot.assembly.connections.length,10)
 // Current Front reconstruction selection must not overwrite Rear's saved editor document.
 await stage(page,'reconstruction','workspace');await field('重建 Group').selectOption(f.front.group.id);await until(async()=>await field('Geometry Execution History').inputValue()===f.front.execution.id)
 assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+f.rear.id)).snapshot.assembly,f.rear)
 await stage(page,'reconstruction','inspector');const candidate=f.front.execution.candidates.find(c=>c.assembly.pieces.length===9);await field('3D Reconstruction Candidate').selectOption(candidate.id);await field('已对照照片审核候选').check();await button('采用候选到 3D Assembly Editor').click()
 await until(async()=>await page.locator('.studio').getAttribute('data-active-stage')==='assembly');await until(()=>button('保存 3D Draft').isEnabled());let front=await exported();assert.equal(front.pieces.length,9);assert.notEqual(front.id,f.rear.id)
 const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/assembly3d/save')&&r.request().method()==='POST');await button('保存 3D Draft').click();assert.equal((await savedResponse).status(),200);await until(()=>button('保存 3D Draft').isEnabled());await until(async()=>await editingId()===front.id);const frontSaved=await api.dispatch('GET','assembly3d/records/'+front.id)
 assert.equal((await api.dispatch('GET','assembly3d/projects/'+f.source.id)).assemblies.length,2)
 const head=await api.dispatch('GET','visible3d/head/'+f.source.id)
 await choose(f.rear.id);assert.deepEqual(await exported(),f.rear);assert.equal(await field('Spatial Planning History').inputValue(),f.origin.planId);assert.equal(await field('Geometry Execution History').inputValue(),f.origin.executionId)
 await page.getByTestId('human-collision-approved').waitFor();assert.match(await page.getByTestId('assembly-origin-summary').innerText(),/g-rear-ramp/);assert.deepEqual(await api.dispatch('GET','visible3d/head/'+f.source.id),head)
 // Source reload is explicitly the original 8-tile result, not saved-Draft restore.
 await button('重新加载来源').click();assert.equal((await exported()).pieces.length,8);assert.match(await row(f.rear.id).innerText(),/未保存/);assert.equal((await api.dispatch('GET','assembly3d/records/'+f.rear.id)).version,rearSaved.version)
 await choose(f.rear.id);assert.deepEqual(await exported(),f.rear);await page.getByTestId('human-collision-approved').waitFor()
 await choose(front.id);assert.deepEqual(await exported(),front);assert.equal(await field('Spatial Planning History').inputValue(),f.front.plan.id)
 await page.reload();await stage(page,'assembly','workspace');await until(async()=>await editingId()===front.id);assert.deepEqual(await exported(),front)
 await choose(f.rear.id);assert.deepEqual(await exported(),f.rear);await choose(front.id)
 // Dirty edits are neither silently discarded nor automatically saved.
 await page.locator(`[data-3d-piece="${front.pieces[0].id}"]`).click();await field('当前 3D 零件颜色').fill('#123456');const dirty=await exported();assert.match(await row(front.id).innerText(),/未保存/)
 acceptDialogs=false;await button('编辑作品 '+f.rear.id).click();assert.deepEqual(await exported(),dirty);assert.match(await row(front.id).innerText(),/未保存/);assert.equal((await api.dispatch('GET','assembly3d/records/'+front.id)).hash,frontSaved.hash)
 acceptDialogs=true;await choose(f.rear.id);await choose(front.id);assert.deepEqual(await exported(),front)
 // Changing the selected Rear Plan leaves its 12-tile Assembly recoverable,
 // while the original strict source/Build gate continues to block it.
 await api.dispatch('POST','visible3d/manual-plan',{reviewId:f.review.id,reconstructionScope:f.plan.reconstructionScope,plan:f.plan.plan})
 const stale=await api.dispatch('GET','assembly3d/records/'+f.rear.id);assert.equal(stale.lineage.selected,false)
 await choose(f.rear.id);assert.deepEqual(await exported(),f.rear);await page.getByRole('alert').filter({hasText:/来源不匹配/}).first().waitFor()
 await assert.rejects(api.dispatch('POST','visible3d/build-check',{originId:f.origin.id,assembly:f.rear}),e=>e.statusCode===409)
 await page.reload();await stage(page,'assembly','workspace');await button('编辑作品 '+front.id).waitFor();assert.deepEqual(await exported(),f.rear)
 for(const width of [1760,1100,680]){
  await page.setViewportSize({width,height:1050});if(width<=760)await page.getByRole('button',{name:'工作阶段',exact:true}).filter({visible:true}).click()
  await page.getByRole('region',{name:'Assembly Selector',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);assert.equal(await page.locator('.assembly-list').evaluate(e=>e.scrollWidth>e.clientWidth+2),false)
  await page.screenshot({path:`${out}/${width}.png`})
 }
 assert.deepEqual(errors,[]);assert.equal(calls.some(([method,route])=>method==='POST'&&['visible3d/analyze','visible3d/plan','visible3d/execute'].includes(route)),false)
 for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw)
 const result={passed:true,rear:'saved real 8-tile geometry + four explicit mirror copies = 12 tiles / original 10 connections; exact poses and original lineage restored',front:'independent 9-tile deterministic storage fixture',checks:['one-time preservation of existing saved working slot','Project-wide selector, independent of current Group/Execution','Front adoption does not overwrite Rear','exact Rear/Front save and restore','explicit original-source reload remains distinct from saved 12-tile restore','read-only actual origin History in Assembly','no Selected mutations on Assembly selection','saved human review restored from server evidence','refresh and independent identities','dirty Cancel/discard; no autosave of edits','stale lineage remains viewable; strict server Build blocked','1760/1100/680 layout'],modelCalls:0,formalWrites:0,errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){console.error(e);if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>'<browser unavailable>')+'\n'+JSON.stringify(calls))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

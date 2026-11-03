// Real Front9 / Rear12 snapshots in isolated storage; no models or formal writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {snapCaseFixture} from '../test/magnetic-snap-case-fixture.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'snap-diagnostics-browser-')),out='/tmp/magnetic-snap-diagnostics'
const f=await snapCaseFixture(dir),api=f.api,errors=[],calls=[]
const seed=f.record,a=seed.snapshot.assembly
const head=await api.dispatch('GET','visible3d/head/'+f.source.id)
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-snap-diagnostics',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push([req.method,route]);try{
   if(req.method!=='GET'&&!route.startsWith('assembly3d/')&&route!=='visible3d/build-check')throw Error('Models / Planning / Execution / source writes forbidden')
   let raw='';for await(const c of req)raw+=c
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{},{request:req})))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1840,height:1100},acceptDownloads:true});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.addInitScript(({r,sourceId})=>{if(sessionStorage.getItem('spatial-seeded'))return
  localStorage.setItem('magnetic-tiles.assembly3d-draft.v1',JSON.stringify(r.snapshot.assembly));localStorage.setItem('magnetic-tiles.assembly3d-origin.v1',JSON.stringify(r.snapshot.photoOrigin))
  localStorage.setItem('magnetic-tiles.assembly3d-saved-ref.v1',JSON.stringify({id:r.assembly.id,hash:r.hash,projectId:r.project.id}));localStorage.setItem('magnetic-visible3d-context.v1',JSON.stringify({sourceId}));sessionStorage.setItem('spatial-seeded','yes')
 },{r:seed,sourceId:f.source.id})
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true})
 async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Snap picker UI did not settle')}
 async function exported(){const d=page.locator('.magnetic-3d-load');if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click();const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 async function frames(){await page.locator('.studio-workspace').evaluate(e=>e.scrollTop=0);await page.evaluate(()=>new Promise(resolve=>{let n=0;const tick=()=>++n===4?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick)}))}
 const fixed=f.connection.pieceA,green=f.connection.pieceB,top=f.reference.pieceId
 const diagnostic=()=>page.getByTestId('snap-constraint-diagnostics'),preview=()=>page.getByTestId('module-snap-preview')
 const close=(x,y)=>assert.ok(Math.abs(Number(x)-y)<1e-6,`${x} != ${y}`)
 async function parameters(flip,angle=0){await field('模块参考 Tile').selectOption(green);await field('固定 Group').selectOption('module-0');await field('模块 Snap 固定 Tile').selectOption(fixed);await field('模块 Snap 固定 Port').selectOption('e2-p0');await field('模块 Snap 移动 Port').selectOption('e0-p0');await field('模块 Snap 二面角').fill(String(angle));await field('模块 Snap Flip').setChecked(flip)}
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`);await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor({state:'attached'});await studioMode(page,'3d');await stage(page,'assembly','workspace');await field('当前 Group').waitFor();await until(()=>button('保存 3D Draft').isEnabled());await field('当前 Group').selectOption('module-1');const baseline=await exported()
 // Loading an already upright face does not imply that it was the user's goal.
 await button('Snap').click();await parameters(true);await button('预览模块吸附').click();await preview().waitFor();assert.equal(await page.getByTestId('snap-reference-missing').count(),1);assert.match(await page.getByTestId('snap-collision-delta').innerText(),/输入时人工接受 5|输入审核未读取/);await button('取消模块预览').click()
 // Explicit Orient is independent of Snap Moving Tile. Already-up action must
 // record intent without a numerical pose round trip or a spurious Revision.
 await button('Orient').click();await field('模块参考 Tile').selectOption(top);await button('所选面朝上').click();assert.deepEqual(await exported(),baseline);assert.equal(await button('3D Undo').isDisabled(),true)
 await button('Snap').click()
 for(const flip of [true,false]){
  await parameters(flip);await button('预览模块吸附').click();await preview().waitFor();await frames();close(await page.getByTestId('snap-reference-angle').getAttribute('data-angle'),30);close(await page.getByTestId('snap-bottom-gap').getAttribute('data-gap'),-1.3620061658979714);assert.equal(Number(await page.getByTestId('snap-collision-delta').getAttribute('data-new-cross')),flip?0:4)
  const residual=page.getByTestId('snap-port-residual');assert.ok(Number(await residual.getAttribute('data-position'))<1e-12);close(await residual.getAttribute('data-angle'),0);close(await residual.getAttribute('data-direction'),1)
  assert.match(await diagnostic().innerText(),/没有其他同约束候选/);assert.match(await diagnostic().innerText(),/无法保持该方向/);assert.match(await diagnostic().innerText(),new RegExp('所需 Dihedral '+(flip?'-30':'30')));assert.match(await page.getByTestId('snap-collision-delta').innerText(),/输入时人工接受 5|输入审核未读取/)
  assert.equal(await field('模块 Snap 二面角').inputValue(),'0');assert.equal(await field('模块 Snap Flip').isChecked(),flip);assert.deepEqual(await exported(),baseline)
  await diagnostic().scrollIntoViewIfNeeded();await page.screenshot({path:out+'/flip-'+flip+'.png'});await button('取消模块预览').click();assert.deepEqual(await exported(),baseline);assert.equal(await button('3D Undo').isDisabled(),true)
 }
 // A manually changed angle can preserve the explicit direction and bottom
 // level, yet the strict Validator still reports new cross-Group collisions.
 await parameters(true,-30);await button('预览模块吸附').click();await preview().waitFor();close(await page.getByTestId('snap-reference-angle').getAttribute('data-angle'),0);close(await page.getByTestId('snap-bottom-gap').getAttribute('data-gap'),0);assert.equal(await page.getByTestId('snap-collision-delta').getAttribute('data-new-cross'),'5');assert.match(await diagnostic().innerText(),/Geometry Invalid/)
 await button('取消模块预览').click();assert.deepEqual(await exported(),baseline);await button('预览模块吸附').click();await button('确认模块吸附（Geometry Invalid）').click();const snapped=await exported();assert.equal(snapped.revision,5);assert.equal(snapped.connections.length,23);assert.deepEqual(snapped.connections.slice(0,22),baseline.connections)
 const fixedIds=new Set(baseline.modules[0].pieces.map(p=>p.id));assert.deepEqual(snapped.pieces.filter(p=>fixedIds.has(p.id)),baseline.pieces.filter(p=>fixedIds.has(p.id)));assert.deepEqual(snapped.modules.map(({frame,...m})=>m),baseline.modules.map(({frame,...m})=>m));assert.deepEqual(snapped.connections.at(-1),{...f.connection,dihedralDeg:-30})
 await button('3D Undo').click();assert.deepEqual(await exported(),baseline);await button('3D Redo').click();assert.deepEqual(await exported(),snapped)
 const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/assembly3d/save')&&r.request().method()==='POST');await button('保存 3D Draft').click();assert.equal((await response).status(),200);await until(()=>button('保存 3D Draft').isEnabled());await page.reload();await field('当前 Group').waitFor();await until(()=>button('保存 3D Draft').isEnabled());assert.deepEqual(await exported(),snapped)
 // Session intent is deliberately absent after reload. Pose/lineage are exact.
 await field('当前 Group').selectOption('module-1');await button('Snap').click();assert.equal(await field('模块 Snap 固定 Port').inputValue(),'e2-p0');assert.equal(await field('模块 Snap 二面角').inputValue(),'-30')
 // Choosing another unoccupied Port permits a fresh preview of the restored
 // document, but does not invent a face reference from the prior saved poses.
 await field('模块 Snap 固定 Port').selectOption('e0-p0');await field('模块 Snap 移动 Port').selectOption('e0-p0');await button('预览模块吸附').click();await preview().waitFor();assert.equal(await page.getByTestId('snap-reference-missing').count(),1);assert.match(await page.getByTestId('snap-no-confirmable-solution').innerText(),/无可确认解/);assert.equal(await button('确认模块吸附（Geometry Invalid）').isDisabled(),true);await button('取消模块预览').click()
 await page.setViewportSize({width:430,height:1000});await stage(page,'assembly','inspector');await field('模块 Snap 固定 Port').selectOption('e0-p0');await button('预览模块吸附').click();await preview().waitFor();assert.equal(await diagnostic().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:out+'/narrow-diagnostics.png'});await button('取消模块预览').click()
 for(const original of [f.front,f.rear])assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+original.assembly.id)).snapshot,original.snapshot);assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+snapped.id)).parent,seed.parent);assert.deepEqual(await api.dispatch('GET','visible3d/head/'+f.source.id),head);for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.deepEqual(errors,[])
 const result={passed:true,input:{id:a.id,recordHash:seed.hash,revision:a.revision,ports:f.connection},checks:['actual saved case Flip true/false 0°: exact endpoints, 30° reference tilt, -1.362 Y gap, 0/4 added cross collisions','explicit Orient goal kept separate from Snap Moving Tile; no-op Orient leaves Revision and Undo unchanged','no fabricated candidates or automatic angle/flip changes','manual -30°/true achieves up + bottom level but adds 5 cross collisions; remains Geometry Invalid','Preview/Cancel never mutate Draft; Confirm/Undo/Redo/CAS save/refresh exact','saved poses do not invent missing direction intent','narrow diagnostic layout has no horizontal overflow','source snapshots / parent lineage unchanged; zero models / formal writes'],errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){console.error(e);if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

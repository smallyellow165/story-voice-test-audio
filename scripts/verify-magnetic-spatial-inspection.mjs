// Production React / WebGL with copied Front9 + Rear12 and disposable storage.
// Model, Planning, Execution and formal source writes are forbidden.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {Quaternion,Vector3} from 'three'
import {multiAssemblyFixture} from '../test/magnetic-multi-assembly-fixture.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {moduleBounds,previewModuleBoundsAlign} from '../src/magnetic-tiles/three-d/module-transform.ts'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'spatial-browser-')),out='/tmp/magnetic-spatial-inspection'
const f=await multiAssemblyFixture(dir),api=f.api,errors=[],calls=[]
const seed=await api.dispatch('POST','assembly3d/combine',{name:'Spatial Inspection Test',parents:[f.front,f.rear].map(r=>({id:r.assembly.id,hash:r.hash,version:r.version}))})
const head=await api.dispatch('GET','visible3d/head/'+f.source.id)
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-spatial-inspection',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push([req.method,route]);try{
   if(req.method!=='GET'&&!route.startsWith('assembly3d/')&&!route.startsWith('assembly3d-review/')&&route!=='visible3d/build-check')throw Error('Models / Planning / Execution / source writes forbidden')
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
 const canvas=()=>page.locator('.magnetic-3d-editor-canvas canvas,.magnetic-3d-canvas canvas').filter({visible:true})
 const table=()=>page.getByRole('table',{name:'Group World Bounds',exact:true}).filter({visible:true})
 async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Spatial UI did not settle')}
 async function open(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click()}
 async function exported(){await open(page.locator('.magnetic-3d-load'));const download=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await download).path(),'utf8'))}
 async function frames(){await page.locator('.studio-workspace').evaluate(e=>e.scrollTop=0);await page.evaluate(()=>new Promise(resolve=>{let n=0;const tick=()=>++n===8?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick)}))}
 async function view(editing=true){await until(async()=>{const t=await page.getByLabel(editing?'3D Editor 相机状态':'3D 相机状态',{exact:true}).textContent();return !!t&&t!=='null'});return JSON.parse(await page.getByLabel(editing?'3D Editor 相机状态':'3D 相机状态',{exact:true}).textContent())}
 async function assertBounds(a,id,preview=false){
  const b=moduleBounds(a,id),center=b.getCenter(new Vector3()),size=b.getSize(new Vector3())
  assert.equal(await table().getAttribute('data-group-id'),id);assert.equal(await table().getAttribute('data-preview'),String(preview))
  for(const axis of ['x','y','z'])for(const [key,v]of [['min',b.min[axis]],['center',center[axis]],['max',b.max[axis]],['size',size[axis]]]){
   const actual=Number(await table().locator(`[data-bounds-axis="${axis}"] [data-bound="${key}"]`).getAttribute('data-value'));assert.ok(Math.abs(actual-v)<1e-10,`${id} world ${axis} ${key}`)
  }
 }
 async function indicator(){await frames();const b=await canvas().boundingBox();return page.screenshot({clip:{x:b.x+b.width-116,y:b.y,width:116,height:116}})}
 async function assertAxisPixels(png,camera){
  const inverse=new Quaternion(...camera.quaternion).invert(),colors=[[198,74,85],[50,129,91],[63,121,189]]
  const targets=[[1,0,0],[0,1,0],[0,0,1]].map((a,i)=>{const v=new Vector3(...a).applyQuaternion(inverse);return {x:58+v.x*28,y:58-v.y*28,color:colors[i]}})
  // Read rendered screenshot pixels, rather than adding test-only scene state.
  const counts=await page.evaluate(async({data,targets})=>{
   const bitmap=await createImageBitmap(await(await fetch(data)).blob()),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height
   const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data
   return targets.map(t=>{let count=0;for(let y=Math.max(0,Math.floor(t.y-10));y<Math.min(c.height,t.y+10);y++)for(let x=Math.max(0,Math.floor(t.x-10));x<Math.min(c.width,t.x+10);x++){const j=(y*c.width+x)*4;if(t.color.every((v,i)=>Math.abs(pixels[j+i]-v)<18))count++}return count})
  },{data:'data:image/png;base64,'+png.toString('base64'),targets})
  counts.forEach((n,i)=>assert.ok(n>8,`rendered +${'XYZ'[i]} matches inverse camera rotation (${n} pixels)`))
 }
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`)
 await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor({state:'attached'});await studioMode(page,'3d');await stage(page,'assembly','workspace');await field('当前 Group').waitFor();await until(()=>button('保存 3D Draft').isEnabled())
 const opening=await exported();assert.deepEqual(opening,seed.snapshot.assembly);await field('当前 Group').selectOption('module-0');await assertBounds(opening,'module-0');await field('当前 Group').selectOption('module-1');await assertBounds(opening,'module-1')
 assert.equal(await page.getByRole('img',{name:'世界 XYZ 方向：+Y 为竖直向上',exact:true}).filter({visible:true}).count(),1)
 for(const preset of ['前','右','顶']){await button(preset).click();await frames();const png=await indicator();await writeFile(out+'/axis-'+preset+'.png',png);await assertAxisPixels(png,await view());assert.deepEqual(await exported(),opening)}
 await button('前').click();await frames();const front=await indicator(),frontView=await view(),c=await canvas().boundingBox()
 await page.mouse.move(c.x+c.width*.2,c.y+c.height*.2);await page.mouse.down();await page.mouse.move(c.x+c.width*.2+80,c.y+c.height*.2+45,{steps:12});await page.mouse.up();await frames()
 const orbit=await indicator(),orbitView=await view();assert.notDeepEqual(orbitView.quaternion,frontView.quaternion);assert.equal(orbit.equals(front),false);await assertAxisPixels(orbit,orbitView);assert.deepEqual(await exported(),opening)
 await button('前').click();await frames();const beforeClick=await view(),b=await canvas().boundingBox();await page.mouse.click(b.x+b.width-30,b.y+58);await frames();assert.deepEqual(await view(),beforeClick);assert.deepEqual(await exported(),opening)
 await field('当前 Group').selectOption('module-1');await button('Rotate').click();await field('模块轴').selectOption('z');await field('模块旋转角度').fill('31')
 const beforeRotateImage=await indicator(),beforeRotateCamera=await view();await button('旋转 Group').click();await frames();const rotated=await exported();assert.deepEqual((await view()).quaternion,beforeRotateCamera.quaternion);assert.equal((await indicator()).equals(beforeRotateImage),true);await assertBounds(rotated,'module-1')
 console.log('PASS world +Y, rendered XYZ camera synchronization, read-only clicks, rotation-aware bounds')
 await button('Move').click();await field('模块坐标系').selectOption('global')
 for(const [axis,distance]of [['x','2.13'],['y','3.27'],['z','-1.49']]){await field('模块轴').selectOption(axis);await field('模块位移').fill(distance);await button('移动 Group').click()}
 const baseline=await exported();await assertBounds(baseline,'module-1')
 // Read-only View also exposes the direction indicator and exact Group bounds.
 await button('View').click();await frames();await assertAxisPixels(await indicator(),await view(false));await assertBounds(baseline,'module-1');assert.deepEqual(await exported(),baseline);await button('Edit Draft').click();await field('当前 Group').selectOption('module-1')
 await open(page.locator('.bounds-align-tools'));await field('Bounds Align Reference Group').selectOption('module-0')
 const reference=moduleBounds(baseline,'module-0'),movingIds=new Set(baseline.modules[1].pieces.map(p=>p.id)),checks=[]
 let final
 for(const axis of ['x','y','z'])for(const mode of ['min','center','max']){
  await field('Bounds Align Axis').selectOption(axis);await field('Bounds Align Mode').selectOption(mode)
  const proposal=previewModuleBoundsAlign(baseline,'module-1','module-0',axis,mode),delta=proposal.boundsAlignment.delta
  assert.notEqual(delta,0);assert.ok(Math.abs(Number(await field('Bounds Align Calculated Delta').getAttribute('data-delta'))-delta)<1e-10)
  await button('预览对齐').click();await page.getByTestId('module-align-preview').waitFor();await assertBounds(proposal.assembly,'module-1',true)
  if(mode==='min')assert.deepEqual(await exported(),baseline)
  if(axis==='y'&&mode==='min'){await page.getByRole('region',{name:'Assembly 编辑工具',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/y-min-preview.png'});await button('取消对齐预览').click();assert.deepEqual(await exported(),baseline);await assertBounds(baseline,'module-1');await button('预览对齐').click()}
  await button('应用对齐').click();await page.getByTestId('module-align-preview').waitFor({state:'hidden'});final=await exported();await assertBounds(final,'module-1')
  const after=moduleBounds(final,'module-1'),value=box=>(mode==='center'?box.getCenter(new Vector3()):box[mode])[axis]
  assert.ok(Math.abs(value(after)-value(reference))<1e-10);assert.deepEqual(final.connections,baseline.connections)
  final.pieces.forEach((p,i)=>{const old=baseline.pieces[i];assert.deepEqual(p.pose.quaternion,old.pose.quaternion);if(!movingIds.has(p.id))assert.deepEqual(p,old);else for(let n=0;n<3;n++)assert.ok(Math.abs(p.pose.position[n]-(old.pose.position[n]+('xyz'[n]===axis?delta:0)))<1e-10)})
  assert.equal(Number(await field('Bounds Align Calculated Delta').getAttribute('data-delta')),0);assert.equal(await button('预览对齐').isDisabled(),true)
  if(axis==='y'&&mode==='min'){await button('3D Undo').click();assert.deepEqual(await exported(),baseline);await button('3D Redo').click();assert.deepEqual(await exported(),final);await field('当前 Group').selectOption('module-1')}
  checks.push(`${axis.toUpperCase()} ${mode}`);console.log('PASS Bounds Align '+checks.at(-1))
  if(!(axis==='z'&&mode==='max')){await button('3D Undo').click();assert.deepEqual(await exported(),baseline);await field('当前 Group').selectOption('module-1')}
 }
 const beforeReadonly=await exported();await field('显示作品 '+f.front.assembly.id).check();await until(()=>page.getByTestId('multi-assembly-display').count())
 await assertBounds(final,'module-1');assert.deepEqual(await exported(),beforeReadonly);await field('显示作品 '+f.front.assembly.id).uncheck();await assertBounds(final,'module-1')
 const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/assembly3d/save')&&r.request().method()==='POST');await button('保存 3D Draft').click();assert.equal((await savedResponse).status(),200);await until(()=>button('保存 3D Draft').isEnabled())
 const saved=await api.dispatch('GET','assembly3d/records/'+final.id);assert.deepEqual(saved.parent,seed.parent);assert.deepEqual(saved.snapshot.assembly,final)
 await page.reload();await stage(page,'assembly','workspace');await field('当前 Group').waitFor();await until(()=>button('保存 3D Draft').isEnabled());assert.deepEqual(await exported(),final);await field('当前 Group').selectOption('module-1');await assertBounds(final,'module-1')
 await open(page.locator('.bounds-align-tools'));await field('Bounds Align Reference Group').selectOption('module-0');await field('Bounds Align Axis').selectOption('z');await field('Bounds Align Mode').selectOption('max');assert.equal(Number(await field('Bounds Align Calculated Delta').getAttribute('data-delta')),0);assert.equal(await button('预览对齐').isDisabled(),true);assert.deepEqual(await exported(),final)
 await button('Revalidate Geometry').click();await page.getByRole('alert').filter({hasText:'严格复验失败'}).waitFor();assert.equal(await page.getByTestId('human-collision-approved').count(),0)
 for(const width of [1840,1100,680]){await page.setViewportSize({width,height:1100});await stage(page,'assembly','inspector');await page.getByRole('region',{name:'Assembly 编辑工具',exact:true}).scrollIntoViewIfNeeded();assert.equal(await table().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:`${out}/inspector-${width}.png`});await stage(page,'assembly','workspace');await frames();const cap=await page.getByRole('img',{name:'世界 XYZ 方向：+Y 为竖直向上',exact:true}).filter({visible:true}).boundingBox(),cv=await canvas().boundingBox();assert.ok(cap.x>=cv.x&&cap.x+cap.width<=cv.x+cv.width&&cap.y>=cv.y&&cap.y+cap.height<=cv.y+cv.height);await page.screenshot({path:`${out}/viewer-${width}.png`})}
 for(const original of [f.front,f.rear])assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+original.assembly.id)).snapshot,original.snapshot)
 assert.deepEqual(await api.dispatch('GET','visible3d/head/'+f.source.id),head);for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.deepEqual(errors,[])
 const result={passed:true,worldUp:'+Y',orientation:'actual rendered XYZ endpoints match inverse camera quaternion; orbit and View/Edit; Group rotation does not affect HUD; clicking does not move camera',bounds:'scaled, rotated solid geometry including thickness; Preview distinguished from Draft; read-only Display Offset excluded',alignments:checks,history:'Preview / Cancel / Apply / Undo / Redo / zero-delta / CAS save / refresh',lineage:'fixed Parent snapshots and original Front / Rear preserved',strictGeometry:'Invalid remains Invalid; no automatic collision acceptance or new Connections',layout:[1840,1100,680],modelCalls:0,executionCalls:0,formalWrites:0,errors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){console.error(e);if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

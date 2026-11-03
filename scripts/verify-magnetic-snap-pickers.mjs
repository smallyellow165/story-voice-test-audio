// Real Front9 / Rear12 snapshots in isolated storage; no models or formal writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {OrthographicCamera,Vector3} from 'three'
import {multiAssemblyFixture} from '../test/magnetic-multi-assembly-fixture.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {alignModuleFace,moduleStep} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {createViewerModel} from '../src/magnetic-tiles/three-d/viewer-model.ts'
import {snapPortSegment} from '../src/magnetic-tiles/three-d/module-snap-selection.ts'
const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'spatial-browser-')),out='/tmp/magnetic-snap-pickers'
const f=await multiAssemblyFixture(dir),api=f.api,errors=[],calls=[]
let seed=await api.dispatch('POST','assembly3d/combine',{name:'Snap Picker Test',parents:[f.front,f.rear].map(r=>({id:r.assembly.id,hash:r.hash,version:r.version}))})
const a=seed.snapshot.assembly,top=a.modules[1].pieces.find(p=>p.sourceId==='rear-top-left').id;const prepared=moduleStep(alignModuleFace(a,'module-1',top,'up'),'module-1','translate','x',4,'global');seed=await api.dispatch('POST','assembly3d/save',{snapshot:{...seed.snapshot,assembly:prepared},expectedHash:seed.hash})
const head=await api.dispatch('GET','visible3d/head/'+f.source.id)
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-spatial-inspection',configureServer(s){
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
 const canvas=()=>page.locator('.magnetic-3d-editor-canvas canvas,.magnetic-3d-canvas canvas').filter({visible:true})
 const selectors=['Fixed Tile','Fixed Port','Moving Tile','Moving Port'],selector=n=>button('从 Viewer 选择 '+n),hover=()=>page.getByTestId('snap-port-hover')
 const panel=()=>page.getByLabel('Module Snap 参数',{exact:true}),moving=()=>field('当前 Group').inputValue()
 async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Snap picker UI did not settle')}
 async function exported(){const d=page.locator('.magnetic-3d-load');if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click();const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 async function frames(){await page.locator('.studio-workspace').evaluate(e=>e.scrollTop=0);await page.evaluate(()=>new Promise(resolve=>{let n=0;const tick=()=>++n===4?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick)}))}
 async function camera(){const v=JSON.parse(await page.getByLabel('3D Editor 相机状态',{exact:true}).textContent()),f=v.frustum,c=new OrthographicCamera(f.left,f.right,f.top,f.bottom,f.near,f.far);c.position.fromArray(v.position);c.quaternion.fromArray(v.quaternion);c.zoom=v.zoom;c.updateProjectionMatrix();c.updateMatrixWorld(true);return c}
 async function screen(point){const c=await camera(),b=await canvas().boundingBox(),v=point.clone().project(c);return {x:b.x+(v.x+1)*b.width/2,y:b.y+(1-v.y)*b.height/2}}
 async function aim(view){if(view==='below'){await button('前').click();await frames();const b=await canvas().boundingBox();await page.mouse.move(b.x+b.width*.1,b.y+b.height*.7);await page.mouse.down();await page.mouse.move(b.x+b.width*.1,b.y+b.height*.7-160,{steps:12});await page.mouse.up()}else if(view==='reset')await button('Reset Camera').click();else await button(view).click();await frames()}
 const models=createViewerModel(seed.snapshot.assembly),find=(module,id)=>seed.snapshot.assembly.modules[module].pieces.find(p=>p.sourceId===id).id
 const fixed=find(0,'front-floor-left'),green=find(1,'ramp-lower-left')
 async function pickTile(side,id){
  const name=side+' Tile',drop=field(side==='Fixed'?'模块 Snap 固定 Tile':'模块参考 Tile'),p=models.find(p=>p.id===id)
  for(const view of ['below','reset','前','后','左','右','顶']){
   if(await selector(name).getAttribute('aria-pressed')!=='true')await selector(name).click();await aim(view)
   for(const [x,y]of [[0,0],[.12,.08],[-.12,-.08]]){if(await selector(name).getAttribute('aria-pressed')!=='true')await selector(name).click();await frames();const pt=await screen(new Vector3(x,y,0).applyQuaternion(p.transform.quaternion).add(p.transform.position));await page.mouse.move(pt.x,pt.y);await page.mouse.click(pt.x,pt.y);assert.equal(await moving(),'module-1');if(await selector(name).getAttribute('aria-pressed')==='false'&&await drop.inputValue()===id)return}
  }throw Error(name+' could not select visible target '+id)
 }
 async function pickPort(side,tileId,portId){
  const name=side+' Port',drop=field(side==='Fixed'?'模块 Snap 固定 Port':'模块 Snap 移动 Port'),p=models.find(p=>p.id===tileId)
  await selector(name).click()
  for(const view of ['below','reset','前','后','左','右','顶']){
   await aim(view);const c=await camera(),s=snapPortSegment(p,portId,c)
   for(const t of [.5,.3,.7]){const pt=await screen(s.p0.clone().lerp(s.p1,t));await page.mouse.move(pt.x,pt.y);await page.waitForTimeout(90)
    if(await hover().isVisible()&&await hover().getAttribute('data-port-id')===portId){await page.screenshot({path:out+'/'+side.toLowerCase()+'-port-hover.png'});await page.mouse.click(pt.x,pt.y);await until(async()=>await selector(name).getAttribute('aria-pressed')==='false');assert.equal(await drop.inputValue(),portId);assert.equal(await moving(),'module-1');return}
   }
  }throw Error(name+' could not select unambiguous target '+tileId+':'+portId)
 }
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`);await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor({state:'attached'});await studioMode(page,'3d');await stage(page,'assembly','workspace');await field('当前 Group').waitFor();await until(()=>button('保存 3D Draft').isEnabled());await field('当前 Group').selectOption('module-1');await button('Snap').click();const baseline=await exported()
 // Four mutually exclusive pickers, toggle / Esc, operation / Group / View / stage cancellation.
 for(const name of selectors){await selector(name).click();assert.equal(await selector(name).getAttribute('aria-pressed'),'true');for(const other of selectors.filter(n=>n!==name))assert.equal(await selector(other).getAttribute('aria-pressed'),'false');await selector(name).click();assert.equal(await selector(name).getAttribute('aria-pressed'),'false');await selector(name).click();await page.keyboard.press('Escape');assert.equal(await selector(name).getAttribute('aria-pressed'),'false')}
 await selector('Fixed Tile').click();await selector('Moving Tile').click();assert.equal(await selector('Fixed Tile').getAttribute('aria-pressed'),'false');await button('Move').click();await button('Snap').click();assert.equal(await page.getByTestId('snap-picker-active').count(),0)
 await selector('Fixed Tile').click();await field('当前 Group').selectOption('module-0');assert.equal(await page.getByTestId('snap-picker-active').count(),0);await field('当前 Group').selectOption('module-1')
 await selector('Fixed Tile').click();await button('View').click();assert.equal(await page.getByTestId('snap-picker-active').count(),0);await button('Edit Draft').click()
 await selector('Fixed Tile').click();await stage(page,'build','workspace');await stage(page,'assembly','workspace');assert.equal(await page.getByTestId('snap-picker-active').count(),0)
 assert.deepEqual(await exported(),baseline);assert.equal(await button('3D Undo').isDisabled(),true);console.log('PASS four pickers, exclusivity, cancellation and zero edit history')
 // Invalid old Port must clear rather than silently selecting a different Port.
 await field('模块 Snap 固定 Port').selectOption('e3-p0');await field('模块 Snap 固定 Tile').selectOption(find(0,'front-triangle-left'));assert.equal(await field('模块 Snap 固定 Port').inputValue(),'')
 await field('模块参考 Tile').selectOption(green);await field('模块 Snap 移动 Port').selectOption('e3-p0');await field('模块参考 Tile').selectOption(find(1,'rear-support-left'));assert.equal(await field('模块 Snap 移动 Port').inputValue(),'');assert.equal(await button('预览模块吸附').isDisabled(),true)
 await pickTile('Fixed',fixed);await pickPort('Fixed',fixed,'e0-p0');console.log('PASS Fixed Tile / Port native Viewer picking')
 // Near edge-on projections must not guess or mutate a previously selected Port.
 await selector('Fixed Port').click();await aim('右');const pt=await screen(models.find(p=>p.id===fixed).transform.position);await page.mouse.move(pt.x,pt.y);await page.waitForTimeout(80);await page.mouse.click(pt.x,pt.y);assert.equal(await selector('Fixed Port').getAttribute('aria-pressed'),'true');assert.equal(await field('模块 Snap 固定 Port').inputValue(),'e0-p0');await page.keyboard.press('Escape')
 await pickTile('Moving',green);await pickPort('Moving',green,'e0-p0');assert.equal(await field('模块 Snap 固定 Tile').inputValue(),fixed);assert.equal(await field('模块 Snap 固定 Port').inputValue(),'e0-p0');console.log('PASS Moving Tile / Port native Viewer picking; Group remains Rear')
 assert.deepEqual(await exported(),baseline);assert.equal(await button('3D Undo').isDisabled(),true);assert.equal(await button('3D Redo').isDisabled(),true)
 // Manual dropdown and subsequent Viewer selection share the same source of truth.
 await field('模块 Snap 移动 Port').selectOption('e1-p0');await pickPort('Moving',green,'e0-p0');await field('模块 Snap 二面角').fill('-30');await field('模块 Snap Flip').check()
 await button('预览模块吸附').click();await page.getByTestId('module-snap-preview').waitFor();assert.deepEqual(await exported(),baseline);await button('取消模块预览').click();assert.deepEqual(await exported(),baseline)
 await button('预览模块吸附').click();await button('确认模块吸附（Geometry Invalid）').click();const snapped=await exported();assert.equal(snapped.connections.length,23);assert.deepEqual(snapped.connections.slice(0,22),baseline.connections);assert.deepEqual(snapped.connections.at(-1),{pieceA:fixed,portA:'e0-p0',pieceB:green,portB:'e0-p0',dihedralDeg:-30,flip:true})
 const fixedIds=new Set(baseline.modules[0].pieces.map(p=>p.id));snapped.pieces.filter(p=>fixedIds.has(p.id)).forEach(p=>assert.deepEqual(p,baseline.pieces.find(x=>x.id===p.id)));assert.deepEqual(snapped.modules.map(({frame,...m})=>m),baseline.modules.map(({frame,...m})=>m))
 await button('3D Undo').click();assert.deepEqual(await exported(),baseline);await button('3D Redo').click();assert.deepEqual(await exported(),snapped)
 const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/assembly3d/save')&&r.request().method()==='POST');await button('保存 3D Draft').click();assert.equal((await response).status(),200);await until(()=>button('保存 3D Draft').isEnabled());await page.reload();await field('当前 Group').waitFor();await until(()=>button('保存 3D Draft').isEnabled());assert.deepEqual(await exported(),snapped);await field('当前 Group').selectOption('module-1');await button('Snap').click()
 assert.equal(await field('模块 Snap 固定 Tile').inputValue(),fixed);assert.equal(await field('模块 Snap 固定 Port').inputValue(),'e0-p0');assert.equal(await field('模块 Snap 移动 Port').inputValue(),'e0-p0')
 const heights=[]
 for(const width of [1840,1100,680,430]){await page.setViewportSize({width,height:1100});await stage(page,'assembly','inspector');await panel().scrollIntoViewIfNeeded();const box=await panel().boundingBox();console.log('SNAP LAYOUT',width,box.width,box.height);assert.ok(box.height<(box.width<190?330:260),'compact Snap fields');assert.equal(await panel().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);heights.push({width,height:box.height});await page.screenshot({path:`${out}/snap-${width}.png`})}
 await page.setViewportSize({width:680,height:1100});await stage(page,'assembly','inspector');await selector('Fixed Tile').click();assert.equal(await canvas().isVisible(),true,'mobile picker opens existing workspace');await page.keyboard.press('Escape');await stage(page,'assembly','inspector')
 for(const original of [f.front,f.rear])assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+original.assembly.id)).snapshot,original.snapshot);assert.deepEqual((await api.dispatch('GET','assembly3d/records/'+snapped.id)).parent,seed.parent);assert.deepEqual(await api.dispatch('GET','visible3d/head/'+f.source.id),head);for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.deepEqual(errors,[])
 const result={passed:true,checks:['four exclusive temporary selectors; toggle/Esc/context cancellation','actual solid Tile hits restricted to Group','canonical Port hover, selected edge feedback, click-to-dropdown','ambiguous edge-on click refuses to guess','invalid old Ports clear; manual dropdown and Viewer share state','picking leaves Group, Pose, Revision and history unchanged','original Module Snap preview/cancel/confirm, one explicit new Connection','Undo/Redo, CAS save and refresh','immutable Front/Rear and multi-Parent lineage','mobile opens existing Viewer'],layout:heights,modelCalls:0,formalWrites:0,errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){console.error(e);if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

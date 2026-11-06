import {connectedRamp} from '../test/magnetic-snap-session-fixture.mjs'
import {computeAllConnectionResiduals} from '../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
import {OrthographicCamera,Vector3} from 'three'
import {createViewerModel} from '../src/magnetic-tiles/three-d/viewer-model.ts'
import {snapPortSegment} from '../src/magnetic-tiles/three-d/module-snap-selection.ts'
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {combinedFreeFixture} from '../test/magnetic-combined-free-fixture.mjs'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {workspaceStore,rememberSavedAssembly,WORKSPACE_RECORD_KEY,WORKSPACE_HEAD_KEY} from '../src/magnetic-tiles/workspace-context.ts'
import {restoreAssemblySnapshot} from '../src/magnetic-tiles/three-d/assembly-library.ts'
import {emptyWorkflowDraft} from '../src/magnetic-tiles/three-d/reconstruction/workflow-draft.ts'
import {touchDraftProject,WORKFLOW_DRAFT_KEY} from '../src/magnetic-tiles/draft-projects.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {stage} from './magnetic-studio-browser.mjs'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'connection-rotate-browser-')),out='/tmp/magnetic-snap-session',f=await combinedFreeFixture(dir),calls=[],errors=[]
const initial=f.combined,{history:connected,id:tileId,request:targetRequest}=await connectedRamp(f)
f.combined=await f.api.dispatch('POST','assembly3d/save',{snapshot:{...initial.snapshot,assembly:connected.current},expectedHash:initial.hash})
const map=new Map(),store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},context={mode:'create',id:f.projectId},scoped=workspaceStore(store,context),active=f.combined,ref={id:active.assembly.id,version:active.version,hash:active.hash}
scoped.setItem('binding',canonical(context));restoreAssemblySnapshot(scoped,active,{raw:null,policy:null,origin:null});for(const p of [...f.parents,ref])rememberSavedAssembly(scoped,p);scoped.setItem(WORKSPACE_RECORD_KEY,JSON.stringify(ref));scoped.setItem(WORKSPACE_HEAD_KEY,JSON.stringify(ref))
const draft=emptyWorkflowDraft(f.projectId),head=JSON.parse(await readFile(path.join(dir,`visible3d/heads/${f.projectId}/${f.source.id}.json`))),review=JSON.parse(f.copied.get(`visible3d/reviews/${f.records[0].snapshot.photoOrigin.origin.reviewId}.json`))
Object.assign(draft,{source:{id:f.source.id,hash:f.source.hash},inputSource:{id:f.source.id,hash:f.source.hash},head,form:review.input.review});scoped.setItem(WORKFLOW_DRAFT_KEY,JSON.stringify(draft));scoped.setItem('history',JSON.stringify({refs:[...f.copied].filter(([file])=>/^visible3d\/(analyses|reviews|plans|executions)\//.test(file)).map(([,raw])=>{const r=JSON.parse(raw);return {id:r.id,hash:r.hash}}),requestIds:[]}));touchDraftProject(store,f.projectId,{name:'Truck-Ramp Combined copy',stage:'assembly'})
let browser,page,server
try{
 await mkdir(out,{recursive:true});server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'vite'),server:{host:'127.0.0.1',port:0},plugins:[{name:'combined-free-isolated',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push([req.method,route]);try{
   if(req.method!=='GET'&&!['assembly3d/save',`visible3d/project/${f.projectId}/workspace-history`].includes(route))throw Error('Analysis / Execution / registration or unrelated mutation forbidden: '+route)
   let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await f.api.dispatch(req.method,route,raw?JSON.parse(raw):{})))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1840,height:1100},acceptDownloads:true});page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.addInitScript(entries=>{if(sessionStorage.getItem('connection-rotate-seed'))return;for(const [k,v]of entries)localStorage.setItem(k,v);sessionStorage.setItem('connection-rotate-seed','1')},[...map])
 const button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}),field=name=>page.getByLabel(name,{exact:true}).filter({visible:true})
 async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI did not settle')}
 async function open(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function exported(){await open(page.locator('.magnetic-3d-load'));const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 const panel=()=>page.getByLabel('Module Snap 参数',{exact:true}),preview=()=>page.getByRole('region',{name:'3D 吸附预览',exact:true})
 const canvas=()=>page.locator('.magnetic-3d-editor-canvas canvas').filter({visible:true})
 const picker=name=>button('从 Viewer 选择 '+name)
 async function frames(){await page.locator('.studio-workspace').evaluate(e=>e.scrollTop=0);await page.evaluate(()=>new Promise(resolve=>{let n=0;const frame=()=>++n===4?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame)}))}
 async function camera(){const v=JSON.parse(await page.getByLabel('3D Editor 相机状态',{exact:true}).textContent()),f=v.frustum,c=new OrthographicCamera(f.left,f.right,f.top,f.bottom,f.near,f.far);c.position.fromArray(v.position);c.quaternion.fromArray(v.quaternion);c.zoom=v.zoom;c.updateProjectionMatrix();c.updateMatrixWorld(true);return c}
 async function screen(point){const c=await camera(),b=await canvas().boundingBox(),v=point.clone().project(c);return {x:b.x+(v.x+1)*b.width/2,y:b.y+(1-v.y)*b.height/2}}
 const models=createViewerModel(connected.current),board=models.find(p=>p.id===tileId)
 async function pickBoard(port){
  const hover=page.getByTestId('snap-port-hover'),name=port?'Fixed Port':'Fixed Tile';await picker(name).click()
  for(const view of ['前','顶','右','左','后']){
   await button(view).click();await frames()
   const c=await camera(),segment=port?snapPortSegment(board,port,c):null
   for(const t of [.5,.3,.7]){
    const point=segment?segment.p0.clone().lerp(segment.p1,t):board.transform.position.clone().add(new Vector3(t-.5,0,0))
    const p=await screen(point);await page.mouse.move(p.x,p.y);await page.waitForTimeout(80)
    if(port&&(!await hover.isVisible()||await hover.getAttribute('data-port-id')!==port))continue
    await page.mouse.click(p.x,p.y)
    if(await picker(name).getAttribute('aria-pressed')==='false')return
   }
  }
  throw Error('Cannot pick board '+(port??'Tile'))
 }
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?workspace=create&workspaceId=${f.projectId}&stage=assembly`
 await page.goto(url);await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());const baseline=await exported();assert.deepEqual(baseline,connected.current)
 await field('当前 Group').selectOption(targetRequest.moving.groupId);await button('Snap').click()
 await field('模块参考 Tile').selectOption(targetRequest.moving.tileId);await field('模块 Snap 移动 Port').selectOption(targetRequest.moving.portId);await field('模块 Snap 二面角').fill('-30');await field('模块 Snap Flip').check()
 const retained=async()=>{assert.equal(await field('Snap Moving 类型').inputValue(),'group');assert.equal(await field('Snap Moving Group').inputValue(),targetRequest.moving.groupId);assert.equal(await field('模块参考 Tile').inputValue(),targetRequest.moving.tileId);assert.equal(await field('模块 Snap 移动 Port').inputValue(),targetRequest.moving.portId);assert.equal(await field('模块 Snap 二面角').inputValue(),'-30');assert.equal(await field('模块 Snap Flip').isChecked(),true)}
 // Begin Fixed object pick at Group grain, then change grain while it is armed.
 await picker('Fixed Tile').click();await button('Tile').click();await page.getByTestId('snap-picker-active').waitFor();assert.equal(await picker('Fixed Tile').getAttribute('aria-pressed'),'true');await retained();assert.deepEqual(await exported(),baseline)
 // Toggle only cancels that pick. Re-arm and hit the real board in the existing Viewer.
 await picker('Fixed Tile').click();await pickBoard();await retained();assert.equal(await field('Snap Fixed 类型').inputValue(),'tile');assert.equal(await field('模块 Snap 固定 Tile').inputValue(),tileId);assert.equal(await preview().count(),0)
 await picker('Fixed Port').click();await button('Group').click();await page.getByTestId('snap-picker-active').waitFor();await retained();await page.keyboard.press('Escape');assert.equal(await picker('Fixed Port').getAttribute('aria-pressed'),'false')
 await button('Tile').click();await pickBoard('e0-p0');await retained();assert.equal(await field('模块 Snap 固定 Port').inputValue(),'e0-p0');assert.equal(await preview().count(),0,'Pick must never also run direct-click Snap');assert.deepEqual(await exported(),baseline)
 assert.match(await page.getByTestId('snap-moving-scope').innerText(),/整体移动 yellow-pole.*16 Tiles/)
 await button('预览模块吸附').click();await page.getByRole('alert').filter({hasText:/Group Snap 被验证拒绝.*穿透/}).waitFor();assert.equal(await preview().count(),0);assert.deepEqual(await exported(),baseline)
 await field('Tile Snap 验证模式').selectOption('less-strict');await button('预览模块吸附').click();await preview().waitFor();await page.getByRole('status',{name:'Snap 碰撞 Warning'}).waitFor();assert.match(await preview().innerText(),/Geometry Invalid/);assert.deepEqual(await exported(),baseline)
 // Grain changes do not invalidate a correctly computed preview or mutate the request.
 await button('Group').click();await retained();await preview().waitFor();await button('Tile').click();await preview().waitFor();assert.deepEqual(await exported(),baseline)
 await panel().scrollIntoViewIfNeeded();await page.screenshot({path:out+'/group-free-preview.png'})
 // Real input changes do invalidate it, including Port, angle, mode, scope, Flip.
 await field('模块 Snap 固定 Port').selectOption('e0-p1');assert.equal(await preview().count(),0);await field('模块 Snap 固定 Port').selectOption('e0-p0')
 await button('预览模块吸附').click();await preview().waitFor();await field('模块 Snap 二面角').fill('-29');assert.equal(await preview().count(),0);await field('模块 Snap 二面角').fill('-30')
 await button('预览模块吸附').click();await preview().waitFor();await field('Tile Snap 验证模式').selectOption('strict');assert.equal(await preview().count(),0);await field('Tile Snap 验证模式').selectOption('less-strict')
 await button('预览模块吸附').click();await preview().waitFor();await field('模块 Snap Flip').uncheck();assert.equal(await preview().count(),0);await field('模块 Snap Flip').check()
 await button('预览模块吸附').click();await preview().waitFor();await field('Snap Fixed 类型').selectOption('group');assert.equal(await preview().count(),0);await field('Snap Fixed 类型').selectOption('tile')
 await button('预览模块吸附').click();await preview().waitFor();await button('取消模块预览').click();assert.deepEqual(await exported(),baseline)
 await button('预览模块吸附').click();await preview().waitFor();await button('确认模块吸附（Geometry Invalid）').click();const snapped=await exported()
 const ids=new Set(baseline.modules[1].pieces.map(p=>p.id));assert.deepEqual(snapped.pieces.filter(p=>!ids.has(p.id)),baseline.pieces.filter(p=>!ids.has(p.id)));assert.deepEqual(snapped.connections.slice(0,97),baseline.connections);assert.deepEqual(snapped.modules.map(({frame,...m})=>m),baseline.modules.map(({frame,...m})=>m));assert.notDeepEqual(snapped.modules[1].frame,baseline.modules[1].frame);assert.equal(snapped.pieces.length,49);assert.equal(snapped.connections.length,98)
 const m=createViewerModel(snapped),residuals=computeAllConnectionResiduals(snapped.connections,Object.fromEntries(m.map(p=>[p.id,p.transform])),id=>m.find(p=>p.id===id)?.shape);assert.ok(residuals.every(r=>r.positionError<1e-8&&r.directionDot>1-1e-8&&r.dihedralError<1e-8));assert.equal(validateAssembly3D(snapped).valid,false)
 await button('3D Undo').click();assert.deepEqual(await exported(),baseline);await button('3D Redo').click();assert.deepEqual(await exported(),snapped)
 await button('保存 3D Draft').click();await until(()=>button('保存 3D Draft').isEnabled());await page.reload();await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());assert.deepEqual(await exported(),snapped)
 await field('当前 Group').selectOption('module-1');await button('Snap').click();assert.equal(await field('模块 Snap 固定 Tile').inputValue(),tileId);assert.equal(await field('模块 Snap 固定 Port').inputValue(),'e0-p0');assert.equal(await field('模块 Snap 移动 Port').inputValue(),'e2-p0');assert.equal(await field('模块 Snap 二面角').inputValue(),'-30');assert.equal(await field('Tile Snap 验证模式').inputValue(),'strict')
 // Tool exit cancels the picker, while a grain-only switch retains it. It never changes history.
 await picker('Fixed Tile').click();await button('Tile').click();await page.getByTestId('snap-picker-active').waitFor();await button('Move').click();assert.equal(await page.getByTestId('snap-picker-active').count(),0);await button('Group').click();await button('Snap').click()
 for(const width of [1840,1100,680,430]){await page.setViewportSize({width,height:1100});await stage(page,'assembly','inspector');await panel().scrollIntoViewIfNeeded();assert.equal(await panel().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:out+`/${width}.png`})}
 const saved=await f.api.dispatch('GET','assembly3d/records/'+baseline.id);assert.deepEqual(saved.snapshot.assembly,snapped);assert.deepEqual(saved.parent,active.parent);for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.deepEqual(errors,[])
 await writeFile(out+'/result.json',JSON.stringify({passed:true,tiles:49,connections:98,geometryValid:false,collisions:validateAssembly3D(snapped).issues.length,checks:['Fixed native Viewer Pick survives Group / Tile grain switch','Moving yellow Group / y07 Port / Dihedral / Flip preserved','Free board picked and Port exact; no simultaneous direct-click preview','Strict blocks, Less Strict warns; Group moves rigidly and Fixed red/green/board untouched','valid preview survives grain switch; actual scope/Port/angle/mode/Flip change invalidates','Confirm/Cancel/Esc/tool switch, Undo/Redo, save/refresh','exact anchors recover from saved external Connection','1840/1100/680/430 no overflow'],productionWrites:0,modelCalls:0,errors},null,2));console.log('PASS Snap session browser: '+out)

}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

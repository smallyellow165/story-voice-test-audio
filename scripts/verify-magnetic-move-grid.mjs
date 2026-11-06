import {moduleCenter} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {Quaternion} from 'three'
import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {OrthographicCamera,Vector3} from 'three'
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
import {stage} from './magnetic-studio-browser.mjs'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'connection-rotate-browser-')),out='/tmp/magnetic-move-grid',f=await combinedFreeFixture(dir),calls=[],errors=[]
const initial=f.combined,added=actions.addPieceAction(actions.createInitialHistory(initial.snapshot.assembly),canonicalProfileSnapshot(f.large),'#fc0303',[5.13,1.07,.11]),tileId=added.pieceId
const moved=actions.setPieceTransformAction(added.history,tileId,{position:[5.13,1.07,.11],quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/6).toArray()})
f.combined=await f.api.dispatch('POST','assembly3d/save',{snapshot:{...initial.snapshot,assembly:moved.current},expectedHash:initial.hash})
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
 const panel=()=>page.getByRole('region',{name:'Move 拖拽与网格',exact:true}),canvas=()=>page.locator('.magnetic-3d-editor-canvas canvas').filter({visible:true})
 async function frames(){await page.locator('.studio-workspace').evaluate(e=>e.scrollTop=0);await page.evaluate(()=>new Promise(resolve=>{let n=0;const frame=()=>++n===5?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame)}))}
 async function cameraState(){return JSON.parse(await page.getByLabel('3D Editor 相机状态',{exact:true}).textContent())}
 async function screen(point){const v=await cameraState(),f=v.frustum,c=new OrthographicCamera(f.left,f.right,f.top,f.bottom,f.near,f.far);c.position.fromArray(v.position);c.quaternion.fromArray(v.quaternion);c.zoom=v.zoom;c.updateProjectionMatrix();c.updateMatrixWorld(true);const b=await canvas().boundingBox(),p=point.clone().project(c);return {x:b.x+(p.x+1)*b.width/2,y:b.y+(1-p.y)*b.height/2}}
 const center=(a,group)=>group?moduleCenter(a,group):new Vector3(...a.pieces.find(p=>p.id===tileId).pose.position)
 const frame=(a,group,space)=>space==='global'?new Quaternion():new Quaternion(...(group?a.modules.find(m=>m.id===group).frame.quaternion:a.pieces.find(p=>p.id===tileId).pose.quaternion))
 async function restoreSelection(group){if(group){await button('Group').click();await field('当前 Group').selectOption(group)}else{await button('Tile').click();await page.locator(`[data-3d-piece="${tileId}"]`).click()}await button('Move').click()}
 async function nativeDrag({group=null,axis='X',step=.5,space='global',grid=true,cancel=false,plane=false,keep=false}={}){
  await restoreSelection(group);await field(group?'模块坐标系':'Move 坐标系').selectOption(space);await field('Move 拖拽约束').selectOption(axis)
  await field('Move Grid Snap').setChecked(grid);await field('Move 网格间距').fill(String(step));await field('Move 网格间距').blur()
  const before=await exported(),origin=center(before,group),q=frame(before,group,space),view=axis==='Z'||axis==='YZ'?'右':axis==='XZ'?'顶':'前'
  await button('Fit to View').click();await frames();await page.waitForTimeout(300);await button(view).click();await frames();const cameraBefore=await cameraState(),o=await screen(origin)
  const vectors=[...axis].map(key=>new Vector3(key==='X'?1:0,key==='Y'?1:0,key==='Z'?1:0).applyQuaternion(q))
  const dirs=await Promise.all(vectors.map(async v=>{const p=await screen(origin.clone().add(v)),n=Math.hypot(p.x-o.x,p.y-o.y);return {x:(p.x-o.x)/n,y:(p.y-o.y)/n}}))
  const handles=plane?[12,17,22,27,32].flatMap(r=>[[r,r],[-r,r],[r,-r],[-r,-r]]):[35,45,55,70,85,100].flatMap(r=>[[r,0],[-r,0]])
  for(const [radius,second] of handles){
   const d=dirs[0],e=plane?dirs[1]:{x:0,y:0},x=o.x+d.x*radius+e.x*second,y=o.y+d.y*radius+e.y*second
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+d.x*63+e.x*37,y+d.y*63+e.y*37,{steps:12});await frames()
   const out=await field('Move 世界位置').getAttribute('data-position'),live=out?.split(',').map(Number),delta=live?new Vector3(...live).distanceTo(origin):0
   if(delta>1e-5){
    assert.deepEqual(await cameraState(),cameraBefore,'object drag never changes camera')
    assert.deepEqual(await page.evaluate(id=>JSON.parse(Object.entries(localStorage).find(([k])=>k.includes(id)&&k.endsWith('working-draft'))[1]).assembly,f.projectId),before,'during drag, preview is not committed')
    if(cancel){if(cancel==='pointercancel')await canvas().dispatchEvent('pointercancel',{pointerId:1,button:0});else await page.keyboard.press('Escape');await page.mouse.move(x+d.x*90,y+d.y*90,{steps:3});await page.mouse.up();await frames();assert.deepEqual(await cameraState(),cameraBefore,'cancelled object drag must not turn into a camera drag');assert.deepEqual(await exported(),before);console.log('PASS cancel',group??'Tile',axis);return before}
    await page.mouse.up();await frames();const next=await exported();assert.equal(next.revision,before.revision+1);assert.deepEqual(next.connections,before.connections,'Move never creates or edits Connections')
    const actual=center(next,group),local=actual.clone().applyQuaternion(q.clone().invert()),old=origin.clone().applyQuaternion(q.clone().invert())
    for(const [i,key]of ['X','Y','Z'].entries())if(axis.includes(key)&&grid)assert.ok(Math.abs(local.getComponent(i)/step-Math.round(local.getComponent(i)/step))<1e-8,'origin grid '+key);else if(!axis.includes(key))assert.ok(Math.abs(local.getComponent(i)-old.getComponent(i))<1e-8,'locked coordinate '+key)
    if(group){const ids=new Set(before.modules.find(m=>m.id===group).pieces.map(p=>p.id)),offset=actual.clone().sub(origin);assert.deepEqual(next.pieces.filter(p=>!ids.has(p.id)),before.pieces.filter(p=>!ids.has(p.id)));for(const p of next.pieces.filter(p=>ids.has(p.id))){const b=before.pieces.find(x=>x.id===p.id);assert.ok(new Vector3(...p.pose.position).sub(new Vector3(...b.pose.position)).distanceTo(offset)<1e-8);assert.ok(new Quaternion(...p.pose.quaternion).angleTo(new Quaternion(...b.pose.quaternion))<1e-7)}}else{assert.deepEqual(next.modules,before.modules);assert.deepEqual(next.pieces.filter(p=>p.id!==tileId),before.pieces.filter(p=>p.id!==tileId));assert.deepEqual(next.pieces.find(p=>p.id===tileId).pose.quaternion,before.pieces.find(p=>p.id===tileId).pose.quaternion)}
    await button('3D Undo').click();assert.deepEqual(await exported(),before);await button('3D Redo').click();assert.deepEqual(await exported(),next);await button('3D Undo').click();assert.deepEqual(await exported(),before);if(keep){await button('3D Redo').click();assert.deepEqual(await exported(),next)}console.log('PASS native drag',group??'Tile',axis,space,step,grid);return next
   }
   await page.mouse.up();await frames();assert.deepEqual(await exported(),before,'missed handle leaves the Assembly exact');await button(view).click();await frames()
  }throw Error('No visible Move handle dragged: '+JSON.stringify({group,axis,step,space,plane}))
 }
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?workspace=create&workspaceId=${f.projectId}&stage=assembly`
 await page.goto(url);await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());const baseline=await exported();assert.equal(baseline.pieces.length,49);assert.equal(baseline.connections.length,96)
 await restoreSelection(null);assert.equal(await field('Move Grid Snap').isChecked(),false);assert.equal(await field('Move 网格间距').inputValue(),'0.5')
 // Settings / coordinate changes are preferences only, not transforms or Undo entries.
 await field('Move Grid Snap').check();await field('Move 网格间距').fill('0.25');await field('Move 坐标系').selectOption('local');await field('Move 拖拽约束').selectOption('Z');assert.deepEqual(await exported(),baseline);assert.equal(await button('3D Undo').isDisabled(),true)
 await field('Move 网格间距').fill('0');await panel().getByRole('alert').waitFor();await field('Move 网格间距').blur();assert.equal(await field('Move 网格间距').inputValue(),'0.25');assert.deepEqual(await exported(),baseline)
 const steps=process.argv.includes('--smoke')?[.5]:[.1,.25,.5,1]
 await nativeDrag({cancel:true});await nativeDrag({cancel:'pointercancel'})
 for(const step of steps)await nativeDrag({step})
 for(const axis of ['Y','Z'])await nativeDrag({axis})
 await nativeDrag({axis:'XY',plane:true});await nativeDrag({space:'local',step:.25});await nativeDrag({grid:false})
 const group='module-2'
 await nativeDrag({group,cancel:true});await nativeDrag({group,cancel:'pointercancel'})
 for(const step of steps)await nativeDrag({group,step})
 for(const axis of ['Y','Z'])await nativeDrag({group,axis})
 await nativeDrag({group,axis:'XZ',plane:true});await nativeDrag({group,space:'local',step:.25});await nativeDrag({group,space:'face',step:.5})
 // Ordinary camera orbit and right-button pan must not move the object, even with Grid enabled.
 await restoreSelection(null);await field('Move 拖拽约束').selectOption('XYZ');await button('Fit to View').click();await frames();const beforeCamera=await cameraState(),box=await canvas().boundingBox(),x=box.x+box.width*.08,y=box.y+box.height*.6
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+45,y+35,{steps:8});await page.mouse.up();await frames();assert.notDeepEqual(await cameraState(),beforeCamera);assert.deepEqual(await exported(),baseline)
 const beforePan=await cameraState();await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+40,y+20,{steps:8});await page.mouse.up({button:'right'});await frames();assert.notDeepEqual(await cameraState(),beforePan);assert.deepEqual(await exported(),baseline)
 // Numeric Move remains exact and independent of mouse Grid Snap.
 await restoreSelection(null);await field('3D 位置 X').fill('5.37');await field('3D 位置 X').press('Enter');assert.equal((await exported()).pieces.find(p=>p.id===tileId).pose.position[0],5.37);await button('3D Undo').click();assert.deepEqual(await exported(),baseline)
 await restoreSelection(group);await field('模块坐标系').selectOption('global');await field('模块轴').selectOption('x');await field('模块位移').fill('0.13');await button('移动 Group').click();const numeric=await exported();assert.ok(Math.abs(moduleCenter(numeric,group).x-moduleCenter(baseline,group).x-.13)<1e-8);assert.deepEqual(numeric.connections,baseline.connections);await button('3D Undo').click();assert.deepEqual(await exported(),baseline)
 await nativeDrag({step:.25,keep:true});const saved=await nativeDrag({group,axis:'Z',step:.5,keep:true})
 await button('保存 3D Draft').click();await until(()=>button('保存 3D Draft').isEnabled());await page.reload();await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());assert.deepEqual(await exported(),saved)
 await restoreSelection(group);for(const width of [1840,1100,680,430]){await page.setViewportSize({width,height:1100});await stage(page,'assembly','inspector');await panel().scrollIntoViewIfNeeded();assert.equal(await panel().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:out+`/${width}.png`})}
 await assert.rejects(f.api.dispatch('POST','assembly3d/save',{snapshot:{...active.snapshot,assembly:saved},expectedHash:active.hash}),e=>e.statusCode===409)
 const stored=await f.api.dispatch('GET','assembly3d/records/'+baseline.id);assert.deepEqual(stored.snapshot.assembly,saved);assert.deepEqual(stored.parent,active.parent);for(const [file,raw]of f.copied)assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.deepEqual(errors,[])
 await writeFile(out+'/result.json',JSON.stringify({passed:true,smoke:process.argv.includes('--smoke'),tiles:49,connections:96,checks:['existing Tile and Group Gizmos reused','real mouse drags at .1/.25/.5/1 world-origin grid','Global X/Y/Z and planes; Local and Face axis constraints','live uncommitted position, mouse-up confirm, Escape rollback','one-step Undo/Redo; numeric movement unaffected by Grid','exact fixed Parents and rigid moving Group, no Connection edits','object drag locks camera; empty-area orbit and right pan leave geometry exact','CAS save, refresh restore, narrow layouts'],modelCalls:0,productionWrites:0,errors},null,2));console.log('PASS Move + Grid browser: '+out)

}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

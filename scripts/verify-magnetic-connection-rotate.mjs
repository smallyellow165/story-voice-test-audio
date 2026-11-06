import * as actions from '../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {previewEdgeSnap,confirmEdgeSnap} from '../src/magnetic-tiles/three-d/editor-snap.ts'
import {createViewerModel as rotationModels} from '../src/magnetic-tiles/three-d/viewer-model.ts'
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
import {parentModule} from '../src/magnetic-tiles/three-d/combined-editing.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {stage} from './magnetic-studio-browser.mjs'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'connection-rotate-browser-')),out='/tmp/magnetic-connection-rotate',f=await combinedFreeFixture(dir),calls=[],errors=[]
const initial=f.combined,added=actions.addPieceAction(actions.createInitialHistory(initial.snapshot.assembly),canonicalProfileSnapshot(f.large),'#fc0303',[5,5,5]),tileId=added.pieceId
const joint={pieceA:f.roofId,portA:'e0-p0',pieceB:tileId,portB:'e2-p1',dihedralDeg:0,flip:true},connected=confirmEdgeSnap(added.history,previewEdgeSnap(added.history.current,joint,'less-strict'),'less-strict')
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
 const panel=()=>page.getByRole('region',{name:'Rotate 旋转轴',exact:true}),preview=()=>page.getByTestId('connection-rotation-preview')
 const parents=a=>({modules:a.modules,pieces:a.pieces.filter(p=>parentModule(a,p.id)),connections:a.connections.filter(c=>parentModule(a,c.pieceA)&&parentModule(a,c.pieceB))})
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?workspace=create&workspaceId=${f.projectId}&stage=assembly`
 await page.goto(url);await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());const baseline=await exported();assert.equal(baseline.pieces.length,49);assert.equal(baseline.connections.length,97)
 await button('Tile').click();await page.locator(`[data-3d-piece="${tileId}"]`).click();await button('Rotate').click();assert.equal(await field('Tile Rotate 旋转轴').inputValue(),'center');assert.equal(await field('3D 旋转 X').count(),1)
 // The original center-rotation controls still work and retain their old semantics.
 await field('3D 旋转 Z').fill('5');await field('3D 旋转 Z').press('Enter');const centerMoved=await exported();assert.notDeepEqual(centerMoved.pieces.at(-1).pose,baseline.pieces.at(-1).pose);assert.deepEqual(parents(centerMoved),parents(baseline));await button('3D Undo').click();assert.deepEqual(await exported(),baseline)
 await page.locator(`[data-3d-piece="${tileId}"]`).click();await button('Rotate').click();await field('Tile Rotate 旋转轴').selectOption('96');assert.equal(await field('3D 旋转 X').count(),0);assert.equal(await field('Tile Rotate 验证模式').inputValue(),'strict')
 await field('连接边旋转角度').fill('20');await preview().waitFor();await until(()=>button('确认旋转').isDisabled());await panel().getByRole('alert').waitFor();assert.match(await preview().innerText(),/验证阻断/);assert.deepEqual(await exported(),baseline)
 await field('Tile Rotate 验证模式').selectOption('less-strict');await until(()=>button('确认旋转').isEnabled());await page.getByRole('status',{name:'Rotate 碰撞 Warning'}).waitFor();assert.match(await panel().innerText(),/20.0000°/)
 for(const angle of [20,30,45,30.125]){await field('连接边旋转角度').fill(String(angle));await until(async()=>await preview().getAttribute('data-angle')===String(angle));assert.equal(await button('确认旋转').isEnabled(),true);assert.deepEqual(await exported(),baseline)}
 await field('连接边旋转步长').fill('0.5');await button('＋ 步长').click();await until(async()=>await preview().getAttribute('data-angle')==='30.625');await button('− 步长').click();await until(async()=>await preview().getAttribute('data-angle')==='30.125')
 await field('连接边旋转角度').fill('30');await until(async()=>await preview().getAttribute('data-angle')==='30');await panel().scrollIntoViewIfNeeded();await page.screenshot({path:out+'/preview-30.png'})
 await field('Tile Rotate 验证模式').selectOption('strict');await until(()=>button('确认旋转').isDisabled());assert.deepEqual(await exported(),baseline);await field('Tile Rotate 验证模式').selectOption('less-strict');await until(()=>button('确认旋转').isEnabled())
 await button('取消旋转').click();assert.equal(await preview().count(),0);assert.deepEqual(await exported(),baseline)
 await field('连接边旋转角度').fill('30');await preview().waitFor();await page.keyboard.press('Escape');assert.equal(await preview().count(),0);await button('预览旋转').click();await preview().waitFor();await button('确认旋转').click()
 const rotated=await exported();assert.deepEqual(parents(rotated),parents(baseline));assert.deepEqual(rotated.connections.slice(0,96),baseline.connections.slice(0,96));assert.ok(Math.abs(rotated.connections[96].dihedralDeg-30)<1e-8);assert.equal(rotated.connections.length,97)
 const models=rotationModels(rotated),rs=computeAllConnectionResiduals(rotated.connections,Object.fromEntries(models.map(m=>[m.id,m.transform])),id=>models.find(m=>m.id===id)?.shape);assert.ok(rs.every(r=>r.positionError<1e-8&&r.directionDot>1-1e-8&&r.dihedralError<1e-8));assert.ok(Math.abs(rotated.pieces.at(-1).pose.position[1]-2.53)<1e-8)
 assert.equal(validateAssembly3D(rotated).valid,false);await field('连接边旋转角度').fill('10');await until(async()=>await preview().getAttribute('data-angle')==='10');assert.match(await panel().innerText(),/40.0000°/);await button('取消旋转').click();assert.deepEqual(await exported(),rotated)
 await button('3D Undo').click();assert.deepEqual(await exported(),baseline);await button('3D Redo').click();assert.deepEqual(await exported(),rotated)
 await button('保存 3D Draft').click();await until(()=>button('保存 3D Draft').isEnabled());await page.reload();await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());assert.deepEqual(await exported(),rotated)
 await button('Tile').click();await page.locator(`[data-3d-piece="${tileId}"]`).click();await button('Rotate').click();await field('Tile Rotate 旋转轴').selectOption('96');assert.equal(await field('Tile Rotate 验证模式').inputValue(),'strict');assert.match(await panel().innerText(),/30.0000°/)
 await field('Tile Rotate 验证模式').selectOption('less-strict');await field('连接边旋转角度').fill('5');await until(()=>button('确认旋转').isEnabled());await field('Tile Rotate 旋转轴').selectOption('center');assert.equal(await preview().count(),0);assert.equal(await field('3D 旋转 X').count(),1);assert.deepEqual(await exported(),rotated)
 await field('Tile Rotate 旋转轴').selectOption('96');for(const width of [1840,1100,680,430]){await page.setViewportSize({width,height:1100});await stage(page,'assembly','inspector');await panel().scrollIntoViewIfNeeded();assert.equal(await panel().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:out+`/${width}.png`})}
 const saved=await f.api.dispatch('GET','assembly3d/records/'+baseline.id);assert.deepEqual(saved.snapshot.assembly,rotated);assert.deepEqual(saved.parent,active.parent)
 for(const [file,raw]of f.copied){assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.equal(await readFile(path.join(dir,file),'utf8'),raw)}assert.deepEqual(errors,[])
 await writeFile(out+'/result.json',JSON.stringify({passed:true,tiles:49,connections:97,dihedral:rotated.connections[96].dihedralDeg,geometryValid:false,checks:['original center Rotate controls preserved','Connection axis uses real fixed Port and locks center Gizmo','20 / 30 / 45 / fractional angles update uncommitted preview','Strict blocks; Less Strict shows collision Warning','small steps, policy changes, Cancel / Escape / repreview','one Tile and one Dihedral change; exact Ports and frozen Parents','Undo / Redo, CAS save, refresh','confirmed pose becomes the next relative-angle baseline','1840/1100/680/430 compact layout'],modelCalls:0,productionWrites:0,errors},null,2));console.log('PASS Connection Rotate browser: '+out)
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

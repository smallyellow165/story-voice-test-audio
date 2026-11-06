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

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'less-strict-browser-')),out='/tmp/magnetic-less-strict',f=await combinedFreeFixture(dir),calls=[],errors=[]
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
 await page.addInitScript(entries=>{if(sessionStorage.getItem('less-strict-seed'))return;for(const [k,v]of entries)localStorage.setItem(k,v);sessionStorage.setItem('less-strict-seed','1')},[...map])
 const button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}),field=name=>page.getByLabel(name,{exact:true}).filter({visible:true})
 async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI did not settle')}
 async function open(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function exported(){await open(page.locator('.magnetic-3d-load'));const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 const preview=()=>page.getByRole('region',{name:'3D 吸附预览',exact:true}),warning=()=>page.getByRole('status').filter({hasText:/Warning · .*实体碰撞/})
 const parents=a=>({modules:a.modules,pieces:a.pieces.filter(p=>parentModule(a,p.id)),connections:a.connections.filter(c=>parentModule(a,c.pieceA)&&parentModule(a,c.pieceB))})
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?workspace=create&workspaceId=${f.projectId}&stage=assembly`
 await page.goto(url);await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());const original=await exported();assert.equal(original.pieces.length,48);assert.equal(original.connections.length,96)
 await open(page.locator('.magnetic-3d-edit-tools'));await open(page.locator('details').filter({has:page.locator(':scope>summary').getByText('从 Tiles Catalog 添加',{exact:true})}));await field('3D Catalog Profile').selectOption('large-square@1');await button('添加 3D 零件').click();await page.getByTestId('combined-free-tile').waitFor();await button('Snap').click()
 assert.equal(await field('Tile Snap 验证模式').inputValue(),'strict')
 await field('3D 自身端口 B').selectOption('e2-p1');await field('3D 目标零件 A').selectOption(f.roofId);await field('3D 目标端口 A').selectOption('e0-p0');await field('新连接二面角').fill('0');await field('新连接 flip').check()
 const before=await exported(),id=before.pieces.find(p=>!original.pieces.some(q=>q.id===p.id)).id
 await button('预览吸附').click();await page.getByRole('alert').filter({hasText:/严格验证拒绝.*穿透/}).waitFor();assert.equal(await preview().count(),0);assert.deepEqual(await exported(),before)
 await field('Tile Snap 验证模式').selectOption('less-strict');await button('预览吸附').click();await preview().waitFor();const diagnostics=page.getByRole('status',{name:'Snap 碰撞 Warning'});await diagnostics.waitFor();assert.match(await diagnostics.innerText(),/m0-p0-r01/);assert.match(await diagnostics.innerText(),/m0-p1-r02/);assert.match(await diagnostics.innerText(),/Depth/);assert.match(await preview().innerText(),/Geometry Invalid/);assert.equal(await diagnostics.locator('.magnetic-3d-blocker').count(),0);assert.deepEqual(await exported(),before)
 const warnColor=await diagnostics.evaluate(e=>getComputedStyle(e).color);assert.notEqual(warnColor,'rgb(185, 28, 28)')
 await page.getByRole('region',{name:'Current Tool',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/preview.png'})
 // Mode, angle, Flip, target and moving Port edits invalidate the old preview.
 await field('Tile Snap 验证模式').selectOption('strict');assert.equal(await preview().count(),0);assert.equal(await button('确认吸附').count(),0);assert.deepEqual(await exported(),before)
 await field('Tile Snap 验证模式').selectOption('less-strict');await button('预览吸附').click();await preview().waitFor();await field('新连接二面角').fill('90');assert.equal(await preview().count(),0)
 await button('预览吸附').click();await page.getByRole('alert').filter({hasText:/相同空间方向占位/}).waitFor();assert.equal(await preview().count(),0);assert.deepEqual(await exported(),before)
 await field('新连接二面角').fill('0');await button('预览吸附').click();await preview().waitFor();await field('新连接 flip').uncheck();assert.equal(await preview().count(),0);await field('新连接 flip').check()
 await button('预览吸附').click();await preview().waitFor();await field('3D 自身端口 B').selectOption('e2-p0');assert.equal(await preview().count(),0);await field('3D 自身端口 B').selectOption('e2-p1')
 await button('预览吸附').click();await preview().waitFor();await field('3D 目标端口 A').selectOption('e1-p0');assert.equal(await preview().count(),0);await field('3D 目标端口 A').selectOption('e0-p0')
 await button('预览吸附').click();await preview().waitFor();await button('取消吸附').click();assert.equal(await preview().count(),0);assert.deepEqual(await exported(),before)
 await button('预览吸附').click();await preview().waitFor();await button('确认吸附').click();const snapped=await exported(),report=validateAssembly3D(snapped)
 assert.equal(snapped.pieces.length,49);assert.equal(snapped.connections.length,97);assert.deepEqual(snapped.connections.at(-1),{pieceA:f.roofId,portA:'e0-p0',pieceB:id,portB:'e2-p1',dihedralDeg:0,flip:true});assert.equal(report.valid,false);assert.ok(report.issues.every(i=>i.code==='intersection'));assert.deepEqual(parents(snapped),parents(original));assert.match(await page.locator('.magnetic-3d-summary').innerText(),/Geometry Invalid/);assert.equal(await page.locator('.magnetic-3d-summary .magnetic-3d-blocker').count(),0)
 await button('3D Undo').click();assert.deepEqual(await exported(),before);await button('3D Redo').click();assert.deepEqual(await exported(),snapped)
 await button('Revalidate Geometry').click();assert.deepEqual(await exported(),snapped);assert.match(await page.locator('.magnetic-3d-summary').innerText(),/Geometry Invalid/)
 await button('保存 3D Draft').click();await until(()=>button('保存 3D Draft').isEnabled());await page.reload();await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());assert.deepEqual(await exported(),snapped);assert.deepEqual(validateAssembly3D(await exported()),report)
 await button('Tile').click();await page.locator(`[data-3d-piece="${id}"]`).click();await button('Snap').click();assert.equal(await field('Tile Snap 验证模式').inputValue(),'strict');await field('Tile Snap 验证模式').selectOption('less-strict');await button('Revalidate Geometry').click();assert.equal(await page.getByRole('region',{name:'Geometry Check',exact:true}).locator('.magnetic-3d-blocker').count(),0);assert.deepEqual(await exported(),snapped)
 for(const width of [1840,1100,680,430]){await page.setViewportSize({width,height:1100});await stage(page,'assembly','inspector');await field('Tile Snap 验证模式').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:out+`/${width}.png`})}
 const saved=await f.api.dispatch('GET','assembly3d/records/'+original.id);assert.deepEqual(saved.snapshot.assembly,snapped);assert.deepEqual(saved.parent,active.parent)
 for(const [file,raw]of f.copied){assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.equal(await readFile(path.join(dir,file),'utf8'),raw)}assert.deepEqual(errors,[])
 await writeFile(out+'/result.json',JSON.stringify({passed:true,tiles:49,connections:97,geometryValid:false,collisions:report.issues.length,checks:['default Strict rejects collision; Less Strict previews without altering Draft','neutral full collision Warning for r01 and r02; real Invalid retained','policy / angle / Flip / Port changes discard preview','Less Strict still rejects spatial direction conflict','confirm / cancel / Undo / Redo preserve Parents and real Connection','Invalid Draft saves and restores exact Pose / Connection / diagnostics','refresh defaults to Strict; Revalidate uses unchanged Validator','1840/1100/680/430 no overflow'],modelCalls:0,productionWrites:0,errors},null,2));console.log('PASS Less Strict browser: '+out)
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

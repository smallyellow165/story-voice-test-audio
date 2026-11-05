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

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'combined-free-browser-')),out='/tmp/magnetic-combined-free',f=await combinedFreeFixture(dir),calls=[],errors=[]
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
 await page.addInitScript(entries=>{if(sessionStorage.getItem('combined-free-seed'))return;for(const [k,v]of entries)localStorage.setItem(k,v);sessionStorage.setItem('combined-free-seed','1')},[...map])
 const button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}),field=name=>page.getByLabel(name,{exact:true}).filter({visible:true})
 async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI did not settle')}
 async function open(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function exported(){await open(page.locator('.magnetic-3d-load'));const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 const parents=a=>({modules:a.modules,pieces:a.pieces.filter(p=>parentModule(a,p.id)),connections:a.connections.filter(c=>parentModule(a,c.pieceA)&&parentModule(a,c.pieceB))})
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?workspace=create&workspaceId=${f.projectId}&stage=assembly`
 await page.goto(url);await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());const original=await exported();assert.equal(original.pieces.length,48);assert.equal(original.connections.length,96);assert.equal(await button('Group').getAttribute('aria-pressed'),'true')
 await open(page.locator('.magnetic-3d-edit-tools'));await open(page.locator('details').filter({has:page.locator(':scope>summary').getByText('从 Tiles Catalog 添加',{exact:true})}));await field('3D Catalog Profile').selectOption('large-square@1');await button('添加 3D 零件').click()
 await page.getByTestId('combined-free-tile').waitFor();assert.equal(await button('Tile').getAttribute('aria-pressed'),'true');let a=await exported();const id=a.pieces.find(p=>!original.pieces.some(q=>q.id===p.id)).id;assert.equal(a.pieces.length,49);assert.deepEqual(parents(a),parents(original))
 await field('3D 位置 X').fill('8');await field('3D 位置 X').press('Enter');await field('3D 位置 Y').fill('7');await field('3D 位置 Y').press('Enter');await field('3D 位置 Z').fill('8');await field('3D 位置 Z').press('Enter')
 await button('Rotate').click();await field('3D 旋转 Y').fill('30');await field('3D 旋转 Y').press('Enter');await button('Orient').click();await button('所选面朝上').click();await button('Snap').click();await field('3D 吸附方式').selectOption('click')
 await field('3D 目标零件 A').selectOption(f.roofId);await field('3D 目标端口 A').selectOption('e0-p0');await field('3D 自身端口 B').selectOption('e0-p0');await field('新连接二面角').fill('0');await field('新连接 flip').uncheck()
 const before=await exported();await button('预览吸附').click();await page.getByRole('alert').filter({hasText:/穿透|冲突/}).waitFor();assert.deepEqual(await exported(),before)
 await field('3D 自身端口 B').selectOption('e0-p1');await field('新连接二面角').fill('90');await button('预览吸附').click();await page.getByRole('region',{name:'3D 吸附预览',exact:true}).waitFor();assert.deepEqual(await exported(),before);await button('确认吸附').click();a=await exported();assert.equal(a.connections.length,97);assert.equal(validateAssembly3D(a).valid,true);assert.deepEqual(parents(a),parents(original));const snapped=a
 await button('3D Undo').click();assert.deepEqual(await exported(),before);await button('3D Redo').click();assert.deepEqual(await exported(),snapped);await button('Revalidate Geometry').click();assert.deepEqual(await exported(),snapped);assert.match(await page.locator('.magnetic-3d-summary').innerText(),/Geometry Valid/)
 // Copy is a new independent Tile; delete removes only its own connections.
 await page.locator(`[data-3d-piece="${id}"]`).click();await button('Copy').click();assert.equal((await exported()).pieces.length,50);await button('3D Undo').click();await page.locator(`[data-3d-piece="${id}"]`).click();await button('Delete').click();a=await exported();assert.equal(a.pieces.length,48);assert.equal(a.connections.length,96);await button('3D Undo').click();assert.deepEqual(await exported(),snapped)
 // Second endpoint cannot pull a connected free Tile or either Group.
 await page.locator(`[data-3d-piece="${id}"]`).click();await button('Snap').click();const yellow=original.modules.find(m=>m.name==='yellow-pole'),target=yellow.pieces.find(p=>p.sourceId==='y07').id
 await field('3D 目标零件 A').selectOption(target);await field('3D 目标端口 A').selectOption('e0-p0');await field('3D 自身端口 B').selectOption('e2-p0');await button('预览吸附').click();await page.getByRole('alert').filter({hasText:/仍有连接/}).waitFor();assert.deepEqual(await exported(),snapped)
 await button('仅建立约束（不移动）').click();const diagnostic=await exported();assert.equal(diagnostic.connections.length,98);assert.equal(validateAssembly3D(diagnostic).valid,false);assert.deepEqual(parents(diagnostic),parents(original));await button('3D Undo').click();assert.deepEqual(await exported(),snapped)
 // Parent single-Tile transforms/internal connection edits are protected.
 await page.locator(`[data-3d-piece="${f.roofId}"]`).click();assert.equal(await button('Move').isDisabled(),true);await page.locator('[data-3d-connection="0"]').first().click();await page.getByRole('region',{name:'Current Tool'}).getByText(/Parent 内部 Connection/).waitFor();assert.equal(await button('删除连接').count(),0)
 await page.locator(`[data-3d-piece="${id}"]`).click();await button('Move').click();await button('保存 3D Draft').click();await until(()=>button('保存 3D Draft').isEnabled());await page.reload();await stage(page,'assembly');await until(()=>button('保存 3D Draft').isEnabled());assert.deepEqual(await exported(),snapped);await page.locator(`[data-3d-piece="${id}"]`).click();await page.getByTestId('combined-free-tile').waitFor();await button('Move').click()
 await page.locator('.magnetic-3d-load > summary').click();await button('Fit to View').click();await page.getByRole('region',{name:'Current Tool',exact:true}).scrollIntoViewIfNeeded()
 for(const width of [1840,1100,680]){await page.setViewportSize({width,height:1100});await stage(page,'assembly','workspace');await page.locator('.magnetic-3d-assembly-actions').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:out+`/${width}.png`})}
 const saved=await f.api.dispatch('GET','assembly3d/records/'+ref.id);assert.deepEqual(saved.parent,active.parent);assert.deepEqual(saved.snapshot.photoOrigin.origin,active.snapshot.photoOrigin.origin);await writeFile(out+'/saved-temporary-snapshot.json',JSON.stringify(saved,null,2))
 for(const [file,raw]of f.copied){assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.equal(await readFile(path.join(dir,file),'utf8'),raw)}assert.deepEqual(errors,[])
 await writeFile(out+'/result.json',JSON.stringify({passed:true,start:{tiles:48,connections:96},finish:{tiles:49,connections:97,geometryValid:true},checks:['Group-mode Insert from exact large-square@1 Profile','automatic free Tile / Move selection','Move Rotate Orient controls','invalid Snap leaves Draft intact','legal red roof Snap preview/confirm','exact fixed Parent poses, membership, internal joints and registration lineage','Copy/Delete and Undo/Redo','mismatched second Group endpoint diagnosis without any Group movement','Parent single-Tile/internal Connection protection','CAS save and refresh of free Tile and links','1840/1100/680 no overflow'],registrationCalls:0,modelCalls:0,productionWrites:0,errors},null,2));console.log('PASS Combined free Tile browser: '+out)
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''));}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

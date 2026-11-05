import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
import {sceneRegistrationFixture} from '../test/magnetic-scene-registration-fixture.mjs'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'
import {workspaceStore,rememberSavedAssembly,WORKSPACE_RECORD_KEY,WORKSPACE_HEAD_KEY} from '../src/magnetic-tiles/workspace-context.ts'
import {restoreAssemblySnapshot} from '../src/magnetic-tiles/three-d/assembly-library.ts'
import {emptyWorkflowDraft} from '../src/magnetic-tiles/three-d/reconstruction/workflow-draft.ts'
import {touchDraftProject,WORKFLOW_DRAFT_KEY} from '../src/magnetic-tiles/draft-projects.ts'
import {stage} from './magnetic-studio-browser.mjs'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'registration-browser-')),out='/tmp/magnetic-scene-registration-v1',f=await sceneRegistrationFixture(dir),calls=[],errors=[]
const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},context={mode:'create',id:f.projectId},scoped=workspaceStore(storage,context),active=f.records[0],o=active.snapshot.photoOrigin.origin
scoped.setItem('binding',canonical(context));restoreAssemblySnapshot(scoped,active,{raw:null,policy:null,origin:null});for(const p of f.parents)rememberSavedAssembly(scoped,p);scoped.setItem(WORKSPACE_RECORD_KEY,JSON.stringify(f.parents[0]));scoped.setItem(WORKSPACE_HEAD_KEY,JSON.stringify(f.parents[0]))
const draft=emptyWorkflowDraft(f.projectId),head=JSON.parse(await readFile(path.join(dir,`visible3d/heads/${f.projectId}/${f.source.id}.json`))),review=JSON.parse(f.copied.get(`visible3d/reviews/${o.reviewId}.json`))
Object.assign(draft,{source:{id:f.source.id,hash:f.source.hash},inputSource:{id:f.source.id,hash:f.source.hash},head,form:review.input.review});scoped.setItem(WORKFLOW_DRAFT_KEY,JSON.stringify(draft));scoped.setItem('history',JSON.stringify({refs:[...f.copied.entries()].filter(([file])=>/^visible3d\/(analyses|reviews|plans|executions)\//.test(file)).map(([,raw])=>{const r=JSON.parse(raw);return {id:r.id,hash:r.hash}}),requestIds:[]}));touchDraftProject(storage,f.projectId,{name:'Truck-Ramp isolated test',stage:'assembly'})
let server,browser,page,failNext=false
try{
 await mkdir(out,{recursive:true})
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'vite'),server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-registration',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push([req.method,route]);try{
   if(req.method!=='GET'&&!route.startsWith('scene-registration/')&&!['assembly3d/save','assembly3d/combine','assembly3d/snapshot-check',`visible3d/project/${f.projectId}/workspace-history`].includes(route))throw Error('Forbidden non-registration mutation: '+route)
   if(failNext&&route==='scene-registration/run'){failNext=false;throw Object.assign(Error('测试输入已过期；未修改当前 Draft'),{statusCode:409})}
   let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await f.api.dispatch(req.method,route,raw?JSON.parse(raw):{})))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1840,height:1100},acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.addInitScript(entries=>{if(sessionStorage.getItem('scene-seeded'))return;for(const [k,v]of entries)localStorage.setItem(k,v);sessionStorage.setItem('scene-seeded','1')},[...map])
 const button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}),field=name=>page.getByLabel(name,{exact:true}).filter({visible:true}),panel=()=>page.getByRole('region',{name:'创建 Combined Assembly',exact:true})
 async function until(fn){for(let i=0;i<400;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI did not settle')}
 async function exported(){const d=page.locator('.magnetic-3d-load');if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click();const next=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await next).path(),'utf8'))}
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?workspace=create&workspaceId=${f.projectId}&stage=assembly`
 await page.goto(url);await stage(page,'assembly');await button('保存 3D Draft').waitFor();await until(()=>button('保存 3D Draft').isEnabled());assert.deepEqual(await exported(),active.snapshot.assembly)
 assert.equal(await page.getByRole('region',{name:'Assembly Selector'}).getByRole('button',{name:'新建 Combined Assembly'}).count(),0)
 await button('新建 Combined Assembly').click();for(const r of f.records)await field('组合来源 '+r.name).check();await until(()=>button('Auto Align from Photo').isEnabled());assert.equal(await field('Scene Registration 参考照片').inputValue(),f.source.images.find(i=>i.name==='Truck-Ramp/2.png').sourceId)
 // A failed run leaves the current editing document intact and can be retried.
 failNext=true;await button('Auto Align from Photo').click();await panel().getByRole('alert').waitFor();assert.deepEqual(await exported(),active.snapshot.assembly);await button('Auto Align from Photo').click();await page.getByTestId('scene-registration-quality').waitFor();assert.match(await page.getByTestId('scene-registration-quality').innerText(),/2\.15 px.*2\.42 px.*48 Tiles/)
 await panel().locator('canvas').waitFor();await panel().getByRole('img',{name:'Scene Registration 照片投影'}).waitFor();assert.equal(await panel().locator('polygon').count(),24);assert.deepEqual(await exported(),active.snapshot.assembly)
 const registered=await f.api.dispatch('GET','scene-registration/records/'+await field('已保存 Scene Registration').inputValue());await writeFile(out+'/registration-result.json',JSON.stringify(registered,null,2))
 for(const width of [1840,1100,680]){await page.setViewportSize({width,height:1100});await stage(page,'assembly');await panel().scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await panel().screenshot({path:out+`/preview-${width}.png`})}
 await page.setViewportSize({width:1840,height:1100});await button('取消预览').click();assert.equal(await page.getByTestId('scene-registration-quality').count(),0);await field('已保存 Scene Registration').selectOption({index:1});await page.getByTestId('scene-registration-quality').waitFor()
 await button('采用布局并创建').click();await until(async()=>(await exported()).id.startsWith('combined-'));const combined=await exported();assert.equal(combined.pieces.length,48);assert.equal(combined.connections.length,96);assert.equal(combined.modules.length,3);assert.match(await page.locator('.magnetic-3d-summary').innerText(),/Geometry Valid/)
 await page.getByLabel('当前 Group',{exact:true}).selectOption('module-1');await button('Move').click();const prior=await exported();await field('模块位移').fill('.1');await button('移动 Group').click();const moved=await exported();assert.notDeepEqual(moved,prior);await button('3D Undo').click();assert.deepEqual(await exported(),prior);await button('3D Redo').click();assert.deepEqual(await exported(),moved)
 await button('保存 3D Draft').click();await until(()=>button('保存 3D Draft').isEnabled());await page.reload();await stage(page,'assembly');await until(async()=>(await exported()).id===combined.id);assert.deepEqual(await exported(),moved)
 await page.screenshot({path:out+'/combined-editor.png'});for(const [file,raw]of f.copied){assert.equal(await readFile(path.join(f.official,file),'utf8'),raw);assert.equal(await readFile(path.join(dir,file),'utf8'),raw)}assert.deepEqual(errors,[])
 await writeFile(out+'/result.json',JSON.stringify({passed:true,tiles:48,connections:96,quality:'2.15 px edges / 2.42 px BBox crosscheck',checks:['Create Workspace fixed ownership','middle action entry, no sidebar duplicate','all three saved parents and exact common image','409 run failure leaves Draft intact','photo overlay + complete scene preview without parent editing','1840/1100/680 no overflow','cancel and explicitly restore independent result','adopt creates Combined with 48 tiles / 96 joints','Group manual movement, Undo/Redo, CAS save, reload','all original input files byte-identical'],modelCalls:0,formalWrites:0,errors,calls},null,2));console.log('PASS Scene Registration browser: '+out)
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''));}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

// Isolated HTTP + Chrome UI acceptance. Files and records live only in /tmp.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,mkdir,readFile,writeFile,copyFile,readdir,rename,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {selectedProject} from '../test/magnetic-selected-project-fixture.mjs'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-library-ui-')),lib=path.join(dir,'images'),store=path.join(dir,'store'),out='/tmp/magnetic-library-ui'
const api=createMagneticIntake(store,{libraryDirectory:lib}),fixture=await selectedProject(api),calls=[],errors=[],metrics=[]
let server,browser,page
try{
 for(const folder of ['car/details','castle','empty'])await mkdir(path.join(lib,folder),{recursive:true})
 await mkdir(out,{recursive:true})
 const originals=path.join(root,'public/test-images/maganetic'),names=['root.png','car/front.png','castle/front.png','car/details/rear.png']
 for(const [i,name] of names.entries())await copyFile(path.join(originals,['car-all.png','car-1.png','car-2.png','car-3.png'][i]),path.join(lib,name))
 for(let i=0;i<36;i++)await copyFile(path.join(lib,'root.png'),path.join(lib,`root-photo-${String(i).padStart(2,'0')}.png`))
 const longName='very-long-image-name-'.repeat(10)+'.png';await copyFile(path.join(lib,'root.png'),path.join(lib,longName))
 const oldRecords={};async function capture(d){for(const e of await readdir(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await capture(p);else oldRecords[p]=await readFile(p,'utf8')}}await capture(store)
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-library-api',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
   const route=req.url.slice(1).split('?')[0];calls.push([req.method,route])
   try{
    if(req.method!=='GET'&&!['library-image','sources','source-sets','visible3d/workspace-history','visible3d/annotate','visible3d/selected'].includes(route))throw Error('No model calls or unrelated writes allowed: '+route)
    let raw='';for await(const c of req)raw+=c
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{})))
   }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
  })
 }}]});await server.listen()
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/`
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1550,height:1100}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 const button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}),field=name=>page.getByLabel(name,{exact:true}).filter({visible:true})
 const check=name=>page.getByRole('checkbox',{name:'加入 '+name,exact:true}),list=()=>page.getByRole('region',{name:'服务器图片列表',exact:true})
 async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI state did not settle')}
 async function ready(){await page.getByTestId('studio-workspace-context').waitFor();await page.locator('[data-stage="source"]').click();await button('刷新 Server Library').waitFor();await until(()=>button('刷新 Server Library').isEnabled());await check('root.png').waitFor()}
 async function currentSource(){const id=await page.evaluate(()=>{const p=new URL(location.href).searchParams,key='magnetic-studio.workspace.v1.create.'+p.get('workspaceId')+'.magnetic-visible3d-context.v1';return JSON.parse(localStorage.getItem(key)||'null')?.sourceId});return id?api.dispatch('GET','sources/'+id):null}
 async function selected(n){await page.getByText('本次 Analysis · '+n+'/4',{exact:true}).waitFor();await until(async()=>!n?await currentSource()===null:(await currentSource())?.images.length===n);await until(()=>button('刷新 Server Library').isEnabled())}
 async function layout(label,minHeight){
  const tabs=await page.getByRole('tablist',{name:'右栏工具',exact:true}).boundingBox(),trace=await button('Trace / Raw').boundingBox(),box=await list().boundingBox()
  assert.ok(Math.abs(tabs.y-trace.y)<=3,label+' Trace alignment');assert.ok(trace.x>=tabs.x+tabs.width,label+' Trace right alignment')
  assert.ok(box.height>=minHeight,label+' library height '+box.height)
  const dimensions=await page.locator('.studio-inspector').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight}))
  assert.ok(dimensions.scrollWidth<=dimensions.width+2,label+' horizontal overflow')
  assert.ok(await list().evaluate(e=>e.scrollHeight>e.clientHeight),label+' internal list scrolling')
  metrics.push({label,listHeight:Math.round(box.height),inspector:dimensions})
 }
 await page.goto(base+'magnetic-gallery.html');await page.evaluate(sourceId=>{localStorage.setItem('magnetic-visible3d-context.v1',JSON.stringify({sourceId}));localStorage.setItem('unrelated-draft','keep me')},fixture.source.id)
 await page.goto(base+'magnetic-tiles.html?workspace=create');await ready()
 const aUrl=page.url();assert.equal(await page.getByRole('tab',{name:'服务器图片',exact:true}).getAttribute('aria-selected'),'true')
 await layout('desktop',420)
 assert.ok((await button('刷新 Server Library').boundingBox()).height<=30);assert.ok((await field('搜索服务器图片').boundingBox()).height<=30)
 await list().locator('img').first().waitFor();await until(()=>list().locator('img').first().evaluate(e=>e.naturalWidth>0))
 await page.screenshot({path:out+'/desktop.png',fullPage:true})
 await button('Trace / Raw').click();await page.getByRole('dialog',{name:'Magnetic Tiles Trace',exact:true}).waitFor();await button('关闭 Trace').click()
 assert.equal(await currentSource(),null,'Create must not restore global historical source')
 await check('root.png').click();await selected(1)
 await button('打开文件夹 car').click();await check('car/front.png').click();await selected(2)
 await button('打开文件夹 car/details').click();await check('car/details/rear.png').click();await selected(3)
 await page.getByRole('navigation',{name:'服务器图片文件夹'}).getByRole('button',{name:'图库',exact:true}).click();await button('打开文件夹 castle').click()
 assert.equal(await check('castle/front.png').isChecked(),false,'same basename in a different folder is a distinct input')
 await check('castle/front.png').click();await selected(4)
 const four=await currentSource();assert.deepEqual(new Set(four.images.map(i=>i.name)),new Set(names))
 await field('搜索服务器图片').fill('front.png');await check('car/front.png').waitFor();assert.equal(await check('car/front.png').isChecked(),true);assert.equal(await check('castle/front.png').isChecked(),true)
 await check('car/front.png').click();await selected(3);assert.equal(await check('castle/front.png').isChecked(),true);await check('car/front.png').click();await selected(4)
 await field('搜索服务器图片').fill('car/details');await check('car/details/rear.png').waitFor();assert.equal(await list().getByRole('checkbox').count(),1)
 await field('搜索服务器图片').fill('root-photo');assert.equal(await check('root-photo-00.png').isDisabled(),true,'maximum four images remains enforced')
 await field('搜索服务器图片').fill('castle/');await copyFile(path.join(lib,'root.png'),path.join(lib,'castle','new.png'));await button('刷新 Server Library').click();await check('castle/new.png').waitFor();assert.equal(await check('castle/front.png').isChecked(),true)
 const before=await currentSource();await rename(path.join(lib,'car','front.png'),path.join(lib,'car','renamed.png'));await button('刷新 Server Library').click();await until(()=>button('刷新 Server Library').isEnabled());assert.deepEqual(await currentSource(),before)
 for(const image of before.images)assert.ok((await api.dispatch('GET','image/'+image.sourceId)).imageBase64,'saved input remains readable after a file rename')
 await field('搜索服务器图片').fill('');await page.getByRole('navigation',{name:'服务器图片文件夹'}).getByRole('button',{name:'图库',exact:true}).click()
 for(const [width,height,min] of [[1100,900,250],[680,900,230],[390,844,180]]){
  await page.setViewportSize({width,height});if(width<=760&&!await page.locator('.studio-inspector').isVisible()){if(await button('检查器').count())await button('检查器').click();else await button('查看检查器').click()}
  await layout(String(width),min);await page.screenshot({path:out+`/width-${width}.png`,fullPage:true})
 }
 await page.setViewportSize({width:1550,height:1100});await page.goto(base+'magnetic-tiles.html?workspace=create');await ready();const bUrl=page.url();assert.notEqual(new URL(aUrl).searchParams.get('workspaceId'),new URL(bUrl).searchParams.get('workspaceId'));assert.equal(await currentSource(),null)
 await page.goto(aUrl);await ready();await selected(4);assert.equal((await currentSource()).hash,before.hash)
 // Use the existing manual/offline Analysis path to check all four inputs, with
 // no provider key, prompt or model-setting changes.
 const source=await currentSource(),evidence={version:2,referenceImageId:source.primaryImageId,observations:[],unknowns:['Offline input binding only'],spatialInterpretation:{camera:{viewpoint:'unknown',evidence:'Offline input binding test',uncertainty:''},faces:[],connections:[],overallShapeHypotheses:[],hiddenStructureHypotheses:[],alternatives:[],unknowns:[]}}
 await page.getByText('人工标注 / 离线验证（不调用模型）',{exact:true}).click();await field('Visible 3D 人工标注 JSON').fill(JSON.stringify(evidence));await button('保存人工标注并 Review').click();await page.waitForFunction(()=>document.querySelector('main')?.dataset.activeStage==='review')
 const h=await api.dispatch('GET','visible3d/history'),analysis=h.analyses.find(a=>a.sourceId===source.id);assert.equal(analysis.sourceHash,source.hash);assert.deepEqual((await api.dispatch('GET','sources/'+source.id)).images,before.images)
 for(const [p,raw] of Object.entries(oldRecords))assert.equal(await readFile(p,'utf8'),raw,p)
 assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-draft')),'keep me')
 assert.ok(!calls.some(([,r])=>r==='history'||r==='visible3d/history'||r.startsWith('assembly3d/projects/')))
 // Fresh legacy 2D source mode also gets the compact header and server default.
 const context=await browser.newContext({viewport:{width:1550,height:1100}}),two=await context.newPage();two.on('pageerror',e=>errors.push(e.message));await two.goto(base+'magnetic-tiles.html?stage=source')
 await two.getByRole('tab',{name:'服务器图片',exact:true}).waitFor();assert.equal(await two.getByRole('tab',{name:'服务器图片',exact:true}).getAttribute('aria-selected'),'true')
 await two.getByRole('button',{name:'Trace / Raw',exact:true}).filter({visible:true}).waitFor();await two.screenshot({path:out+'/2d.png',fullPage:true});await context.close()
 assert.deepEqual(errors,[]);await writeFile(out+'/result.json',JSON.stringify({passed:true,metrics,modelCalls:0},null,2))
 console.log('PASS: compact header; default server tab; responsive tall scrolling list; nested folders; same basenames; global path search; thumbnails; refresh/rename; select/unselect 1–4 cross-folder snapshots; offline Analysis; Create isolation; 2D header/default; immutable old records. '+JSON.stringify(metrics))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(0,7000))}console.error({metrics,errors,calls:calls.slice(-18)});throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

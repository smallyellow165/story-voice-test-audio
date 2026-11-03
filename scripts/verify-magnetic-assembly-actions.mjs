// Full direct workflow in isolated HTTP storage + Chrome/WebGL; no model calls.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {png} from '../test/magnetic-visible3d-fixtures.mjs'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-direct-browser-')),out='/tmp/magnetic-direct-browser'
const api=createMagneticIntake(dir),calls=[],errors=[]
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 const fixture=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/orange-reviewed-geometry.json',import.meta.url),'utf8'))
 const post=(r,b)=>api.dispatch('POST','visible3d/'+r,b)
 const source=await api.dispatch('POST','sources',{name:'OFFLINE direct workflow.png',original:png,view:png})
 const analysis=await post('annotate',{sourceId:source.id,evidence:fixture.input.evidence}),review=await post('reviews',{analysisId:analysis.id,review:fixture.input.review,expectedRevision:0,thickness:.06})
 const plan=await post('manual-plan',{reviewId:review.record.id,plan:fixture.plan}),execution=(await post('execute',{planId:plan.id,requestId:randomUUID()})).record
 const original=structuredClone(execution.diagnosticCandidates[0].assembly)
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-direct-api',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
   const route=req.url.slice(1).split('?')[0];calls.push([req.method,route])
   try{
    res.setHeader('Content-Type','application/json')
    if(req.method!=='GET'&&!['visible3d/selected','visible3d/open-diagnostic-draft','visible3d/build-check','assembly3d/save','gallery/publish'].includes(route))throw Error('Model or unrelated write forbidden: '+route)
    let raw='';for await(const c of req)raw+=c
    res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{})))
   }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
  })
 }}]});await server.listen()
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/`
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1660,height:1050},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.addInitScript(sourceId=>{
  if(sessionStorage.getItem('direct-seeded'))return
  localStorage.setItem('magnetic-studio.mode.v1','3d');localStorage.setItem('magnetic-visible3d-context.v1',JSON.stringify({sourceId}));sessionStorage.setItem('direct-seeded','yes')
 },source.id)
 const button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}),field=name=>page.getByLabel(name,{exact:true}).filter({visible:true})
 async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI state did not settle')}
 async function open(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function exported(){await open(page.locator('.magnetic-3d-load'));const next=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await next).path(),'utf8'))}
 async function noApprovalUI(){assert.equal(await page.getByRole('checkbox',{name:/接受碰撞|已对照照片审核候选/}).count(),0);assert.equal(await button('批准当前作品').count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Human Accepted|Human Approved/)}
 await page.goto(base+'magnetic-tiles.html?stage=reconstruction')
 await field('3D Reconstruction Candidate').waitFor();await field('3D Reconstruction Candidate').selectOption(execution.diagnosticCandidates[0].id)
 await noApprovalUI();await button('打开 Diagnostic 到 Assembly Editor').click()
 const diagnostics=page.getByRole('region',{name:'Collision Diagnostics',exact:true});await diagnostics.waitFor()
 const adopted=await exported();assert.deepEqual(adopted.pieces,original.pieces);assert.deepEqual(adopted.connections,original.connections);assert.equal(validateAssembly3D(adopted).valid,false)
 assert.equal(await diagnostics.locator('tbody tr').count(),4);await noApprovalUI()
 await diagnostics.locator('tbody tr').first().locator('td').first().click();await page.locator('[data-collision-overlay]').waitFor({state:'attached'});await button('聚焦碰撞').click();await button('取消碰撞选择').click()
 await button('Revalidate Geometry').click();await page.getByRole('alert').filter({hasText:'几何诊断'}).waitFor()
 await button('保存 3D Draft').click()
 const add=page.getByRole('link',{name:/^Add to Gallery /}).first();await add.waitFor();const addUrl=await add.getAttribute('href')
 await page.screenshot({path:out+'/editor-diagnostics.png',fullPage:true})
 await page.goto(new URL(addUrl,base).href);await field('作品描述').fill('包含几何碰撞的个人作品');await button('加入 Gallery').click();await page.waitForURL(/magnetic-gallery.html\?id=/);await page.locator('canvas').waitFor()
 const galleryId=new URL(page.url()).searchParams.get('id'),published=await api.dispatch('GET','gallery/items/'+galleryId)
 assert.deepEqual(published.assembly,adopted);await page.screenshot({path:out+'/invalid-gallery.png',fullPage:true})
 // Tutorial generation and save no longer need a server grant or revalidation receipt.
 await page.goto(base+'magnetic-tiles.html?stage=build');await until(()=>button('生成搭建教程').isEnabled());await button('生成搭建教程').click();await page.getByTestId('tutorial-player').waitFor()
 assert.match(await page.getByTestId('tutorial-validation').innerText(),/Geometry Invalid/)
 assert.match(await page.getByTestId('tutorial-source').innerText(),/6 片/)
 await until(()=>button('保存教程').isEnabled());await button('保存教程').click();await until(async()=>(await page.getByTestId('tutorial-save-status').innerText()).includes('已保存'))
 await button('下一步').click();await page.reload();await page.getByTestId('tutorial-player').waitFor();await noApprovalUI()
 await page.screenshot({path:out+'/invalid-tutorial.png',fullPage:true})
 // Editing and Undo/Redo keep real diagnostics and do not synchronize approvals.
 await page.locator('[data-stage="assembly"]').click();await button('Edit Draft').click();await page.locator('[data-3d-piece="'+adopted.pieces[0].id+'"]').click()
 const x=Number(await field('3D 位置 X').inputValue());await field('3D 位置 X').fill(String(x+.1));await field('3D 位置 X').press('Enter')
 await button('3D Undo').click();assert.deepEqual(await exported(),adopted);await button('3D Redo').click();await button('3D Undo').click()
 assert.deepEqual(await exported(),adopted);await noApprovalUI()
 await page.setViewportSize({width:680,height:1000});await page.screenshot({path:out+'/editor-mobile.png',fullPage:true})
 assert.deepEqual((await api.dispatch('GET','gallery/items/'+galleryId)).assembly,adopted)
 assert.deepEqual(errors,[]);assert.ok(!calls.some(([,r])=>r.startsWith('assembly3d-review/')))
 assert.ok(!calls.some(([m,r])=>m==='POST'&&/analyze|plan|execute/.test(r)))
 console.log('PASS: Diagnostic → Editor → Invalid save → Gallery → Tutorial generate/save/reload → Undo/Redo; collision focus and strict Invalid preserved; no approval UI/API or model calls. '+out)
}catch(e){if(page){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(0,9000))}console.error({errors,calls:calls.slice(-20)});throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

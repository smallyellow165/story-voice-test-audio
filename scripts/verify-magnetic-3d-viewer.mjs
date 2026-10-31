// Isolated production UI + real API reader + actual WebGL. No production files/keys.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url)),data=await mkdtemp(path.join(tmpdir(),'magnetic-3d-api-'))
const out=process.env.MAGNETIC_3D_ARTIFACTS||'/tmp/magnetic-phase2-browser'
await mkdir(out,{recursive:true})
const api=createMagneticIntake(data),writes=[],errors=[],consoleErrors=[]
const server=await createServer({configFile:false,root,base:'/story-voice-test-audio/',
 server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-magnetic-read-api',configureServer(s){s.middlewares.use('/favicon.ico',(req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  if(req.method!=='GET'){writes.push(req.url);res.statusCode=403;res.end('Read-only acceptance server');return}
  try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch('GET',req.url.slice(1).split('?')[0])))}
  catch(e){res.statusCode=e.statusCode||500;res.end(JSON.stringify({error:String(e)}))}
 })}}]})
let browser,page
try{
 await server.listen();const port=server.httpServer.address().port,url=`http://127.0.0.1:${port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true});page=await context.newPage()
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
 const visible=loc=>loc.filter({visible:true}),button=name=>visible(page.getByRole('button',{name,exact:true}))
 await page.goto(url);await button('添加正方形').click()
 const before2d=await page.locator('svg[aria-label="磁力片二维画布"]').innerHTML()
 await button('3D 查看').click();await page.locator('.magnetic-3d-canvas canvas').waitFor({state:'visible'})
 const camera=async()=>JSON.parse(await page.getByLabel('3D 相机状态',{exact:true}).textContent())
 await page.waitForFunction(()=>document.querySelector('[aria-label="3D 相机状态"]')?.textContent!=='null')
 const canvas=page.locator('.magnetic-3d-canvas canvas')
 const canvasReady=()=>page.waitForFunction(()=>{const c=document.querySelector('.magnetic-3d-canvas canvas'),p=document.querySelector('.magnetic-3d-canvas');return c&&p&&c.width>=p.clientWidth*.9&&c.height>=p.clientHeight*.9&&p.clientWidth>0})
 async function saved(){const d=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await d).path(),'utf8'))}
 const checks=[]
 for(const [id,count,connections]of[['right-angle',2,1],['closed-cube',6,12],['mixed-profiles',3,1]]){
  await page.locator(`[data-3d-example="${id}"]`).click()
  assert.equal(await page.locator('[data-3d-piece]').count(),count)
  assert.match(await page.locator('.magnetic-3d-summary').textContent(),/几何校验通过/)
  const details=page.locator('.magnetic-3d-load');if(!await details.evaluate(e=>e.open))await details.locator('summary').click()
  const snapshot=await saved();assert.equal(snapshot.connections.length,connections);console.log('Example:',id)
  await button('重新加载来源').click();assert.deepEqual(await saved(),snapshot);await canvasReady()
  await page.locator('[data-3d-piece]').first().click()
  const selected=snapshot.pieces[0];assert.equal(await page.locator('[data-selected-3d-piece]').getAttribute('data-selected-3d-piece'),selected.id)
  assert.deepEqual(JSON.parse(await page.locator('[data-3d-position]').getAttribute('data-3d-position')),selected.pose.position)
  await button('Fit to View').scrollIntoViewIfNeeded();await page.waitForTimeout(500);await page.screenshot({path:`${out}/${id}.png`});checks.push(id)
 }
 await page.locator('[data-3d-example="closed-cube"]').click();await canvasReady()
 const box=await canvas.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2
 await button('Reset Camera').click();await page.waitForTimeout(100);const initial=await camera();console.log('Camera initial',JSON.stringify(initial))
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+110,y+45,{steps:12});await page.mouse.up();await page.waitForTimeout(100)
 const rotated=await camera();assert.notDeepEqual(rotated.position,initial.position,'orbit rotates camera')
 await page.mouse.wheel(0,220);await page.waitForTimeout(100);assert.notEqual((await camera()).zoom,rotated.zoom,'wheel zooms')
 const prePan=await camera();await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+65,y+30,{steps:8});await page.mouse.up({button:'right'});await page.waitForTimeout(100)
 assert.notDeepEqual((await camera()).target,prePan.target,'right drag pans')
 const preFit=await camera();await button('Fit to View').click();await page.waitForTimeout(100);const fitted=await camera()
 assert.notDeepEqual(fitted.target,preFit.target,'fit recenters')
 await button('Reset Camera').click();await page.waitForTimeout(100);const reset=await camera()
 for(const k of ['zoom'])assert.ok(Math.abs(reset[k]-initial[k])<1e-6)
 initial.position.forEach((n,i)=>assert.ok(Math.abs(n-reset.position[i])<1e-6))
 // Raycast selection through the real WebGL canvas, independent of the piece list.
 const hitbox=await canvas.boundingBox();await canvas.click({position:{x:hitbox.width*.42,y:hitbox.height*.58}})
 await page.locator('[data-selected-3d-piece]').waitFor({state:'visible',timeout:5000})
 await page.screenshot({path:out+'/cube-selected.png'})
 // Load a same-ID snapshot with changed thickness, geometry and an arbitrary saved pose.
 const fixture=JSON.parse(await readFile(path.join(root,'src/magnetic-tiles/three-d/examples/mixed-profiles.json'),'utf8'))
 fixture.id='loaded-snapshot';fixture.pieces[2].pose.position=[4.123,-.75,2.5];fixture.profiles[2].thickness=.123
 const importPath=out+'/loaded-snapshot.json';await writeFile(importPath,JSON.stringify(fixture))
 await page.getByLabel('打开 Assembly3D 文件',{exact:true}).setInputFiles(importPath)
 await page.waitForFunction(()=>document.querySelector('.magnetic-3d-heading p')?.textContent==='loaded-snapshot.json')
 await button('重新加载来源').click();assert.deepEqual(await saved(),fixture)
 await page.locator('[data-3d-piece="free-triangle-v2"]').click()
 assert.match(await page.locator('.magnetic-3d-piece-info').textContent(),/right-triangle@2/)
 assert.match(await page.locator('.magnetic-3d-piece-info').textContent(),/0\.123/)
 assert.deepEqual(JSON.parse(await page.locator('[data-3d-position]').getAttribute('data-3d-position')),[4.123,-.75,2.5])
 await page.getByLabel('Assembly3D JSON',{exact:true}).fill('{invalid');await button('加载 JSON').click()
 assert.match(await page.getByRole('alert').textContent(),/加载失败/);assert.deepEqual(await saved(),fixture)
 await button('2D 查看').click();assert.equal(await page.locator('svg[aria-label="磁力片二维画布"]').innerHTML(),before2d)
 for(const stage of ['source','review','reconstruction','build','assembly']){await page.locator(`[data-stage="${stage}"]`).click();assert.equal(await page.locator('main').getAttribute('data-active-stage'),stage)}
 await button('3D 查看').click();await page.locator('[data-3d-piece="free-triangle-v2"]').waitFor({state:'visible'})
 // Tablet/mobile layouts must still expose the model, example controls and Inspector.
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/mobile.png'})
 await visible(page.getByRole('button',{name:'检查器',exact:true})).click();await page.locator('[data-3d-piece="free-triangle-v2"]').click()
 assert.equal(await page.locator('[data-selected-3d-piece]').getAttribute('data-selected-3d-piece'),'free-triangle-v2')
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 const result={checks,camera:['orbit','zoom','pan','fit','reset'],selection:['canvas raycast','list','inspector'],loading:['file','reload','snapshot equality','invalid retains prior'],twoD:'unchanged draft and five stages',mobile:'390px',writes,errors,consoleErrors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){console.error(JSON.stringify({errors,consoleErrors}));if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}finally{await browser?.close();await server.close();await rm(data,{recursive:true,force:true})}

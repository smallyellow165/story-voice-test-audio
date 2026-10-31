// Actual Chrome + WebGL, isolated real APIs, synthetic image/annotations. No paid requests.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {visibleFixture} from '../test/magnetic-visible3d-fixtures.mjs'
import {adaptProfile} from '../src/magnetic-tiles/three-d/profile-adapter.ts'
import {Vector3,Quaternion,OrthographicCamera} from 'three'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(path.join(tmpdir(),'visible3d-browser-')),out='/tmp/magnetic-phase5b-browser'
await mkdir(out,{recursive:true});const api=createMagneticIntake(directory),errors=[],consoleErrors=[],calls=[]
const server=await createServer({configFile:false,root,base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-visible3d-api',configureServer(s){s.middlewares.use('/favicon.ico',(req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
 const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route})
 if(req.method==='POST'&&!['sources','visible3d/annotate','visible3d/reviews','visible3d/manual-plan','visible3d/execute','visible3d/adopt'].includes(route)){res.statusCode=403;res.end(JSON.stringify({error:'Live model calls forbidden in acceptance'}));return}
 try{let raw='';for await(const chunk of req)raw+=chunk;const result=await api.dispatch(req.method,route,raw?JSON.parse(raw):{});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))}catch(e){res.statusCode=e.statusCode||422;res.end(JSON.stringify({error:e.message}))}
 })}}]})
let browser,page
try{
 await server.listen();const port=server.httpServer.address().port,url=`http://127.0.0.1:${port}/story-voice-test-audio/magnetic-tiles.html?stage=source`
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const context=await browser.newContext({viewport:{width:1650,height:1100},acceptDownloads:true});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});page.on('dialog',d=>d.accept())
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),step=n=>page.locator(`[data-stage="${n}"]`).click()
 async function details(locator){if(!await locator.evaluate(e=>e.open))await locator.locator('summary').click()}
 async function image(assembly){
  const camera=new OrthographicCamera(-1.9,1.9,1.5,-1.5,.01,100);camera.position.set(4,4,5);camera.lookAt(0,.3,0);camera.updateMatrixWorld()
  const polygons=assembly.pieces.map(p=>{const s=assembly.profiles.find(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion),shape=adaptProfile(s).shape;return {color:p.color??'#55b8ac',points:shape.vertices.map(v=>{const n=new Vector3(v.x,v.y,0).applyQuaternion(new Quaternion(...p.pose.quaternion)).add(new Vector3(...p.pose.position)).project(camera);return [(n.x+1)*400,(1-n.y)*300]})}})
  const data=await page.evaluate(polygons=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const c=canvas.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,0,800,600);for(const p of polygons){c.beginPath();p.points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=p.color;c.fill();c.strokeStyle='#333';c.lineWidth=5;c.stroke()}return canvas.toDataURL('image/png').split(',')[1]},polygons);return Buffer.from(data,'base64')
 }
 async function rendered(){
  const canvas=page.locator('.visible3d-workspace .magnetic-3d-canvas canvas').filter({visible:true});await canvas.scrollIntoViewIfNeeded()
  // Check actual rasterized piece colors, not merely the existence of a WebGL canvas.
  for(let attempt=0;attempt<40;attempt++){
   const shot=await canvas.screenshot();const count=await page.evaluate(async bytes=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const pixels=ctx.getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];if(r>g*1.2+5||g>r*1.3+10||b>r*1.3+10)count++}return count},[...shot])
   if(count>100)return count
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  }
  throw Error('Viewer canvas exists but no rendered piece pixels were detected')
 }
 async function create(name,expected){
  const f=await visibleFixture(name);if(name==='right-angle')f.plan.connections[0].angles=[90,-90];await step('source');await button('Visible 3D').click()
  await field('上传 Visible 3D 照片').setInputFiles({name:name+'-synthetic.png',mimeType:'image/png',buffer:await image(f.assembly)})
  await button('Analyze Visible 3D（调用模型）').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('p')].some(p=>p.textContent.includes('Visible 3D · '+document.querySelector('input[type=file]')?.files?.[0]?.name)))
  await details(page.locator('.visible3d-workspace details').filter({hasText:'人工标注 / 离线验证'}));await field('Visible 3D 人工标注 JSON').fill(JSON.stringify(f.evidence));await button('保存人工标注并 Review').click();await button('保存 3D Review').waitFor()
  for(const p of f.review.pieces){await page.locator(`[data-review-id="${p.id}"]`).filter({visible:true}).click();await field('3D Review Profile').selectOption(`${p.profileId}@${p.profileVersion}`);await field('确认可见实例').check()}
  await button('保存 3D Review').click();await page.getByRole('status').filter({hasText:'3D Review 已保存'}).waitFor();await button('进入 3D Reconstruction').click()
  const manual=page.locator('.visible3d-workspace details').filter({hasText:'人工 Spatial Hypothesis / 修改后保存新版本'});await details(manual);await field('3D Spatial Hypothesis JSON').fill(JSON.stringify(f.plan));await button('保存人工 Spatial Hypothesis').click();await manual.locator('summary').click();await button('Geometry Execution（不调用模型）').waitFor({state:'visible'});await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Geometry Execution（不调用模型）'&&!b.disabled));await button('Geometry Execution（不调用模型）').click()
  await page.getByTestId('visible3d-execution-status').filter({hasText:'candidates_found'}).waitFor({timeout:20000});await page.locator('.visible3d-workspace .magnetic-3d-canvas canvas').waitFor();await page.waitForFunction(()=>{const c=document.querySelector('.visible3d-workspace canvas');return c&&c.width>200&&c.height>100})
  assert.match(await page.getByTestId('visible3d-execution-status').textContent(),new RegExp(expected+' Candidates'))
  await button('Fit to View').click();await button('Reset Camera').click();await rendered();assert.equal(await button('采用候选到 3D Assembly Editor').isDisabled(),true)
  return f
 }
 async function adopt(){await field('已对照照片审核候选').check();await button('采用候选到 3D Assembly Editor').click();await button('Edit Draft').waitFor();await page.locator('.visible3d-origin').waitFor();assert.equal(await button('Edit Draft').getAttribute('aria-pressed'),'true')}
 async function exported(){await details(page.locator('.magnetic-3d-load'));const dl=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await dl).path(),'utf8'))}
 await page.goto(url);await create('right-angle',2)
 const sourceBefore=await api.dispatch('GET','history');assert.equal(sourceBefore.analyses.length,0)
 const h=await api.dispatch('GET','visible3d/history'),x=h.executions[0];await page.getByRole('button',{name:/candidate-2 ·/}).click();await button('Fit to View').click();await page.getByRole('button',{name:/candidate-1 ·/}).click();await rendered();await page.screenshot({path:out+'/pair-candidate.png'})
 await adopt();const adopted=await exported();assert.deepEqual(adopted.pieces,x.candidates[0].assembly.pieces);assert.deepEqual(adopted.profiles,x.candidates[0].assembly.profiles)
 await page.reload();await button('3D 查看').click();assert.deepEqual(await exported(),adopted);assert.match(await page.locator('.visible3d-origin').textContent(),/采用时快照一致/)
 await step('reconstruction');await page.getByTestId('visible3d-execution-status').waitFor();assert.match(await page.getByTestId('visible3d-execution-status').textContent(),/candidates_found/)
 await step('review');await page.locator('[data-review-id]').filter({visible:true}).first().click();await field('3D Review 颜色').fill('#112233');await step('reconstruction');assert.equal(await button('采用候选到 3D Assembly Editor').isDisabled(),true);assert.match(await page.locator('.visible3d-workspace').filter({visible:true}).innerText(),/Outdated/)
 // A separate page saving a review invalidates the old candidate on refresh and at the API.
 const latest=(await api.dispatch('GET','visible3d/history')).reviews[0];await api.dispatch('POST','visible3d/reviews',{analysisId:latest.analysisId,review:latest.input.review,expectedRevision:1});await button('刷新 3D 历史').click();await page.waitForTimeout(200);assert.equal(await button('采用候选到 3D Assembly Editor').isDisabled(),true)
 await create('closed-cube',1);const cubeExecution=(await api.dispatch('GET','visible3d/history')).executions[0];assert.equal(cubeExecution.candidates[0].assembly.connections.length,12)
 await field('3D 连接组合预算').fill('0');await button('Geometry Execution（不调用模型）').click();await page.getByTestId('visible3d-execution-status').filter({hasText:'budget_exhausted'}).waitFor();assert.equal(await button('采用候选到 3D Assembly Editor').count(),0)
 await field('3D 连接组合预算').fill('128');await button('Geometry Execution（不调用模型）').click();await page.getByTestId('visible3d-execution-status').filter({hasText:'candidates_found'}).waitFor();await rendered();await page.screenshot({path:out+'/cube-candidate.png'});await adopt();const cube=await exported();assert.equal(cube.connections.length,12)
 await step('build');await button('3D 教程').click();await button('Generate Build Order').click();await page.getByTestId('build-order-status').filter({hasText:'complete · 6 步'}).waitFor({timeout:20000})
 await step('source');await button('2D 图片').click();assert.equal(await page.locator('.visible3d-workspace').filter({visible:true}).count(),0);assert.equal((await api.dispatch('GET','history')).analyses.length,0)
 assert.equal(calls.some(c=>/visible3d\/(analyze|plan)$/.test(c.route)),false);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 const result={passed:true,pair:'manual visible evidence → reviewed profiles → spatial hypothesis → real geometry → editor adoption',cube:'six pieces/twelve actual validated connections; downstream auto build order complete',persistence:'reload exact Pose/ProfileSnapshot and immutable origin; context restoration',protection:'unchecked, dirty Review, changed head and budget exhaustion block adoption',realVisionCalls:0,realPhotographs:0,fixture:'synthetic projected images and human annotations; no recognition accuracy claim',apiCalls:calls.length,errors,consoleErrors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}console.error({errors,consoleErrors});throw e}
finally{await browser?.close();await server.close();await rm(directory,{recursive:true,force:true})}

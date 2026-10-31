// Actual Chrome + WebGL, isolated real APIs, synthetic image/annotations. No paid requests.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {visibleFixture} from '../test/magnetic-visible3d-fixtures.mjs'
import {upgradeVisibleFixture,visibleV2Fixture} from '../test/magnetic-visible3d-v2-fixtures.mjs'
import {adaptProfile} from '../src/magnetic-tiles/three-d/profile-adapter.ts'
import {Vector3,Quaternion,OrthographicCamera} from 'three'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile,readFile,cp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const v2=process.argv.includes('--v2')
const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(path.join(tmpdir(),'visible3d-browser-')),out=v2?'/tmp/magnetic-visible-v2-browser':'/tmp/magnetic-phase5b-browser'
await mkdir(out,{recursive:true});const api=createMagneticIntake(directory),errors=[],consoleErrors=[],calls=[]
const liveIndex=process.argv.indexOf('--live-evaluation'),liveDirectory=liveIndex>=0?process.argv[liveIndex+1]:null
let live=null
if(liveDirectory){
 if(!v2)throw Error('--live-evaluation requires --v2')
 live=JSON.parse(await readFile(path.join(liveDirectory,'evaluation.json'),'utf8'))
 if(live.geometryOutcome!=='candidates_found')throw Error('Evaluation has no successful candidates')
 const source=JSON.parse(await readFile(path.join(root,'generated/magnetic-intake/sources',live.sourceId+'.json'),'utf8'))
 await mkdir(path.join(directory,'sources'),{recursive:true});await cp(path.join(root,'generated/magnetic-intake/sources',live.sourceId+'.json'),path.join(directory,'sources',live.sourceId+'.json'))
 await mkdir(path.join(directory,'assets'),{recursive:true});for(const id of new Set([source.originalHash,source.view.hash]))await cp(path.join(root,'generated/magnetic-intake/assets',id+'.json'),path.join(directory,'assets',id+'.json'))
 await cp(path.join(root,'generated/magnetic-intake/profile-registry'),path.join(directory,'profile-registry'),{recursive:true})
 for(const kind of ['analyses','reviews','plans','executions','heads','model-traces'])await cp(path.join(liveDirectory,kind),path.join(directory,'visible3d',kind),{recursive:true})
}
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
 async function details(locator){if(!await locator.evaluate(e=>e.open))await locator.locator(':scope > summary').click()}
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
  const f=v2?(name==='closed-cube'?await visibleV2Fixture():upgradeVisibleFixture(await visibleFixture(name))):await visibleFixture(name);if(name==='right-angle')f.plan.connections[0].angles=[90,-90];await step('source');await button('Visible 3D').click()
  await field('上传 Visible 3D 照片').setInputFiles({name:name+'-synthetic.png',mimeType:'image/png',buffer:await image(f.assembly)})
  await button('Analyze Visible 3D（调用模型）').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('p')].some(p=>p.textContent.includes('Visible 3D · '+document.querySelector('input[type=file]')?.files?.[0]?.name)))
  await details(page.locator('.visible3d-workspace details').filter({hasText:'人工标注 / 离线验证'}));await field('Visible 3D 人工标注 JSON').fill(JSON.stringify(f.evidence));await button('保存人工标注并 Review').click();await button('保存 3D Review').waitFor()
  for(const p of f.review.pieces){await page.locator(`[data-review-id="${p.id}"]`).filter({visible:true}).click();if(v2){assert.equal(await field('3D Review Profile').inputValue(),'');await button('采用 AI 形状判断').click();assert.equal(await field('3D 人工 Shape Family').inputValue(),'square');await button(`使用 Profile 候选 ${p.profileId}@${p.profileVersion}`).click();assert.equal(await field('确认可见实例').isChecked(),false)}else await field('3D Review Profile').selectOption(`${p.profileId}@${p.profileVersion}`);await field('确认可见实例').check()}
  if(v2){await field('3D 整体解释审核').selectOption('corrected');await field('3D 空间解释修正说明').fill('仅确认可见片构成的局部结构，完整封闭作品未确认');await button('核对此连接与角度建议').first().click();assert.equal(await field('3D 连接 Port A').inputValue(),'');assert.equal(await field('3D Review 二面角候选').inputValue(),'90');assert.equal(await page.getByRole('button',{name:'移除约束',exact:true}).count(),0,'reviewing a suggestion does not establish a constraint');await field('3D 连接 Port A').selectOption(f.plan.connections[0].portA);await field('3D 连接 Port B').selectOption(f.plan.connections[0].portB);await button('加入 / 替换人工连接约束').click();await button('移除约束').click()}

  await button('保存 3D Review').click();await page.getByRole('status').filter({hasText:'3D Review 已保存'}).waitFor();await button('进入 3D Reconstruction').click()
  const manual=page.locator('.visible3d-workspace details').filter({hasText:'人工 Spatial Hypothesis / 修改后保存新版本'});await details(manual);await field('3D Spatial Hypothesis JSON').fill(JSON.stringify(f.plan));await button('保存人工 Spatial Hypothesis').click();await manual.locator('summary').click();await button('Geometry Execution（不调用模型）').waitFor({state:'visible'});await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Geometry Execution（不调用模型）'&&!b.disabled));if(v2){await details(page.locator('details[aria-label="Planning 推断详情"]'));const d=page.locator('details[aria-label="3D Planning 连接审核"]');await details(d);await button('选择解释 1 并保存人工计划').click();await page.getByRole('status').filter({hasText:'已创建独立的人工选择计划'}).waitFor()}await button('Geometry Execution（不调用模型）').click()
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
 await create('closed-cube',1);const cubeExecution=(await api.dispatch('GET','visible3d/history')).executions[0];assert.equal(cubeExecution.candidates[0].assembly.connections.length,v2?3:12)
 await field('3D 连接组合预算').fill('0');await button('Geometry Execution（不调用模型）').click();await page.getByTestId('visible3d-execution-status').filter({hasText:'budget_exhausted'}).waitFor();assert.equal(await button('采用候选到 3D Assembly Editor').count(),0)
 await field('3D 连接组合预算').fill('128');await button('Geometry Execution（不调用模型）').click();await page.getByTestId('visible3d-execution-status').filter({hasText:'candidates_found'}).waitFor();await rendered();await page.screenshot({path:out+'/cube-candidate.png'});await adopt();const cube=await exported();assert.equal(cube.connections.length,v2?3:12);if(v2)assert.equal(cube.pieces.length,3)
 await step('build');await button('3D 教程').click();await button('Generate Build Order').click();await page.getByTestId('build-order-status').filter({hasText:v2?'complete · 3 步':'complete · 6 步'}).waitFor({timeout:20000})
 await step('source');await button('2D 图片').click();assert.equal(await page.locator('.visible3d-workspace').filter({visible:true}).count(),0);assert.equal((await api.dispatch('GET','history')).analyses.length,0)
 if(live){
  await step('source');await button('Visible 3D').click();await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${live.sourceId}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(live.sourceId)
  await button('刷新 3D 历史').click()
  const h=await api.dispatch('GET','visible3d/history'),a=h.analyses.find(a=>a.sourceId===live.sourceId),r=h.reviews.find(r=>r.analysisId===a.id),p=h.plans.find(p=>p.reviewId===r.id),x=h.executions.find(x=>x.planId===p.id)
  await field('3D Analysis 历史').selectOption(a.id);await step('review');await field('3D Review 历史').selectOption(r.id);await step('reconstruction');await field('3D Plan 历史').selectOption(p.id);await field('3D Candidates 历史').selectOption(x.id)
  await page.getByTestId('visible3d-execution-status').filter({hasText:'2 Candidates'}).waitFor();await rendered();await page.screenshot({path:out+'/real-purple-candidate-1.png'})
  await page.locator('.visible3d-workspace .visible3d-image').filter({visible:true}).screenshot({path:out+'/real-purple-evidence.png'})
  await page.getByRole('button',{name:/candidate-2 ·/}).click();await rendered();await page.screenshot({path:out+'/real-purple-candidate-2.png'})
  await adopt();const realAdopted=await exported();assert.deepEqual(realAdopted.pieces,x.candidates[1].assembly.pieces);assert.deepEqual(realAdopted.profiles,x.candidates[1].assembly.profiles);assert.equal(realAdopted.pieces.length,3);assert.equal(realAdopted.connections.length,3)
  await page.reload();await button('3D 查看').click();assert.deepEqual(await exported(),realAdopted)
 }
 assert.equal(calls.some(c=>/visible3d\/(analyze|plan)$/.test(c.route)),false);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 const result={passed:true,version:v2?'V2':'V1',pair:'manual visible evidence → reviewed profiles → spatial hypothesis → real geometry → editor adoption',cube:v2?'only three visible faces/three actual legal connections; no hidden panels; downstream build order complete':'six pieces/twelve actual validated connections; downstream auto build order complete',persistence:'reload exact Pose/ProfileSnapshot and immutable origin; context restoration',protection:'unchecked, dirty Review, changed head and budget exhaustion block adoption',realVisionCalls:0,realPhotographs:live?1:0,liveEvaluation:live?{model:live.model,sourceId:live.sourceId,geometry:'two actual 3-piece/3-connection candidates; explicit adoption and reload; Photo Match still unverified'}:null,fixture:'synthetic projected images and human annotations; no recognition accuracy claim',apiCalls:calls.length,errors,consoleErrors}
 await rm(out+'/failure.png',{force:true});await rm(out+'/failure.txt',{force:true});await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}console.error({errors,consoleErrors});throw e}
finally{await browser?.close();await server.close();await rm(directory,{recursive:true,force:true})}

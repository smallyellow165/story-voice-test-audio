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
const out=process.env.MAGNETIC_3D_ARTIFACTS||'/tmp/magnetic-phase5a-browser'
await mkdir(out,{recursive:true})
const api=createMagneticIntake(data),writes=[],errors=[],consoleErrors=[]
const server=await createServer({configFile:false,root,base:'/story-voice-test-audio/',
 server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-magnetic-read-api',configureServer(s){s.middlewares.use('/favicon.ico',(req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  if(req.method!=='GET'){writes.push(req.url);res.statusCode=403;res.end('Read-only acceptance server');return}
  try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch('GET',req.url.slice(1).split('?')[0])))}
  catch(e){res.statusCode=e.statusCode||500;res.end(JSON.stringify({error:String(e)}))}
 })}}]})
let browser,page
try {
 await server.listen();const port=server.httpServer.address().port,url=`http://127.0.0.1:${port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const context=await browser.newContext({viewport:{width:1650,height:1100},acceptDownloads:true});page=await context.newPage()
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});let acceptDialogs=true;page.on('dialog',d=>acceptDialogs?d.accept():d.dismiss())
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true})
 async function advanced(){const d=page.locator('.magnetic-tutorial-advanced');if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click()}
 async function exported(){await advanced();const d=page.locator('.magnetic-tutorial-io');if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click();const dl=page.waitForEvent('download');await button('导出 Tutorial3D').click();return JSON.parse(await readFile(await(await dl).path(),'utf8'))}
 async function ready(){await page.waitForFunction(()=>{const c=document.querySelector('.magnetic-tutorial-canvas canvas'),p=document.querySelector('.magnetic-tutorial-canvas');return c&&p&&c.width>=p.clientWidth*.9&&c.height>=p.clientHeight*.9&&p.clientWidth>0})}
 async function generate(status='complete'){
  const trigger=button('重新生成教程');await(await trigger.count()?trigger:button('生成搭建教程')).click()
  await page.waitForFunction(status=>document.querySelector('[data-testid="build-order-status"]')?.getAttribute('data-status')===status,status)
 }
 async function budget(){await advanced();const d=page.locator('details').filter({has:page.getByText('搜索预算与约束',{exact:true})}).last();if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click()}
 async function build(){await page.locator('[data-stage="build"]').click();await button('3D 教程').click()}
 async function importAssembly(a){
  await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click();const d=page.locator('.magnetic-3d-load');if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click()
  await field('Assembly3D JSON').fill(JSON.stringify(a));await button('加载 JSON').click();await button('从当前作品创建 Draft').click();await button('保存 3D Draft').click();const saved=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await saved).path(),'utf8'))
 }
 const pair=JSON.parse(await readFile(path.join(root,'src/magnetic-tiles/three-d/examples/right-angle.json'),'utf8'))
 const cube=JSON.parse(await readFile(path.join(root,'src/magnetic-tiles/three-d/examples/closed-cube.json'),'utf8'))
 await page.goto(url);await button('添加正方形').click()
 const twoD=await page.locator('[data-tile-id]').evaluateAll(els=>els.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points'),color:e.getAttribute('fill')})))
 await page.locator('[data-stage="build"]').click();await button('生成搭建步骤').click();await button('保存教程').click();await button('完成搭建').click()
 const dl2d=page.waitForEvent('download');await button('导出教程 JSON').click();const saved2d=JSON.parse(await readFile(await(await dl2d).path(),'utf8'))
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click();await page.locator('.magnetic-3d-canvas canvas').waitFor()
 await build();assert.equal(await page.getByTestId('tutorial-player').count(),0);assert.equal(await button('生成搭建教程').isEnabled(),true);assert.equal(await button('保存教程').isDisabled(),true,'empty prepared tutorial is not a normal save')
 await generate();await ready();assert.match(await page.getByTestId('tutorial-progress').textContent(),/1 \/ 2/)
 assert.equal(await page.locator('.magnetic-tutorial-advanced').evaluate(e=>e.open),false)
 assert.equal(await button('采用候选并替换当前 Draft').count(),0,'ordinary preview needs no technical adoption')
 const pairTutorial=await exported();assert.deepEqual(pairTutorial.assembly,pair);assert.deepEqual(pairTutorial.steps.flatMap(s=>s.addedPieceIds),['base','wall'])
 await button('下一步').click();assert.match(await page.getByTestId('tutorial-progress').textContent(),/2 \/ 2/);await button('上一步').click()
 await button('重新开始').click();await button('自动播放').click();await button('暂停').click();const paused=await page.getByTestId('tutorial-player').getAttribute('data-step-index');await page.waitForTimeout(1400);assert.equal(await page.getByTestId('tutorial-player').getAttribute('data-step-index'),paused)
 await button('自动播放').click();await page.getByTestId('tutorial-progress').filter({hasText:'播放完成'}).waitFor({timeout:12000})
 await button('保存教程').click();assert.match(await page.getByTestId('tutorial-save-status').textContent(),/已保存/)
 await page.reload();await button('3D 教程').click();await ready();assert.deepEqual(await exported(),pairTutorial)
 // Re-generation confirmation happens before search or document replacement.
 await field('3D 步骤标题').fill('保留我的编辑');const editedPair=await exported();acceptDialogs=false;await button('重新生成教程').click();assert.deepEqual(await exported(),editedPair)
 acceptDialogs=true;await generate();await ready();assert.deepEqual(await exported(),pairTutorial);assert.equal(await button('保存教程').isEnabled(),true,'new preview requires explicit save even if bytes equal the old saved tutorial')
 await button('保存教程').click()
 // A bounded failure never replaces a valid current tutorial.
 await budget();await field('规划几何检查预算').fill('0');await generate('budget-exhausted');assert.match(await page.getByTestId('build-order-stats').textContent(),/0\/0/);assert.deepEqual(await exported(),pairTutorial)
 await field('规划几何检查预算').fill('2000')
 await importAssembly(cube);await build();assert.match(await page.locator('.magnetic-tutorial-warning').filter({hasText:'与当前 Assembly 不同'}).textContent(),/与当前 Assembly 不同/);assert.deepEqual(await exported(),pairTutorial);assert.equal(await button('保存教程').isDisabled(),true)
 await generate();await ready();const generated=await exported();assert.equal(generated.steps.length,6);assert.equal(generated.steps.flatMap(s=>s.addedConnections).length,12)
 assert.deepEqual(generated.assembly.pieces,cube.pieces);assert.deepEqual(generated.assembly.profiles,cube.profiles);assert.equal(generated.steps[0].addedPieceIds[0],'bottom');assert.equal(generated.steps.at(-1).addedPieceIds[0],'top')
 for(const step of generated.steps){await field('3D 教程查看步骤').selectOption(String(generated.steps.indexOf(step)));assert.match(await page.getByTestId('tutorial-step-validation').textContent(),/Geometry Valid · Connected Construction 通过/)}
 await advanced();const diag=page.locator('details').filter({has:page.getByText(/^生成 Diagnostic ·/)}).last();if(!await diag.evaluate(e=>e.open))await diag.locator(':scope > summary').click();assert.ok(await page.locator('[data-build-order-diagnostic="CLOSURE_OR_SUPPORT_RISK"]').count())
 await page.getByTestId('step-card-1').click();await field('3D 步骤标题').fill('人工审核后的底座');await field('3D 步骤说明').fill('先放置基础片，安装时扶稳');const edited=await exported()
 await button('教程 Undo').click();assert.equal((await exported()).steps[0].description,generated.steps[0].description);await button('教程 Redo').click();assert.deepEqual(await exported(),edited)
 await button('保存教程').click();await page.reload();await button('3D 教程').click();await ready();assert.deepEqual(await exported(),edited)
 assert.equal(await field('3D 历史教程').locator('option').count(),3,'pair and cube saves are both retained')
 await field('3D 历史教程').selectOption(pairTutorial.id);await button('打开教程').click();await ready();assert.deepEqual(await exported(),pairTutorial);assert.equal(await button('保存教程').isDisabled(),true,'historical source mismatch cannot be saved as current-assembly tutorial')
 await field('3D 历史教程').selectOption(edited.id);await button('打开教程').click();await ready();assert.deepEqual(await exported(),edited)
 // A document edit made while a Worker is loading wins over its late result.
 let release,seen;const gate=new Promise(r=>release=r),started=new Promise(r=>seen=r)
 await page.route('**/build-order.worker.ts*',async route=>{seen();await gate;await route.continue()})
 await button('重新生成教程').click();await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('Worker request was not observed')),10000))]);await field('3D 教程标题').fill('搜索期间的修改');const during=await exported();release()
 await page.getByRole('status').filter({hasText:'生成期间教程已有修改'}).waitFor({timeout:20000});assert.deepEqual(await exported(),during);await page.unroute('**/build-order.worker.ts*')
 await button('教程 Undo').click();assert.deepEqual(await exported(),edited)
 await budget();await field('规划几何检查预算').fill('3');await generate('budget-exhausted');assert.ok(await button('采用未完成候选 Draft').count());assert.deepEqual(await exported(),edited)
 await field('规划几何检查预算').fill('2000');await field('每步新增连接上限').fill('1');await field('规划束宽').fill('1');await generate('search-limited');assert.deepEqual(await exported(),edited)
 await field('每步新增连接上限').fill('64');await field('规划束宽').fill('12')
 // Use the already saved purple-photo candidate; this is a UI/geometry test, not a new Vision call.
 const entries=await import('node:fs/promises').then(fs=>fs.readdir(path.join(root,'generated/magnetic-intake/visible3d/executions')))
 const records=await Promise.all(entries.filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(path.join(root,'generated/magnetic-intake/visible3d/executions',f),'utf8'))))
 const purple=records.find(r=>r.candidates.length===4)?.candidates[0].assembly;assert.ok(purple,'saved purple three-panel case required')
 await importAssembly(purple);await build();assert.deepEqual(await exported(),edited,'source switch never silently replaces the saved tutorial')
 await generate();await ready();const purpleTutorial=await exported();assert.equal(purpleTutorial.steps.length,3);assert.deepEqual(purpleTutorial.assembly.pieces,purple.pieces);assert.deepEqual(purpleTutorial.assembly.profiles,purple.profiles)
 await button('保存教程').click();await page.reload();await button('3D 教程').click();await ready();assert.deepEqual(await exported(),purpleTutorial)
 await field('打开 Tutorial3D 文件').setInputFiles({name:'purple.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(purpleTutorial))});assert.deepEqual(await exported(),purpleTutorial)
 await button('重新开始').click();await button('自动播放').click();await page.getByTestId('tutorial-progress').filter({hasText:'播放完成'}).waitFor({timeout:15000})
 await button('Fit to View').click();await button('Reset Camera').click();await button('锁定视角').click();await button('解锁视角').click();assert.deepEqual(await exported(),purpleTutorial)
 // Close advanced panels before visual QA of the ordinary workflow.
 await page.locator('.magnetic-tutorial-advanced > summary').click()
 for(const width of [1650,1100,680]){
  await page.setViewportSize({width,height:1000});await page.locator('.magnetic-3d-build>h3').scrollIntoViewIfNeeded();await ready()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false)
  if(width>=761)await page.locator('.magnetic-tutorial-inspector').evaluate(e=>e.closest('.studio-inspector').scrollTop=0)
  await page.screenshot({path:out+`/tutorial-${width}.png`})
  if(width<761){await button('检查器').click();assert.equal(await button('保存教程').isVisible(),true);assert.equal(await field('3D 历史教程').isVisible(),true);await button('工作区').click()}
 }
 await page.setViewportSize({width:1650,height:1100})
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click();await button('Edit Draft').click();await page.locator(`[data-3d-piece="${purple.pieces[0].id}"]`).click();const x=Number(await field('3D 位置 X').inputValue());await field('3D 位置 X').fill(String(x+.1));await field('3D 位置 X').press('Enter');await field('3D 位置 X').fill(String(x));await field('3D 位置 X').press('Enter');await button('保存 3D Draft').click();await build();assert.match(await page.locator('.magnetic-tutorial-warning').filter({hasText:'与当前 Assembly 不同'}).textContent(),/与当前 Assembly 不同/);assert.equal(await button('保存教程').isDisabled(),true);assert.deepEqual(await exported(),purpleTutorial)
 const invalid=structuredClone(purple);invalid.pieces[1].pose=structuredClone(invalid.pieces[0].pose);await importAssembly(invalid);await build();assert.equal(await button('重新生成教程').isDisabled(),true);assert.deepEqual(await exported(),purpleTutorial)
 // Restore original Assembly and verify tutorial operations have not rewritten it or 2D state.
 const finalAssembly=await importAssembly(purple);await build();await button('2D 教程').click();if(await button('继续当前教程').isVisible())await button('继续当前教程').click()
 const after2d=page.waitForEvent('download');await button('导出教程 JSON').click();assert.deepEqual(JSON.parse(await readFile(await(await after2d).path(),'utf8')),saved2d);assert.match(await page.locator('.build-step-heading').filter({visible:true}).textContent(),/已完成/)
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click();const io=page.locator('.magnetic-3d-load');if(!await io.evaluate(e=>e.open))await io.locator('summary').click();const d=page.waitForEvent('download');await button('导出 Assembly3D').click();assert.deepEqual(JSON.parse(await readFile(await(await d).path(),'utf8')),finalAssembly)
 await button('2D 查看').click();assert.deepEqual(await page.locator('[data-tile-id]').evaluateAll(els=>els.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points'),color:e.getAttribute('fill')}))),twoD)
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 const result={worker:'real Worker; pair 2 steps, cube 6 steps/12 connections, saved purple snapshot 3 steps',workflow:'empty preparation, direct preview, no Candidate Adopt required, explicit save/history/open',protection:'declined regeneration, edits during generation, budgets, source revision mismatch, invalid geometry',playback:'prev/next, seek, auto/pause/restart, Fit/Reset/lock',persistence:'pair/cube/purple retained, reload and JSON file import/export',widths:[1650,1100,680],productionWrites:0,modelCalls:0,writes,errors,consoleErrors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){console.error(JSON.stringify({errors,consoleErrors}));if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server.close();await rm(data,{recursive:true,force:true})}

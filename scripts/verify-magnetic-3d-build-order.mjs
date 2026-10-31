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
 async function exported(){const details=page.locator('.magnetic-tutorial-io');if(!await details.evaluate(e=>e.open))await details.locator('summary').click();const dl=page.waitForEvent('download');await button('导出 Tutorial3D').click();return JSON.parse(await readFile(await(await dl).path(),'utf8'))}
 async function ready(){const p=page.getByTestId('tutorial-player'),d=p.locator('details');if(!await d.evaluate(e=>e.open))await d.locator('summary').click();await page.waitForFunction(()=>{const c=document.querySelector('.magnetic-tutorial-canvas canvas'),p=document.querySelector('.magnetic-tutorial-canvas');return c&&p&&c.width>=p.clientWidth*.9&&c.height>=p.clientHeight*.9&&p.clientWidth>0})}
 const status=()=>page.getByTestId('build-order-status').textContent()
 async function generate(expected='complete'){await button('Generate Build Order').click();await page.getByTestId('build-order-status').filter({hasText:expected}).waitFor({timeout:20000})}
 async function budget(){const d=page.locator('.magnetic-build-order>details');if(!await d.evaluate(e=>e.open))await d.locator('summary').click()}
 async function build(){await page.locator('[data-stage="build"]').click();await button('3D 教程').click()}
 const pair=JSON.parse(await readFile(path.join(root,'src/magnetic-tiles/three-d/examples/right-angle.json'),'utf8'))
 const cube=JSON.parse(await readFile(path.join(root,'src/magnetic-tiles/three-d/examples/closed-cube.json'),'utf8'))
 await page.goto(url);await button('添加正方形').click()
 const twoD=await page.locator('[data-tile-id]').evaluateAll(els=>els.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points'),color:e.getAttribute('fill')})))
 await page.locator('[data-stage="build"]').click();await button('生成搭建步骤').click();await button('保存教程').click();await button('完成搭建').click()
 const dl2d=page.waitForEvent('download');await button('导出教程 JSON').click();const saved2d=JSON.parse(await readFile(await(await dl2d).path(),'utf8'))
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click();await page.locator('.magnetic-3d-canvas canvas').waitFor()
 await build();await generate();assert.match(await status(),/complete · 2 步/)
 assert.equal(await page.getByTestId('tutorial-player').count(),0,'generation does not adopt or play automatically')
 await button('采用为 Tutorial Draft').click();await ready()
 const pairTutorial=await exported();assert.deepEqual(pairTutorial.assembly,pair);assert.deepEqual(pairTutorial.steps.flatMap(s=>s.addedPieceIds),['base','wall'])
 await button('保存 Tutorial Draft').click()
 await button('重新播放').click();await page.getByTestId('tutorial-progress').filter({hasText:'播放完成'}).waitFor({timeout:10000})
 assert.deepEqual(await exported(),pairTutorial)
 await generate();assert.deepEqual(await exported(),pairTutorial,'regeneration preserves the current draft')
 acceptDialogs=false;await button('采用候选并替换当前 Draft').click();assert.deepEqual(await exported(),pairTutorial,'declined replacement is non-destructive');acceptDialogs=true
 await button('采用候选并替换当前 Draft').click();await ready();assert.deepEqual(await exported(),pairTutorial,'identical input yields an identical Tutorial3D')
 console.log('PASS real Worker, deterministic pair, explicit adoption/replacement and pause-free playback')
 // Exhausted searches do not replace the accepted tutorial, including when they produce a partial candidate.
 await budget();await field('规划几何检查预算').fill('0');await generate('budget-exhausted');assert.match(await page.getByTestId('build-order-stats').textContent(),/0\/0/)
 assert.deepEqual(await exported(),pairTutorial)
 await field('规划几何检查预算').fill('2000')
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click();await page.locator('[data-3d-example="closed-cube"]').click()
 await button('从当前作品创建 Draft').click();await button('保存 3D Draft').click()
 await build();assert.equal(await button('采用候选并替换当前 Draft').count(),0,'failed candidates cannot be mistaken for a completed plan')
 await generate();assert.match(await status(),/complete · 6 步/);assert.deepEqual(await exported(),pairTutorial,'new-source generation preserves the old tutorial until adoption')
 await button('采用候选并替换当前 Draft').click();await ready()
 const generated=await exported();assert.equal(generated.steps.length,6);assert.equal(generated.steps.flatMap(s=>s.addedConnections).length,12)
 assert.deepEqual(generated.assembly.pieces,cube.pieces);assert.deepEqual(generated.assembly.profiles,cube.profiles)
 assert.equal(generated.steps[0].addedPieceIds[0],'bottom');assert.equal(generated.steps.at(-1).addedPieceIds[0],'top')
 for(const s of generated.steps){await page.getByTestId(`step-card-${s.id}`).click();assert.match(await page.getByTestId('tutorial-step-validation').textContent(),/Geometry Valid · Connected Construction 通过/)}
 await page.locator('.magnetic-build-order').getByText(/生成 Diagnostic/).click()
 assert.ok(await page.locator('[data-build-order-diagnostic="CLOSURE_OR_SUPPORT_RISK"]').count()>0)
 // Manual editing, Undo, save, reload and actual import/export remain the Phase 4 flow.
 await page.getByTestId('step-card-1').click();await field('3D 步骤标题').fill('人工审核后的底座');await field('3D 步骤说明').fill('先放置基础片，安装时扶稳')
 const edited=await exported();assert.equal(edited.steps[0].title,'人工审核后的底座');assert.deepEqual(edited.assembly,generated.assembly)
 await button('教程 Undo').click();assert.equal((await exported()).steps[0].description,generated.steps[0].description)
 await button('教程 Redo').click();assert.deepEqual(await exported(),edited)
 await button('保存 Tutorial Draft').click();await page.reload();await button('3D 教程').click();await ready();assert.deepEqual(await exported(),edited)
 await field('打开 Tutorial3D 文件').setInputFiles({name:'generated.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(edited))});assert.deepEqual(await exported(),edited)
 await button('重新播放').click();await page.getByTestId('tutorial-progress').filter({hasText:'播放完成'}).waitFor({timeout:20000})
 assert.deepEqual(await exported(),edited);await page.locator('.magnetic-3d-build>h3').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/generated-cube.png'})
 console.log('PASS all cube prefixes, manual editing, save/refresh/import and exact source preservation')
 // Re-running a constrained/budgeted search cannot damage the accepted draft.
 await budget();await field('规划几何检查预算').fill('3');await generate('budget-exhausted');assert.ok(await button('采用未完成候选 Draft').count())
 assert.deepEqual(await exported(),edited);await field('规划几何检查预算').fill('2000');await field('每步新增连接上限').fill('1');await field('规划束宽').fill('1');await generate('search-limited')
 assert.deepEqual(await exported(),edited);await field('每步新增连接上限').fill('64');await field('规划束宽').fill('12');await generate()
 // Keep a completed candidate while selecting a different source; its adoption must be disabled.
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click();await page.locator('[data-3d-example="mixed-profiles"]').click();await build()
 assert.equal(await button('采用候选并替换当前 Draft').isDisabled(),true)
 await generate('no-order');assert.ok(await page.locator('[data-build-order-diagnostic="DISCONNECTED_SOURCE"]').count())
 assert.deepEqual(await exported(),edited)
 // Illegal source geometry is blocked in the UI, not silently repaired by planning.
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click();await button('从当前作品创建 Draft').click();await page.locator('[data-3d-piece="base"]').click()
 await field('3D 位置 Y').fill('2');await field('3D 位置 Y').press('Enter');await build();assert.equal(await button('Generate Build Order').isDisabled(),true)
 assert.deepEqual(await exported(),edited)
 // Verify saved Assembly and 2D document/progress isolation after all generated/failed candidates.
 await page.reload();await button('3D 教程').click();await ready();assert.deepEqual(await exported(),edited)
 await button('2D 教程').click();if(await button('继续当前教程').isVisible())await button('继续当前教程').click()
 const after2d=page.waitForEvent('download');await button('导出教程 JSON').click();assert.deepEqual(JSON.parse(await readFile(await(await after2d).path(),'utf8')),saved2d)
 assert.match(await page.locator('.build-step-heading').filter({visible:true}).textContent(),/已完成/)
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click()
 const io=page.locator('.magnetic-3d-load');if(!await io.evaluate(e=>e.open))await io.locator('summary').click()
 const d=page.waitForEvent('download');await button('导出 Assembly3D').click();assert.deepEqual(JSON.parse(await readFile(await(await d).path(),'utf8')),edited.assembly)
 await button('2D 查看').click();assert.deepEqual(await page.locator('[data-tile-id]').evaluateAll(els=>els.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points'),color:e.getAttribute('fill')}))),twoD)
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 const result={worker:'real module Worker, deterministic pair and cube generation',adoption:'generation never overwrites; declined and accepted replacement verified',cube:'six steps, twelve connections; all intermediate stages geometry valid and connected',review:'closure/support warnings, exact budgets, incomplete and no-order results',persistence:'manual edit, undo/redo, save, refresh, actual file import/export',isolation:'stale candidate disabled; invalid source blocked; Assembly and 2D saved content/progress preserved',writes,errors,consoleErrors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){console.error(JSON.stringify({errors,consoleErrors}));if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server.close();await rm(data,{recursive:true,force:true})}

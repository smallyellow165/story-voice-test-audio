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
const out=process.env.MAGNETIC_3D_ARTIFACTS||'/tmp/magnetic-phase4-browser'
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
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});page.on('dialog',d=>d.accept())
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true})
 async function exported(){const details=page.locator('.magnetic-tutorial-io');if(!await details.evaluate(e=>e.open))await details.locator('summary').click();const dl=page.waitForEvent('download');await button('导出 Tutorial3D').click();return JSON.parse(await readFile(await(await dl).path(),'utf8'))}
 async function assign(id){const join=button(`加入零件 ${id}`);if(!await join.isVisible())await page.getByRole('button',{name:/展开可添加零件/}).click();await join.click()}
 async function addStep(id,title){await button('新增步骤').click();await field('3D 步骤标题').fill(title);await assign(id)}
 const validation=()=>page.getByTestId('tutorial-validation').textContent()
 const progress=()=>page.getByTestId('tutorial-progress').textContent()
 const camera=async()=>JSON.parse(await field('3D Tutorial 相机').textContent())
 const visible=async()=>JSON.parse(await field('3D Tutorial 可见零件').textContent())
 async function ready(){const details=page.getByTestId('tutorial-player').locator('details');if(!await details.evaluate(e=>e.open))await details.locator('summary').click();await page.waitForFunction(()=>{const c=document.querySelector('.magnetic-tutorial-canvas canvas'),p=document.querySelector('.magnetic-tutorial-canvas');return c&&p&&c.width>=p.clientWidth*.9&&c.height>=p.clientHeight*.9&&p.clientWidth>0});await field('3D Tutorial 相机').filter({hasText:/position/}).waitFor()}
 async function build(){await page.locator('[data-stage="build"]').click();await button('3D 教程').click()}
 await page.goto(url);await button('添加正方形').click()
 const twoD=await page.locator('[data-tile-id]').evaluateAll(els=>els.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points'),color:e.getAttribute('fill')})))
 await page.locator('[data-stage="build"]').click();await button('生成搭建步骤').click();await button('保存教程').click();await button('完成搭建').click()
 const dl2d=page.waitForEvent('download');await button('导出教程 JSON').click();const saved2d=JSON.parse(await readFile(await(await dl2d).path(),'utf8'))
 await page.locator('[data-stage="assembly"]').click()
 await button('3D 查看').click();await page.locator('.magnetic-3d-canvas canvas').waitFor()
 const pair=JSON.parse(await readFile(path.join(root,'src/magnetic-tiles/three-d/examples/right-angle.json'),'utf8'))
 await build();await button('从当前 3D Assembly 创建教程').click();await ready()
 await addStep(pair.pieces[0].id,'底座');await field('3D 步骤说明').fill('先放第一片正方形')
 await button('原位淡入').click();await button('设为本步镜头').click()
 await addStep(pair.pieces[1].id,'垂直连接');await field('3D 步骤说明').fill('沿边连接为 90°')
 await button('原位淡入').click();await button('Fit to View').click()
 // Real camera rotation/pan/zoom, captured through upstream orchestration panel.
 const box=await page.locator('.magnetic-tutorial-canvas canvas').boundingBox()
 await page.mouse.move(box.x+box.width*.45,box.y+box.height*.45);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5,{steps:12});await page.mouse.up();await page.mouse.wheel(0,-100)
 await button('设为本步镜头').click();await field('本步相机过渡毫秒').fill('1200');await page.getByTitle('展开详细参数',{exact:true}).click();await field(`${pair.pieces[1].id} 入场时长`).fill('1500')
 console.log('PASS authored pair steps and cameras');const authored=await exported();assert.equal(authored.steps.length,2);assert.deepEqual(authored.assembly,pair);assert.equal(authored.steps[0].description,'先放第一片正方形')
 assert.notDeepEqual(authored.steps[0].camera.position,authored.steps[1].camera.position)
 assert.match(await validation(),/几何与顺序检查通过/)
 assert.deepEqual((await visible()).newIds,[pair.pieces[1].id]);assert.equal((await visible()).visibleIds.length,2)
 await button('保存 Tutorial Draft').click()
 await page.getByTestId('step-card-1').click();await page.waitForTimeout(950)
 assert.deepEqual((await visible()).visibleIds,[pair.pieces[0].id]);assert.deepEqual((await visible()).newIds,[pair.pieces[0].id])
 await button('下一步').click();await page.waitForTimeout(1400)
 const target=authored.steps[1].camera,c=await camera();assert.ok(Math.abs(c.zoom-target.zoom)<.01,'saved step camera zoom applied')
 c.position.forEach((n,i)=>assert.ok(Math.abs(n-target.position[i])<.01,'saved step camera position applied'))
 await button('Reset Camera').click();const reset=await camera();await page.waitForTimeout(250);assert.deepEqual(await camera(),reset,'camera rig does not overwrite Reset after transition')
 await button('Fit to View').click();assert.deepEqual(await exported(),authored,'camera and navigation leave document unchanged')
 await button('重新播放').click();await page.waitForTimeout(300);await button('暂停').click()
 const paused=await progress();await page.waitForTimeout(2100);assert.equal(await progress(),paused,'pause stops automatic step advance')
 await button('自动播放').click();await page.getByTestId('tutorial-progress').filter({hasText:'播放完成'}).waitFor({timeout:12000})
 assert.deepEqual(await exported(),authored,'all playback animations leave final Pose untouched');assert.equal(JSON.parse(await field('3D Tutorial 播放状态').textContent()).stepTotalMs,2300,'destination step uses its own configured duration')
 console.log('PASS navigation, camera, autoplay, pause and source immutability');await page.screenshot({path:out+'/right-angle.png'})
 // Reorder, delete, re-add via Undo; IDs/camera assignment remain attached to their steps.
 await page.getByTestId('step-card-2').getByTitle('前移',{exact:true}).click()
 let edited=await exported();assert.deepEqual(edited.steps.map(s=>s.id),[2,1]);assert.equal(edited.steps[0].title,'垂直连接')
 await button('教程 Undo').click();assert.deepEqual(await exported(),authored)
 await page.getByTestId('step-card-2').getByTitle('删除步骤',{exact:true}).click();assert.match(await validation(),/尚未通过/)
 await button('教程 Undo').click();assert.deepEqual(await exported(),authored)
 await page.reload();await button('3D 教程').click();await ready();assert.deepEqual(await exported(),authored)
 // Source changes must never rebind the tutorial. Saved Assembly Draft stays independent.
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click();await page.locator('[data-3d-example="closed-cube"]').click()
 await button('从当前作品创建 Draft').click();await button('保存 3D Draft').click()
 await build();assert.match(await page.locator('.magnetic-tutorial-warning').textContent(),/与当前 Assembly 不同/)
 assert.deepEqual(await exported(),authored)
 await button('从当前 3D Assembly 创建教程').click();await ready()
 const cube=JSON.parse(await readFile(path.join(root,'src/magnetic-tiles/three-d/examples/closed-cube.json'),'utf8'))
 for(const [i,p] of cube.pieces.entries()){await addStep(p.id,`立方体第 ${i+1} 片`);await button('无动画').click();await button('设为本步镜头').click()}
 assert.equal(await page.locator('[data-tutorial-diagnostic="DISCONNECTED"]').count()>0,true,'disconnected intermediate steps are diagnosed')
 for(let n=0;n<4;n++)await page.getByTestId('step-card-2').getByTitle('后移',{exact:true}).click()
 const cubeTutorial=await exported();assert.equal(cubeTutorial.steps.length,6);assert.ok(cubeTutorial.steps.every(s=>s.addedPieceIds.length===1),'rapid authoring keeps new step selection separate from old playback reports');assert.equal(cubeTutorial.assembly.connections.length,12)
 assert.deepEqual(cubeTutorial.assembly.pieces,cube.pieces);assert.deepEqual(cubeTutorial.assembly.profiles,cube.profiles)
 assert.match(await validation(),/最终 Assembly Geometry Valid/)
 assert.match(await validation(),/几何与顺序检查通过/,'manually moving the top face last makes every cumulative step connected')
 await button('保存 Tutorial Draft').click();await button('重新播放').click();await page.getByTestId('tutorial-progress').filter({hasText:'播放完成'}).waitFor({timeout:20000})
 assert.equal((await visible()).visibleIds.length,6);assert.equal((await visible()).newIds.length,1)
 await page.reload();await button('3D 教程').click();await ready();assert.deepEqual(await exported(),cubeTutorial)
 await button('重新加载已保存教程').click();assert.deepEqual(await exported(),cubeTutorial)
 // Invalid geometry remains an explicitly unverified, saveable Tutorial Draft.
 const invalid=structuredClone(cubeTutorial);invalid.id='invalid-tutorial';invalid.assembly.pieces[1].pose=structuredClone(invalid.assembly.pieces[0].pose)
 await field('Tutorial3D JSON').fill(JSON.stringify(invalid));await button('导入 Tutorial JSON').click();assert.match(await validation(),/最终 Assembly Geometry Invalid/)
 await button('保存 Tutorial Draft').click();await page.reload();await button('3D 教程').click();await ready();assert.deepEqual(await exported(),invalid);assert.match(await validation(),/最终 Assembly Geometry Invalid/)
 await field('打开 Tutorial3D 文件').setInputFiles({name:'restored-valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(cubeTutorial))});await button('保存 Tutorial Draft').click()
 // Import a modified, incomplete draft, preserve saved source and all geometry.
 const imported=structuredClone(cubeTutorial);imported.id='imported-tutorial';imported.steps[0].title='导入步骤';
 await field('Tutorial3D JSON').fill(JSON.stringify(imported));await button('导入 Tutorial JSON').click();assert.deepEqual(await exported(),imported)
 await field('Tutorial3D JSON').fill('{"broken":true}');await button('导入 Tutorial JSON').click();assert.deepEqual(await exported(),imported)
 // Actual file import, using the same tutorial format.
 await field('打开 Tutorial3D 文件').setInputFiles({name:'tutorial.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(cubeTutorial))});assert.deepEqual(await exported(),cubeTutorial)
 await button('2D 教程').click();if(await button('继续当前教程').isVisible())await button('继续当前教程').click();const dl2dAfter=page.waitForEvent('download');await button('导出教程 JSON').click();assert.deepEqual(JSON.parse(await readFile(await(await dl2dAfter).path(),'utf8')),saved2d);assert.match(await page.locator('.build-step-heading').filter({visible:true}).textContent(),/已完成/);assert.equal(await page.getByTestId('tutorial-player').filter({visible:true}).count(),0)
 await button('3D 教程').click();await ready();assert.deepEqual(await exported(),cubeTutorial)
 await page.getByTestId('step-card-2').click();await page.waitForTimeout(1700);await page.locator('.magnetic-3d-build>h3').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/cube.png'})
 await page.locator('[data-stage="assembly"]').click();await button('3D 查看').click()
 const io=page.locator('.magnetic-3d-load');if(!await io.evaluate(e=>e.open))await io.locator('summary').click()
 const download=page.waitForEvent('download');await button('导出 Assembly3D').click();const actualAssembly=JSON.parse(await readFile(await(await download).path(),'utf8'))
 assert.deepEqual(actualAssembly,cubeTutorial.assembly,'Tutorial creation/edit/play never changes saved Assembly Draft')
 await button('2D 查看').click();assert.deepEqual(await page.locator('[data-tile-id]').evaluateAll(els=>els.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points'),color:e.getAttribute('fill')}))),twoD)
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 const result={pair:'two manually authored steps, pose/camera snapshots, playback/pause/completion',cube:'six manually authored steps, twelve source connections, disconnected intermediate diagnostics',editing:'add, title, description, assign, reorder, delete, undo, camera capture',persistence:'save, refresh, reload, JSON import/export, file import and corrupt-file rejection',isolation:'source mismatch explicit; Assembly/2D remain unchanged',writes,errors,consoleErrors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){console.error(JSON.stringify({errors,consoleErrors}));if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server.close();await rm(data,{recursive:true,force:true})}

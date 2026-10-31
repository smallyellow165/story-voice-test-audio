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
const out=process.env.MAGNETIC_3D_ARTIFACTS||'/tmp/magnetic-phase3-browser'
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
 const summary=()=>page.locator('.magnetic-3d-summary').textContent()
 const select=async id=>{await page.locator(`[data-3d-piece="${id}"]`).click();await field('3D 位置 X').waitFor({state:'visible'})}
 const canvas=()=>page.locator('.magnetic-3d-editor-canvas canvas')
 const ready=()=>page.waitForFunction(()=>{const c=document.querySelector('.magnetic-3d-editor-canvas canvas'),p=document.querySelector('.magnetic-3d-editor-canvas');return c&&p&&c.width>=p.clientWidth*.9&&c.height>=p.clientHeight*.9&&p.clientWidth>0})
 async function exported(){const dl=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await dl).path(),'utf8'))}
 async function jsonOpen(){const details=page.locator('.magnetic-3d-load');if(!await details.evaluate(e=>e.open))await details.locator('summary').click()}
 async function setNumber(label,value){await field(label).fill(String(value));await field(label).press('Enter')}
 async function add(profile='square@1'){await field('3D Catalog Profile').selectOption(profile);await button('添加 3D 零件').click();return page.locator('[data-selected-3d-piece]').getAttribute('data-selected-3d-piece')}
 async function valid(){await page.waitForFunction(()=>document.querySelector('.magnetic-3d-summary')?.textContent.includes('Geometry Valid'))}
 await page.goto(url);await button('添加正方形').click()
 const twoD=await page.locator('[data-tile-id]').evaluateAll(els=>els.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points'),color:e.getAttribute('fill')})))
 await button('3D 查看').click();await button('新建空白 3D Draft').click();await add();await ready()
 const gizmoPiece=await page.locator('[data-selected-3d-piece]').getAttribute('data-selected-3d-piece')
 await field('3D 编辑工具').selectOption('move')
 await page.getByRole('region',{name:'3D 编辑画布',exact:true}).focus();await page.keyboard.press('d');await page.waitForTimeout(500)
 assert.ok(Math.abs(Number(await field('3D 位置 X').inputValue())-.2)<1e-8,'keyboard move updates authoritative pose')
 await button('3D Undo').click();await select(gizmoPiece);assert.equal(Number(await field('3D 位置 X').inputValue()),0)
 await button('3D Redo').click();await select(gizmoPiece);assert.equal(Number(await field('3D 位置 X').inputValue()),.2)
 await setNumber('3D 位置 X',0);await button('Fit to View').click();await button('前').click();await ready();await page.waitForTimeout(100)
 const beforeDrag=Number(await field('3D 位置 X').inputValue());let didMove=false
 for(const dx of [45,65,80,100]){
  await button('Fit to View').click();await button('前').click();await page.waitForTimeout(100)
  const box=await canvas().boundingBox(),cx=box.x+box.width/2,cy=box.y+box.height/2
  await page.mouse.move(cx+dx,cy);await page.mouse.down();await page.mouse.move(cx+dx+45,cy,{steps:12});await page.mouse.up();await page.waitForTimeout(100)
  if(Math.abs(Number(await field('3D 位置 X').inputValue())-beforeDrag)>.001){didMove=true;break}
 }
 assert.ok(didMove,'real mouse TransformControls drag changes X')
 await button('3D Undo').click();await select(gizmoPiece);assert.ok(Math.abs(Number(await field('3D 位置 X').inputValue())-beforeDrag)<1e-8,'one undo restores one entire gizmo drag')
 await field('3D 编辑工具').selectOption('rotate');await button('Fit to View').click();await button('前').click();await ready()
 const beforeRotation=JSON.parse(await page.locator('[data-3d-quaternion]').getAttribute('data-3d-quaternion'));let didRotate=false
 for(const r of [55,75,95,115]){
  const box=await canvas().boundingBox(),cx=box.x+box.width/2,cy=box.y+box.height/2
  await page.mouse.move(cx+r,cy);await page.mouse.down();await page.mouse.move(cx+r*.7,cy-r*.7,{steps:15});await page.mouse.up();await page.waitForTimeout(100)
  const q=JSON.parse(await page.locator('[data-3d-quaternion]').getAttribute('data-3d-quaternion'))
  if(q.some((n,i)=>Math.abs(n-beforeRotation[i])>.001)){didRotate=true;break}
 }
 assert.ok(didRotate,'real mouse TransformControls rotation changes quaternion')
 await button('3D Undo').click();await select(gizmoPiece)
 assert.deepEqual(JSON.parse(await page.locator('[data-3d-quaternion]').getAttribute('data-3d-quaternion')),beforeRotation)
 await page.screenshot({path:out+'/gizmo.png'});console.log('PASS keyboard, actual mouse move/rotate, single-transaction undo')
 // Start the documented from-zero construction using real Catalog + edge controls.
 await button('新建空白 3D Draft').click();const base=await add(),wall=await add()
 await field('3D 目标零件 A').selectOption(base);await field('3D 自身端口 B').selectOption('e0-p0');await field('3D 目标端口 A').selectOption('e0-p0')
 await field('新连接二面角').fill('90');await button('吸附并建立连接').click();await valid()
 assert.match(await summary(),/2 片 · 1 条连接/)
 await button('3D Undo').click();assert.match(await summary(),/2 片 · 0 条连接/)
 await button('3D Redo').click();await valid()
 const triangle=await add('right-triangle@1');await field('3D 目标零件 A').selectOption(base);await field('3D 目标端口 A').selectOption('e2-p0')
 await button('吸附并建立连接').click();await valid();assert.match(await summary(),/3 片 · 2 条连接/)
 await button('复制').click();assert.match(await summary(),/4 片/);await button('删除').click();assert.match(await summary(),/3 片/)
 await button('3D Undo').click();assert.match(await summary(),/4 片/);await button('3D Redo').click();await select(triangle)
 await field('当前 3D 零件颜色').fill('#123456')
 await page.getByText('修改当前 Profile 快照厚度',{exact:true}).click();await field('当前 Profile 厚度').fill('.08');await button('应用快照厚度').click()
 await valid();await jsonOpen();const built=await exported();assert.equal(built.profiles.find(s=>s.profile.id==='right-triangle').thickness,.08)
 assert.equal(built.pieces.find(p=>p.id===triangle).color,'#123456')
 // Wrong angle is a constraint edit, no silent pose update. Explicit solve is separate.
 await page.locator('[data-3d-connection="0"]').click();const beforeAngle=await exported()
 await button('-90°').click();assert.match(await summary(),/Geometry Invalid/)
 assert.deepEqual((await exported()).pieces,beforeAngle.pieces)
 await button('3D Undo').click();await valid()
 await page.locator('[data-3d-connection="0"]').click()
 await page.getByText('修改连接端口',{exact:true}).click();await field('连接端口 B').selectOption('e1-p0')
 await button('更新连接端口（不移动）').click();assert.match(await summary(),/Geometry Invalid/)
 const changedPorts=await exported();assert.equal(changedPorts.connections[0].portB,'e1-p0');assert.deepEqual(changedPorts.pieces,beforeAngle.pieces)
 await button('3D Undo').click();await valid();await page.locator('[data-3d-connection="0"]').click()
 await button('断开连接').click();assert.match(await summary(),/3 片 · 1 条连接/)
 assert.deepEqual((await exported()).pieces,beforeAngle.pieces)
 await button('3D Undo').click();await valid();assert.match(await summary(),/3 片 · 2 条连接/)
 // Save an intentionally unfinished/colliding draft, reload the page, and compare exact snapshots.
 await select(wall);await setNumber('3D 位置 X',0);await setNumber('3D 位置 Y',.025);await setNumber('3D 位置 Z',0);await setNumber('3D 旋转 X',-90)
 assert.match(await summary(),/Geometry Invalid/)
 assert.match(await page.locator('.magnetic-3d-inspector').textContent(),/穿透|重叠/)
 const invalid=await exported();await button('保存 3D Draft').click();await page.reload();await button('3D 查看').click();await jsonOpen()
 assert.deepEqual(await exported(),invalid);assert.match(await summary(),/Geometry Invalid/)
 assert.equal(await button('保存 3D Draft').count(),0,'View has no mutation/save controls')
 await button('Fit to View').click();await button('Reset Camera').click();await page.locator('[data-3d-piece]').first().click()
 assert.deepEqual(await exported(),invalid,'view selection/camera/export preserve all poses and constraints')
 await button('Edit Draft').click();await select(base);await button('显式求解（固定选中片）').click();await valid()
 await button('保存 3D Draft').click();const repaired=await exported();await button('重新加载已保存 Draft').click();assert.deepEqual(await exported(),repaired)
 console.log('PASS Catalog, edge snap, three-piece structure, color/thickness, invalid draft save/refresh, read-only view')
 // Existing cube becomes an editable Draft without losing any of its twelve constraints.
 await page.locator('[data-3d-example="closed-cube"]').click();await button('从当前作品创建 Draft').click();await select('top')
 assert.match(await summary(),/6 片 · 12 条连接/);await setNumber('3D 位置 X',.2);assert.match(await summary(),/Geometry Invalid/)
 await button('3D Undo').click();await valid();await select('top');await button('删除').click();assert.match(await summary(),/5 片 · 8 条连接/)
 await button('3D Undo').click();await valid();assert.match(await summary(),/6 片 · 12 条连接/)
 await button('保存 3D Draft').click();const savedCube=await exported();await page.reload();await button('3D 查看').click();await jsonOpen()
 assert.deepEqual(await exported(),savedCube)
 await button('2D 查看').click()
 assert.deepEqual(await page.locator('[data-tile-id]').evaluateAll(els=>els.map(e=>({id:e.dataset.tileId,points:e.getAttribute('points'),color:e.getAttribute('fill')}))),twoD)
 for(const stage of ['source','review','reconstruction','build','assembly'])await page.locator(`[data-stage="${stage}"]`).click()
 await button('3D 查看').click();await page.locator('.magnetic-3d-canvas canvas').waitFor({state:'visible'})
 await page.waitForFunction(()=>{const c=document.querySelector('.magnetic-3d-canvas canvas'),p=document.querySelector('.magnetic-3d-canvas');return c&&p&&c.width>=p.clientWidth*.9&&c.height>=p.clientHeight*.9&&p.clientWidth>0})
 await page.waitForTimeout(500)
 await page.screenshot({path:out+'/restored-cube.png'})
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 const result={catalog:'add/copy/delete/versioned snapshots',interaction:'keyboard + real mouse gizmo translation/rotation',connections:'90 degree snap, angle editing, diagnostics, explicit solve',history:'pose/connection/delete undo-redo',persistence:'invalid and valid drafts saved/refreshed/restored exactly',view:'no mutations',cube:'6 pieces / 12 connections edited and restored',twoD:'draft and five-stage navigation preserved',writes,errors,consoleErrors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
} catch(e){console.error(JSON.stringify({errors,consoleErrors}));if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server.close();await rm(data,{recursive:true,force:true})}

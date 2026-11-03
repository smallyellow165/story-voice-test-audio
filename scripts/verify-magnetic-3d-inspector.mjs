// Isolated browser + saved fixture; no model calls or formal history writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-inspector-')),out='/tmp/magnetic-3d-inspector',api=createMagneticIntake(dir)
let browser,server,page
const errors=[],consoleErrors=[],calls=[]
try{
 await mkdir(out,{recursive:true})
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-inspector-api',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{calls.push([req.method,req.url]);if(req.method!=='GET'){res.statusCode=403;res.end('No writes/models');return}try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch('GET',req.url.slice(1).split('?')[0])))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})}}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1660,height:1100},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});page.on('dialog',d=>d.accept())
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true})
 const label=id=>page.locator(`[data-tile-label="${id}"]`),select=id=>page.locator(`[data-3d-piece="${id}"]`).click()
 const table=()=>page.getByRole('region',{name:'Tiles & Connections',exact:true}),details=()=>page.getByRole('region',{name:'Selection Detail',exact:true}),check=()=>page.getByRole('region',{name:'Geometry Check',exact:true})
 const canvas=()=>page.locator('.magnetic-3d-canvas canvas,.magnetic-3d-editor-canvas canvas')
 async function frames(){await canvas().scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>{let n=0;const frame=()=>++n===20?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame)}))}
 async function open(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function exported(){await open(page.locator('.magnetic-3d-load'));const dl=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await dl).path(),'utf8'))}
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`);await button('3D').click()
 const f=JSON.parse(await readFile(path.join(root,'checks/magnetic-3d/fixtures/orange-reviewed-geometry.json'),'utf8')),orange=executeVisible3D(f.plan,f.input).diagnosticCandidates[0].assembly
 await open(page.locator('.magnetic-3d-load'));await field('Assembly3D JSON').fill(JSON.stringify(orange));await button('加载 JSON').click();await frames()
 assert.match(await check().textContent(),/Geometry Invalid/);assert.equal(await check().locator('details').evaluate(e=>e.open),false)
 assert.equal(await table().locator('tbody tr').count(),6);assert.equal(await table().locator('[data-3d-connection]').count(),14);assert.equal(await page.locator('[data-tile-label]').count(),6);assert.equal(await field('显示 Tile ID').isChecked(),true)
 await check().locator(':scope>details>summary').click();await check().getByText('碰撞空间证据 / Raw',{exact:true}).click();const collisionEvidence=JSON.parse(await check().locator('pre').innerText());assert.ok(collisionEvidence.length>0&&collisionEvidence.every(c=>c.pieceIds.length===2));await check().locator(':scope>details>summary').click();await button('3D Inspector说明').click();await page.getByRole('region',{name:'3D Inspector说明',exact:true}).waitFor({state:'visible'});await page.keyboard.press('Escape');assert.equal(await page.locator('.magnetic-3d-edit-tools').evaluate(e=>e.open),false);assert.match(await details().innerText(),/点击画布或表格/)
 // Every actual Piece ID is selectable, including an occluded far-side tile.
 for(const p of orange.pieces){await select(p.id);await frames();assert.equal(await page.locator('[data-selected-3d-piece]').getAttribute('data-selected-3d-piece'),p.id);assert.equal(await label(p.id).getAttribute('data-selected'),'true');assert.equal(await label(p.id).evaluate(e=>getComputedStyle(e).visibility),'visible')}
 const link=table().locator('[data-3d-connection="0"]');await link.first().click();await frames();assert.equal(await page.locator('[data-selected-3d-connection]').getAttribute('data-selected-3d-connection'),'0');assert.equal(await link.evaluateAll(es=>es.every(e=>e.getAttribute('aria-pressed')==='true')),true)
 assert.deepEqual((await page.locator('[data-tile-label][data-selected=true]').evaluateAll(es=>es.map(e=>e.dataset.tileLabel))).sort(),[orange.connections[0].pieceA,orange.connections[0].pieceB].sort());assert.deepEqual(await exported(),orange)
 await frames();await page.screenshot({path:out+'/connection-view.png'});await link.last().click();assert.equal(await page.locator('[data-selected-3d-connection]').getAttribute('data-selected-3d-connection'),'0')
 // Labels are projected inside canvas bounds and do not intercept a mesh click.
 await select('tile1');await frames();let rect=await label('tile1').boundingBox(),bounds=await canvas().boundingBox();assert.ok(rect.x>=bounds.x-1&&rect.y>=bounds.y-1&&rect.x+rect.width<=bounds.x+bounds.width+1&&rect.y+rect.height<=bounds.y+bounds.height+1)
 const before=await label('tile1').evaluate(e=>e.style.transform);await button('Reset Camera').click();await frames();bounds=await canvas().boundingBox();await page.mouse.move(bounds.x+bounds.width*.8,bounds.y+bounds.height*.8);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.8+90,bounds.y+bounds.height*.8-35,{steps:12});await page.mouse.up();await frames();assert.notEqual(await label('tile1').evaluate(e=>e.style.transform),before)
 await button('Reset Camera').click();await select('tile1');await frames();rect=await label('tile1').boundingBox();await table().locator('[data-3d-connection="0"]').first().click();await frames();await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);await page.locator('[data-selected-3d-piece="tile1"]').waitFor({state:'visible'});assert.equal(await label('tile1').evaluate(e=>getComputedStyle(e).pointerEvents),'none')
 await field('显示 Tile ID').uncheck();assert.equal(await page.locator('[data-tile-label]').count(),0);await field('显示 Tile ID').check();await frames();assert.deepEqual(await exported(),orange)
 await button('Edit Draft').click();await frames();assert.equal(await page.locator('[data-tile-label]').count(),6)
 const draft=await exported();await table().locator('[data-3d-connection="0"]').first().click();await frames();await page.screenshot({path:out+'/connection-edit.png'});await button('断开连接').click();assert.equal((await exported()).connections.length,6);await button('3D Undo').click();assert.deepEqual(await exported(),draft);await button('3D Redo').click();assert.equal((await exported()).connections.length,6);await button('3D Undo').click()
 await select('tile1');await field('3D 位置 X').fill('2');await field('3D 位置 X').press('Enter');assert.match(await check().textContent(),/Geometry Invalid/);await button('3D Undo').click();await select('tile1');assert.deepEqual((await exported()).pieces,draft.pieces)
 await open(page.locator('.magnetic-3d-edit-tools'));await open(page.locator('.magnetic-3d-edit-tools details').filter({has:page.getByLabel('3D Catalog Profile',{exact:true})}));await button('Rotate').click();await field('3D Catalog Profile').selectOption('square@1');assert.equal(await button('添加 3D 零件').isEnabled(),true)
 await button('Revalidate Geometry').click();await page.getByRole('alert').filter({hasText:'严格复验失败'}).waitFor();await button('保存 3D Draft').click();const saved=await exported();await page.reload();assert.deepEqual(await exported(),saved);assert.match(await check().textContent(),/Geometry Invalid/);await button('Edit Draft').click();await select('tile1');await frames()
 // Summary, table and selected labels fit a resizable inspector without inner scrolling.
 for(const width of [1660,1100,680]){await page.setViewportSize({width,height:1000});if(width<761){await button('检查器').click()}await select('tile1');assert.equal(await table().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);if(width>=761){await frames();await check().scrollIntoViewIfNeeded()}await page.screenshot({path:`${out}/inspector-${width}.png`})}
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.equal(calls.some(([m])=>m!=='GET'),false)
 const result={passed:true,orange:'6 labels, 6 Tile rows, 7 unique Connections referenced twice; exact Pose preserved',selection:'table ↔ real canvas hit ↔ detail; both connection endpoint labels selected',labels:'camera projection, orbit, occlusion, toggle, no pointer interception; View and Edit',editing:'disconnect, pose edit, Undo/Redo, strict revalidate, invalid save/reload',layout:[1660,1100,680],models:0,productionWrites:0,errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

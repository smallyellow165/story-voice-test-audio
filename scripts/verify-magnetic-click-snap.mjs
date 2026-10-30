import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {startMagneticSandbox} from './magnetic-sandbox.mjs'
import {stage,rightTab,studioButton} from './magnetic-studio-browser.mjs'
import {validate} from '../src/magnetic-tiles/geometry.ts'
const sandbox=await startMagneticSandbox(),base=sandbox.origin,url=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-click-snap',get=async route=>(await fetch(base+'/api/magnetic-intake/'+route)).json(),registry=await get('profiles'),beforeHistory=await get('history')
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1550,height:1000},acceptDownloads:true}),errors=[],writes=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));context.on('request',r=>{if(r.url().includes('/api/magnetic-intake/')&&r.method()==='POST')writes.push(r.url())})
const tile=(id,x=0,y=0)=>({id,profileId:'square',profileVersion:1,color:'#f5b942',pose:{x,y,angleRad:0}}),assembly=instances=>({schemaVersion:1,id:'click-browser-test',revision:0,name:'Click acceptance',instances}),page=await context.newPage(),mode=page.getByLabel('吸附方式',{exact:true}),message=page.locator('.board-message'),polygon=id=>page.locator(`[data-tile-id="${id}"]`)
const center=locator=>locator.evaluate(el=>{const p=el.getAttribute('points').split(' ').map(s=>s.split(',').map(Number)),q=new DOMPoint(p.reduce((n,v)=>n+v[0],0)/p.length,p.reduce((n,v)=>n+v[1],0)/p.length).matrixTransform(el.getScreenCTM());return{x:q.x,y:q.y}})
async function click(id){const p=await center(polygon(id));await page.mouse.click(p.x,p.y)}
async function exportAssembly(){await stage(page,'assembly','inspector');const event=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON',exact:true}).click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
async function load(a){await stage(page,'assembly','inspector');await page.locator('.storage-panel input[type=file]').setInputFiles({name:'isolated-click.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(a))});await page.waitForFunction(n=>document.querySelectorAll('[data-tile-id]').length===n,a.instances.length);await page.waitForFunction(()=>document.querySelector('.board-message').textContent.includes('已导入'));return exportAssembly()}
await mkdir(out,{recursive:true})
try{
 await page.goto(url+'?stage=assembly&rightTab=inspector');await mode.waitFor();assert.equal(await mode.inputValue(),'drag')
 const scene=assembly([tile('anchor'),tile('loose',1.08,.04)]),initial=await load(scene)
 await click('loose');assert.deepEqual(await exportAssembly(),initial,'ordinary click in default drag mode only selects')
 await mode.selectOption('click');await click('loose');assert.match(await message.innerText(),/已单击吸附/);const snapped=await exportAssembly();assert.equal(snapped.revision,initial.revision+1);assert.deepEqual(snapped.instances[0],initial.instances[0]);assert.equal(validate(snapped.instances,registry.profiles).valid,true)
 await click('loose');assert.match(await message.innerText(),/无需调整/);assert.deepEqual(await exportAssembly(),snapped)
 await studioButton(page,'撤销').click();assert.deepEqual(await exportAssembly(),initial,'successful snap creates one Undo step')
 await polygon('loose').focus();await page.keyboard.press('Enter');assert.match(await message.innerText(),/已单击吸附/);assert.equal((await exportAssembly()).revision,initial.revision+1)
 await page.getByRole('button',{name:'保存作品快照',exact:true}).click();await page.reload();await mode.waitFor();assert.equal(await mode.inputValue(),'drag','mode is temporary and resets on reload');const saved=await exportAssembly();assert.equal(validate(saved.instances,registry.profiles).valid,true)
 await studioButton(page,'生成搭建步骤').click();await page.getByRole('button',{name:'保存教程',exact:true}).waitFor();assert.equal(await page.locator('[data-build-tile]').count(),1);await page.getByRole('button',{name:'下一步',exact:true}).click();assert.equal(await page.locator('[data-build-tile]').count(),2)
 await stage(page,'assembly','workspace');await mode.selectOption('click');await rightTab(page,'catalog');await rightTab(page,'inspector');assert.equal(await mode.inputValue(),'click')
 // Native pointer motion in click mode does not turn into a drag or a snap.
 const beforeMotion=await load(scene),p=await center(polygon('loose'));await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+15,p.y,{steps:5});assert.equal(await page.locator('.snap-preview').count(),0);await page.mouse.up();assert.match(await message.innerText(),/不拖动零件/);assert.deepEqual(await exportAssembly(),beforeMotion)
 const far=await load(assembly([tile('anchor'),tile('loose',4,3)]));await click('loose');assert.match(await message.innerText(),/附近没有/);assert.deepEqual(await exportAssembly(),far)
 const ambiguous=await load(assembly([tile('left',-1.08),tile('right',1.08),tile('loose')]));await click('loose');assert.match(await message.innerText(),/多个相近候选/);assert.deepEqual(await exportAssembly(),ambiguous)
 await page.screenshot({path:out+'/ambiguous.png'})
 const point=await load(assembly([tile('anchor'),tile('loose',1,1)]));await click('loose');assert.match(await message.innerText(),/附近没有/);assert.deepEqual(await exportAssembly(),point)
 // Real saved cat geometry imported only into this isolated browser workspace.
 const cat=JSON.parse(await readFile(new URL('../test/fixtures/magnetic-intake/cat-assembly-click-snap.json',import.meta.url))),catBefore=await load(cat.assembly)
 assert.equal(catBefore.instances.length,9)
 for(const t of catBefore.instances){await click(t.id);assert.match(await message.innerText(),/已有合法连接/);assert.deepEqual(await exportAssembly(),catBefore)}
 const report=validate((await exportAssembly()).instances,registry.profiles);assert.equal(report.connections.length,8);assert.equal(report.components.length,1);assert.equal(report.valid,true)
 await page.setViewportSize({width:1024,height:700});assert.ok(await page.locator('.board-toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:out+'/cat.png'})
 // Touch uses the same actual click handler, with no synthetic drag events.
 const touchContext=await browser.newContext({viewport:{width:430,height:900},isMobile:true,hasTouch:true}),touch=await touchContext.newPage();await touch.goto(url+'?stage=assembly&rightTab=inspector');await stage(touch,'assembly','inspector');await touch.locator('.storage-panel input[type=file]').setInputFiles({name:'touch.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(scene))});await touch.waitForFunction(()=>document.querySelectorAll('[data-tile-id]').length===2);await stage(touch,'assembly','workspace');await touch.getByLabel('吸附方式',{exact:true}).selectOption('click');const tp=await center(touch.locator('[data-tile-id="loose"]'));await touch.touchscreen.tap(tp.x,tp.y);assert.match(await touch.locator('.board-message').innerText(),/已单击吸附/);assert.ok(await touch.locator('.board-toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await touch.screenshot({path:out+'/touch.png'});await touchContext.close()
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(sandbox.calls.recognize,0);assert.deepEqual(await get('profiles'),registry);assert.deepEqual(await get('history'),beforeHistory)
 await writeFile(out+'/summary.json',JSON.stringify({pass:true,defaultDrag:true,clickSnap:true,keyboard:true,touch:true,undo:true,saveReload:true,build:true,noPointerDrag:true,ambiguity:true,cat:{tiles:9,connections:8,components:1,allClicksUnchanged:true},serverWrites:writes.length,paidCalls:sandbox.calls.recognize},null,2));console.log('PASS: Click/Drag mode, shared Snap, native click/keyboard/touch, no dragging in click mode, no-op/ambiguity/no candidate, single-step Undo, save/reload/Build, cat 9/8/1 unchanged, compact 1024/430 layout, zero server writes/models. '+out)
}finally{await context.close();await browser.close();await sandbox.close()}

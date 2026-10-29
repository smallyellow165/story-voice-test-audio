import {stage,studioButton} from './magnetic-studio-browser.mjs'
// Real production UI, isolated browser storage; no app globals or runtime mocks.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {readFile,mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const output=process.env.MAGNETIC_SCREENSHOTS||'/tmp/magnetic-build-screenshots';await mkdir(output,{recursive:true})
const page=await browser.newPage({viewport:{width:1500,height:1050},acceptDownloads:true}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
const button=name=>studioButton(page,name)
const player=page.getByRole('region',{name:'搭建教程播放器'})
const count=()=>player.locator('[data-build-tile]').count()
async function dragLast(x,y){
 const el=page.locator('polygon[data-tile-id]').last();await el.scrollIntoViewIfNeeded()
 const start=await el.evaluate(el=>{const pts=el.getAttribute('points').split(' ').map(p=>p.split(',').map(Number));const p=new DOMPoint(pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y}})
 const end=await page.locator('.tiles-board').evaluate((el,[x,y])=>{const p=new DOMPoint(x,-y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y}},[x,y])
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up()
}
async function add(name,x,y,rotations=0){await button('添加'+name).click();for(let i=0;i<rotations;i++)await button('旋转 90°').click();await dragLast(x,y)}
async function exportBuild(){await stage(page,'build');if(await page.getByRole('button',{name:'继续上次教程',exact:true}).isVisible())await page.getByRole('button',{name:'继续上次教程',exact:true}).click();const dl=page.waitForEvent('download');await button('导出教程 JSON').click();return JSON.parse(await readFile(await (await dl).path(),'utf8'))}
async function waitReady(){await button('导入教程 JSON').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='导入教程 JSON'&&!b.disabled))}
try{
 await page.goto(process.env.MAGNETIC_URL||'http://127.0.0.1:5173/story-voice-test-audio/magnetic-tiles.html');await waitReady()
 assert.equal(await button('生成搭建步骤').isDisabled(),true)
 await add('正方形',.5,.5);await add('正方形',1.57,.54);await add('正方形',.54,1.57);await add('正方形',1.57,1.54)
 await add('等腰直角三角形',.70,2.38,1);await add('等腰直角三角形',1.38,2.38)
 await add('等边三角形',.5,-.30,2)
 assert.match(await page.getByTestId('validation').innerText(),/正式有效/)
 await button('生成搭建步骤').click();await waitReady();assert.equal(await count(),1)
 assert.equal(await page.locator('.build-saved select').locator('option').count(),1)
 const bundle=await exportBuild();assert.equal(bundle.plan.steps.length,7)
 const view=await player.locator('svg').getAttribute('viewBox')
 await button('下一步').click();await waitReady();assert.equal(await count(),2)
 await page.reload();await waitReady();assert.equal(await count(),2,'unsaved preview progress restored')
 await button('保存教程').click();await waitReady();assert.equal(await button('保存教程').isDisabled(),true)
 assert.deepEqual(await exportBuild(),bundle)
 await button('下一步').click();await waitReady();assert.equal(await count(),3)
 await button('上一步').click();await waitReady();assert.equal(await count(),2)
 await button('重播当前步').click();assert.equal(await count(),2)
 await button('重新开始').click();await waitReady();assert.equal(await count(),1)
 for(let i=1;i<7;i++){await button('下一步').click();await waitReady();assert.equal(await count(),i+1);assert.equal(await player.locator('svg').getAttribute('viewBox'),view)}
 assert.ok(await player.locator('.build-edge').count()>0)
 await player.screenshot({path:output+'/build-wide.png',animations:'disabled'})
 await button('完成搭建').click();await waitReady();await page.reload();await waitReady();assert.match(await player.locator('h3').innerText(),/已完成/)
 // Changing the source cannot alter the saved tutorial.
 await button('新建').click();assert.equal(await page.locator('polygon[data-tile-id]').count(),0)
 assert.deepEqual(await exportBuild(),bundle)
 await button('添加正方形').click();await button('生成搭建步骤').click();await waitReady();await button('保存教程').click();await waitReady()
 assert.equal(await page.locator('.build-saved select').locator('option').count(),3)
 await page.locator('.build-saved select').selectOption(bundle.plan.id);await button('打开教程').click();await waitReady();assert.equal(await count(),7)
 await page.getByTestId('build-import').setInputFiles({name:'roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await waitReady();assert.deepEqual(await exportBuild(),bundle)
 const bad=structuredClone(bundle);bad.snapshot.hash='tampered'
 await page.getByTestId('build-import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await waitReady()
 assert.match(await page.getByRole('alert').innerText(),/Hash/);assert.deepEqual(await exportBuild(),bundle)
 await button('重新开始').click();await waitReady();await button('下一步').click();await waitReady()
 await page.setViewportSize({width:390,height:844});await stage(page,'build','workspace');await player.scrollIntoViewIfNeeded();await player.screenshot({path:output+'/build-narrow.png',animations:'disabled'})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.equal(await player.locator('.build-board').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(243, 247, 239)')
 assert.deepEqual(errors,[])
 console.log('PASS: 7-piece UI construction, all profiles, preview/save/load/replay, stable viewport, completion, refresh, source isolation, multiple plans, JSON/tamper rejection, narrow viewport.')
 console.log('Screenshots: '+output)
}finally{await browser.close()}

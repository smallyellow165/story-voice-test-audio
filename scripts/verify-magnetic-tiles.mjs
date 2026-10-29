import {stage} from './magnetic-studio-browser.mjs'
// Browser-only acceptance through production UI. No mock runtime or application globals.
// Reuses Playwright already installed in the adjacent V4 development workspace.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {readFile,mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const output=process.env.MAGNETIC_SCREENSHOTS||'/tmp/magnetic-tiles-screenshots'
await mkdir(output,{recursive:true})
const page=await browser.newPage({viewport:{width:1500,height:1050},acceptDownloads:true}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
const polygons=()=>page.locator('polygon[data-tile-id]')
const valid=()=>page.getByTestId('validation')
async function center(locator){return locator.evaluate(el=>{
 const pts=el.getAttribute('points').split(' ').map(p=>p.split(',').map(Number))
 const x=pts.reduce((s,p)=>s+p[0],0)/pts.length,y=pts.reduce((s,p)=>s+p[1],0)/pts.length
 const p=new DOMPoint(x,y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y}
})}
async function destination(x,y){return page.locator('.tiles-board').evaluate((el,[x,y])=>{const p=new DOMPoint(x,-y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y}},[x,y])}
async function drag(locator,x,y,{snap=false,cancel=false}={}){
 await locator.scrollIntoViewIfNeeded();const a=await center(locator),b=await destination(x,y)
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12})
 let previewPoints,previewConnections
 if(snap){
  assert.equal(await page.locator('.snap-preview').count(),1,'actual snap ghost must be visible before release')
  previewPoints=await locator.getAttribute('points')
  previewConnections=await page.locator('.connections li').allTextContents()
  for(const offset of [.2,-.2,0]){
   await page.mouse.move(b.x+offset,b.y)
   assert.equal(await locator.getAttribute('points'),previewPoints,'subpixel pointer noise must not flip preview')
  }
 }
 if(cancel)await page.keyboard.press('Escape')
 await page.mouse.up()
 if(snap && !cancel){
  assert.equal(await locator.getAttribute('points'),previewPoints,'committed polygon must equal preview')
  assert.deepEqual(await page.locator('.connections li').allTextContents(),previewConnections,'connection UI must agree before and after release')
 }
}
async function add(name){await page.getByRole('button',{name:'添加'+name,exact:true}).click();return polygons().last()}
async function exported(){
 await stage(page,'assembly','inspector');const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON',exact:true}).click();return JSON.parse(await readFile(await (await downloaded).path(),'utf8'))}
try{
 await page.goto(process.env.MAGNETIC_URL||'http://127.0.0.1:5173/story-voice-test-audio/magnetic-tiles.html')
 for(const name of ['正方形','等腰直角三角形','等边三角形'])await add(name)
 assert.equal(await polygons().count(),3)
 assert.deepEqual(await polygons().evaluateAll(es=>es.map(e=>e.dataset.profile)),['square','right-triangle','equilateral-triangle'])
 await page.getByRole('button',{name:'新建',exact:true}).click()
 // Build a house entirely via add / drag / rotate controls: four walls + two roof pieces.
 await drag(await add('正方形'),.5,.5)
 await drag(await add('正方形'),1.57,.54,{snap:true})
 await drag(await add('正方形'),.54,1.57,{snap:true})
 await drag(await add('正方形'),1.57,1.54,{snap:true})
 const left=await add('等腰直角三角形')
 await page.getByRole('button',{name:'旋转 90°',exact:true}).click()
 await drag(left,.70,2.38,{snap:true})
 await drag(await add('等腰直角三角形'),1.38,2.38,{snap:true})
 assert.match(await valid().innerText(),/正式有效/)
 assert.equal(await page.locator('.connections li').count(),7)
 await page.screenshot({path:output+'/house-wide.png',fullPage:true})
 await page.getByRole('button',{name:'保存作品快照',exact:true}).click()
 const saved=await exported();assert.equal(saved.instances.length,6)
 await page.reload();assert.match(await valid().innerText(),/正式有效/)
 assert.deepEqual(await exported(),saved)
 assert.equal(await page.locator('.connections li').count(),7)
 // Invalid overlap is previewed and rejected; cancel and undo preserve exact geometry.
 await drag(polygons().last(),.4,.4)
 assert.match(await page.getByRole('status').innerText(),/未提交/)
 assert.deepEqual((await exported()).instances,saved.instances)
 await drag(polygons().last(),3.4,2.4,{cancel:true})
 assert.deepEqual((await exported()).instances,saved.instances)
 await drag(polygons().last(),3.4,2.4)
 assert.match(await valid().innerText(),/草稿/)
 assert.equal(await page.locator('.connections li').count(),5)
 await page.getByRole('button',{name:'↷ 15°',exact:true}).click()
 assert.match(await page.getByRole('status').innerText(),/已旋转/)
 assert.equal(await page.locator('.connections li').count(),5)
 await page.getByRole('button',{name:'撤销',exact:true}).click()
 await page.getByRole('button',{name:'撤销',exact:true}).click()
 assert.deepEqual((await exported()).instances,saved.instances)
 await polygons().last().focus();await page.keyboard.press('Enter');await page.keyboard.press('r')
 assert.match(await page.getByRole('status').innerText(),/未提交/)
 await page.keyboard.press('Delete');assert.equal(await polygons().count(),5)
 await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await polygons().count(),6)
 // A third shape joins a square via a real drag at a legal unit edge.
 await page.getByRole('button',{name:'新建',exact:true}).click()
 await drag(await add('正方形'),.5,.5)
 await drag(await add('等边三角形'),.54,1+Math.sqrt(3)/6+.06,{snap:true})
 assert.match(await valid().innerText(),/正式有效/)
 assert.equal(await page.locator('.connections li').count(),1)
 await page.getByRole('button',{name:'加载所选作品',exact:true}).click()
 assert.deepEqual((await exported()).instances,saved.instances)
 // Close zoom previously made a 15-degree edge impossible to capture. Exercise
 // the real rotate buttons and drag around the target edge centre, then 45 degrees.
 await page.getByRole('button',{name:'新建',exact:true}).click()
 await drag(await add('正方形'),-.5,0)
 await drag(await add('正方形'),1,0)
 await page.getByRole('button',{name:'↷ 15°',exact:true}).click()
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'放大视图',exact:true}).click()
 await drag(polygons().last(),.5*Math.cos(Math.PI/12),.5*Math.sin(Math.PI/12),{snap:true})
 assert.match(await valid().innerText(),/正式有效/)
 await drag(polygons().last(),1,0)
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'↷ 15°',exact:true}).click()
 await drag(polygons().last(),Math.SQRT1_2/2,Math.SQRT1_2/2,{snap:true})
 assert.match(await valid().innerText(),/正式有效/)
 await page.screenshot({path:output+'/rotated-snap-close-zoom.png',fullPage:true})
 await page.getByRole('button',{name:'加载所选作品',exact:true}).click()
 // Import goes through production parser, preserving current data on rejection.
 await page.locator('.storage-panel input[type=file]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...saved,instances:[{...saved.instances[0],profileVersion:99}]}))})
 await page.getByRole('status').filter({hasText:'导入失败'}).waitFor()
 assert.match(await page.getByRole('status').innerText(),/导入失败/)
 assert.deepEqual((await exported()).instances,saved.instances)
 await page.getByRole('button',{name:'加载所选作品',exact:true}).click()
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/house-narrow.png',fullPage:true})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow')
 // Native touch events exercise the real pointer capture path on a narrow screen.
 const cdp=await page.context().newCDPSession(page)
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true})
 await polygons().last().scrollIntoViewIfNeeded()
 const touchStart=await center(polygons().last()),touchEnd=await destination(2.8,2.4)
 const firstFinger={...touchStart,id:1},beforeTouch=await polygons().last().getAttribute('points')
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[firstFinger]})
 const otherFinger={...await destination(-.5,.5),id:2}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[firstFinger,otherFinger]})
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[firstFinger,{...otherFinger,x:otherFinger.x+15}]})
 assert.equal(await polygons().last().getAttribute('points'),beforeTouch,'second finger must not move the captured piece')
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[firstFinger]})
 assert.equal(await polygons().last().getAttribute('points'),beforeTouch,'second release must not commit or cancel the first drag')
 for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:touchStart.x+(touchEnd.x-touchStart.x)*i/8,y:touchStart.y+(touchEnd.y-touchStart.y)*i/8}]})
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 assert.match(await valid().innerText(),/草稿/)
 await page.getByRole('button',{name:'撤销',exact:true}).click()
 assert.deepEqual((await exported()).instances,saved.instances)
 await cdp.detach()
 assert.deepEqual(errors,[])
 console.log('PASS: three profiles; 6-piece house via UI; snap ghosts; 7 connections; overlap rejection; detach/cancel/rotate/delete/undo; save/reload/load exact poses; triangle-square snap; 15/45-degree close-zoom capture; stable preview/commit equality; invalid import; narrow layout and two-finger isolation.')
 console.log('Screenshots: '+output)
}finally{await browser.close()}

import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {stage,studioButton} from './magnetic-studio-browser.mjs'
const {profiles}=JSON.parse(await readFile(new URL('../src/magnetic-tiles/profiles.json',import.meta.url),'utf8'))
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/api/magnetic-intake/recognize',()=>{throw Error('Paid call forbidden')})
try{
 await page.goto((process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173')+'/story-voice-test-audio/magnetic-tiles.html')
 await studioButton(page,'添加正方形').click()
 await stage(page,'catalog')
 assert.equal(await page.locator('nav[aria-label="工作阶段"] button').count(),5)
 assert.equal(await page.locator('.supported-tile').count(),profiles.length)
 for(const p of profiles){
  await page.getByLabel('支持的磁力片',{exact:true}).selectOption(`${p.id}@${p.version}`)
  const card=page.locator('.supported-tile[aria-pressed="true"]')
  assert.equal(await card.locator('polygon').getAttribute('points'),p.vertices.map(v=>v.join(',')).join(' '))
  assert.equal(await card.locator('line').count(),p.connectableEdges.length)
  const info=await page.getByRole('region',{name:'Profile 规格'}).innerText()
  assert.ok(info.includes(p.id));assert.ok(info.includes('Version：'+p.version))
  for(const v of p.vertices)assert.ok(info.includes(v.join(', ')))
 }
 await page.screenshot({path:'/tmp/magnetic-catalog.png'})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1))
 assert.equal(await page.getByRole('separator').count(),2)
 await stage(page,'assembly');assert.equal(await page.locator('[data-tile-id]').count(),1)
 await stage(page,'build');await studioButton(page,'生成搭建步骤').click()
 await page.getByRole('button',{name:'保存教程',exact:true}).waitFor({state:'visible'})
 await stage(page,'catalog');await page.locator('.supported-tile').first().click()
 await stage(page,'build');assert.equal(await page.locator('[data-build-tile]').count(),1)
 await stage(page,'catalog');await page.setViewportSize({width:1024,height:768})
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1))
 assert.deepEqual(errors,[])
 console.log('PASS: catalog outside five stages; all SVG vertices/connector edges exact; selection and details; editor and Build state preserved; viewport layout; no paid calls. Screenshot /tmp/magnetic-catalog.png')
}finally{await browser.close()}

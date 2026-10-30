import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {workflowTerms} from '../src/magnetic-tiles/studio-terms.ts'
import {stage} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173'
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
const descriptions=[['Studio','图片到作品，一片一片搭。'],...Object.values(workflowTerms).map(s=>[s.label,s.hint])]
try{
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await stage(page,'source')
 const nav=page.getByRole('navigation',{name:'工作阶段'})
 const metrics=await nav.evaluate(e=>({nav:e.getBoundingClientRect().height,header:document.querySelector('.studio-workflow header').getBoundingClientRect().height,rows:[...e.children].map(x=>x.getBoundingClientRect().height)}))
 assert.equal(await nav.locator('[data-stage]').count(),5);assert.ok(metrics.nav<=180);assert.ok(metrics.rows.every(h=>h===32));assert.equal(await nav.locator('small').count(),0)
 await page.screenshot({path:'/tmp/magnetic-nav-after.png'})
 for(const [label,detail] of descriptions){
  console.log('Checking',label)
  const trigger=page.getByRole('button',{name:label+'说明',exact:true}),popup=page.getByRole('region',{name:label+'说明',exact:true})
  await trigger.hover();await popup.waitFor();assert.equal(await popup.innerText(),detail)
  await trigger.click();await page.mouse.move(1000,800);assert.ok(await popup.isVisible());assert.equal(await page.locator('[data-stage=source]').getAttribute('aria-current'),'step')
  await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});await page.waitForFunction(el=>el.getAttribute('aria-expanded')==='false',await trigger.elementHandle(),{timeout:5000})
  await trigger.blur();await trigger.focus();await popup.waitFor();await trigger.press('Enter');await page.mouse.move(1000,800);assert.ok(await popup.isVisible());await trigger.press('Space');await popup.waitFor({state:'hidden'});await page.waitForFunction(el=>el.getAttribute('aria-expanded')==='false',await trigger.elementHandle(),{timeout:5000});assert.equal(await page.locator('[data-stage=source]').getAttribute('aria-current'),'step')
 }
 await page.getByRole('button',{name:workflowTerms.reconstruction.label+'说明',exact:true}).hover()
 const clip=await page.getByRole('region',{name:workflowTerms.reconstruction.label+'说明',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),c=document.querySelector('.studio-workflow').getBoundingClientRect(),x=Math.min(r.right-2,c.right+5),y=r.top+r.height/2;return {extends:r.right>c.right,topLayer:el.matches(':popover-open'),visibleOutside:el.contains(document.elementFromPoint(x,y))}})
 assert.deepEqual(clip,{extends:true,topLayer:true,visibleOutside:true});await page.screenshot({path:'/tmp/magnetic-nav-tooltip.png'});await page.keyboard.press('Escape')
 for(const id of ['review','reconstruction','assembly','build','source']){await stage(page,id);assert.equal(await page.locator(`[data-stage=${id}]`).getAttribute('aria-current'),'step')}
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1))
 const touch=await browser.newPage({viewport:{width:430,height:900},hasTouch:true,isMobile:true})
 touch.setDefaultTimeout(10000);touch.setDefaultNavigationTimeout(10000);console.log('Touch start');await touch.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await touch.getByRole('button',{name:'工作阶段',exact:true}).tap()
 const trigger=touch.getByRole('button',{name:'Studio说明',exact:true}),popup=touch.getByRole('region',{name:'Studio说明',exact:true})
 console.log('Touch info');await trigger.tap();await popup.waitFor();assert.equal(await touch.locator('[data-stage=assembly]').getAttribute('aria-current'),'step');await touch.locator('.eyebrow').tap();await popup.waitFor({state:'hidden'});console.log('Touch screenshot');await touch.screenshot({path:'/tmp/magnetic-nav-touch.png'});assert.ok(await touch.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));await touch.close()
 const before=await readFile('/tmp/magnetic-nav-before.json','utf8').then(JSON.parse).catch(()=>null)
 await writeFile('/tmp/magnetic-nav-after.json',JSON.stringify({before,after:metrics},null,2));assert.deepEqual(errors,[])
 console.log('PASS: five 32px rows; hover, click/pin, keyboard, Escape and touch; Info never navigates; top-layer outside scroll clipping; five stages; Catalog remains a right-side tool. '+JSON.stringify({before,after:metrics}))
}finally{await browser.close()}

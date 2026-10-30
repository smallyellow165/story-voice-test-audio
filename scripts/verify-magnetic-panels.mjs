// Real browser rendering and pointer drags; only existing history is read.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {stage} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',out='/tmp/magnetic-panels';await mkdir(out,{recursive:true})
const history=await(await fetch(base+'/api/magnetic-intake/history')).json()
const records=history.reconstructions.filter(r=>r.candidates?.[0]?.assembly.instances.length===17&&r.mode==='flat-mosaic');assert.ok(records.length)
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/magnetic-intake/recognize',()=>{throw Error('Paid calls forbidden')})
async function open(r=records[0]){
 await stage(page,'source');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='刷新图片历史'&&!b.disabled))
 await page.getByLabel('当前图片',{exact:true}).selectOption(r.sourceId)
 await page.getByLabel('历史 Reconstruction',{exact:true}).selectOption(r.id)
 await page.locator('.intake-candidate polygon').first().waitFor()
}
const widths=()=>page.locator('.studio-panels > [data-panel]').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width))
const ratio=()=>page.locator('.studio-comparison > [data-panel]').evaluateAll(es=>es[0].getBoundingClientRect().width/(es[0].getBoundingClientRect().width+es[1].getBoundingClientRect().width))
async function drag(name,dx){const h=page.getByRole('separator',{name,exact:true});await h.scrollIntoViewIfNeeded();const b=await h.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2,{steps:15});await page.mouse.up()}
async function pixels(name){
 const svg=page.locator('.intake-candidate');await svg.scrollIntoViewIfNeeded()
 const samples=await svg.evaluate(el=>{const box=el.getBoundingClientRect();return [...el.querySelectorAll('polygon')].map(p=>{const vs=p.getAttribute('points').split(' ').map(v=>v.split(',').map(Number)),c=new DOMPoint(vs.reduce((s,v)=>s+v[0],0)/vs.length,vs.reduce((s,v)=>s+v[1],0)/vs.length).matrixTransform(p.getScreenCTM());const style=getComputedStyle(p);return {id:p.dataset.candidatePiece,x:c.x-box.x,y:c.y-box.y,color:p.getAttribute('fill'),outline:style.outlineStyle,stroke:parseFloat(style.strokeWidth),vector:style.vectorEffect}})})
 assert.equal(samples.length,17);for(const s of samples){assert.equal(s.outline,'none');assert.ok(s.stroke<=3.5);assert.equal(s.vector,'non-scaling-stroke')}
 const file=out+'/'+name+'.png';await svg.screenshot({path:file});await writeFile(out+'/samples.json',JSON.stringify(samples))
 // Inspect actual Chrome-painted pixels (not a re-rendered SVG or DOM-only assertion).
 execFileSync('python3',['-c',`from PIL import Image\nimport json,sys\nim=Image.open(sys.argv[1]).convert('RGB')\nfor s in json.load(open(sys.argv[2])):\n p=im.getpixel((round(s['x']),round(s['y'])))\n want=tuple(bytes.fromhex(s['color'][1:]))\n assert max(abs(a-b) for a,b in zip(p,want))<12,(s['id'],p,want)`,file,out+'/samples.json'])
}
async function bounds(){const b=await page.evaluate(()=>{const cols=[...document.querySelectorAll('.studio-column')].map(e=>e.getBoundingClientRect());return {h:document.documentElement.scrollHeight,w:document.documentElement.scrollWidth,ih:innerHeight,iw:innerWidth,ordered:cols[0].right<=cols[1].left&&cols[1].right<=cols[2].left,overflow:[...document.querySelectorAll('.studio-column')].map(e=>getComputedStyle(e).overflowY)}});assert.ok(b.h<=b.ih&&b.w<=b.iw&&b.ordered);assert.deepEqual(b.overflow,['auto','auto','auto'])}
try{
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await open();await bounds()
 const geometry=await page.locator('.intake-candidate polygon').evaluateAll(es=>es.map(e=>e.getAttribute('points')))
 const first=await widths();assert.equal(first.length,3)
 await drag('调整左栏与中栏宽度',65);const second=await widths();assert.ok(second[0]>first[0]+40)
 await drag('调整中栏与右栏宽度',-80);const third=await widths();assert.ok(third[2]>second[2]+50)
 await drag('调整原图与候选宽度',-70);const split=await ratio();assert.ok(split<.45)
 for(const id of ['h1','l1','l2','b1','f1','f2']){
  await page.getByRole('button',{name:'候选零件 '+id,exact:true}).click();await pixels('click-'+id)
  await page.keyboard.press('Tab');await pixels('keyboard-after-'+id)
 }
 await page.getByRole('button',{name:'候选零件 l1',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('[data-observation=l1]').getAttribute('class'),'observation selected')
 for(const s of ['review','assembly','build','source','reconstruction'])await stage(page,s)
 assert.ok(Math.abs(await ratio()-split)<.015,'comparison ratio survives collapse/expand')
 await pixels('stage-roundtrip');assert.deepEqual(await page.locator('.intake-candidate polygon').evaluateAll(es=>es.map(e=>e.getAttribute('points'))),geometry)
 const saved=await widths(),savedRatio=await ratio();await page.reload();await open()
 const restored=await widths();restored.forEach((v,i)=>assert.ok(Math.abs(v-saved[i])<3,'outer width restored'))
 assert.ok(Math.abs(await ratio()-savedRatio)<.015,'comparison ratio restored on refresh')
 for(const width of [1280,1920,1024,1600]){
  await page.setViewportSize({width,height:900});await bounds()
  for(const delta of [25,-35,10]){await drag('调整原图与候选宽度',delta);await drag('调整左栏与中栏宽度',delta);await drag('调整中栏与右栏宽度',-delta)}
  await stage(page,'review');await stage(page,'reconstruction');await pixels('width-'+width)
 }
 if(records[1]){await page.getByLabel('历史 Reconstruction',{exact:true}).selectOption(records[1].id);await page.getByLabel('几何重建候选',{exact:true}).selectOption(records[1].candidates[0].id);await pixels('history-change')}
 await page.screenshot({path:out+'/studio-resized.png'})
 // Each column scrolls without moving the page or its neighbors.
 await page.setViewportSize({width:1600,height:480})
 for(const column of ['workflow','inspector','workspace']){
  if(column==='workspace')await stage(page,'assembly')
  const el=page.locator('.studio-'+column);await el.evaluate(e=>e.scrollTop=0);const box=await el.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height-30);await page.mouse.wheel(0,500);await page.waitForFunction(c=>document.querySelector('.studio-'+c).scrollTop>0,column);assert.equal(await page.evaluate(()=>scrollY),0)
 }
 await page.setViewportSize({width:430,height:900});await stage(page,'reconstruction');await page.locator('.intake-candidate').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await pixels('narrow')
 assert.deepEqual(errors,[]);console.log('PASS: both outer separators and nested separator; resize, refresh and stage persistence; 17-piece actual pixel checks under pointer/keyboard focus; 1024/1280/1600/1920/430 windows; independent scrolling; unchanged geometry; no paid calls. Screenshots: '+out)
}finally{await browser.close()}

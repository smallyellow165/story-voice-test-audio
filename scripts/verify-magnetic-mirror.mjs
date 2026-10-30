// Frozen real history + production UI + real API; never writes Selected/Review or calls models.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {vertices,edges,alignEdge} from '../src/magnetic-tiles/geometry.ts'
import {alignmentInspection} from '../src/magnetic-tiles/intake/alignment-inspection.ts'
import {stage,studioButton} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',out='/tmp/magnetic-mirror-v1',root=base+'/story-voice-test-audio/magnetic-tiles.html'
const get=async route=>{const r=await fetch(base+'/api/magnetic-intake/'+route);assert.equal(r.status,200);return r.json()}
const r=await get('reconstructions/446d68f3-103f-46e2-b0ef-d6505f21ffeb'),saved=JSON.stringify(r),review=await get('reviews/'+r.reviewId),selected=await get('selected/'+r.sourceId),before=new Map()
for(const kind of ['analyses','reviews','reconstructions'])for(const f of await readdir(new URL('../generated/magnetic-intake/'+kind+'/',import.meta.url))){if(f.endsWith('.json')){const u=new URL('../generated/magnetic-intake/'+kind+'/'+f,import.meta.url);before.set(u.href,await readFile(u,'utf8'))}}
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']}),ctx=await browser.newContext({viewport:{width:1600,height:1000}}),paid=[],errors=[]
ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));await ctx.route('**/api/magnetic-intake/recognize',route=>{paid.push(route.request().url());return route.abort()})
const page=await ctx.newPage(),button=name=>studioButton(page,name),idle=p=>p.waitForFunction(()=>{const e=document.querySelector('select[aria-label="当前图片"]');return e&&!e.disabled})
const url=root+`?stage=reconstruction&sourceId=${r.sourceId}&analysisId=${review.analysisId}&reviewId=${review.id}&reconstructionId=${r.id}&candidateId=diagnostic-1&observationId=p3&rightTab=inspector`
try{
 await mkdir(out,{recursive:true});await page.goto(url);await idle(page)
 assert.equal(await page.getByLabel('Diagnostic 几何摆放',{exact:true}).locator('polygon').count(),11)
 await page.getByRole('button',{name:'对齐 / 镜像叠加',exact:true}).click();const summary=page.getByTestId('alignment-summary'),select=page.getByLabel('对齐比较方案',{exact:true});assert.match(await summary.innerText(),/0\.591023527.*0\.300.*pair valid true.*context valid true.*镜像 false/)
 await page.screenshot({path:out+'/saved-rigid-overlay.png'})
 const expected=alignmentInspection(r,'diagnostic-1'),mirrored=expected.alternatives.find(a=>a.id==='mirror-e0-e2')
 await select.selectOption(mirrored.id);assert.match(await summary.innerText(),/计算反事实，非历史搜索尝试.*0\.158384016.*pair valid true.*context valid true.*镜像 true/)
 const poly=page.locator('[data-alignment-pose]');assert.deepEqual(JSON.parse(await poly.getAttribute('data-alignment-pose')),mirrored.tile.pose);assert.equal(await poly.getAttribute('points'),vertices(mirrored.tile,profiles).map(([x,y])=>[x,-y].join(',')).join(' '))
 const own=await page.locator('[data-alignment-edge="own"]').evaluate(e=>[+e.getAttribute('x1'),+e.getAttribute('y1'),+e.getAttribute('x2'),+e.getAttribute('y2')]),target=await page.locator('[data-alignment-edge="target"]').evaluate(e=>[+e.getAttribute('x2'),+e.getAttribute('y2'),+e.getAttribute('x1'),+e.getAttribute('y1')]);assert.deepEqual(own,target)
 assert.equal(await page.getByRole('button',{name:'在作品编辑器中打开',exact:true}).count(),0)
 await page.screenshot({path:out+'/mirrored-overlay.png'});await writeFile(out+'/alignment.json',JSON.stringify(expected,null,2))
 const api=JSON.parse((await get('trace/reconstructions/'+r.id+'/alignment/diagnostic-1')).text);assert.deepEqual(api.alignment,expected);assert.equal(api.references.review.id,review.id)
 await page.reload();await idle(page);await page.getByRole('button',{name:'对齐 / 镜像叠加',exact:true}).click();assert.equal(await select.inputValue(),'saved')
 const tab=await ctx.newPage();await tab.goto(url);await idle(tab);assert.equal(await tab.getByLabel('几何重建候选',{exact:true}).inputValue(),'diagnostic-1')
 await page.setViewportSize({width:430,height:900});await stage(page,'reconstruction','workspace');await select.selectOption('mirror-e0-e2');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/mobile-overlay.png'})
 await page.setViewportSize({width:1600,height:1000})
 // General mirror editing, actual imported Assembly persistence and Build playback.
 const t=(id,profileId='square',mirrored=false)=>({id,profileId,profileVersion:1,color:'#aabbcc',pose:{x:0,y:0,angleRad:0,...(mirrored?{mirrored:true}:{})}})
 const square=t('base'),raw=t('mirrored','tall-right-triangle',true),m=alignEdge(raw,edges(raw,profiles)[0],edges(square,profiles)[0],profiles),assembly={schemaVersion:1,id:'mirror-browser',revision:1,name:'General mirror browser',instances:[square,m]}
 await stage(page,'assembly','inspector');const chooser=page.waitForEvent('filechooser');await button('导入 JSON').click();await(await chooser).setFiles({name:'mirror.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(assembly))})
 const drawn=page.locator('polygon[data-tile-id="mirrored"]');await drawn.waitFor();assert.equal(await drawn.getAttribute('points'),vertices(m,profiles).map(v=>v.join(',')).join(' '));await drawn.click()
 await button('保存作品快照').click();const assemblyUrl=page.url();await page.reload();await idle(page);assert.equal(await drawn.getAttribute('points'),vertices(m,profiles).map(v=>v.join(',')).join(' '))
 await button('生成搭建步骤').click();await page.waitForFunction(()=>document.querySelectorAll('[data-build-tile]').length===1);await button('下一步').click();await page.locator('[data-build-tile="mirrored"]').waitFor();assert.equal(await page.locator('[data-build-tile="mirrored"]').getAttribute('points'),vertices(m,profiles).map(v=>v.join(',')).join(' '));assert.match(await page.locator('.build-instruction').innerText(),/翻面/)
 // A single isolated asymmetric tile can be flipped and undone via the regular editor.
 await stage(page,'assembly','inspector');await button('新建').click();await button('添加细长直角三角形').click();const one=page.locator('polygon[data-tile-id]');await one.click();const original=await one.getAttribute('points');await button('翻面选中').click();assert.notEqual(await one.getAttribute('points'),original);await button('撤销').click();assert.equal(await one.getAttribute('points'),original)
 for(const [file,bytes] of before)assert.equal(await readFile(new URL(file),'utf8'),bytes)
 assert.equal(JSON.stringify(await get('reconstructions/'+r.id)),saved);assert.deepEqual(await get('selected/'+r.sourceId),selected);assert.deepEqual(errors,[]);assert.deepEqual(paid,[])
 await writeFile(out+'/result.json',JSON.stringify({status:'PASS',historicalUrl:url,assemblyUrl,unchangedSnapshots:before.size,paidCalls:0,rigidRms:expected.actual.residual.rms,mirroredRms:mirrored.residual.rms},null,2))
 console.log('PASS: exact historical trial 468, true pose/edge/residual overlay, reflected full-edge validator, read-only API, copied URL/reload/mobile, mirrored Assembly save/reload/Build/flip/undo, unchanged snapshots/Selected, 0 paid calls. '+out)
}finally{await browser.close()}

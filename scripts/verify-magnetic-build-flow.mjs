import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {startMagneticSandbox} from './magnetic-sandbox.mjs'
import {stage,rightTab} from './magnetic-studio-browser.mjs'
const sandbox=await startMagneticSandbox(),base=sandbox.origin,url=base+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-build-flow'
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],writes=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));context.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/magnetic-intake/'))writes.push(r.url())})
const player=page.getByRole('region',{name:'搭建教程播放器',exact:true,includeHidden:true}),preview=page.getByRole('region',{name:'Build 作品预览',exact:true}),button=n=>page.getByRole('button',{name:n,exact:true}),get=async route=>(await fetch(base+'/api/magnetic-intake/'+route)).json(),historyBefore=await get('history'),registryBefore=await get('profiles')
const cat=JSON.parse(await readFile(new URL('../test/fixtures/magnetic-intake/cat-assembly-click-snap.json',import.meta.url))),other={schemaVersion:1,id:'other-build-source',revision:1,name:'其他作品',instances:[{id:'a',profileId:'square',profileVersion:1,color:'#f5b942',pose:{x:0,y:0,angleRad:0}},{id:'b',profileId:'square',profileVersion:1,color:'#f5b942',pose:{x:1,y:0,angleRad:0}}]}
const ready=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='导入教程 JSON'&&!b.disabled))
async function importAssembly(a){await stage(page,'assembly','inspector');await page.locator('.storage-panel input[type=file]').setInputFiles({name:'isolated-build-source.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(a))});await page.waitForFunction(()=>document.querySelector('.board-message').textContent.includes('已导入'));await stage(page,'build','inspector');await ready()}
async function exported(){const event=page.waitForEvent('download');await button('导出教程 JSON').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
async function openHistory(id){await page.getByLabel('历史教程',{exact:true}).selectOption(id);await button('打开教程').click();await ready()}
const boxes=()=>page.locator('.build-transport button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}}))
function stable(a,b){assert.equal(a.length,4);assert.equal(b.length,4);a.forEach((r,i)=>{for(const k of ['x','y','w','h'])assert.ok(Math.abs(r[k]-b[i][k])<.75,`control ${i} ${k} moved ${r[k]} -> ${b[i][k]}`)})}
async function playNine(){
 const before=await exported();await button('重新开始').click();await ready();await page.locator('.studio-inspector').evaluate(e=>e.scrollTop=0);const fixed=await boxes();assert.ok(fixed.every(b=>b.y>=0&&b.y+b.h<=page.viewportSize().height),'transport is in viewport')
 for(let i=0;i<9;i++){assert.equal(await player.locator('[data-build-tile]').count(),i+1);stable(fixed,await boxes());if(i<8){await button('下一步').click();await ready()}}
 await button('完成搭建').click();await ready();assert.match(await player.locator('h3').innerText(),/已完成/);stable(fixed,await boxes())
 await button('上一步').click();await ready();stable(fixed,await boxes());await button('下一步').click();await ready();stable(fixed,await boxes());await button('完成搭建').click();await ready();stable(fixed,await boxes());assert.deepEqual(await exported(),before,'completion only changes progress, not plan or save status');return fixed
}
await mkdir(out,{recursive:true})
try{
 await page.goto(url+'?stage=assembly&rightTab=inspector');await importAssembly(other);await stage(page,'assembly','inspector');await button('保存作品快照').click();await stage(page,'build','inspector');assert.equal(await preview.count(),1);await button('生成搭建步骤').click();await ready();const old=await exported(),oldURL=page.url();await button('下一步').click();await ready();assert.equal(await player.locator('[data-build-tile]').count(),2)
 // An unrelated active preview must not become the first Build action for the cat.
 await importAssembly(cat.assembly);await stage(page,'assembly','inspector');await button('保存作品快照').click();await stage(page,'build','inspector');assert.equal(await preview.count(),1);assert.equal(await player.count(),0);assert.equal(await button('继续上次教程').count(),0);assert.equal(await button('继续当前教程').count(),0);assert.equal(await button('生成搭建步骤').isEnabled(),true)
 await button('生成搭建步骤').click();await ready();const nine=await exported();assert.equal(nine.plan.steps.length,9);assert.equal(await button('生成搭建步骤').count(),0);assert.match(await page.getByTestId('build-save-status').innerText(),/未保存/)
 await playNine();assert.match(await page.getByTestId('build-save-status').innerText(),/未保存/);await button('保存教程').click();await ready();assert.match(await page.getByTestId('build-save-status').innerText(),/已保存.*一致/);assert.equal(await button('保存教程').isDisabled(),true);await page.screenshot({path:out+'/completed.png'})
 const copied=page.url();await page.reload();await ready();await player.waitFor();assert.match(await player.locator('h3').innerText(),/已完成/);assert.equal((await exported()).plan.id,nine.plan.id)
 const reopened=await context.newPage();await reopened.goto(copied);await reopened.getByRole('region',{name:'搭建教程播放器',exact:true}).waitFor();assert.match(await reopened.getByTestId('build-playback-source').innerText(),/9 块/);await reopened.close()
 await page.goto(oldURL);await ready();await player.waitFor();assert.match(await page.getByTestId('build-playback-source').innerText(),/其他作品/);assert.equal(await player.locator('[data-build-tile]').count(),2)
 await page.goto(copied);await ready();await player.waitFor();assert.match(await player.locator('h3').innerText(),/已完成/);await page.goBack();await ready();await player.waitFor();assert.match(await page.getByTestId('build-playback-source').innerText(),/其他作品/);await page.goForward();await ready();await player.waitFor()
 // No implicit resume on workflow entry, but the exact current tutorial is offered.
 await stage(page,'assembly');await stage(page,'build','inspector');assert.equal(await preview.count(),1);assert.equal(await player.count(),0);await button('继续当前教程').click();await ready();assert.match(await player.locator('h3').innerText(),/已完成/)
 // Old unsaved preview/progress survived new generation and was not silently saved.
 await openHistory(old.plan.id);assert.equal(await player.locator('[data-build-tile]').count(),2);assert.match(await page.getByTestId('build-playback-source').innerText(),/历史教程.*其他作品/);assert.match(await page.getByTestId('build-save-status').innerText(),/未保存/);assert.equal((await exported()).plan.id,old.plan.id)
 // A valid imported stress tutorial uses the actual 9-piece source and bounded long copy.
 const stress=structuredClone(nine);stress.plan.id=crypto.randomUUID();stress.plan.title='长短说明布局验收';stress.plan.steps.forEach((s,i)=>s.instruction=i%2?'请按图找到这块磁力片并确认连接边。'.repeat(24):'按图放置。')
 await page.getByTestId('build-import').setInputFiles({name:'long-instructions.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(stress))});await ready();assert.equal((await exported()).plan.id,stress.plan.id)
 for(const width of [1600,1024]){await page.setViewportSize({width,height:900});await playNine();await page.screenshot({path:out+'/controls-'+width+'.png'})}
 // Drag the actual right divider; per-step button coordinates remain stable afterward.
 await page.setViewportSize({width:1550,height:900});const separator=page.getByRole('separator',{name:'调整中栏与右栏宽度'}),r=await separator.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+80);await page.mouse.down();await page.mouse.move(r.x+95,r.y+80,{steps:8});await page.mouse.up();await playNine()
 await page.evaluate(()=>document.documentElement.style.zoom='125%');await playNine();await page.evaluate(()=>document.documentElement.style.zoom='')
 await page.setViewportSize({width:430,height:900});await stage(page,'build','inspector');if(await button('继续当前教程').isVisible())await button('继续当前教程').click();await ready();await playNine();assert.ok(await page.locator('.build-transport').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:out+'/mobile.png'})
 // Changing the actual Assembly version invalidates the matching current tutorial.
 await page.setViewportSize({width:1600,height:1000});await stage(page,'assembly','inspector');await page.getByLabel('作品名称',{exact:true}).fill('小猫新版本');await page.getByLabel('作品名称',{exact:true}).press('Tab');await stage(page,'build','inspector');assert.equal(await preview.count(),1);assert.equal(await button('继续当前教程').count(),0);assert.equal(await button('生成搭建步骤').isEnabled(),true)
 await openHistory(nine.plan.id);assert.match(await page.getByTestId('build-playback-source').innerText(),/与所选作品不同/)
 // Source image changes also return to the current-work preview; no plan is lost.
 const h=await get('history'),rose=h.sources.find(s=>s.name==='connetix-rose.png');await page.getByLabel('当前图片',{exact:true}).selectOption(rose.id);await page.waitForFunction(()=>!document.querySelector('select[aria-label="当前图片"]').disabled);await preview.waitFor();assert.equal(await player.count(),0)
 // Explicit URLs with a Source restore that same tutorial; a later source switch cannot inherit it.
 await openHistory(nine.plan.id);const withSource=page.url();assert.equal(new URL(withSource).searchParams.get('sourceId'),rose.id);await page.reload();await ready();await player.waitFor();assert.equal((await exported()).plan.id,nine.plan.id)
 const palm=h.sources.find(s=>s.name==='connetix-palm-tree.png');await page.getByLabel('当前图片',{exact:true}).selectOption(palm.id);await preview.waitFor();assert.equal(await player.count(),0)
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(sandbox.calls.recognize,0);assert.deepEqual(await get('history'),historyBefore);assert.deepEqual(await get('profiles'),registryBefore)
 await writeFile(out+'/summary.json',JSON.stringify({pass:true,catSteps:9,controlsStable:true,widths:[1600,1024,430],divider:true,zoom:'125%',sourceScoped:true,oldUnsavedProgressPreserved:true,completionSeparateFromSave:true,refreshDeepLink:true,sourceImageChange:true,paidCalls:0,serverWrites:0},null,2));console.log('PASS: exact-source Build flow, unrelated preview isolation/preservation, cat nine steps, fixed controls across copy/completion/restart/width/divider/zoom/mobile, adjacent save state, URL/reload/new tab, changed Assembly/source image isolation, zero server writes/models. '+out)
}finally{await context.close();await browser.close();await sandbox.close()}

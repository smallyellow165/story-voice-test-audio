import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import {stage,studioButton} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173'
const h=await(await fetch(base+'/api/magnetic-intake/history')).json(),record=h.reconstructions.find(r=>r.candidates?.[0]?.assembly.instances.length===17&&r.mode==='flat-mosaic');assert.ok(record)
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/magnetic-intake/recognize',()=>{throw Error('Paid call forbidden')})
const button=n=>studioButton(page,n),preview=page.getByRole('region',{name:'Build 作品预览'}),player=page.getByRole('region',{name:'搭建教程播放器'}),source=page.getByLabel('教程来源作品',{exact:true})
const ready=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='导入教程 JSON'&&!b.disabled))
const idle=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='刷新图片历史'&&!b.disabled))
async function exportJson(label){const dl=page.waitForEvent('download');await button(label).click();return JSON.parse(await readFile(await(await dl).path(),'utf8'))}
async function name(text){await stage(page,'assembly');await page.getByLabel('作品名称',{exact:true}).fill(text);await page.getByLabel('作品名称',{exact:true}).press('Tab')}
async function assertPreview(n){assert.equal(await preview.locator('[data-preview-piece]').count(),n);assert.equal(await player.count(),0);assert.equal(await page.locator('.build-instruction').count(),0);assert.equal(await page.getByTestId('build-playback-source').count(),0);assert.equal(await page.getByRole('button',{name:'保存教程',exact:true}).isDisabled(),true)}
async function openPlan(id){await page.locator('.build-saved select').selectOption(id);await button('打开教程').click();await ready()}
try{
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html')
 for(let i=0;i<5;i++)await button('添加正方形').click()
 await page.getByLabel('作品模式',{exact:true}).selectOption('flat-mosaic');await name('手动五块作品');await button('保存作品快照').click()
 await stage(page,'build');await assertPreview(5);await button('生成搭建步骤').click();await ready();await button('保存教程').click();await ready()
 const five=await exportJson('导出教程 JSON');assert.equal(five.plan.steps.length,5)
 for(let i=1;i<5;i++){await button('下一步').click();await ready()}
 await button('完成搭建').click();await ready()
 await stage(page,'source');await idle();await page.getByLabel('当前图片',{exact:true}).selectOption(record.sourceId);await idle();await page.getByLabel('历史 Reconstruction',{exact:true}).selectOption(record.id);await idle()
 await page.getByLabel('已对照原图',{exact:true}).check();await button('在作品编辑器中打开').click();await idle();await name('小鸭子保存作品');await button('保存作品快照').click();const duck=await exportJson('导出 JSON')
 await name('小鸭子未保存修改');const draft=await exportJson('导出 JSON')
 await stage(page,'build');await assertPreview(17);assert.equal(await source.inputValue(),'current');assert.match(await page.getByTestId('build-source-status').innerText(),/未保存草稿/)
 assert.equal(await page.locator('.studio-workflow').getByLabel('教程来源作品',{exact:true}).count(),0);assert.equal(await page.locator('.studio-inspector').getByLabel('教程来源作品',{exact:true}).count(),1)
 await source.selectOption('saved:'+duck.id);await assertPreview(17);assert.match(await preview.innerText(),/小鸭子保存作品/)
 await button('生成搭建步骤').click();await ready();await button('保存教程').click();await ready();const seventeen=await exportJson('导出教程 JSON');assert.equal(seventeen.plan.steps.length,17);assert.deepEqual(seventeen.snapshot.assembly,duck)
 await button('下一步').click();await ready();assert.equal(await player.locator('[data-build-tile]').count(),2)
 await openPlan(five.plan.id);assert.equal(await player.locator('[data-build-tile]').count(),5);assert.match(await player.innerText(),/手动五块作品.*已完成/)
 await source.selectOption('saved:'+duck.id);await assertPreview(17)
 await mkdir('/tmp/magnetic-build-viewer',{recursive:true});await page.screenshot({path:'/tmp/magnetic-build-viewer/duck-preview-after-five.png'})
 await page.getByRole('button',{name:'继续当前教程',exact:true}).click();await ready();assert.equal(await player.locator('[data-build-tile]').count(),2);assert.deepEqual(await exportJson('导出教程 JSON'),seventeen)
 await openPlan(seventeen.plan.id);assert.equal(await player.locator('[data-build-tile]').count(),2);assert.deepEqual(await exportJson('导出教程 JSON'),seventeen)
 assert.deepEqual(await exportJson('导出 JSON'),draft,'source and tutorial switches must not change the editor')
 await stage(page,'build');await assertPreview(17);await openPlan(five.plan.id)
 await page.reload();await stage(page,'build');await ready();assert.equal(await source.inputValue(),'current');assert.equal(await player.locator('[data-build-tile]').count(),5);assert.match(await page.getByTestId('build-playback-source').innerText(),/手动五块作品/)
 await source.selectOption('saved:'+duck.id);await assertPreview(17);await openPlan(seventeen.plan.id);assert.equal(await player.locator('[data-build-tile]').count(),2)
 await button('重新开始').click();await ready();assert.equal(await player.locator('[data-build-tile]').count(),1)
 for(let i=1;i<17;i++){await button('下一步').click();await ready()}
 await button('完成搭建').click();await ready();await page.screenshot({path:'/tmp/magnetic-build-viewer/duck-tutorial.png'})
 assert.deepEqual(await exportJson('导出教程 JSON'),seventeen);assert.deepEqual(errors,[])
 console.log('PASS: real historical duck 17 + manually built 5; source preview in Workspace; source controls only in Build Inspector; tutorial controls only when playing; immutable plans and editor draft preserved; independent progress, reload and replay.')
}finally{await browser.close()}

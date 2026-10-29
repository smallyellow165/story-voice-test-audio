// Production UI and isolated browser storage. No image recognition or fixture injection.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {readFile,mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {stage,studioButton} from './magnetic-studio-browser.mjs'
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/magnetic-intake/recognize',()=>{throw Error('Paid call forbidden')})
const button=name=>studioButton(page,name),source=page.getByLabel('教程来源作品',{exact:true}),status=page.getByTestId('build-source-status')
async function ready(){await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='导出教程 JSON'&&!b.disabled))}
async function name(value){await stage(page,'assembly');await page.getByLabel('作品名称',{exact:true}).fill(value);await page.getByLabel('作品名称',{exact:true}).press('Tab')}
async function exported(label){const event=page.waitForEvent('download');await button(label).click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
async function generate(){await button('生成搭建步骤').click();await ready();return exported('导出教程 JSON')}
try{
 await page.goto(process.env.MAGNETIC_URL||'http://127.0.0.1:5173/story-voice-test-audio/magnetic-tiles.html')
 await button('添加正方形').click();await name('手动作业 A')
 await stage(page,'build');assert.match(await status.innerText(),/未保存草稿/)
 const unsaved=await generate();assert.equal(unsaved.snapshot.assembly.name,'手动作业 A');await button('保存教程').click();await ready()
 await button('保存作品快照').click();const savedA=await exported('导出 JSON');await stage(page,'build')
 assert.equal(await source.inputValue(),'current');assert.match(await status.innerText(),/快照一致/)
 assert.equal(await source.locator('optgroup[label="已保存作品"] option').count(),1)
 await name('手动作业 A 未保存编辑');const edited=await exported('导出 JSON');await stage(page,'build')
 assert.match(await status.innerText(),/未保存草稿.*不同/)
 const draft=await generate();assert.equal(draft.snapshot.assembly.name,'手动作业 A 未保存编辑');await button('保存教程').click();await ready()
 await source.selectOption('saved:'+savedA.id);assert.match(await status.innerText(),/已保存作品快照/)
 const fromSaved=await generate();assert.deepEqual(fromSaved.snapshot.assembly,savedA);await button('保存教程').click();await ready()
 assert.deepEqual(await exported('导出 JSON'),edited,'choosing a saved source must not replace the live draft')
 await stage(page,'build');assert.equal(await source.inputValue(),'current','returning from editor continues current work')
 assert.match(await status.innerText(),/未保存草稿/)
 // A second independently saved work is a source even without an existing tutorial.
 await button('新建').click();await button('添加等边三角形').click();await name('手动作业 B');await button('保存作品快照').click();const savedB=await exported('导出 JSON')
 await stage(page,'build');assert.equal(await source.locator('optgroup option').count(),2)
 await source.selectOption('saved:'+savedB.id);const b=await generate();assert.equal(b.snapshot.assembly.instances[0].profileId,'equilateral-triangle');await button('保存教程').click();await ready()
 await source.selectOption('saved:'+savedA.id);assert.equal(await page.getByTestId('build-playback-source').count(),0);assert.match(await page.getByRole('region',{name:'Build 作品预览'}).innerText(),/手动作业 A/)
 await page.locator('.build-saved select').selectOption(unsaved.plan.id);await button('打开教程').click();await ready();assert.deepEqual(await exported('导出教程 JSON'),unsaved,'old immutable source survives editing and selection')
 await button('完成搭建').click();await ready()
 await page.reload();await stage(page,'build');await ready();assert.match(await page.getByRole('region',{name:'搭建教程播放器'}).innerText(),/已完成/)
 assert.deepEqual(await exported('导出教程 JSON'),unsaved)
 assert.equal(await source.locator('optgroup option').count(),2);assert.match(await status.innerText(),/快照一致/)
 assert.deepEqual(await exported('导出 JSON'),savedB)
 await stage(page,'build');await source.selectOption('saved:'+savedA.id);await generate();await ready()
 await mkdir('/tmp/magnetic-build-source',{recursive:true});await page.screenshot({path:'/tmp/magnetic-build-source/saved-source.png'})
 assert.deepEqual(errors,[]);console.log('PASS: manual unsaved -> preview/save; saved work choices independent of tutorials; draft protection; source switching and labels; immutable historical snapshots; refresh and replay.')
}finally{await browser.close()}

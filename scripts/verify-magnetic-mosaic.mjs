// Real saved observations; no Vision calls. Separate browser workspace, immutable server records.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5173',out='/tmp/magnetic-mosaic-screenshots';await mkdir(out,{recursive:true})
const history=await (await fetch(base+'/api/magnetic-intake/history')).json()
const reviewId=process.env.MAGNETIC_REVIEW_ID||'97d5c0f3-5330-4a37-a13b-efa155af1cd2'
const review=history.reviews.find(r=>r.id===reviewId);assert.ok(review,'existing full Review required')
const analysis=history.analyses.find(a=>a.id===review.analysisId)
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/magnetic-intake/recognize',()=>{throw Error('Paid call forbidden')})
const button=name=>page.getByRole('button',{name,exact:true})
async function ready(){await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='刷新图片历史'&&!b.disabled))}
try{
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await page.locator('.intake-panel summary').click();await ready()
 await page.getByLabel('已保存图片',{exact:true}).selectOption(analysis.sourceId);await ready()
 await page.getByLabel('历史 Analysis',{exact:true}).selectOption(analysis.id);await ready()
 await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await ready()
 const failedResponse=page.waitForResponse(r=>r.url().endsWith('/reconstruct')&&r.request().method()==='POST')
 await button('重建二维布局').click();const failed=await (await failedResponse).json();await ready();assert.equal(failed.candidates.length,0);assert.match(await page.getByRole('region',{name:'重建结果',exact:true}).innerText(),/没有找到合法候选/)
 await page.getByRole('region',{name:'重建结果',exact:true}).screenshot({path:out+'/connected-failure.png'})
 await page.getByLabel('重建作品模式',{exact:true}).selectOption('flat-mosaic')
 const response=page.waitForResponse(r=>r.url().endsWith('/reconstruct')&&r.request().method()==='POST')
 await button('重建二维布局').click();const result=await (await response).json();await ready()
 assert.equal(result.outcome,'success');assert.ok(result.candidates.length)
 const c=result.candidates[0];assert.equal(c.assembly.instances.length,17);assert.equal(c.components.length,3);assert.equal(c.connections,17)
 assert.match(await page.getByRole('region',{name:'重建结果',exact:true}).innerText(),/成功：生成/)
 await page.locator('.intake-grid').screenshot({path:out+'/source-candidate.png'})
 await writeFile(out+'/result.json',JSON.stringify(result,null,2))
 if(process.env.MAGNETIC_VISUAL_ACCEPTED==='1'){
  await page.getByLabel('已对照原图',{exact:true}).check();await button('打开到 Playground').click();await ready()
  assert.equal(await page.locator('polygon[data-tile-id]').count(),17)
  assert.equal(await page.getByLabel('作品模式',{exact:true}).inputValue(),'flat-mosaic')
  await button('保存作品快照').click()
  await button('生成搭建步骤').click()
  const player=page.getByRole('region',{name:'搭建教程播放器'})
  await player.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='保存教程'&&!b.disabled))
  await button('保存教程').click()
  const waitBuild=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='导出教程 JSON'&&!b.disabled))
  await waitBuild();const download=page.waitForEvent('download');await button('导出教程 JSON').click();const bundle=JSON.parse(await readFile(await (await download).path(),'utf8'))
  assert.equal(bundle.plan.steps.length,17);assert.equal(bundle.plan.steps.filter(s=>s.startsComponent).length,3)
  for(let i=1;i<17;i++){await button('下一步').click();await waitBuild();assert.equal(await player.locator('[data-build-tile]').count(),i+1);if(i===15){assert.equal(await player.locator('.build-edge').count(),0);await player.screenshot({path:out+'/component-root.png'})}}
  await player.screenshot({path:out+'/build-complete.png'});await button('完成搭建').click();await waitBuild();await page.reload();await waitBuild();assert.match(await player.locator('h3').innerText(),/已完成/)
  assert.equal(await page.locator('polygon[data-tile-id]').count(),17)
  await button('新建').click();assert.equal(await player.locator('[data-build-tile]').count(),17)
  await page.getByTestId('build-import').setInputFiles({name:'mosaic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await waitBuild();await button('重新开始').click();await waitBuild();assert.equal(await player.locator('[data-build-tile]').count(),1)
  await page.setViewportSize({width:430,height:900});await player.screenshot({path:out+'/build-narrow.png'})
 }
 const after=await (await fetch(base+'/api/magnetic-intake/history')).json();assert.equal(after.analyses.length,history.analyses.length);assert.equal(after.reviews.length,history.reviews.length)
 assert.deepEqual(after.reviews.find(r=>r.id===review.id),review);assert.deepEqual(after.analyses.find(a=>a.id===analysis.id),analysis);assert.deepEqual(errors,[])
 console.log(JSON.stringify({reviewId,candidates:result.candidates.length,pieces:17,components:c.components,connections:c.connections,imageError:c.imageError,explored:result.explored,trials:result.trials,screenshots:out,fullReplay:process.env.MAGNETIC_VISUAL_ACCEPTED==='1'}))
}finally{await browser.close()}

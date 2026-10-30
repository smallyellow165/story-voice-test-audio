import {stage,studioButton,reviewDetails} from './magnetic-studio-browser.mjs'
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
const button=name=>studioButton(page,name)
async function ready(){await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='刷新图片历史'&&!b.disabled))}
try{
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await stage(page,'source');await ready()
 await page.getByLabel('已保存图片',{exact:true}).selectOption(analysis.sourceId);await ready()
 await page.getByLabel('历史 Analysis',{exact:true}).selectOption(analysis.id);await ready()
 await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await ready()
 await stage(page,'reconstruction')
 // Review edits and selected observation survive all stage changes without a save.
 await stage(page,'review')
 await reviewDetails(page,'高级信息 / 编辑');const reason=await page.getByLabel('输入说明 / 修正理由',{exact:true}).inputValue()
 await page.getByLabel('输入说明 / 修正理由',{exact:true}).fill(reason+' UI draft')
 await page.locator('[data-review-id="b1"]').click()
 const shape=await page.getByLabel('修正形状',{exact:true}).inputValue()
 await page.getByLabel('修正形状',{exact:true}).selectOption('right-triangle@1')
 for(const s of ['assembly','build','source','review'])await stage(page,s)
 assert.equal(await page.getByLabel('输入说明 / 修正理由',{exact:true}).inputValue(),reason+' UI draft')
 assert.equal(await page.getByLabel('修正形状',{exact:true}).inputValue(),'right-triangle@1')
 assert.match(await page.locator('.intake-controls legend').innerText(),/b1/)
 await page.getByLabel('输入说明 / 修正理由',{exact:true}).fill(reason)
 await page.getByLabel('修正形状',{exact:true}).selectOption(shape)
 await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await ready()
 await stage(page,'reconstruction')
 const failedResponse=page.waitForResponse(r=>r.url().endsWith('/reconstruct')&&r.request().method()==='POST')
 await button('重建二维布局').click();const failed=await (await failedResponse).json();await ready();assert.equal(failed.candidates.length,0);assert.match(await page.getByRole('region',{name:'重建结果',exact:true}).innerText(),/没有找到合法候选/)
 await page.getByRole('region',{name:'重建结果',exact:true}).screenshot({path:out+'/connected-failure.png'})
 await page.getByLabel('重建作品模式',{exact:true}).selectOption('flat-mosaic')
 const response=page.waitForResponse(r=>r.url().endsWith('/reconstruct')&&r.request().method()==='POST')
 await button('重建二维布局').click();const result=await (await response).json();await ready()
 assert.equal(result.outcome,'success');assert.ok(result.candidates.length)
 const c=result.candidates[0];assert.equal(c.assembly.instances.length,17);assert.equal(c.components.length,3);assert.equal(c.connections,17)
 assert.match(await page.getByRole('region',{name:'重建结果',exact:true}).innerText(),/成功：生成/)
 await page.locator('.studio').screenshot({path:out+'/source-candidate.png'})
 const layout=await page.evaluate(()=>{
  const main=document.querySelector('main'),cols=[...main.querySelectorAll('.studio-column')],rects=cols.map(c=>c.getBoundingClientRect())
  return {children:cols.length,rootChildren:document.querySelector('#root').children.length,pageHeight:document.documentElement.scrollHeight,height:innerHeight,pageWidth:document.documentElement.scrollWidth,width:innerWidth,overflow:cols.map(c=>getComputedStyle(c).overflowY),ordered:rects[0].right<=rects[1].left&&rects[1].right<=rects[2].left,largest:rects[1].width>rects[0].width&&rects[1].width>rects[2].width}
 })
 assert.equal(layout.children,3);assert.equal(layout.rootChildren,1);assert.ok(layout.pageHeight<=layout.height);assert.ok(layout.pageWidth<=layout.width);assert.ok(layout.ordered&&layout.largest);assert.deepEqual(layout.overflow,['auto','auto','auto'])
 // Wheel input scrolls each column independently, with no document movement.
 await page.setViewportSize({width:1440,height:720})
 for(const column of ['workflow','inspector']){
  const el=page.locator('.studio-'+column);await el.evaluate(e=>{e.scrollTop=0});const box=await el.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height-30);await page.mouse.wheel(0,600)
  await page.waitForFunction(c=>document.querySelector('.studio-'+c).scrollTop>0,column)
  assert.equal(await page.evaluate(()=>scrollY),0)
 }
 await stage(page,'assembly');await page.setViewportSize({width:1440,height:500})
 const center=page.locator('.studio-workspace');await center.evaluate(e=>{e.scrollTop=0});const centerBox=await center.boundingBox();await page.mouse.move(centerBox.x+centerBox.width/2,centerBox.y+centerBox.height-30);await page.mouse.wheel(0,450)
 await page.waitForFunction(()=>document.querySelector('.studio-workspace').scrollTop>0);assert.equal(await page.evaluate(()=>scrollY),0)
 await page.setViewportSize({width:1600,height:1100});await stage(page,'reconstruction')
 await page.getByRole('button',{name:'候选零件 f1',exact:true}).click()
 assert.equal(await page.locator('[data-observation="f1"]').getAttribute('class'),'observation selected')
 await button('修正选中零件').click();assert.match(await page.locator('.intake-controls legend').innerText(),/f1/)
 await stage(page,'assembly');await stage(page,'reconstruction')
 assert.equal(await page.getByLabel('重建候选',{exact:true}).inputValue(),c.id)
 await writeFile(out+'/result.json' ,JSON.stringify(result,null,2))
 if(process.env.MAGNETIC_VISUAL_ACCEPTED==='1'){
  await page.getByLabel('已对照原图',{exact:true}).check();await button('在作品编辑器中打开').click();await ready()
  assert.equal(await page.locator('polygon[data-tile-id]').count(),17)
  assert.equal(await page.getByLabel('作品模式',{exact:true}).inputValue(),'flat-mosaic')
  await button('保存作品快照').click();await page.screenshot({path:out+'/studio-assembly.png'})
  await stage(page,'build')
  assert.match(await page.getByTestId('build-source-status').innerText(),/快照一致/)
  assert.match(await page.getByRole('region',{name:'生成教程的作品来源'}).innerText(),/17 块.*Flat Mosaic/)
  const savedSource=page.getByLabel('教程来源作品',{exact:true}).locator('optgroup option').first()
  await page.getByLabel('教程来源作品',{exact:true}).selectOption(await savedSource.getAttribute('value'))
  await button('生成搭建步骤').click()
  const player=page.getByRole('region',{name:'搭建教程播放器'})
  await player.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='保存教程'&&!b.disabled))
  await button('保存教程').click()
  const waitBuild=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='导出教程 JSON'&&!b.disabled))
  await waitBuild();const download=page.waitForEvent('download');await button('导出教程 JSON').click();const bundle=JSON.parse(await readFile(await (await download).path(),'utf8'))
  assert.equal(bundle.plan.steps.length,17);assert.equal(bundle.plan.steps.filter(s=>s.startsComponent).length,3)
  for(let i=1;i<17;i++){await button('下一步').click();await waitBuild();assert.equal(await player.locator('[data-build-tile]').count(),i+1);if(i===15){assert.equal(await player.locator('.build-edge').count(),0);await player.screenshot({path:out+'/component-root.png'})}}
  await page.screenshot({path:out+'/build-complete.png'});await button('完成搭建').click();await waitBuild();await page.reload();await stage(page,'build');await waitBuild();assert.match(await player.locator('h3').innerText(),/已完成/)
  assert.equal(await page.locator('polygon[data-tile-id]').count(),17)
  await button('新建').click();await stage(page,'build');await page.getByRole('button',{name:'继续上次教程',exact:true}).click();assert.equal(await player.locator('[data-build-tile]').count(),17)
  await stage(page,'build');await page.getByTestId('build-import').setInputFiles({name:'mosaic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await waitBuild();await button('重新开始').click();await waitBuild();assert.equal(await player.locator('[data-build-tile]').count(),1)
  await page.setViewportSize({width:430,height:900});await stage(page,'build','workspace');await player.screenshot({path:out+'/build-narrow.png'})
 }
 const after=await (await fetch(base+'/api/magnetic-intake/history')).json();assert.equal(after.analyses.length,history.analyses.length);assert.equal(after.reviews.length,history.reviews.length)
 assert.deepEqual(after.reviews.find(r=>r.id===review.id),review);assert.deepEqual(after.analyses.find(a=>a.id===analysis.id),analysis);assert.deepEqual(errors,[])
 console.log(JSON.stringify({reviewId,candidates:result.candidates.length,pieces:17,components:c.components,connections:c.connections,imageError:c.imageError,explored:result.explored,trials:result.trials,screenshots:out,fullReplay:process.env.MAGNETIC_VISUAL_ACCEPTED==='1'}))
}finally{await browser.close()}

import {stage,studioButton} from './magnetic-studio-browser.mjs'
// Real browser UI. Paid recognition is explicitly opt-in and limited to two images.
// Default replays previously saved real analyses; never injects mock provider output.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {vertices,validate} from '../src/magnetic-tiles/geometry.ts'
import {cases,evidenceFor} from '../test/fixtures/magnetic-intake/cases.mjs'
const base=process.env.MAGNETIC_INTAKE_URL||'http://127.0.0.1:5186'
const output=process.env.MAGNETIC_INTAKE_OUTPUT||'/tmp/magnetic-intake-benchmarks'
const duck=process.env.MAGNETIC_DUCK_IMAGE||new URL('../public/test-images/maganetic/26d33ab7b7de237be0538c7a88da290a.jpg',import.meta.url).pathname
const live=process.env.MAGNETIC_LIVE==='1'
const liveCases=(process.env.MAGNETIC_LIVE_CASES||'two-squares,duck').split(',')
const selectedModel=process.env.MAGNETIC_MODEL||'gpt-4.1'
await mkdir(output,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1500,height:1050},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message))
const button=name=>studioButton(page,name)
const report={live,calls:0,cases:[]}
async function idle(){await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='上传磁力片图片'&&!b.disabled),{},{timeout:240000})}
async function getHistory(){const response=await page.request.get(base+'/api/magnetic-intake/history');assert.equal(response.status(),200);return response.json()}
async function exportBuild(){await stage(page,'build');if(await page.getByRole('button',{name:'继续上次教程',exact:true}).isVisible())await page.getByRole('button',{name:'继续上次教程',exact:true}).click();const event=page.waitForEvent('download');await button('导出教程 JSON').click();return JSON.parse(await readFile(await (await event).path(),'utf8'))}
try{
 // Draw independent benchmark inputs; they are test images, never application recognition results.
 const draw=await browser.newPage()
 for(const c of cases){const f=evidenceFor(c.tiles,profiles,vertices,validate);await draw.setViewportSize({width:f.width,height:f.height});await draw.setContent(`<html><body style="margin:0;background:#fff"><svg width="${f.width}" height="${f.height}" viewBox="0 0 ${f.width} ${f.height}">${f.evidence.observations.map(o=>`<polygon points="${o.outline.map(([x,y])=>`${x*f.width},${y*f.height}`).join(' ')}" fill="${o.color}" stroke="#263c37" stroke-width="3"/>`).join('')}</svg></body></html>`);await draw.screenshot({path:`${output}/benchmark-${c.id}.png`})}await draw.close()
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await stage(page,'source');await idle()
 for(const entry of [{id:'two-squares',file:`${output}/benchmark-two-squares.png`},{id:'duck',file:duck}]){
  await stage(page,'source')
  const upload=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/sources')&&r.request().method()==='POST');await page.getByTestId('intake-upload').setInputFiles(entry.file);const source=await (await upload).json();await idle()
  await page.getByLabel('识别模型',{exact:true}).selectOption(selectedModel)
  let analysis
  if(live&&liveCases.includes(entry.id)){const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/recognize'),{timeout:240000});await button('识别图片（调用模型）').click();report.calls++;analysis=await (await response).json();await idle()}
  else {const h=await getHistory();analysis=h.analyses.find(a=>a.sourceId===source.id&&a.status==='complete');if(!analysis)throw Error('Missing saved real analysis; explicitly run MAGNETIC_LIVE=1 once');await page.getByLabel('历史 Analysis',{exact:true}).selectOption(analysis.id);await idle();analysis=await (await page.request.get(base+'/api/magnetic-intake/analyses/'+analysis.id)).json()}
  const summary={id:entry.id,sourceId:source.id,analysisId:analysis.id,model:analysis.model,modelVersion:analysis.modelVersion,usage:analysis.usageMetadata,status:analysis.status,evidence:analysis.evidence,error:analysis.error}
  report.cases.push(summary);await writeFile(output+'/report.json',JSON.stringify(report,null,2))
  assert.equal(analysis.status,'complete',JSON.stringify(summary))
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reviews')&&r.request().method()==='POST');await button('保存审核快照').click();const review=await (await saved).json();await idle()
  const reconstructed=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct'));await button('重建二维布局').click();const result=await (await reconstructed).json();await idle()
  summary.reviewId=review.id;summary.reconstructionId=result.id;summary.reconstruction=result
  await page.locator('.studio').screenshot({path:`${output}/${entry.id}-intake.png`,animations:'disabled'})
  await writeFile(output+'/report.json',JSON.stringify(report,null,2))
  if(entry.id==='duck'){
   // Explicit manual subassembly benchmark. NOT a claim that the entire duck reconstructed.
   const headIds=analysis.evidence.observations.filter(o=>/^h[1-6]$/.test(o.id)||o.id==='r1').map(o=>o.id)
   if(headIds.length===7){
    await stage(page,'review')
    for(const o of analysis.evidence.observations.filter(o=>!headIds.includes(o.id))){
     await page.locator('.intake-observations button').filter({hasText:o.id+' ·'}).click()
     await page.getByLabel('不采用本片（误检或仅重建局部）',{exact:true}).check()
    }
    await page.getByLabel('输入说明 / 修正理由',{exact:true}).fill('人工局部验收：仅重建六块鸭头三角形和嘴部；身体与脚并非误检，本次有意排除，不代表完整小鸭子成功。')
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reviews')&&r.request().method()==='POST');await button('保存审核快照').click();const partialReview=await (await saved).json();await idle()
    const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct'));await button('重建二维布局').click();const partial=await (await response).json();await idle()
    summary.manualSubset={description:'Only six head triangles and beak; body/feet intentionally excluded for a 7-piece subassembly test',reviewId:partialReview.id,result:partial}
    assert.ok(partial.candidates.length,'real photo head subset should reconstruct after explicit review')
    assert.equal(partial.candidates[0].assembly.instances.length,7)
    assert.equal(partial.candidates[0].connections,7)
    if(partial.candidates.length){await page.getByLabel('已对照原图',{exact:true}).check();await button('在作品编辑器中打开').click();await idle();await button('生成搭建步骤').click();await button('保存教程').click();summary.manualSubset.buildPlanId=(await exportBuild()).plan.id}
    await page.locator('.studio').screenshot({path:output+'/duck-head-subset.png',animations:'disabled'})
   }
  }
  if(entry.id==='two-squares'){
   assert.equal(analysis.evidence.observations.length,2,'recognition count must match the image, not only schema')
   assert.ok(analysis.evidence.observations.every(o=>o.profileId==='square'))
   assert.ok(result.candidates.length,'real observation must reconstruct')
   assert.equal(result.candidates[0].connections,1)
   assert.ok(result.candidates[0].imageError<.12)
   await page.getByLabel('已对照原图',{exact:true}).check();await button('在作品编辑器中打开').click();await idle()
   assert.equal(await page.locator('polygon[data-tile-id]').count(),2)
   await button('生成搭建步骤').click();await button('保存教程').click();await button('下一步').click()
   const bundle=await exportBuild();assert.equal(bundle.plan.steps.length,2);summary.buildPlanId=bundle.plan.id
   await page.reload();await stage(page,'source');await idle()
   await page.getByLabel('已保存图片',{exact:true}).selectOption(source.id);await idle();await page.getByLabel('历史 Analysis',{exact:true}).selectOption(analysis.id);await idle()
   await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await idle()
   // Create a new manual review; retain the old immutable review, assembly and Build.
   await stage(page,'review');await page.getByLabel('修正颜色',{exact:true}).fill('#4466aa');await button('保存审核快照').click();await idle()
   const h=await getHistory();assert.ok(h.reviews.filter(r=>r.analysisId===analysis.id).length>=2)
   assert.equal(h.reviews.find(r=>r.id===review.id).hash,review.hash)
   assert.deepEqual(await exportBuild(),bundle)
   // Switching context preserves an unsaved manual edit as a new immutable snapshot.
   await stage(page,'review');await page.getByLabel('修正颜色',{exact:true}).fill('#118855')
   await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await idle()
   assert.ok((await getHistory()).reviews.some(r=>r.analysisId===analysis.id&&r.evidence.observations.some(o=>o.color==='#118855')))
   // Shape correction and relation editing exercise the same real Review UI.
   await stage(page,'review');await page.getByLabel('修正形状',{exact:true}).selectOption('unknown')
   await button('保存审核快照').click();await idle()
   const unknownResponse=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct'))
   await button('重建二维布局').click();const unknownResult=await (await unknownResponse).json();await idle()
   assert.equal(unknownResult.candidates.length,0)
   await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await idle()
   await stage(page,'review');await page.getByLabel('连接到',{exact:true}).selectOption(analysis.evidence.observations[1].id)
   await page.getByLabel('关系意图',{exact:true}).selectOption('separate');await button('设置关系').click()
   await button('保存审核快照').click();await idle()
   const disconnectedResponse=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct'))
   await button('重建二维布局').click();const disconnected=await (await disconnectedResponse).json();await idle();assert.equal(disconnected.candidates.length,0)
   await page.getByLabel('历史 Review',{exact:true}).selectOption(review.id);await idle()
   await button('补一块漏检零件').click();assert.match(await page.locator('.intake-controls legend').innerText(),/人工补充/)
   await stage(page,'review');await page.getByLabel('修正形状',{exact:true}).selectOption('right-triangle@1')
   await button('删除角点').first().click();assert.equal(await page.locator('.intake-point').count(),3)
   await page.getByLabel('不采用本片（误检或仅重建局部）',{exact:true}).check()
   await button('保存审核快照').click();await idle()
   const manualHistory=await getHistory();assert.ok(manualHistory.reviews.some(r=>r.analysisId===analysis.id&&r.evidence.observations.some(o=>o.origin==='manual'&&o.excluded)))
   // Editing the loaded assembly preserves its ancestry but invalidates exact-match wording.
   await stage(page,'assembly');const first=page.locator('polygon[data-tile-id]').first();await first.focus();await page.keyboard.press('Enter');await page.keyboard.press('Delete')
   await page.waitForFunction(()=>document.querySelector('.intake-origin')?.textContent.includes('已手动修改'))
   assert.deepEqual(await exportBuild(),bundle)
  }
 }
 // A future replay must never pay again; all data came through real HTTP + UI.
 await page.setViewportSize({width:390,height:844});await page.locator('.studio').screenshot({path:output+'/intake-narrow.png',animations:'disabled'})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 const finalHistory=await getHistory();report.paidAnalyses=finalHistory.analyses.filter(a=>report.cases.some(c=>c.sourceId===a.sourceId)).map(a=>({id:a.id,model:a.model,modelVersion:a.modelVersion,status:a.status,error:a.error,usage:a.usageMetadata}));
 await writeFile(output+'/report.json',JSON.stringify(report,null,2))
 console.log(JSON.stringify({calls:report.calls,cases:report.cases.map(c=>({id:c.id,status:c.status,count:c.evidence?.observations.length,kind:c.evidence?.sourceKind,candidates:c.reconstruction?.candidates?.length,diagnostics:c.reconstruction?.diagnostics,usage:c.usage})),output},null,2))
}finally{await browser.close()}

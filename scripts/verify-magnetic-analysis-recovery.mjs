// Real Studio/API with an explicitly offline historical response in temporary
// storage. No provider calls, production writes, or bypass of Source hashing.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {multiFixture} from '../test/magnetic-multi-image-fixtures.mjs'
import {stage} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'analysis-recovery-ui-')),out='/tmp/magnetic-analysis-recovery-browser'
let server,browser,page,providerCalls=0
const originalFetch=globalThis.fetch
globalThis.fetch=(url,...args)=>{if(String(url).startsWith('https://api.openai.com/')){providerCalls++;throw Error('Provider network forbidden')}return originalFetch(url,...args)}
const errors=[],requests=[],f=await multiFixture(dir),traceId=randomUUID(),requestId=randomUUID(),workspaceId=randomUUID()
const raw=structuredClone(f.evidence);raw.observations.forEach(o=>o.imageEvidence[0].features=[])
const trace={id:traceId,status:'invalid_plan',parseStatus:'parsed',validation:{valid:false,issues:['主图坐标必须与对应图片证据一致']},requestInput:f.prepared.input,sources:[{sourceId:f.source.id,sourceHash:f.source.hash}],rawOutput:JSON.stringify(raw),plan:raw,wireStatus:'response_saved',finishReason:'completed',usageMetadata:{total_tokens:123},background:{state:'completed',responseId:'resp_offline_fixture'}}
const operation={id:requestId,kind:'analyze',createdAt:new Date().toISOString(),state:'failed',usable:false,error:'主图坐标必须与对应图片证据一致',sourceId:f.source.id,sourceHash:f.source.hash,trace}
try{
 await mkdir(out,{recursive:true});for(const kind of ['model-traces','requests'])await mkdir(path.join(dir,'visible3d',kind),{recursive:true})
 const traceFile=path.join(dir,'visible3d/model-traces',traceId+'.json');await writeFile(traceFile,JSON.stringify(trace));const before=await readFile(traceFile)
 await writeFile(path.join(dir,'visible3d/requests',requestId+'.json'),JSON.stringify(operation))
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'offline-analysis-recovery',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];requests.push({method:req.method,route});try{
   if(['visible3d/analyze','visible3d/plan','visible3d/execute'].includes(route))throw Error('Provider/geometry generation forbidden in recovery test')
   let text='';for await(const c of req)text+=c
   const result=await f.api.dispatch(req.method,route,text?JSON.parse(text):{});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
 // Exact saved receipt belonging to this Create; never import by photo/name.
 await page.addInitScript(({workspaceId,requestId,sourceId})=>{
  const prefix='magnetic-studio.workspace.v1.create.'+workspaceId+'.'
  if(!localStorage.getItem(prefix+'history')){
   localStorage.setItem(prefix+'history',JSON.stringify({refs:[],requestIds:[requestId]}))
   localStorage.setItem(prefix+'magnetic-visible3d-context.v1',JSON.stringify({sourceId,model:'gpt-6.1-sol',analysisTraceRequestId:requestId}))
  }
 },{workspaceId,requestId,sourceId:f.source.id})
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?workspace=create&workspaceId=${workspaceId}&stage=source`
 const button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}),history=()=>page.getByLabel('Analysis History',{exact:true}).filter({visible:true})
 await page.goto(url);await stage(page,'source','inspector')
 await history().locator(`option[value="${requestId}"]`).waitFor({state:'attached'});assert.equal(await history().locator('option').count(),2)
 await page.getByTestId('visible3d-analysis-state').getByText('Validation Failed · 结果校验失败',{exact:true}).waitFor();assert.equal(await page.getByTestId('visible3d-analysis-state').getAttribute('data-tone'),'error');assert.equal(await page.locator('.analysis-toolbar').getByRole('button',{name:'进入 Review',exact:true}).isDisabled(),true)
 assert.equal(await page.getByText('识别请求（已有记录）',{exact:true}).count(),0)
 await button('Trace / Raw').click();const dialog=page.getByRole('dialog',{name:'Magnetic Tiles Trace',exact:true})
 await page.waitForFunction(()=>document.querySelector('dialog[open] textarea[aria-label="Trace JSON"]')?.value.includes('resp_offline_fixture'))
 const saved=JSON.parse(await dialog.getByLabel('Trace JSON',{exact:true}).inputValue());assert.equal(saved.trace.status,'invalid_plan');assert.equal(saved.trace.usageMetadata.total_tokens,123)
 await dialog.getByRole('button',{name:'关闭 Trace',exact:true}).click();await button('恢复结果并 Review（不调用模型）').click()
 await stage(page,'review','inspector');await page.getByLabel('3D Review Profile',{exact:true}).waitFor()
 await page.getByText(`Analysis 标注诊断 · ${raw.observations.length}`,{exact:true}).click();assert.ok((await page.locator('.analysis-validation-diagnostics').innerText()).includes('原始图片级标注及坐标保存在 Trace'))
 // Column filtering is presentation-only: selection, annotations and batch scope
 // stay based on the pre-existing image/status/search selection.
 const table=page.locator('.review-parts-table'),filterButton=table.getByRole('button',{name:'筛选 Observation ID',exact:true}),pop=page.getByRole('dialog',{name:'Observation ID 筛选',exact:true}),visibleRows=()=>table.locator('tbody tr').evaluateAll(rows=>rows.map(r=>r.dataset.reviewId)),visibleMarks=()=>page.locator('.review-evidence-fit [data-observation]').evaluateAll(nodes=>nodes.map(n=>n.dataset.observation))
 await stage(page,'review','workspace');assert.deepEqual(await visibleRows(),['base','wall']);await table.getByLabel('显示证据 wall',{exact:true}).uncheck();assert.deepEqual(await visibleMarks(),['base'])
 const headerHeight=(await table.locator('thead').boundingBox()).height;await filterButton.click();await pop.waitFor();const popBox=await pop.boundingBox();assert.ok(popBox.width<=241&&popBox.height<=180,'compact popover');assert.equal((await table.locator('thead').boundingBox()).height,headerHeight,'popover must not change table header height');await page.screenshot({path:out+'/id-filter-popover.png'});await pop.getByLabel('Observation ID 筛选文本',{exact:true}).fill('WAL');await pop.getByLabel('Observation ID 筛选文本',{exact:true}).press('Enter')
 assert.deepEqual(await visibleRows(),['wall']);assert.deepEqual(await visibleMarks(),['base']);assert.equal(await filterButton.getAttribute('aria-pressed'),'true');assert.equal(await table.getByLabel('显示证据 wall',{exact:true}).isChecked(),false)
 await page.getByRole('group',{name:'Review 统计与筛选'}).getByRole('button',{name:/^Known /}).click();assert.deepEqual(await visibleRows(),[]);await page.getByRole('group',{name:'Review 统计与筛选'}).getByRole('button',{name:/^Unknown /}).click();assert.deepEqual(await visibleRows(),['wall'])
 await page.getByLabel('搜索审核零件',{exact:true}).fill('base');assert.deepEqual(await visibleRows(),[]);await page.getByLabel('搜索审核零件',{exact:true}).fill('');assert.deepEqual(await visibleRows(),['wall'])
 await page.getByRole('button',{name:/^图片 \d+\/\d+/}).click();const imageFilter=page.getByRole('dialog',{name:'Review 图片筛选',exact:true});await imageFilter.getByRole('button',{name:'清除图片',exact:true}).click();await imageFilter.getByRole('button',{name:'关闭图片筛选',exact:true}).click();assert.deepEqual(await visibleRows(),[])
 await page.getByRole('button',{name:/^图片 \d+\/\d+/}).click();await imageFilter.getByRole('button',{name:'全部图片',exact:true}).click();await imageFilter.getByRole('button',{name:'关闭图片筛选',exact:true}).click();assert.deepEqual(await visibleRows(),['wall'])
 await stage(page,'source','workspace');await stage(page,'review','workspace');assert.deepEqual(await visibleRows(),['wall']);assert.equal(await filterButton.getAttribute('aria-pressed'),'true')
 await page.reload();await stage(page,'review','workspace');await table.locator('[data-review-id="wall"]').waitFor({state:'attached'});assert.deepEqual(await visibleRows(),['wall']);assert.equal(await filterButton.getAttribute('aria-pressed'),'true')
 await page.getByLabel('当前证据图片',{exact:true}).selectOption(f.source.images[1].sourceId);assert.deepEqual(await visibleRows(),['wall']);await page.locator('.review-evidence-fit [data-observation="base"]').waitFor();assert.deepEqual(await visibleMarks(),['base'])
 await filterButton.click();await pop.getByLabel('Observation ID 匹配方式',{exact:true}).selectOption('startsWith');await pop.getByLabel('Observation ID 筛选文本',{exact:true}).fill('BA');await pop.getByRole('button',{name:'Apply',exact:true}).click();assert.deepEqual(await visibleRows(),['base']);assert.equal(await table.getByLabel('显示证据 base',{exact:true}).isChecked(),true)
 await page.getByRole('group',{name:'Review 统计与筛选'}).getByRole('button',{name:/^全部 /}).click();page.once('dialog',d=>d.accept());await button('采用所有 AI 建议').click();assert.match(await page.locator('.review-bulk-summary').innerText(),/已采用 2/);assert.deepEqual(await visibleRows(),['base'],'batch still applies to the hidden observation')
 await table.locator('[data-review-id="base"]').click();assert.deepEqual(await visibleRows(),['base']);await filterButton.click();await pop.getByLabel('Observation ID 筛选文本',{exact:true}).fill('wall');await pop.getByLabel('Observation ID 筛选文本',{exact:true}).press('Escape');assert.deepEqual(await visibleRows(),['base']);assert.equal(await pop.isVisible(),false)
 await filterButton.click();assert.equal(await pop.getByLabel('Observation ID 筛选文本',{exact:true}).inputValue(),'BA');await pop.getByRole('button',{name:'Clear',exact:true}).click();assert.equal(await filterButton.getAttribute('aria-pressed'),'false');assert.deepEqual(await visibleRows(),['base','wall']);assert.deepEqual(await visibleMarks(),['base'])
 await page.getByRole('group',{name:'Review 统计与筛选'}).getByRole('button',{name:/^全部 /}).click()
 const reviewResponse=page.waitForResponse(r=>r.url().endsWith('/visible3d/reviews')&&r.status()===200);await button('保存 3D Review').click();await reviewResponse
 assert.deepEqual(await readFile(traceFile),before);const result=(await f.api.dispatch('GET','visible3d/history'));assert.equal(result.analyses.length,1);assert.equal(result.reviews.length,1);assert.equal(result.reviews[0].input.review.pieces.filter(p=>p.confirmed).length,2);assert.equal(result.plans.length,0)
 await page.reload();await stage(page,'source','inspector');await page.getByTestId('visible3d-analysis-state').getByText('Reviewable · 待人工 Review（含诊断）',{exact:true}).waitFor();assert.equal(await history().locator('option').count(),2,'request/result appear once');assert.equal(await page.locator('.analysis-toolbar').getByRole('button',{name:'进入 Review',exact:true}).isEnabled(),true);assert.equal(await page.locator('.studio-inspector').getByRole('button',{name:'进入 Review',exact:true}).count(),0)
 await button('进入 Review').click();await stage(page,'review','inspector');await page.getByLabel('3D Review Profile',{exact:true}).waitFor();await page.screenshot({path:out+'/recovered-review.png'})
 // Another Create has no history, even for records in this same server library.
 await page.goto(url.replace(workspaceId,randomUUID()));await stage(page,'source','inspector');assert.equal(await history().count(),0)
 await page.goto(url);await stage(page,'source','inspector');await history().waitFor();assert.equal(await history().locator('option').count(),2)
 assert.deepEqual(await readFile(traceFile),before);assert.deepEqual(errors,[]);assert.equal(providerCalls,0)
 assert.equal(requests.filter(r=>r.route==='visible3d/resume-analyze').length,1)
 const report={passed:true,modelCalls:0,productionWrites:0,checks:['one Analysis History','failed raw/usage trace','offline recovery -> Review','ID filter + independent evidence selection','diagnostics retained','Review persistence','refresh and reopen','one immutable result','raw Trace unchanged','Create receipt isolation','no Planning/Execution']}
 await writeFile(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{globalThis.fetch=originalFetch;await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

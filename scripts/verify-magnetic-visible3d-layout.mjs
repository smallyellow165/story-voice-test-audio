// Saved real-photo records are copied into a temporary API. No model calls or production writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {mkdtemp,mkdir,readFile,writeFile,readdir,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,stored=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'visible3d-layout-')),out='/tmp/magnetic-visible3d-layout'
let browser,server,page
try{
 await mkdir(out,{recursive:true})
 const sources=await Promise.all((await readdir(path.join(stored,'sources'))).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(path.join(stored,'sources',f),'utf8'))))
 const source=sources.find(s=>s.name==='qisimiaoxiang_square.png');assert.ok(source,'saved real-photo case is required')
 for(const kind of ['sources','assets'])await mkdir(path.join(dir,kind),{recursive:true})
 await cp(path.join(stored,'sources',source.id+'.json'),path.join(dir,'sources',source.id+'.json'))
 for(const id of new Set([source.originalHash,source.view.hash]))await cp(path.join(stored,'assets',id+'.json'),path.join(dir,'assets',id+'.json'))
 await cp(path.join(stored,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 for(const kind of ['analyses','reviews','plans','executions','heads','model-traces'])await cp(path.join(stored,'visible3d',kind),path.join(dir,'visible3d',kind),{recursive:true})
 const api=createMagneticIntake(dir),history=await api.dispatch('GET','visible3d/history')
 const execution=history.executions.find(x=>x.sourceId===source.id&&x.candidates.length===4);assert.ok(execution,'four saved candidates required')
 const plan=history.plans.find(p=>p.id===execution.planId),review=history.reviews.find(r=>r.id===plan.reviewId),analysis=history.analyses.find(a=>a.id===review.analysisId)
 const errors=[],calls=[];let acceptDialogs=true,dialogs=0
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-layout-api',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];calls.push(route)
  if(req.method!=='GET'&&!['visible3d/execute','visible3d/adopt'].includes(route)){res.statusCode=403;res.end(JSON.stringify({error:'Model and production writes forbidden'}));return}
  try{let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen()
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1650,height:1100},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs++;return acceptDialogs?d.accept():d.dismiss()})
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),step=n=>page.locator(`[data-stage="${n}"]`).click()
 const inspector=page.locator('.visible3d-inspector').filter({visible:true}),comparison=page.getByRole('region',{name:'Visible 3D 照片与候选对照',exact:true})
 async function open(summary){const d=inspector.locator('details').filter({has:page.getByText(summary,{exact:true})}).last();if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click();return d}
 async function settled(){await page.waitForFunction(()=>{const c=document.querySelector('.visible3d-compare canvas'),o=document.querySelector('.visible3d-compare [aria-label="3D 相机状态"]');return c?.width>100&&o?.textContent&&o.textContent!=='null'});await page.evaluate(()=>new Promise(resolve=>{let n=0;const frame=()=>++n===12?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame)}))}
 const camera=async()=>JSON.parse(await page.locator('.visible3d-compare [aria-label="3D 相机状态"]').textContent())
 function sameCamera(actual,saved){for(const key of ['position','quaternion','up','target'])actual[key].forEach((v,i)=>assert.ok(Math.abs(v-saved[key][i])<1e-7,key));assert.ok(Math.abs(actual.zoom-saved.zoom)<1e-7);for(const key of ['top','bottom','near','far'])assert.ok(Math.abs(actual.frustum[key]-saved.frustum[key])<1e-7,key)}
 const select=async id=>{await field('3D Reconstruction Candidate').selectOption(id);await settled();assert.match(await comparison.innerText(),new RegExp(id));assert.match(await page.getByRole('region',{name:'Candidate Review 与 Assembly',exact:true}).innerText(),new RegExp(id))}
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=source`)
 await button('Visible 3D').click();await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${source.id}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(source.id)
 await field('3D Analysis 历史').selectOption(analysis.id);await field('3D Review 历史').selectOption(review.id);await step('reconstruction');await field('Spatial Planning History').selectOption(plan.id);await field('Geometry Execution History').selectOption(execution.id);await settled()
 assert.equal(await field('3D Reconstruction Candidate').locator('option').count(),5)
 for(const name of ['Spatial Planning（调用模型）','Geometry Execution（不调用模型）'])assert.equal(await inspector.getByRole('button',{name,exact:true}).count(),1)
 assert.equal(await comparison.getByRole('button',{name:'Geometry Execution（不调用模型）',exact:true}).count(),0)
 assert.ok((await comparison.locator('canvas').boundingBox()).y<450,'viewer starts near top, not below planning controls')
 for(const c of execution.candidates){await select(c.id);assert.equal(await field('已对照照片审核候选').isChecked(),false);const d=await open(`覆盖与未验证约束 · ${c.id}`);assert.match(await d.innerText(),new RegExp(c.coverage.reconstructed.join(', ')));const v=await open(`Geometry Validator Diagnostic · ${c.id}`);assert.deepEqual(JSON.parse(await v.locator('pre').textContent()),c.geometry)}
 await select('candidate-1')
 const piece=analysis.evidence.observations[1].id,other=analysis.evidence.observations[0].id,viewer=page.locator('.visible3d-compare .magnetic-3d-scene'),image=page.locator('.visible3d-compare .visible3d-image'),linked=id=>page.locator(`[data-linked-observation="${id}"]`).filter({visible:true})
 await image.getByRole('button',{name:`识别零件 ${piece}`,exact:true}).click();assert.equal(await viewer.getAttribute('data-viewer-selected-piece'),piece)
 await button('正对所选面').click();await settled();await linked(other).click()
 const canvas=viewer.locator('canvas'),box=await canvas.boundingBox();let hit=false
 for(const [x,y] of [[.5,.5],[.4,.55],[.55,.4],[.35,.4]]){await canvas.click({position:{x:box.width*x,y:box.height*y}});if(await viewer.getAttribute('data-viewer-selected-piece')===piece){hit=true;break}}
 assert.ok(hit,'WebGL raycast selects corresponding observation');assert.equal(await image.locator(`[data-observation="${piece}"]`).getAttribute('aria-pressed'),'true')
 await select('candidate-2');assert.equal(await linked(piece).getAttribute('aria-pressed'),'true');await button('以所选面为上方观察').click();await settled();await button('保存当前视角').click();const saved=await camera()
 await select('candidate-1');await select('candidate-2');sameCamera(await camera(),saved)
 await page.reload();await page.getByTestId('visible3d-execution-status').waitFor();await settled();assert.equal(await field('3D Reconstruction Candidate').inputValue(),'candidate-2');sameCamera(await camera(),saved)
 await field('Geometry Execution History').selectOption(execution.id);await settled();await select('candidate-2');sameCamera(await camera(),saved)
 await button('Fit to View').click();await button('Reset Camera').click();await settled()
 await open('Planning 空间理解与连接解释（模型推断）');await open('模型 Connection / Port / Dihedral / Flip 候选');await open('人工 Spatial Hypothesis / 修改后保存新版本');assert.ok(await field('3D Spatial Hypothesis JSON').count());await open('执行 Diagnostic · '+execution.diagnostics.length+' 条');await open('已审核空间检查')
 const provenance=await open('来源、Trace 与导出');assert.match(await provenance.locator('pre').textContent(),new RegExp(execution.id))
 const traceButton=provenance.getByRole('button',{name:/原始 Trace/}).first();await traceButton.click();const trace=await open('实际保存的模型 Trace');assert.ok((await trace.locator('pre').textContent()).length>100);await button('关闭 Trace').click()
 const download=page.waitForEvent('download');await button('导出完整来源记录').click();assert.ok((await download).suggestedFilename().endsWith('.json'))
 // Collapse evidence before checking the default comparison layout.
 await inspector.locator('details[open] > summary').evaluateAll(nodes=>nodes.forEach(n=>n.click()))
 for(const width of [1650,1100,820,680]){await page.setViewportSize({width,height:1000});if(width<761&&!await comparison.isVisible())await button('查看工作区').click();await canvas.scrollIntoViewIfNeeded();await settled();const b=await canvas.boundingBox();assert.ok(b.width>200&&b.height>=300);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'no page overflow');assert.equal(await comparison.evaluate(e=>e.scrollWidth>e.clientWidth+2),false,'no comparison overflow');if(width>=761)await inspector.evaluate(e=>e.closest('.studio-inspector').scrollTop=0);await page.screenshot({path:`${out}/layout-${width}.png`});if(width<761){await button('检查器').click();assert.equal(await field('3D Reconstruction Candidate').isVisible(),true)}}
 await page.setViewportSize({width:1650,height:1100});await select('candidate-2');assert.deepEqual((await api.dispatch('GET','visible3d/executions/'+execution.id)).record,execution)
 await field('3D 连接组合预算').fill('0');await button('Geometry Execution（不调用模型）').click();await page.getByTestId('visible3d-execution-status').filter({hasText:'budget_exhausted'}).waitFor();assert.ok(await inspector.getByRole('alert').filter({hasText:'搜索预算已耗尽'}).isVisible());assert.equal(await button('采用候选到 3D Assembly Editor').count(),0)
 await field('Geometry Execution History').selectOption(execution.id);await settled();await select('candidate-2');assert.equal(await button('采用候选到 3D Assembly Editor').isDisabled(),true)
 await field('已对照照片审核候选').check();acceptDialogs=false;await button('采用候选到 3D Assembly Editor').click();assert.equal(await page.locator('main').getAttribute('data-active-stage'),'reconstruction');assert.equal((await api.dispatch('GET','visible3d/history')).origins.length,0)
 acceptDialogs=true;await button('采用候选到 3D Assembly Editor').click();await button('Edit Draft').waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="3D Editor 相机状态"]')?.textContent!=='null');sameCamera(JSON.parse(await page.getByLabel('3D Editor 相机状态',{exact:true}).textContent()),saved)
 const origin=(await api.dispatch('GET','visible3d/history')).origins[0];assert.deepEqual(origin.assembly.pieces,execution.candidates[1].assembly.pieces);assert.deepEqual(origin.assembly.profiles,execution.candidates[1].assembly.profiles)
 await page.reload();await button('3D 查看').click();await page.locator('.visible3d-origin').waitFor();await step('reconstruction');await settled();await button('2D 图片').click();assert.equal(await comparison.isVisible(),false);await button('Visible 3D').click();await settled();assert.equal(await field('3D Reconstruction Candidate').inputValue(),'candidate-2')
 assert.equal(calls.some(r=>/visible3d\/(plan|analyze)$/.test(r)),false);assert.deepEqual(errors,[])
 const result={passed:true,savedRealPhoto:source.name,candidates:4,selection:'dropdown, ID linkage, WebGL raycast, inspector synchronisation',camera:'save, candidate/history switch, refresh and Assembly adoption',details:'planning, manual JSON, coverage, validator, execution, spatial, Trace and export',widths:[1650,1100,820,680],protection:'checkbox, cancel replacement, budget exhaustion',productionWrites:0,modelCalls:0,dialogs,errors}
 await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

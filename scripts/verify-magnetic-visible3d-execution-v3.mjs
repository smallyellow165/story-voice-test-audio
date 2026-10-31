// Replay immutable real records in a temporary API; no model calls or production writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {mkdtemp,mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
const overrideTest=process.argv.includes('--override')
const root=new URL('../',import.meta.url).pathname,stored=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'visible3d-execution-v3-')),out=overrideTest?'/tmp/magnetic-visible3d-override':'/tmp/magnetic-visible3d-execution-v3'
const read=async file=>JSON.parse(await readFile(file,'utf8')),reviewId='66ec23c3-b08c-41f9-aa90-a4f2ab9450f6',planId='edb975b9-c57c-4dd6-8ee1-03a379303c1a',oldId='37e8ebfc-3691-4300-9ba8-cae7b38bdc65'
let browser,server,page
try{
 await mkdir(out,{recursive:true})
 const review=await read(path.join(stored,'visible3d/reviews',reviewId+'.json')),plan=await read(path.join(stored,'visible3d/plans',planId+'.json')),source=await read(path.join(stored,'sources',review.sourceId+'.json'))
 const tracked=[['reviews',reviewId],['plans',planId],['executions',oldId]].map(([kind,id])=>path.join(stored,'visible3d',kind,id+'.json')),before=await Promise.all(tracked.map(f=>readFile(f,'utf8')))
 for(const kind of ['sources','assets'])await mkdir(path.join(dir,kind),{recursive:true})
 await cp(path.join(stored,'sources',source.id+'.json'),path.join(dir,'sources',source.id+'.json'))
 for(const id of new Set([source.originalHash,source.view.hash]))await cp(path.join(stored,'assets',id+'.json'),path.join(dir,'assets',id+'.json'))
 await cp(path.join(stored,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 for(const kind of ['analyses','reviews','plans','executions','heads','model-traces'])await cp(path.join(stored,'visible3d',kind),path.join(dir,'visible3d',kind),{recursive:true})
 const api=createMagneticIntake(dir),errors=[],calls=[]
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-v3-api',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];calls.push(route)
  if(req.method!=='GET'&&!['visible3d/execute','visible3d/adopt',...(overrideTest?['visible3d/open-diagnostic-draft']:[])].includes(route)){res.statusCode=403;res.end(JSON.stringify({error:'Models and non-test writes forbidden'}));return}
  try{let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen()
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1660,height:1100}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),inspector=page.locator('.visible3d-inspector').filter({visible:true}),comparison=page.getByRole('region',{name:'Visible 3D 照片与候选对照',exact:true})
 async function settled(){await page.waitForFunction(()=>{const c=document.querySelector('.visible3d-compare canvas'),o=document.querySelector('.visible3d-compare [aria-label="3D 相机状态"]');return c?.width>100&&o?.textContent&&o.textContent!=='null'});await page.evaluate(()=>new Promise(resolve=>{let n=0;const frame=()=>++n===12?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame)}))}
 async function details(label){const d=inspector.locator('details').filter({has:page.getByText(label,{exact:true})}).last();if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click();return d}
 const camera=async()=>JSON.parse(await comparison.getByLabel('3D 相机状态',{exact:true}).textContent())
 function sameCamera(a,b){for(const key of ['position','quaternion','up','target'])a[key].forEach((v,i)=>assert.ok(Math.abs(v-b[key][i])<1e-7,key));assert.ok(Math.abs(a.zoom-b.zoom)<1e-7)}
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=source`)
 await button('3D').click();await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${source.id}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(source.id)
 await field('3D Analysis 历史').selectOption(review.analysisId);await field('3D Review 历史').selectOption(reviewId);await page.locator('[data-stage="reconstruction"]').click();await field('Spatial Planning History').selectOption(planId)
 // Old V2 remains partial, correctly marked, and is not rewritten.
 await field('Geometry Execution History').selectOption(oldId);await settled();assert.match(await page.getByTestId('visible3d-execution-state').innerText(),/1\/6.*5/)
 await button('Geometry Execution（不调用模型）').click();await page.getByTestId('candidate-validation').filter({hasText:'diagnostic-1'}).waitFor();await settled()
 const executionId=await field('Geometry Execution History').inputValue(),x=(await api.dispatch('GET','visible3d/executions/'+executionId)).record
 await page.screenshot({path:out+'/diagnostic-default.png'});assert.notEqual(executionId,oldId);assert.equal(x.version,3);assert.equal(await field('3D Reconstruction Candidate').inputValue(),'diagnostic-1')
 assert.match(await page.getByTestId('candidate-validation').innerText(),/Ideal Geometry Valid · Solid Collision Invalid/);assert.match(await page.getByTestId('candidate-validation').innerText(),/6\/6/)
 assert.match(await page.getByTestId('visible3d-execution-state').innerText(),/3\/6.*3/);assert.equal(await page.getByTestId('visible3d-execution-state').getAttribute('data-tone'),'error')
 assert.equal(await button('采用当前结构进入 3D Assembly Editor').isDisabled(),true);assert.equal(await field('已对照照片审核候选').isDisabled(),true)
 await assert.rejects(api.dispatch('POST','visible3d/adopt',{executionId,candidateId:'diagnostic-1',visualChecked:true}),/Diagnostic/)
 const evidence=await details('碰撞空间证据与原连接约束 · diagnostic-1'),data=JSON.parse(await evidence.locator('pre').textContent());assert.equal(data.collisions.length,4);assert.equal(data.collisions[0].locality,'near-shared-vertex');assert.equal(data.construction.parentConnections.length,7)
 if(overrideTest){
  const force=()=>field('强制允许进入 Assembly Editor'),enter=()=>button('采用当前结构进入 3D Assembly Editor')
  assert.equal(await force().isChecked(),false);assert.equal(await enter().isDisabled(),true)
  await force().check();assert.equal(await enter().isEnabled(),true);assert.match(await page.getByTestId('candidate-validation').innerText(),/Solid Collision Invalid/)
  await field('3D Reconstruction Candidate').selectOption('diagnostic-2');await settled();assert.equal(await force().isChecked(),false)
  await force().check();await field('Geometry Execution History').selectOption(oldId);await settled();await field('Geometry Execution History').selectOption(executionId);await settled();assert.equal(await force().isChecked(),false)
  // A different saved Review/Plan clears the current authorization without changing any record.
  const history=await api.dispatch('GET','visible3d/history'),otherReview=history.reviews.find(r=>r.analysisId===review.analysisId&&r.id!==reviewId)
  const otherPlan=history.plans.find(p=>p.reviewId===reviewId&&p.id!==planId)??await api.dispatch('POST','visible3d/manual-plan',{reviewId,plan:plan.plan})
  await button('刷新 3D 历史').click();await field('Spatial Planning History').locator(`option[value="${otherPlan.id}"]`).waitFor({state:'attached'});await force().check();await field('Spatial Planning History').selectOption(otherPlan.id);await field('Spatial Planning History').selectOption(planId);await field('Geometry Execution History').selectOption(executionId);await settled();assert.equal(await force().isChecked(),false)
  await force().check();if(otherReview){await field('3D Review 历史').selectOption(otherReview.id);await field('3D Review 历史').selectOption(reviewId)}else{await field('3D Analysis 历史').selectOption(review.analysisId)}
  await field('Spatial Planning History').selectOption(planId);await field('Geometry Execution History').selectOption(executionId);await settled();assert.equal(await force().isChecked(),false)
  await force().check();await page.locator('[data-stage="source"]').click();await field('已有图片来源').focus();await field('已有图片来源').selectOption(source.id);await field('3D Analysis 历史').selectOption(review.analysisId);await field('3D Review 历史').selectOption(reviewId);await page.locator('[data-stage="reconstruction"]').click();await field('Spatial Planning History').selectOption(planId);await field('Geometry Execution History').selectOption(executionId);await settled();assert.equal(await force().isChecked(),false)
  await comparison.locator('[data-linked-observation="tile1"]').click();await button('以所选面为上方观察').click();await settled();await button('保存当前视角').click();const handoffCamera=await camera()
  await force().check();await enter().click();await button('Edit Draft').waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="3D Editor 相机状态"]')?.textContent!=='null')
  sameCamera(JSON.parse(await page.getByLabel('3D Editor 相机状态',{exact:true}).textContent()),handoffCamera)
  const summary=()=>page.locator('.magnetic-3d-summary').filter({visible:true}),repair=()=>page.getByTestId('repair-draft-status').filter({visible:true})
  async function exported(){const d=page.locator('.magnetic-3d-load').filter({visible:true});if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click();const dl=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await dl).path(),'utf8'))}
  const initial=await exported(),diagnostic=x.diagnosticCandidates[0];assert.equal(initial.pieces.length,6);assert.deepEqual(initial.pieces,diagnostic.assembly.pieces);assert.deepEqual(initial.profiles,diagnostic.assembly.profiles);assert.deepEqual(initial.connections,diagnostic.assembly.connections);assert.match(await summary().innerText(),/Geometry Invalid/);assert.equal(await repair().getAttribute('role'),'alert')
  const origin=(await api.dispatch('GET','visible3d/history')).origins[0];assert.equal(origin.entryMode,'diagnostic-override');assert.equal(origin.diagnostic.geometry.valid,false);assert.equal(origin.humanReview.status,'pending')
  await button('Revalidate Geometry').click();await page.getByRole('alert').filter({hasText:'严格复验失败'}).waitFor();assert.deepEqual(await exported(),initial)
  await button('保存 3D Draft').click();await page.reload();await button('Edit Draft').click();assert.deepEqual(await exported(),initial);assert.match(await repair().innerText(),/Geometry Invalid/)
  await page.locator('[data-3d-piece="tile2"]').click();const originalX=await field('3D 位置 X').inputValue();await field('3D 位置 X').fill(String(Number(originalX)+.2));await field('3D 位置 X').press('Enter');assert.ok((await exported()).revision>initial.revision);await button('Revalidate Geometry').click();await page.getByRole('alert').filter({hasText:'严格复验失败'}).waitFor();await button('3D Undo').click();assert.deepEqual((await exported()).pieces,initial.pieces)
  // Explicit editing only: remove the three front panels to obtain the known
  // legal cap substructure. There is no automatic offset or case-specific app rule.
  for(const id of ['tile2','tile3','tile4']){await page.locator(`[data-3d-piece="${id}"]`).click();await button('删除').click()}
  const repaired=await exported();assert.equal(repaired.pieces.length,3);assert.match(await summary().innerText(),/尚未复验/);assert.match(await repair().innerText(),/验证已过期|尚未复验/)
  await button('保存 3D Draft').click();await page.locator('[data-stage="build"]').click();await page.getByTestId('repair-build-blocker').waitFor();assert.equal(await button('生成搭建教程').isDisabled(),true)
  await page.locator('[data-stage="assembly"]').click();await button('Revalidate Geometry').click();await repair().filter({hasText:'已通过 Revalidate Geometry'}).waitFor();assert.equal(await repair().getAttribute('role'),'status');await button('保存 3D Draft').click();await page.reload();await button('Edit Draft').click();assert.deepEqual(await exported(),repaired);assert.match(await repair().innerText(),/已通过/)
  await page.locator('[data-stage="build"]').click();await button('生成搭建教程').click();await page.getByTestId('build-order-status').filter({hasText:'已生成'}).waitFor();assert.match(await page.getByTestId('tutorial-progress').innerText(),/1 \/ 3/)
  // Even a color-only revision cannot reuse the prior exact-snapshot receipt.
  await page.locator('[data-stage="assembly"]').click();await page.locator('[data-3d-piece="tile1"]').click();await field('当前 3D 零件颜色').fill('#123456');assert.match(await repair().innerText(),/验证已过期/);await page.locator('[data-stage="build"]').click();await page.getByTestId('repair-build-blocker').waitFor();assert.equal(await button('重新生成教程').isDisabled(),true);assert.equal(await button('保存教程').isDisabled(),true)
  await page.locator('[data-stage="assembly"]').click();await button('Revalidate Geometry').click();await repair().filter({hasText:'已通过'}).waitFor();await page.screenshot({path:out+'/repair-revalidated.png'})
  for(const width of [1660,1100,680]){await page.setViewportSize({width,height:1000});if(width<761)await button('检查器').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);assert.equal(await repair().isVisible(),true);await page.screenshot({path:`${out}/repair-${width}.png`})}await page.setViewportSize({width:1660,height:1100});
  await page.locator('[data-stage="reconstruction"]').click();await settled();assert.equal(await force().isChecked(),false);assert.equal(await enter().isDisabled(),true);await page.screenshot({path:out+'/override-reset.png'})
  assert.deepEqual(await Promise.all(tracked.map(f=>readFile(f,'utf8'))),before);assert.deepEqual(errors,[]);assert.equal(calls.some(r=>/visible3d\/(plan|analyze)$/.test(r)),false)
  const result={passed:true,source:source.name,authorization:'explicit, candidate/history/review/source/navigation reset, never persisted',handoff:'six exact poses, profiles, connections and saved camera; original Invalid diagnostics retained',editor:'invalid save/reload, move, strict revalidation failure, undo, explicit partial repair, stale receipt blocking, current revision/hash revalidation',build:'invalid and stale blocked, verified repaired cap generates three steps',ordinaryAdopt:'still rejects Diagnostic; covered separately by baseline browser/API tests',modelCalls:0,productionWrites:0,errors}
  await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
 }else{
 const viewer=comparison.locator('.magnetic-3d-scene');await comparison.locator('[data-linked-observation="tile1"]').click();assert.equal(await viewer.getAttribute('data-viewer-selected-piece'),'tile1');await button('正对所选面').click();await settled();await button('保存当前视角').click();const saved=await camera()
 const select=async id=>{await field('3D Reconstruction Candidate').selectOption(id);await settled();assert.match(await page.getByTestId('candidate-validation').innerText(),new RegExp(id))}
 for(const c of [...x.candidates,...x.diagnosticCandidates]){await select(c.id);assert.equal(await button(c.kind==='diagnostic'?'采用当前结构进入 3D Assembly Editor':'采用候选到 3D Assembly Editor').isDisabled(),true);assert.equal(await page.getByTestId('candidate-validation').getAttribute('data-candidate-kind'),c.kind)}
 await select('diagnostic-1');sameCamera(await camera(),saved);await page.reload();await settled();assert.equal(await field('3D Reconstruction Candidate').inputValue(),'diagnostic-1');sameCamera(await camera(),saved)
 await field('Geometry Execution History').selectOption(oldId);await settled();assert.equal(await field('3D Reconstruction Candidate').inputValue(),'candidate-1');assert.match(await page.getByTestId('candidate-validation').innerText(),/1\/6/)
 await field('Geometry Execution History').selectOption(executionId);await settled();assert.equal(await field('3D Reconstruction Candidate').inputValue(),'diagnostic-1');sameCamera(await camera(),saved)
 await button('Trace / Raw').click();const trace=page.getByRole('dialog',{name:'Magnetic Tiles Trace',exact:true});await trace.getByRole('button',{name:'Geometry Execution',exact:true}).click();await page.waitForFunction(id=>{try{return JSON.parse(document.querySelector('dialog[open] textarea[aria-label="Trace JSON"]').value).execution?.record?.id===id}catch{return false}},executionId)
 const traceData=JSON.parse(await trace.getByLabel('Trace JSON',{exact:true}).inputValue());assert.equal(traceData.candidateValidation.solidCollision.valid,false);assert.equal(traceData.candidateCollisions.length,4);await trace.getByRole('button',{name:'关闭 Trace',exact:true}).click()
 await inspector.locator('details[open] > summary').evaluateAll(nodes=>nodes.forEach(n=>n.click()))
 for(const width of [1660,1100,680]){await page.setViewportSize({width,height:1000});if(width<761&&!await comparison.isVisible())await button('查看工作区').click();await comparison.locator('canvas').scrollIntoViewIfNeeded();await settled();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:`${out}/diagnostic-${width}.png`});if(width<761)await button('检查器').click()}
 await page.setViewportSize({width:1660,height:1100});await select('candidate-1');assert.match(await page.getByTestId('candidate-validation').innerText(),/Ideal Geometry Valid · Solid Collision Valid/);assert.match(await page.getByTestId('candidate-validation').innerText(),/3\/6/);await field('已对照照片审核候选').check();await button('保存当前视角').click();const partialCamera=await camera();await button('采用候选到 3D Assembly Editor').click();await button('Edit Draft').waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="3D Editor 相机状态"]')?.textContent!=='null');sameCamera(JSON.parse(await page.getByLabel('3D Editor 相机状态',{exact:true}).textContent()),partialCamera)
 const origin=(await api.dispatch('GET','visible3d/history')).origins[0];assert.deepEqual(origin.assembly.pieces,x.candidates[0].assembly.pieces);assert.deepEqual(origin.assembly.profiles,x.candidates[0].assembly.profiles);assert.equal(origin.coverage.reconstructed.length,3)
 assert.deepEqual(await Promise.all(tracked.map(f=>readFile(f,'utf8'))),before);assert.deepEqual(errors,[]);assert.equal(calls.some(r=>/visible3d\/(plan|analyze)$/.test(r)),false)
 const result={passed:true,source:source.name,reviewId,planId,oldExecutionUntouched:oldId,diagnostic:6,ideal:true,solid:false,localCoverages:x.candidates.map(c=>c.coverage.reconstructed),search:x.search,browserChecks:['real WebGL rendering','all legal/diagnostic selections','blocked diagnostic adoption','partial completeness blocker','collision evidence','camera isolation, refresh, history restore, Assembly handoff','current Trace','explicit legal partial adoption','desktop/narrow layouts'],screenshots:out,modelCalls:0,productionWrites:0,errors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
 }
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

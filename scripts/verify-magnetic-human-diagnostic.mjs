import {canonicalTestRecords,canonicalSelectedTestHead} from './magnetic-canonical-test-records.mjs'
// Saved Front records in a disposable service. No model/execute HTTP endpoints
// and no formal history writes; the normal handoff's deterministic replay stays on.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {stage,studioMode,openSavedImageSources} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,cp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,official=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'magnetic-accepted-browser-')),out='/tmp/magnetic-human-diagnostic/browser',originals=new Map(),calls=[],errors=[]
async function copy(relative){const file=path.join(official,relative),bytes=await readFile(file);originals.set(file,bytes);await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),bytes);return JSON.parse(bytes)}
async function sourceCopy(id){const s=await copy('sources/'+id+'.json');for(const hash of new Set([s.originalHash,s.view.hash]))await copy('assets/'+hash+'.json');return s}
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 const records=await Promise.all((await readdir(path.join(official,'visible3d/executions'))).filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await readFile(path.join(official,'visible3d/executions',n),'utf8'))))
 const found=records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).find(x=>x.reconstructionScope?.groupName==='m_front'&&x.diagnosticCandidates?.some(d=>d.id==='diagnostic-1'&&d.assembly.pieces.length===9&&d.geometry.issues.length===4&&d.geometry.issues.every(i=>i.code==='intersection')))
 assert.ok(found,'Requires the saved Front 9/9 four-intersection Execution, never generates one')
 const execution=await copy('visible3d/executions/'+found.id+'.json'),plan=await copy('visible3d/plans/'+execution.planId+'.json'),review=await copy('visible3d/reviews/'+execution.reviewId+'.json'),analysis=await copy('visible3d/analyses/'+review.analysisId+'.json'),source=await sourceCopy(execution.sourceId)
 await canonicalTestRecords(dir,plan,execution)
 for(const i of source.images??[])await sourceCopy(i.sourceId)
 for(const id of new Set([analysis.traceId,plan.traceId].filter(Boolean)))await copy('visible3d/model-traces/'+id+'.json')
 await cp(path.join(official,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 const moduleHead=await copy('visible3d/module-heads/'+review.id+'.json')
 for(const id of new Set([moduleHead.recordId,plan.reconstructionScope.modulePlan.id].filter(Boolean)))await copy('visible3d/module-plans/'+id+'.json')
 await mkdir(path.join(dir,'visible3d/heads'),{recursive:true});await writeFile(path.join(dir,'visible3d/heads',source.id+'.json'),JSON.stringify(canonicalSelectedTestHead(plan,execution,analysis,review)))
 const api=createMagneticIntake(dir,{enableHumanReview:true})
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-accepted-diagnostic',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route});try{
   if(req.method!=='GET'&&!['visible3d/open-diagnostic-draft','visible3d/adopt'].includes(route)&&!route.startsWith('assembly3d-review/')&&!route.startsWith('assembly3d/'))throw Error('Models, Geometry Execution and unrelated writes are forbidden')
   let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{},{request:req})))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 } } ]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1780,height:1100},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));const dialogs=[];let dialogAccept=true;page.on('dialog',async d=>{dialogs.push(d.message());await (dialogAccept?d.accept():d.dismiss())});page.setDefaultTimeout(18000)
 const oldDraft=JSON.parse(await readFile(path.join(root,'src/magnetic-tiles/three-d/examples/right-angle.json'),'utf8'));
 await page.addInitScript(a=>{if(!sessionStorage.getItem('navigation-existing-draft')){localStorage.setItem('magnetic-tiles.assembly3d-draft.v1',JSON.stringify(a));sessionStorage.setItem('navigation-existing-draft','yes')}},oldDraft);
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html`,field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),approved=()=>page.getByTestId('human-collision-approved'),collisionRows=()=>page.getByRole('region',{name:'Collision Review',exact:true}).locator('tbody tr')
 async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out waiting for UI')}
 async function open(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function saveDraft(){const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/assembly3d/save')&&r.request().method()==='POST');await button('保存 3D Draft').click();assert.equal((await response).status(),200);await until(()=>button('保存 3D Draft').isEnabled())}
 async function exportedAssembly(){await open(page.locator('.magnetic-3d-load'));const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 async function exportedTutorial(){await open(page.locator('.magnetic-tutorial-advanced'));await open(page.locator('.magnetic-tutorial-io'));const event=page.waitForEvent('download');await button('导出 Tutorial3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 await page.goto(base+'?stage=source');await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor({state:'attached'});await studioMode(page,'3d');await openSavedImageSources(page);await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${source.id}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(source.id);await field('3D Analysis 历史').selectOption(analysis.id);await field('3D Review 历史').selectOption(review.id);await stage(page,'reconstruction','inspector');await field('重建 Group').locator(`option[value="${plan.reconstructionScope.groupId}"]`).waitFor({state:'attached'});await field('重建 Group').selectOption(plan.reconstructionScope.groupId);await field('Spatial Planning History').selectOption(plan.id);await field('Geometry Execution History').selectOption(execution.id);await field('3D Reconstruction Candidate').selectOption('diagnostic-1')
 const errorList=page.getByLabel('Diagnostic Validation Errors',{exact:true});assert.equal(await errorList.locator('tbody tr').count(),4)
 for(let i=0;i<4;i++){await errorList.locator('[data-diagnostic-error]').nth(i).click();await page.locator('.visible3d-compare [data-collision-overlay]').waitFor();assert.equal(await page.locator('.visible3d-compare [data-collision-overlay]').getAttribute('data-collision-kind'),'volume')}
 assert.equal(await page.getByRole('checkbox',{name:'强制允许进入 Assembly Editor',exact:true}).count(),0);assert.equal(await button('人工采用并进入 Assembly').isEnabled(),true)
 await page.screenshot({path:out+'/reconstruction.png'});
 const beforeDraft=await page.evaluate(()=>localStorage.getItem('magnetic-tiles.assembly3d-draft.v1')),beforeOrigins=calls.filter(c=>c.method==='POST'&&c.route==='visible3d/open-diagnostic-draft').length;
 dialogAccept=false;await button('人工采用并进入 Assembly').click();await until(()=>button('人工采用并进入 Assembly').isEnabled());assert.equal(await page.locator('.studio').getAttribute('data-active-stage'),'reconstruction');assert.equal(await page.evaluate(()=>localStorage.getItem('magnetic-tiles.assembly3d-draft.v1')),beforeDraft);assert.equal(calls.filter(c=>c.method==='POST'&&c.route==='visible3d/open-diagnostic-draft').length,beforeOrigins);
 dialogAccept=true;await page.route('**/api/magnetic-intake/assembly3d-review/accept-diagnostic',r=>r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'隔离测试：人工接受失败'})}));await button('人工采用并进入 Assembly').click();await page.getByRole('alert').filter({hasText:'隔离测试：人工接受失败'}).waitFor();assert.equal(await page.locator('.studio').getAttribute('data-active-stage'),'reconstruction');assert.equal(await page.evaluate(()=>localStorage.getItem('magnetic-tiles.assembly3d-draft.v1')),beforeDraft);await page.unroute('**/api/magnetic-intake/assembly3d-review/accept-diagnostic');
 await button('人工采用并进入 Assembly').click();await until(async()=>await page.locator('.studio').getAttribute('data-active-stage')==='assembly');assert.equal(await page.locator('[data-stage=assembly]').getAttribute('aria-current'),'step');assert.match(page.url(),/stage=assembly/);await approved().waitFor();assert.match(await approved().innerText(),/Geometry Invalid \+ Human Accepted Diagnostic/)
 const selected=execution.diagnosticCandidates.find(c=>c.id==='diagnostic-1'),assembly=await exportedAssembly();assert.equal(assembly.pieces.length,9);assert.deepEqual(assembly.pieces,selected.assembly.pieces);assert.deepEqual(assembly.connections,selected.assembly.connections);assert.deepEqual(assembly.profiles,selected.assembly.profiles)
 const firstPair=await collisionRows().first().locator('td button').innerText(),mark=()=>page.getByRole('checkbox',{name:'不可修复碰撞 '+firstPair,exact:true})
 const acceptedSnapshot=await exportedAssembly();await mark().check();assert.deepEqual(await exportedAssembly(),acceptedSnapshot);await approved().waitFor();assert.match(await page.getByTestId('collision-review-progress').innerText(),/4\/4/)
 await button('3D Undo').click();assert.equal(await mark().isChecked(),false);await approved().waitFor();await button('3D Redo').click();assert.equal(await mark().isChecked(),true);await approved().waitFor();await saveDraft();await page.reload();await approved().waitFor();assert.equal(await mark().isChecked(),true);assert.deepEqual(await exportedAssembly(),acceptedSnapshot);await button('Edit Draft').click()
 assert.equal(await collisionRows().count(),4);for(let i=0;i<4;i++){assert.equal(await collisionRows().nth(i).getByRole('checkbox',{name:/^接受碰撞 /}).isChecked(),true);await collisionRows().nth(i).locator('td').first().click();await button('聚焦碰撞').click();await page.locator('[data-collision-overlay]').waitFor()}
 assert.equal(await button('批准当前作品').isDisabled(),true);await saveDraft();await page.reload();await approved().waitFor();await button('Revalidate Geometry').click();await approved().waitFor();assert.deepEqual(await exportedAssembly(),assembly)
 await page.screenshot({path:out+'/assembly.png'})
 await page.locator('[data-stage="build"]').click();await until(()=>button('生成搭建教程').isEnabled());await button('生成搭建教程').click();await page.getByTestId('tutorial-player').waitFor();const tutorial=await exportedTutorial();assert.equal(tutorial.steps.length,9);assert.deepEqual(tutorial.assembly,assembly);assert.match(await page.getByTestId('tutorial-validation').innerText(),/Invalid \+ Human Accepted Diagnostic/)
 await button('下一步').click();assert.match(await page.getByTestId('tutorial-progress').innerText(),/2 \/ 9/);await button('重新开始').click();await button('保存教程').click();await until(async()=> (await page.getByTestId('tutorial-save-status').innerText()).includes('已保存'));await page.reload();await page.getByTestId('tutorial-player').waitFor();assert.deepEqual(await exportedTutorial(),tutorial)
 await page.screenshot({path:out+'/build.png'})
 await page.locator('[data-stage="assembly"]').click();await button('Edit Draft').click();await page.locator('[data-3d-piece="p22"]').click();const x=Number(await field('3D 位置 X').inputValue());await field('3D 位置 X').fill(String(x+.01));await field('3D 位置 X').press('Enter');await until(async()=>!await approved().count());await saveDraft();await page.locator('[data-stage="build"]').click();await until(()=>button('重新生成教程').isDisabled());assert.equal(await page.getByTestId('tutorial-player').count(),0)
 await page.locator('[data-stage="assembly"]').click();await button('3D Undo').click();await approved().waitFor();assert.deepEqual((await exportedAssembly()).pieces,assembly.pieces)
 assert.ok(dialogs.filter(m=>m.includes('替换当前保存的 3D Draft')).length>=3,'Cancel, failed acceptance and OK all exercise the existing-Draft confirmation');
 // This fixture authors an explicitly manual complete Plan: a partial legal
 // Candidate is correctly blocked by its hard constraints. Ordinary valid
 // Candidate adoption is covered by magnetic-visible3d.test.mjs.
 await button('保存 3D Draft').click();

 for(const width of [1100,680]){await page.setViewportSize({width,height:1050});await stage(page,'assembly','inspector');assert.equal(await page.locator('[data-stage=assembly]').getAttribute('aria-current'),'step');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false)}
 assert.equal(calls.filter(c=>c.method==='POST'&&c.route==='assembly3d-review/accept-diagnostic').length,1)
 assert.equal(calls.filter(c=>c.method==='POST'&&['assembly3d-review/approve','assembly3d-review/accept'].includes(c.route)).length,0)
 for(const [file,bytes]of originals)assert.ok(bytes.equals(await readFile(file)),file+' changed');assert.deepEqual(errors,[])
 await writeFile(out+'/result.json',JSON.stringify({passed:true,executionId:execution.id,front:9,intersections:4,adoptionClicks:1,repeatedApprovals:0,tutorialSteps:9,refresh:true,existingDraftReplacement:true,automaticAssemblyNavigation:true,cancelPreservesDraft:true,failedAcceptanceStaysInReconstruction:true,newErrorBlocked:true,undoRechecked:true,models:0,productionWrites:0,errors},null,2));console.log(await readFile(out+'/result.json','utf8'))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText()+'\n'+JSON.stringify(calls)); }throw e}finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

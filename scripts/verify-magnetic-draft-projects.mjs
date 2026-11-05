// Real UI + isolated disk-backed API, with deterministic offline Analysis.
// Persistent Chrome profile tests actual browser restart, not storage injection
// for new projects. Storage seeding is used only for explicit migration/corruption.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {visibleFixture} from '../test/magnetic-visible3d-fixtures.mjs'
import {upgradeVisibleFixture} from '../test/magnetic-visible3d-v2-fixtures.mjs'
import {stage} from './magnetic-studio-browser.mjs'
import {canonical} from '../src/magnetic-tiles/build-plan.ts'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-draft-browser-')),store=path.join(dir,'store'),lib=path.join(dir,'images'),profile=path.join(dir,'chrome'),out='/tmp/magnetic-draft-projects-browser'
const fixture=upgradeVisibleFixture(await visibleFixture()),errors=[],dialogs=[],calls=[],checks=[]
let api=createMagneticIntake(store,{libraryDirectory:lib}),workflow
function restartAPI(){
 api=createMagneticIntake(store,{libraryDirectory:lib})
 workflow=createVisible3DWorkflow(path.join(store,'visible3d'),{readSource:id=>api.dispatch('GET','sources/'+id),readImage:s=>api.dispatch('GET','image/'+s.id),readImages:s=>Promise.all((s.images??[{sourceId:s.id}]).map(async e=>({...e,...await api.dispatch('GET','image/'+e.sourceId)}))),getRegistry:()=>api.dispatch('GET','profiles'),runModel:async(prepared,options)=>{
  const value=structuredClone(fixture.evidence),id=randomUUID(),trace={id,status:'plan_ready_for_review',parseStatus:'parsed',validation:{valid:true},wireStatus:'response_saved',finishReason:'completed',sources:options.sources,requestInput:prepared.input,plan:value,rawOutput:JSON.stringify(value),usageMetadata:{fixture:true}}
  await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,id+'.json'),JSON.stringify(trace));return trace
 }})
}
restartAPI()
let server,context,page,base
const browserOptions={executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'],viewport:{width:1660,height:1080},timezoneId:'America/Los_Angeles',acceptDownloads:true}
async function launch(){context=await chromium.launchPersistentContext(profile,browserOptions);page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.type());return d.type()==='prompt'?d.accept('Whole group'):d.accept()})}
const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true})
const prefix=id=>'magnetic-studio.workspace.v1.create.'+id+'.',metadata=id=>'magnetic-studio.draft-project.v1.'+id
async function until(fn){for(let i=0;i<240;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI did not settle')}
async function draft(id){return page.evaluate(k=>JSON.parse(localStorage.getItem(k)),prefix(id)+'workflow-draft.v1')}
async function gallery(){await page.goto(base+'magnetic-gallery.html');await page.getByRole('region',{name:'继续制作 / Draft Projects'}).waitFor()}
const card=id=>page.locator(`[data-draft-project="${id}"]`)
async function resume(id,expectedStage){await card(id).getByRole('link',{name:/Continue Editing/}).click();await page.getByTestId('studio-workspace-context').waitFor();await until(()=>page.locator('.studio').getAttribute('data-active-stage').then(s=>s===expectedStage));await until(()=>button('导出 Review 工作草稿').count().then(n=>n===1))}
async function newProject(){await gallery();await page.getByRole('link',{name:'家长制作入口 / Create New',exact:true}).click();await button('导出 Review 工作草稿').waitFor();return new URL(page.url()).searchParams.get('workspaceId')}
async function analyze(){await stage(page,'source','inspector');await field('加入 sample.png').click();await until(()=>button('Analyze Visible 3D（调用模型）').isEnabled());await button('Analyze Visible 3D（调用模型）').click();await stage(page,'review');await until(()=>page.locator('.review-parts-table tbody tr').count().then(n=>n===fixture.evidence.observations.length))}
async function details(name){const d=page.locator('details').filter({has:page.locator(':scope>summary').getByText(name,{exact:true})}).filter({visible:true});if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
try{
 await mkdir(lib,{recursive:true});await mkdir(out,{recursive:true});await copyFile(path.join(root,'public/test-images/maganetic/car-1.png'),path.join(lib,'sample.png'))
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'draft-projects-offline',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
   const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route})
   try{
    if(/resume-analyze|\/plan$/.test(route))throw Error('Provider polling/planning forbidden')
    let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{}
    let result=route.startsWith('visible3d/')?await workflow.dispatch(req.method,route.slice(10),body):await api.dispatch(req.method,route,body)
    if(route.endsWith('/status'))result={...result,providers:{openai:true}}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))
   }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
  })
 }}]});await server.listen();base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/`;await launch()

 const a=await newProject(),aUrl=page.url();await gallery();await card(a).waitFor();await resume(a,'assembly');checks.push('new empty Create appears without Save Project / Assembly')
 await analyze();await stage(page,'source');const analysisOnly=await draft(a),analysisId=analysisOnly.head.analysisId;assert.ok(analysisId)
 await gallery();assert.match(await card(a).innerText(),/图片与识别/);await resume(a,'source');assert.equal((await draft(a)).head.analysisId,analysisId);checks.push('Analysis-only Continue Editing keeps exact identity')
 await stage(page,'review');await button('采用所有 AI 建议').click();const first=fixture.evidence.observations[0].id
 await page.locator(`[data-review-id="${first}"]`).click();await stage(page,'review','inspector');await field('3D Review 颜色').fill('#123456')
 await until(async()=>(await draft(a)).form.pieces[0].color==='#123456');const unsaved=await draft(a);assert.equal(unsaved.head.reviewId,null)
 await gallery();await resume(a,'review');await stage(page,'review','inspector');assert.equal(await field('3D Review 颜色').inputValue(),'#123456');assert.deepEqual((await draft(a)).form,unsaved.form);checks.push('unsaved Profile/confirmation/color Review survives leaving')
 await stage(page,'review');const savedResponse=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.status()===200);await button('保存 3D Review').click();const savedReview=await(await savedResponse).json()
 await until(async()=>(await draft(a)).head.reviewId===savedReview.record.id);await gallery();await resume(a,'review');assert.equal((await draft(a)).head.reviewHash,savedReview.record.hash);assert.equal((await draft(a)).source.hash,analysisOnly.source.hash);checks.push('saved Review exact ID/Hash/Source restores')

 await stage(page,'review');const moduleResponse=page.waitForResponse(r=>r.url().endsWith('/module-plans')&&r.status()===200);await button('创建模块').click();const group=(await(await moduleResponse).json()).record.modules[0].id;
 await stage(page,'reconstruction','inspector');await field('重建 Group').selectOption(group);await details('人工 Spatial Hypothesis / 修改后保存新版本');await field('3D Spatial Hypothesis JSON').fill(JSON.stringify(fixture.plan))
 const planResponse=page.waitForResponse(r=>r.url().endsWith('/manual-plan')&&r.status()===200);await button('保存人工 Spatial Hypothesis').click();const plan=await(await planResponse).json();await until(async()=>(await draft(a)).head.groups[group]?.plan.id===plan.id)
 const executionResponse=page.waitForResponse(r=>r.url().endsWith('/execute')&&r.status()===200);await button('Geometry Execution（不调用模型）').click();const execution=await(await executionResponse).json();assert.equal(execution.state,'complete');await until(async()=>(await draft(a)).head.groups[group]?.execution?.id===execution.record.id)
 await field('3D Spatial Hypothesis JSON').fill('unsaved manual hypothesis text');await until(async()=>(await draft(a)).manual==='unsaved manual hypothesis text')
 await gallery();await resume(a,'reconstruction');assert.equal((await draft(a)).head.groups[group].plan.hash,plan.hash);assert.equal((await draft(a)).head.groups[group].execution.hash,execution.record.hash);await stage(page,'reconstruction','inspector');await details('人工 Spatial Hypothesis / 修改后保存新版本');assert.equal(await field('3D Spatial Hypothesis JSON').inputValue(),'unsaved manual hypothesis text');checks.push('Reconstruction Plan/Execution/candidate and unsaved JSON restore')
 await button('采用候选到 3D Assembly Editor').click();await stage(page,'assembly');await until(()=>page.locator('[data-3d-piece]').count().then(n=>n===fixture.review.pieces.length))
 await page.locator('[data-3d-piece]').first().click();await stage(page,'assembly','inspector');await field('当前 3D 零件颜色').fill('#abcdef')
 await until(()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k))?.assembly.pieces[0].color==='#abcdef',prefix(a)+'working-draft'))
 const assemblyRaw=await page.evaluate(k=>localStorage.getItem(k),prefix(a)+'working-draft');await gallery();await resume(a,'assembly');assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).assembly.pieces[0].color,prefix(a)+'working-draft'),'#abcdef');checks.push('unsaved Assembly poses/profiles/origin and collision sidecar restore')
 await stage(page,'assembly','inspector');const assemblyResponse=page.waitForResponse(r=>r.url().endsWith('/assembly3d/save')&&r.status()===200);await button('保存 3D Draft').click();const savedAssembly=await(await assemblyResponse).json();assert.equal(savedAssembly.snapshot.assembly.pieces[0].color,'#abcdef')
 const duplicate=await context.newPage();await duplicate.goto(aUrl);await duplicate.getByRole('alert').filter({hasText:'此工作区已在其他页面打开'}).waitFor();assert.equal(await duplicate.locator('.studio').count(),0);await duplicate.close();checks.push('second tab cannot overwrite active workspace')

 const b=await newProject();assert.notEqual(b,a);await analyze();const bDraft=await draft(b);assert.notEqual(bDraft.head.analysisId,analysisId);assert.equal(bDraft.source.id,analysisOnly.source.id);assert.equal(bDraft.head.reviewId,null);await gallery();await card(a).waitFor();await card(b).waitFor();checks.push('two Projects with same photos keep independent histories/drafts')
 // Browser profile and API service are both reopened over the same backing data.
 await context.close();restartAPI();await launch();await gallery();await card(a).waitFor();await card(b).waitFor();await resume(a,'assembly');assert.equal((await draft(a)).head.reviewId,savedReview.record.id);assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).assembly.pieces[0].color,prefix(a)+'working-draft'),'#abcdef');checks.push('browser restart and API restart preserve discovery and working state')

 // Simulate an independent server writer, not another browser autosave.
 await stage(page,'review','inspector');await field('3D Review 颜色').fill('#654321');await until(async()=>(await draft(a)).form.pieces[0].color==='#654321');const beforeConflict=await draft(a)
 const serverReview=await workflow.dispatch('POST',`project/${a}/reviews`,{analysisId,review:savedReview.record.input.review,expectedRevision:beforeConflict.head.revision,expectedSelectedRevision:beforeConflict.head.selectedRevision,baseReview:{id:savedReview.record.id,hash:savedReview.record.hash}})
 await page.getByRole('alert').filter({hasText:'服务器 Selected / CAS 基线已变化'}).waitFor();assert.equal((await draft(a)).head.reviewId,savedReview.record.id)
 await stage(page,'review');const conflictResponse=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.status()===409);await button('保存 3D Review').click();await conflictResponse
 assert.equal((await draft(a)).form.pieces[0].color,'#654321');assert.equal((await workflow.dispatch('GET',`project/${a}/head/${analysisOnly.source.id}`)).reviewId,serverReview.record.id)
 await gallery();await resume(a,'review');assert.equal((await draft(a)).head.reviewId,savedReview.record.id);assert.equal((await draft(a)).form.pieces[0].color,'#654321');checks.push('external Selected change and Review 409 keep old CAS base and unsaved draft across restart')

 await gallery();const stored=await page.evaluate(k=>localStorage.getItem(k),prefix(a)+'workflow-draft.v1');await page.evaluate(k=>{const d=JSON.parse(localStorage.getItem(k));d.source.hash='0'.repeat(64);localStorage.setItem(k,JSON.stringify(d))},prefix(a)+'workflow-draft.v1');const corrupt=await page.evaluate(k=>localStorage.getItem(k),prefix(a)+'workflow-draft.v1')
 await card(a).getByRole('link',{name:/Continue Editing/}).click();await page.getByRole('alert').filter({hasText:'工作流程恢复失败'}).waitFor();assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix(a)+'workflow-draft.v1'),corrupt);await page.evaluate(({k,stored})=>localStorage.setItem(k,stored),{k:prefix(a)+'workflow-draft.v1',stored});checks.push('corrupt recovery is reported and original bytes remain; no latest fallback')
 await gallery()
 const originKey=prefix(a)+'magnetic-tiles.assembly3d-origin.v1',originalOrigin=await page.evaluate(k=>localStorage.getItem(k),originKey)
 await page.evaluate(k=>localStorage.setItem(k,'{broken'),originKey);await card(a).getByRole('link',{name:/Continue Editing/}).click();await page.getByRole('alert').filter({hasText:'本作品来源草稿损坏'}).waitFor();assert.equal(await page.evaluate(k=>localStorage.getItem(k),originKey),'{broken')
 await page.evaluate(({k,value})=>localStorage.setItem(k,value),{k:originKey,value:originalOrigin});await gallery();checks.push('corrupt Assembly origin fails visibly instead of restoring an unlinked document')
 const ref={id:savedAssembly.assembly.id,version:savedAssembly.version,hash:savedAssembly.hash},item=(await api.dispatch('POST','gallery/publish',{description:'Pinned draft publication',assemblyRef:ref})).item
 await gallery();await until(()=>card(a).count().then(n=>n===0));await card(b).waitFor();assert.ok(await page.evaluate(k=>localStorage.getItem(k),metadata(a)));checks.push('published Create hidden from Draft list without deleting local data')
 const publishedBefore=await api.dispatch('GET','gallery/items/'+item.id);await page.getByRole('link',{name:'Edit 作品：Pinned draft publication',exact:true}).click();await page.getByTestId('studio-workspace-context').filter({hasText:'Edit'}).waitFor();await until(()=>page.locator('[data-3d-piece]').count().then(n=>n===fixture.review.pieces.length));await page.locator('[data-3d-piece]').first().click();await stage(page,'assembly','inspector');await field('当前 3D 零件颜色').fill('#fedcba');await gallery();assert.deepEqual(await api.dispatch('GET','gallery/items/'+item.id),publishedBefore);checks.push('Edit stays bound to published version; Gallery read-only snapshot unchanged')

 // One-time migration: exact scoped binding and project head, plus a bad binding.
 const legacy=randomUUID(),bad=randomUUID(),legacyA=await workflow.dispatch('POST',`project/${legacy}/annotate`,{sourceId:analysisOnly.source.id,evidence:fixture.evidence});await workflow.dispatch('POST',`project/${legacy}/selected`,{sourceId:analysisOnly.source.id,stage:'analysis',id:legacyA.id,hash:legacyA.hash,expectedRevision:0})
 const legacyBytes=JSON.stringify({sourceId:analysisOnly.source.id,inputSourceId:analysisOnly.source.id})
 await page.evaluate(({legacy,bad,legacyBytes})=>{
  localStorage.setItem('magnetic-studio.workspace.v1.create.'+legacy+'.binding',JSON.stringify({id:legacy,mode:'create'}));localStorage.setItem('magnetic-studio.workspace.v1.create.'+legacy+'.magnetic-visible3d-context.v2',legacyBytes);localStorage.setItem('magnetic-studio.workspace.v1.create.'+legacy+'.magnetic-studio.right-panel.v1',JSON.stringify({lastStage:'review'}));localStorage.setItem('magnetic-studio.workspace.v1.create.'+bad+'.binding','{bad');localStorage.removeItem('magnetic-studio.draft-project-migration.v1')
 },{legacy,bad,legacyBytes})
 await gallery();await card(legacy).waitFor();assert.equal(await card(bad).count(),0);assert.equal(await page.evaluate(k=>localStorage.getItem(k),prefix(legacy)+'magnetic-visible3d-context.v2'),legacyBytes);await page.screenshot({path:out+'/gallery-drafts.png'});await resume(legacy,'review');assert.equal((await draft(legacy)).head.analysisId,legacyA.id);checks.push('safe legacy Workspace migrates once; corrupt binding is skipped and preserved')
 // Verify persistent conflict recovery did not rewrite the immutable snapshots.
 assert.deepEqual((await api.dispatch('GET',`assembly3d/records/${ref.id}/versions/${ref.version}`)).snapshot,savedAssembly.snapshot)
 assert.equal(dialogs.includes('beforeunload'),false,'successful autosaves should allow leaving normally')
 assert.ok(!calls.some(c=>c.route==='visible3d/history'||c.route==='visible3d/workspace-history'))
 assert.deepEqual(errors,[])
 await page.screenshot({path:out+'/restored-review.png'});const result={passed:true,checks,projects:[a,b],safeMigration:legacy,skippedMigration:bad,realProviderCalls:0,productionWrites:0,errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page&&!page.isClosed()){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>'')+'\n'+JSON.stringify(calls.slice(-20)))}throw e}
finally{await context?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

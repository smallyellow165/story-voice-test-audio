import {visibleFixture} from '../test/magnetic-visible3d-fixtures.mjs'
// Isolated real HTTP + Chrome/WebGL test. No model requests or personal data writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,rm,mkdir,readFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {selectedProject} from '../test/magnetic-selected-project-fixture.mjs'
import {selectFixture} from '../test/magnetic-selected-fixture.mjs'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {moduleStep} from '../src/magnetic-tiles/three-d/module-transform.ts'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-gallery-browser-'))
const out='/tmp/magnetic-workspace-browser',api=createMagneticIntake(dir),f=await selectedProject(api),calls=[],errors=[]
const ref=r=>({id:r.assembly.id,version:r.version,hash:r.hash})
const save=(snapshot,expectedHash=null)=>api.dispatch('POST','assembly3d/save',{snapshot,expectedHash})
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 async function saved(name){
  const p=f.plans[name][1],x=f.executions[name][1]
  await selectFixture(api,f.source.id,'plan',p);await selectFixture(api,f.source.id,'execution',x)
  const origin=await api.dispatch('POST','visible3d/adopt',{executionId:x.id,executionHash:x.hash,candidateId:'candidate-1'})
  return save({assembly:structuredClone(origin.assembly),photoOrigin:{origin,assemblyRaw:serializeAssembly3D(origin.assembly)},nonRepairable:[]})
 }
 const front=await saved('Front'),back=await saved('Back')
 const combined=await api.dispatch('POST','assembly3d/combine',{name:'Combined',parents:[ref(front),ref(back)]})
 const combinedSnapshot=structuredClone(combined.snapshot);combinedSnapshot.assembly=moduleStep(combinedSnapshot.assembly,'module-1','translate','x',10,'global')
 const combinedSaved=await save(combinedSnapshot,combined.hash)
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-gallery-api',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
   const route=req.url.slice(1).split('?')[0];calls.push([req.method,route])
   try{
    res.setHeader('Content-Type','application/json')
    const action=route.replace(/^visible3d\/project\/[a-f0-9-]+\//,'visible3d/');if(req.method!=='GET'&&!['gallery/publish','assembly3d/save','assembly3d/save-editor','assembly3d/combine','assembly3d/snapshot-check','visible3d/workspace-history','sources','source-sets','visible3d/annotate','visible3d/reviews','visible3d/manual-plan','visible3d/selected','visible3d/execute','visible3d/adopt'].includes(action))throw Error('No model calls or unrelated writes in Gallery test: '+route)
    let raw='';for await(const chunk of req)raw+=chunk
    res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{},{request:req})))
   }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
  })
 }}]})
 await server.listen()
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/`
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1500,height:1100},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())

 const publish=async(record,description)=>(await api.dispatch('POST','gallery/publish',{description,assemblyRef:ref(record)})).item
 const a=await publish(front,'A 小房子'),b=await publish(back,'B 花园'),c=await publish(combinedSaved,'C 组合')
 const editUrl=item=>base+'magnetic-tiles.html?'+new URLSearchParams({workspace:'edit',galleryId:item.id,assemblyId:item.assemblyRef.id,version:String(item.assemblyRef.version),hash:item.assemblyRef.hash,stage:'assembly'})
 const button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}),field=name=>page.getByLabel(name,{exact:true}).filter({visible:true})
 async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI state did not settle')}
 async function openDetails(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function exported(){await openDetails(page.locator('.magnetic-3d-load'));const next=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await next).path(),'utf8'))}
 async function ready(){await page.locator('canvas').waitFor();await page.getByTestId('studio-workspace-context').waitFor();await until(()=>button('保存 3D Draft').isEnabled())}
 async function editColor(color){await page.locator('[data-3d-piece]').first().click();await field('当前 3D 零件颜色').fill(color)}
 async function saveUI(){await button('保存 3D Draft').click();await page.getByRole('status').filter({hasText:'3D Draft 已保存'}).waitFor()}
 const before={};for(const folder of ['visible3d','assembly3d','gallery']){
  const visit=async dir=>{for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await visit(p);else before[p]=await readFile(p,'utf8')}};await visit(path.join(dir,folder))
 }
 await page.goto(base+'magnetic-gallery.html');await page.getByRole('link',{name:'Edit 作品：A 小房子',exact:true}).waitFor()
 // Poison the old working slot deliberately. Scoped controllers must never read it.
 await page.evaluate(({front})=>{
  localStorage.setItem('magnetic-tiles.assembly3d-draft.v1',JSON.stringify(front.snapshot.assembly))
  localStorage.setItem('magnetic-tiles.assembly3d-origin.v1',JSON.stringify(front.snapshot.photoOrigin))
  localStorage.setItem('magnetic-visible3d-context.v1',JSON.stringify({sourceId:front.project.id}))
  localStorage.setItem('magnetic-studio.mode.v1','2d')
 },{front})
 const legacy=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)))
 await page.getByRole('link',{name:'家长制作入口 / Create New',exact:true}).click();await ready()
 const createUrl=page.url();assert.ok(new URL(createUrl).searchParams.get('workspaceId'))
 assert.equal((await exported()).pieces.length,0);assert.equal(await page.locator('[data-3d-piece]').count(),0)
 assert.equal(await field('Analysis History').locator('option').count(),1)
 await page.locator('[data-stage="source"]').click();await page.getByRole('button',{name:'Analyze Visible 3D（调用模型）',exact:true}).waitFor()
 assert.equal(await field('Analysis History').locator('option').count(),1)
 assert.equal(await field('3D Review 历史').count(),0)
 assert.equal(await page.getByText('重新打开图片集合',{exact:true}).isVisible(),false)
 await page.locator('[data-stage="assembly"]').click()
 await openDetails(page.locator('.magnetic-3d-edit-tools'));await page.getByText('从 Tiles Catalog 添加',{exact:true}).click()
 await button('添加 3D 零件').click();assert.equal((await exported()).pieces.length,1)
 const createWorking=await exported();await page.reload();await ready();assert.deepEqual(await exported(),createWorking)
 await saveUI();const manual=await exported(),manualRecord=await api.dispatch('GET','assembly3d/records/'+manual.id)
 assert.equal(manualRecord.snapshot.photoOrigin.origin.kind,'editor-created');await page.getByRole('link',{name:/^Add to Gallery /}).waitFor()
 await page.goto(base+'magnetic-gallery.html');await page.getByRole('link',{name:'家长制作入口 / Create New',exact:true}).click();await ready()
 assert.notEqual(new URL(page.url()).searchParams.get('workspaceId'),new URL(createUrl).searchParams.get('workspaceId'));assert.equal((await exported()).pieces.length,0)
 await page.goto(createUrl);await ready();assert.deepEqual(await exported(),createWorking)
 await page.goto(base+'magnetic-gallery.html');await page.getByRole('link',{name:'Edit 作品：A 小房子',exact:true}).click();await ready()
 assert.deepEqual(await exported(),front.snapshot.assembly)
 const aUrl=page.url();await editColor('#123abc');const aDraft=await exported();assert.notDeepEqual(aDraft,front.snapshot.assembly)
 // Successful autosave permits normal navigation without a leave-page gate.
 await page.goto(editUrl(b));await ready();assert.deepEqual(await exported(),back.snapshot.assembly)
 await page.goto(aUrl);await ready();assert.deepEqual(await exported(),aDraft)

 await page.reload();await ready();assert.deepEqual(await exported(),aDraft)
 await page.getByTestId('workspace-recovery-status').filter({hasText:'已恢复未保存修改'}).waitFor()
 await page.goto(editUrl(b));await ready();assert.deepEqual(await exported(),back.snapshot.assembly)
 await editColor('#abc123');const bDraft=await exported();await page.goto(aUrl);await ready();assert.deepEqual(await exported(),aDraft)
 // A different server edit creates a later head after this workspace initialized.
 const changed=structuredClone(front.snapshot);changed.assembly.revision++;changed.assembly.pieces[0].color='#777777'
 const head=await save(changed,front.hash)
 await button('保存 3D Draft').click();await page.getByRole('alert').filter({hasText:'其他页面更新'}).waitFor()
 assert.deepEqual(await exported(),aDraft)
 await button(`保留当前草稿，在 v${head.version} 后追加保存`).click();await page.getByRole('status').filter({hasText:'3D Draft 已保存'}).waitFor()
 const resolved=await api.dispatch('GET','assembly3d/records/'+front.assembly.id);assert.equal(resolved.version,head.version+1);assert.deepEqual(resolved.snapshot.assembly,aDraft)
 assert.deepEqual((await api.dispatch('GET','gallery/items/'+a.id)).assembly,front.snapshot.assembly)
 // A new browser session has no workspace Draft: pinned v1 displayed, v2 only a CAS receipt.
 const fresh=await browser.newContext({viewport:{width:1500,height:1100},acceptDownloads:true});const oldPage=page
 page=await fresh.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.goto(editUrl(a));await ready();assert.deepEqual(await exported(),front.snapshot.assembly)
 await editColor('#aabbcc');const toSave=await exported();await saveUI()
 const result=await api.dispatch('GET','assembly3d/records/'+front.assembly.id)
 assert.equal(result.version,resolved.version+1);assert.deepEqual(result.snapshot.assembly,toSave)
 assert.deepEqual((await api.dispatch('GET','gallery/items/'+a.id)).assembly,front.snapshot.assembly)
 await page.locator('[data-stage="build"]').click();await until(()=>button('生成搭建教程').isEnabled());await button('生成搭建教程').click();await page.getByTestId('tutorial-player').waitFor()
 await until(()=>button('保存教程').isEnabled());await button('保存教程').click();await page.getByTestId('tutorial-save-status').filter({hasText:'已保存'}).waitFor()
 await page.locator('[data-stage="assembly"]').click()

 await page.reload();await ready();assert.deepEqual(await exported(),toSave)
 await page.goto(editUrl(c));await ready();assert.deepEqual(await exported(),combinedSaved.snapshot.assembly)
 await field('当前 Group').selectOption('module-1');await field('模块位移').fill('2');await button('移动 Group').click()
 const combinedEdited=await exported();await saveUI()
 const savedCombined=await api.dispatch('GET','assembly3d/records/'+combinedSaved.assembly.id)
 assert.deepEqual(savedCombined.snapshot.assembly,combinedEdited);assert.deepEqual(savedCombined.parent,combinedSaved.parent)
 assert.deepEqual(savedCombined.snapshot.assembly.modules.map(m=>m.parent),combinedSaved.snapshot.assembly.modules.map(m=>m.parent))
 await page.screenshot({path:path.join(out,'edit-combined.png'),fullPage:true})
 await fresh.close();page=oldPage
 await page.goto(editUrl(b));await ready();assert.deepEqual(await exported(),bDraft)
 await page.goto(createUrl);await ready();assert.deepEqual(await exported(),createWorking)
 // View must never alter any Studio workspace Draft or the legacy slot.
 const drafts=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('workspace.v1.')||!k.includes('studio-columns'))))
 await page.goto(base+'magnetic-gallery.html?id='+a.id);await page.locator('canvas').waitFor()
 assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('workspace.v1.')||!k.includes('studio-columns')))),drafts)
 // Exercise the normal Source → Analysis → Review → Plan → Execution path
 // with offline annotation. New records must be owned without importing history.
 await page.goto(base+'magnetic-gallery.html');await page.getByRole('link',{name:'家长制作入口 / Create New',exact:true}).click();await ready()
 await page.locator('[data-stage="source"]').click();const image=await page.screenshot({type:'png',clip:{x:0,y:0,width:64,height:64}});await page.getByRole('tab',{name:'上传图片',exact:true}).click();await page.getByLabel('上传磁力片图片文件',{exact:true}).setInputFiles({name:'workspace-proof.png',mimeType:'image/png',buffer:image})
 await page.getByText('人工标注 / 离线验证（不调用模型）',{exact:true}).click();const annotate=button('保存人工标注并 Review');await until(()=>annotate.isEnabled());const fixture=await visibleFixture();await field('Visible 3D 人工标注 JSON').fill(JSON.stringify(fixture.evidence));await annotate.click()
 await button('采用所有 AI 建议').waitFor();await until(()=>button('采用所有 AI 建议').isEnabled());await button('采用所有 AI 建议').click();await button('保存 3D Review').click()
 await until(()=>button('进入 3D Reconstruction').isEnabled());await button('进入 3D Reconstruction').click()
 await page.getByText('人工 Spatial Hypothesis / 修改后保存新版本',{exact:true}).click();await field('3D Spatial Hypothesis JSON').fill(JSON.stringify(fixture.plan));await button('保存人工 Spatial Hypothesis').click()
 await until(()=>button('Geometry Execution（不调用模型）').isEnabled());await button('Geometry Execution（不调用模型）').click()
 await until(()=>button('采用候选到 3D Assembly Editor').isEnabled());await button('采用候选到 3D Assembly Editor').click();await ready();assert.equal((await exported()).pieces.length,2)
 await saveUI();const fromSource=await exported();assert.equal(fromSource.pieces.length,2)
 await page.reload();await ready();assert.deepEqual(await exported(),fromSource)
 await page.locator('[data-stage="source"]').click();await field('Analysis History').waitFor();assert.equal(await field('Analysis History').locator('option').count(),2)
 assert.equal(await field('3D Review 历史').locator('option').count(),2)
 // Retain exact saved receipts produced in this Create. Combining these own
 // documents reuses the existing UI without loading a Project-wide library.
 const ownParent1=await api.dispatch('GET','assembly3d/records/'+fromSource.id)
 await page.locator('[data-stage="reconstruction"]').click();await until(()=>button('采用候选到 3D Assembly Editor').isEnabled());await button('采用候选到 3D Assembly Editor').click();await ready();await saveUI()
 const second=await exported();assert.notEqual(second.id,fromSource.id);const ownParent2=await api.dispatch('GET','assembly3d/records/'+second.id)
 await until(()=>button('新建 Combined Assembly').isEnabled());await button('新建 Combined Assembly').click()
 await field('组合固定作品').selectOption(fromSource.id);await field('组合移动作品').selectOption(second.id);await field('组合名称').fill('本工作区组合')
 await button('创建 Combined Assembly').click();await page.getByRole('link',{name:/^Add to Gallery 本工作区组合/}).waitFor();await saveUI()
 const ownCombined=await exported();assert.equal(ownCombined.modules.length,2)
 assert.deepEqual(ownCombined.modules.map(m=>m.parent.id).sort(),[fromSource.id,second.id].sort())
 assert.equal((await api.dispatch('GET','assembly3d/records/'+fromSource.id)).hash,ownParent1.hash)
 assert.equal((await api.dispatch('GET','assembly3d/records/'+second.id)).hash,ownParent2.hash)
 await page.reload();await ready();assert.deepEqual(await exported(),ownCombined)

 for(const [k,v] of Object.entries(legacy))assert.equal(await page.evaluate(k=>localStorage.getItem(k),k),v,k)
 for(const [p,raw] of Object.entries(before))assert.equal(await readFile(p,'utf8'),raw,p)
 assert.ok(!calls.some(([,r])=>r==='visible3d/history'||r==='visible3d/requests'||r.startsWith('assembly3d/projects/')))
 assert.deepEqual(errors,[])
 console.log('PASS: blank Create; scoped empty histories; Editor-created save; fixed A/B/Combined Edit; unsaved refresh recovery; isolated Drafts; stale CAS rejection and explicit append recovery; own-only Combined creation; pinned Gallery after new save; groups/parents preserved; View and all original files unchanged; no model calls. '+out)
}catch(e){if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(0,10000))}console.error({errors,calls:calls.slice(-25)});throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

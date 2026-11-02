// Saved real eight-piece car and exact lineage, copied into disposable storage.
// No Planning/Execution/model calls and no changes to the user's records/Draft.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {stage,studioMode,rightTab} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,official=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'manual-symmetry-car-')),out='/tmp/magnetic-manual-symmetry'
const originPath=path.join(official,'visible3d/origins/603183ad-6109-4765-82d8-580b11e04fe8.json'),originRaw=await readFile(originPath,'utf8'),origin=JSON.parse(originRaw),group=origin.reconstructionScope.groupId
let original=origin.assembly
const copied=new Map(),calls=[],errors=[]
async function copy(relative){if(copied.has(relative))return JSON.parse(copied.get(relative));const raw=await readFile(path.join(official,relative),'utf8');copied.set(relative,raw);await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),raw);return JSON.parse(raw)}
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 for(const [kind,id] of [['analyses',origin.analysisId],['reviews',origin.reviewId],['plans',origin.planId],['executions',origin.executionId]]){const r=await copy(`visible3d/${kind}/${id}.json`);if(r.traceId)await copy(`visible3d/model-traces/${r.traceId}.json`)}
 await copy(`visible3d/heads/${origin.sourceId}.json`)
 const source=await copy(`sources/${origin.sourceId}.json`)
 for(const id of new Set([source.id,...source.images.map(i=>i.sourceId)])){const s=await copy(`sources/${id}.json`);for(const hash of new Set([s.originalHash,s.view.hash]))await copy(`assets/${hash}.json`)}
 let module=await copy(`visible3d/module-plans/${origin.reconstructionScope.modulePlan.id}.json`)
 while(module.parent)module=await copy(`visible3d/module-plans/${module.parent.id}.json`)
 await copy(`visible3d/module-heads/${origin.reviewId}.json`)
 for(const file of await readdir(path.join(official,'profile-registry')))if(file.endsWith('.json'))await copy('profile-registry/'+file)
 const api=createMagneticIntake(dir,{enableHumanReview:true})
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'manual-mirror-isolated',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push([req.method,route]);try{
   if(req.method!=='GET'&&!['visible3d/selected','visible3d/open-diagnostic-draft','visible3d/build-check'].includes(route)&&!route.startsWith('assembly3d-review/')&&!route.startsWith('assembly3d/'))throw Error('Model/Planning/Execution/unrelated writes forbidden')
   let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{},{request:req})))
  }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1740,height:1100},acceptDownloads:true});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.addInitScript(id=>{if(sessionStorage.getItem('manual-symmetry-seed'))return;localStorage.setItem('magnetic-visible3d-context.v1',JSON.stringify({sourceId:id}));sessionStorage.setItem('manual-symmetry-seed','yes')},origin.sourceId)
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),panel=()=>page.getByRole('region',{name:'Symmetry Fill',exact:true}),ghost=()=>page.locator('[data-symmetry-preview-ids]')
 async function until(fn){for(let i=0;i<240;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('UI state did not settle')}
 async function exported(){const d=page.locator('.magnetic-3d-load');if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click();const download=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await download).path(),'utf8'))}
 async function manual(offset='.5'){await field('对称平面方式').selectOption('reference');await field('对称参考 Tile').selectOption('ramp-lower-left');await field('对称平面局部法向').selectOption('x');await field('对称平面偏移').fill(offset)}
 async function openBlue(){await page.locator('[data-3d-piece="rear-side-left"]').click();await button('对称补全').click();await panel().waitFor();assert.match(await page.getByTestId('symmetry-source-count').innerText(),/来源 1 片：rear-side-left/)}
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=reconstruction`
 await page.goto(url);await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor({state:'attached'});await studioMode(page,'3d');await stage(page,'reconstruction','workspace')
 await field('重建 Group').locator(`option[value="${group}"]`).waitFor({state:'attached'});await field('重建 Group').selectOption(group)
 await until(async()=>await field('Geometry Execution History').inputValue()===origin.executionId)
 await stage(page,'reconstruction','inspector');await field('3D Reconstruction Candidate').selectOption('diagnostic-1');await button('人工采用并进入 Assembly').click()
 await until(async()=>await page.locator('.studio').getAttribute('data-active-stage')==='assembly');await page.getByTestId('human-collision-approved').waitFor()
 const adopted=await exported();assert.deepEqual({...adopted,id:original.id},original);original=adopted;await until(async()=>await button('保存 3D Draft').isEnabled())
 // Mode changes and re-entry are presentation only: no ID, revision, history,
 // saved Draft or existing collision-acceptance changes.
 const mode=()=>button('Edit Draft').getAttribute('aria-pressed'),raw=await page.evaluate(()=>localStorage.getItem('magnetic-tiles.assembly3d-draft.v1'))
 assert.equal(await mode(),'true');assert.equal(await button('3D Undo').isDisabled(),true)
 await button('View').click();assert.equal(await button('View').getAttribute('aria-pressed'),'true');assert.deepEqual(await exported(),original)
 await button('Edit Draft').click();assert.equal(await mode(),'true');assert.deepEqual(await exported(),original)
 await button('View').click();await button('重新加载来源').click();assert.equal(await mode(),'true');assert.deepEqual(await exported(),original)
 await button('View').click();await stage(page,'source','workspace');await stage(page,'assembly','workspace');assert.equal(await mode(),'true');assert.deepEqual(await exported(),original)
 await button('View').click();await page.reload();await stage(page,'assembly','inspector');assert.equal(await mode(),'true');assert.deepEqual(await exported(),original)
 const tools=page.locator('.magnetic-3d-edit-tools');await tools.locator(':scope > summary').click();await button('View').click();await button('重新加载已保存 Draft').click();await until(async()=>await mode()==='true'&&await button('保存 3D Draft').isEnabled());assert.equal(await mode(),'true');assert.deepEqual(await exported(),original)
 assert.equal(await page.evaluate(()=>localStorage.getItem('magnetic-tiles.assembly3d-draft.v1')),raw);assert.equal(await button('3D Undo').isDisabled(),true);assert.doesNotMatch(await page.locator('.magnetic-3d-summary').innerText(),/未保存/)
 await until(async()=> (await page.getByTestId('collision-review-progress').innerText()).includes('1/1'))
 // Start with the Inspector scrolled deep and the Catalog selected. Opening the
 // tool must reveal Inspector and bring the actual plane controls into view.
 await page.locator('[data-3d-piece="rear-side-left"]').click();await rightTab(page,'catalog');await button('对称补全').click();await panel().waitFor()
 await until(async()=>{const b=await panel().boundingBox();return b&&b.y>=0&&b.y<260})
 assert.equal(await page.getByRole('tab',{name:'Inspector',exact:true}).getAttribute('aria-selected'),'true')
 assert.equal(await panel().getByRole('checkbox').count(),0,'no replacement confirmation checkbox')
 assert.equal(await button('预览补全').isDisabled(),true,'automatic scaffold mismatch remains a blocker')
 await button('左').click()
 const label=page.locator('.magnetic-3d-editor-canvas [data-tile-label="rear-side-left"]');await label.waitFor();const hit=await label.boundingBox()
 await page.mouse.click(hit.x+hit.width/2,hit.y+hit.height/2);await until(async()=> (await page.getByTestId('symmetry-source-count').innerText())==='来源 0 片')
 await page.mouse.click(hit.x+hit.width/2,hit.y+hit.height/2);await until(async()=> (await page.getByTestId('symmetry-source-count').innerText()).includes('来源 1 片：rear-side-left'));assert.deepEqual(await exported(),original)
 await manual('0');await button('预览补全').click();await ghost().waitFor();assert.deepEqual(await exported(),original)
 await button('取消预览').click();assert.equal(await ghost().count(),0);assert.deepEqual(await exported(),original)
 await manual();await button('预览补全').click();await ghost().waitFor();assert.match(await page.getByTestId('symmetry-preview-summary').innerText(),/新增 1 片 · 0 条连接 · 总计 9 片/)
 assert.match(await panel().innerText(),/Solid Collision Invalid/);assert.equal(await button('确认加入').isEnabled(),true)
 const ids=JSON.parse(await ghost().getAttribute('data-symmetry-preview-ids'))
 await button('Fit to View').click()
 for(const side of ['前','后','左']){await button(side).click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:`${out}/blue-${side}.png`})}
 const canvas=await page.locator('.magnetic-3d-editor-canvas canvas').boundingBox();await page.mouse.move(canvas.x+canvas.width*.9,canvas.y+canvas.height*.3);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.9-60,canvas.y+canvas.height*.3+30,{steps:10});await page.mouse.up();assert.deepEqual(await exported(),original)
 await button('Reset Camera').click();await button('确认加入').click();let nine=await exported()
 assert.equal(nine.pieces.length,9);assert.deepEqual(nine.pieces.slice(0,8),original.pieces);assert.deepEqual(nine.connections,original.connections);assert.deepEqual(nine.profiles,original.profiles)
 assert.equal(nine.pieces[8].id,ids[0]);assert.ok(Math.abs(nine.pieces[8].pose.position[0]-1.5)<1e-12)
 await until(async()=> (await page.getByTestId('collision-review-progress').innerText()).includes('1/3'))
 await until(()=>button('3D Undo').isEnabled());await button('3D Undo').click();assert.deepEqual(await exported(),original)
 await until(()=>button('3D Redo').isEnabled());await button('3D Redo').click();assert.deepEqual(await exported(),nine)
 await until(()=>button('保存 3D Draft').isEnabled());await button('保存 3D Draft').click();await page.locator('.magnetic-3d-save-notice').filter({hasText:'3D Draft 已保存'}).waitFor();await page.reload();await stage(page,'assembly','inspector');assert.deepEqual(await exported(),nine)
 await until(async()=> (await page.getByTestId('collision-review-progress').innerText()).includes('1/3'))
 await button('Revalidate Geometry').click();await page.locator('.magnetic-3d-save-notice').filter({hasText:'Revalidate Geometry'}).waitFor();assert.match(await page.locator('.magnetic-3d-save-notice').innerText(),/Geometry Invalid/)
 await page.getByRole('region',{name:'Collision Review',exact:true}).locator('tbody tr').nth(2).getByRole('button').click();await page.locator('[data-collision-overlay]').waitFor({state:'attached'});await button('聚焦碰撞').click();await button('取消碰撞选择').click();assert.deepEqual(await exported(),nine)
 // Existing opposite roof panels cannot be duplicated by the left/right plane.
 await button('Edit Draft').click();await button('对称补全').click();await field('对称来源 rear-top-left').check();await field('对称来源 rear-top-right').check();await manual();assert.equal(await button('预览补全').isDisabled(),true);await panel().getByRole('alert').filter({hasText:'重复补全'}).waitFor();assert.equal(await ghost().count(),0)
 // A different explicit plane can still preview the selected roof patch and
 // its one internal joint; this is a hypothesis, not a claim about hidden photos.
 await field('对称平面偏移').fill('3');await button('预览补全').click();await ghost().waitFor();assert.match(await page.getByTestId('symmetry-preview-summary').innerText(),/新增 2 片 · 1 条连接 · 总计 11 片/)
 assert.deepEqual(await exported(),nine);await button('取消预览').click();assert.deepEqual(await exported(),nine)
 await field('对称平面方式').selectOption('auto');assert.equal(await button('预览补全').isDisabled(),true);await panel().getByRole('alert').filter({hasText:/框架|同一平面/}).waitFor();await button('关闭工具').click()
 await openBlue();await field('对称平面方式').selectOption('reference');await field('对称平面偏移').fill('');assert.equal(await button('预览补全').isDisabled(),true);await panel().getByRole('alert').filter({hasText:'偏移'}).waitFor()
 for(const width of [1740,1100,680]){await page.setViewportSize({width,height:1000});await stage(page,'assembly','inspector');await panel().scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);assert.equal(await panel().evaluate(e=>e.scrollWidth>e.clientWidth+2),false);await page.screenshot({path:`${out}/panel-${width}.png`})}
 assert.deepEqual(errors,[]);assert.equal(calls.some(([m,r])=>m==='POST'&&['visible3d/plan','visible3d/analyze','visible3d/execute'].includes(r)),false)
 assert.equal(await readFile(originPath,'utf8'),originRaw);for(const [file,raw]of copied)assert.equal(await readFile(path.join(official,file),'utf8'),raw)
 const result={passed:true,original:'8 pieces / 10 joints / one Human Accepted intersection',manual:'blue 9 pieces / original 10 joints exact; x=1.5 across center x=.5; no external joints inferred',collisions:'original accepted collision retained; two new intersections unaccepted (.015 ramp / .03 roof), 1/3 after apply and refresh',purple:'duplicate left/right mirrors rejected; alternate explicit plane previews two roofs and one internal joint; cancel unchanged',checks:['adopt saved Diagnostic with exact Selected lineage','tool reveals Inspector from Catalog and scrolls into view','Viewer clicks toggle sources without geometry edits','manual offset 0 preview despite asymmetric scaffold','correct center .5','Fit/Reset/front/back/side/orbit','cancel','apply/Undo/Redo/save/reload','strict Revalidate and collision overlay/focus','automatic scaffold checks retained','invalid offset blocker','1740/1100/680 layout'],modelCalls:0,executionCalls:0,formalWrites:0}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText()+'\n'+JSON.stringify(calls))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

import {openSavedImageSources} from './magnetic-studio-browser.mjs'
// One real saved 2D case + saved purple 3D records, copied to an isolated API.
// No model calls, no production mutations, no runtime application state injection.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,readdir,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)),stored=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'magnetic-global-mode-')),out='/tmp/magnetic-studio-mode'
const read=async(kind,id)=>JSON.parse(await readFile(path.join(stored,kind,id+'.json'),'utf8'))
const records=async kind=>Promise.all((await readdir(path.join(stored,kind))).filter(f=>f.endsWith('.json')).map(f=>read(kind,f.slice(0,-5))))
let browser,server,page
try{
 await mkdir(out,{recursive:true})
 const twoD=(await records('reconstructions')).filter(r=>r.candidates[0]?.assembly.instances.length===1).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];assert.ok(twoD)
 const r2=await read('reviews',twoD.reviewId),a2=await read('analyses',r2.analysisId),s2=await read('sources',twoD.sourceId)
 const s3=(await records('sources')).find(s=>s.name==='qisimiaoxiang_square.png');assert.ok(s3)
 for(const kind of ['sources','assets','analyses','reviews','reconstructions'])await mkdir(path.join(dir,kind),{recursive:true})
 for(const s of [s2,s3]){await cp(path.join(stored,'sources',s.id+'.json'),path.join(dir,'sources',s.id+'.json'));for(const id of new Set([s.originalHash,s.view.hash]))await cp(path.join(stored,'assets',id+'.json'),path.join(dir,'assets',id+'.json'))}
 for(const [kind,id] of [['analyses',a2.id],['reviews',r2.id],['reconstructions',twoD.id]])await cp(path.join(stored,kind,id+'.json'),path.join(dir,kind,id+'.json'))
 await cp(path.join(stored,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 for(const kind of ['analyses','reviews','plans','executions','heads','model-traces'])await cp(path.join(stored,'visible3d',kind),path.join(dir,'visible3d',kind),{recursive:true})
 const api=createMagneticIntake(dir),h3=await api.dispatch('GET','visible3d/history'),x3=h3.executions.find(x=>x.sourceId===s3.id&&x.candidates.length===4)
 const p3=h3.plans.find(p=>p.id===x3.planId),r3=h3.reviews.find(r=>r.id===p3.reviewId),a3=h3.analyses.find(a=>a.id===r3.analysisId)
 const calls=[],errors=[],consoleErrors=[];let dialogs=0,workers=0
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-mode-api',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route})
  if(req.method!=='GET'&&!['origins','visible3d/adopt'].includes(route)){res.statusCode=403;res.end(JSON.stringify({error:'Model and generation calls forbidden in mode test'}));return}
  try{let body='';for await(const c of req)body+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,body?JSON.parse(body):{})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen()
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html`
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1650,height:1100},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('worker',()=>workers++);page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});page.on('dialog',d=>{dialogs++;return d.accept()})
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true})
 const mode=()=>page.locator('main').getAttribute('data-studio-mode'),active=()=>page.locator('main').getAttribute('data-active-stage')
 const data=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('magnetic-tiles.'))))
 async function camera(){await page.waitForFunction(()=>{const o=document.querySelector('.visible3d-compare [aria-label="3D 相机状态"]');return o?.textContent&&o.textContent!=='null'});return JSON.parse(await page.locator('.visible3d-compare [aria-label="3D 相机状态"]').textContent())}
 function cameraNear(a,b){for(const k of ['position','quaternion','target','up'])a[k].forEach((v,i)=>assert.ok(Math.abs(v-b[k][i])<1e-7,k));assert.ok(Math.abs(a.zoom-b.zoom)<1e-7)}
 async function exportTutorial(){const d=page.locator('.magnetic-tutorial-advanced');if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click();const io=page.locator('.magnetic-tutorial-io');if(!await io.evaluate(e=>e.open))await io.locator(':scope > summary').click();const dl=page.waitForEvent('download');await button('导出 Tutorial3D').click();return JSON.parse(await readFile(await(await dl).path(),'utf8'))}
 async function modeStage(expected,s){await stage(page,s);assert.equal(await mode(),expected);assert.equal(await active(),s);assert.equal(await page.getByRole('group',{name:'Studio 工作模式',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:expected==='3d'?'3D':'2D',exact:true}).getAttribute('aria-pressed'),'true')}
 await page.goto(base+`?stage=reconstruction&sourceId=${s2.id}&analysisId=${a2.id}&reviewId=${r2.id}&reconstructionId=${twoD.id}&candidateId=${twoD.candidates[0].id}`)
 await field('几何重建候选').waitFor();assert.equal(await mode(),'2d');assert.equal(await field('几何重建候选').inputValue(),twoD.candidates[0].id)
 for(const name of ['图片重建维度','作品查看模式','教程维度'])assert.equal(await page.getByRole('group',{name,exact:true}).count(),0)
 for(const name of ['2D 图片','Visible 3D','2D 查看','3D 查看','2D 教程','3D 教程'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),0)
 await field('已对照原图').check();await button('在作品编辑器中打开').click();await modeStage('2d','assembly');await button('保存作品快照').click()
 await modeStage('2d','build');await button('生成搭建步骤').click();await button('保存教程').click();await button('完成搭建').click();await page.locator('.build-step-heading').filter({hasText:'已完成'}).waitFor()
 const saved2=await data(),twoDPlayback=await page.getByTestId('build-playback-source').textContent()
 await studioMode(page,'3d');assert.equal(await mode(),'3d');await page.getByTestId('tutorial-source').waitFor()
 assert.deepEqual(Object.fromEntries(Object.entries(await data()).filter(([k])=>k in saved2)),saved2,'first 3D switch preserves every 2D save')
 await modeStage('3d','source');await openSavedImageSources(page);await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${s3.id}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(s3.id)
 await field('3D Analysis 历史').selectOption(a3.id);await field('3D Review 历史').selectOption(r3.id);await modeStage('3d','reconstruction');await field('Spatial Planning History').selectOption(p3.id);await field('Geometry Execution History').selectOption(x3.id);await field('3D Reconstruction Candidate').selectOption('candidate-2');await camera()
 await page.locator('[data-linked-observation]').filter({visible:true}).first().click();await button('以所选面为上方观察').click();await button('保存当前视角').click();const savedCamera=await camera()
 await field('已对照照片审核候选').check();await button('采用候选到 3D Assembly Editor').click();await button('Edit Draft').waitFor();assert.equal(await mode(),'3d');assert.equal(await active(),'assembly')
 const adopted=await data();await modeStage('3d','build');await button('生成搭建教程').click();await page.getByTestId('build-order-status').filter({hasText:'已生成 · 3 步'}).waitFor({timeout:20000});await button('保存教程').click();await field('3D 教程查看步骤').selectOption('1')
 const tutorial=await exportTutorial(),baseline=await data(),postCount=calls.filter(c=>c.method==='POST').length,dialogCount=dialogs,workerCount=workers
 for(const s of ['source','review','reconstruction','assembly','build']){
  await modeStage('3d',s);assert.equal(await field('3D Analysis 历史').inputValue(),a3.id);assert.equal(await field('3D Review 历史').inputValue(),r3.id);assert.equal(await field('Spatial Planning History').inputValue(),p3.id);assert.equal(await field('Geometry Execution History').inputValue(),x3.id);assert.equal(await field('历史 Reconstruction').count(),0)
  await studioMode(page,'2d');assert.equal(await active(),s);assert.equal(await field('历史 Reconstruction').inputValue(),twoD.id);assert.equal(await field('3D Analysis 历史').count(),0)
  if(s==='reconstruction')assert.equal(await field('几何重建候选').inputValue(),twoD.candidates[0].id)
  if(s==='assembly')assert.equal(await page.locator('[data-tile-id]').filter({visible:true}).count(),1)
  await studioMode(page,'3d');assert.equal(await active(),s);assert.equal(await field('3D Reconstruction Candidate').count(),s==='reconstruction'?1:0)
  if(s==='reconstruction'){assert.equal(await field('3D Reconstruction Candidate').inputValue(),'candidate-2');cameraNear(await camera(),savedCamera)}
  if(s==='assembly')assert.equal((await data())['magnetic-tiles.assembly3d-draft.v1'],adopted['magnetic-tiles.assembly3d-draft.v1'])
  if(s==='build')assert.deepEqual(await exportTutorial(),tutorial)
  assert.deepEqual(await data(),baseline,'navigation/mode changes do not write business storage')
 }
 assert.equal(calls.filter(c=>c.method==='POST').length,postCount);assert.equal(dialogs,dialogCount,'mode switches do not adopt or ask to replace drafts');assert.equal(workers,workerCount,'mode switches do not start a Build Order Worker')
 await studioMode(page,'2d');await page.getByTestId('build-playback-source').waitFor();assert.equal(await page.getByTestId('build-playback-source').textContent(),twoDPlayback);assert.match(await page.locator('.build-step-heading').filter({visible:true}).textContent(),/已完成/)
 await page.reload();await page.getByTestId('build-playback-source').waitFor();assert.equal(await mode(),'2d');assert.match(await page.locator('.build-step-heading').filter({visible:true}).textContent(),/已完成/)
 await studioMode(page,'3d');await page.getByTestId('tutorial-source').waitFor();await page.reload();await page.getByTestId('tutorial-source').waitFor();assert.equal(await mode(),'3d');assert.deepEqual(await exportTutorial(),tutorial)
 await modeStage('3d','reconstruction');await page.getByTestId('visible3d-execution-status').waitFor();assert.equal(await field('3D Reconstruction Candidate').inputValue(),'candidate-2');cameraNear(await camera(),savedCamera)
 await modeStage('3d','assembly');await page.goBack();await page.waitForFunction(()=>document.querySelector('main').dataset.activeStage==='reconstruction');assert.equal(await mode(),'3d')
 for(const width of [1650,1100,680]){
  await page.setViewportSize({width,height:1000});await studioMode(page,'2d');await studioMode(page,'3d');await stage(page,'reconstruction');await camera()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false)
  if(width>=761){assert.equal(await page.locator('.studio-mode-switch').isVisible(),true);await page.screenshot({path:out+`/mode-${width}.png`})}
  else{await button('工作阶段').click();await page.getByRole('group',{name:'Studio 工作模式',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/mode-680.png'});await button('查看工作区').click()}
 }
 assert.equal(calls.some(c=>c.method==='POST'&&/recognize|analyze|plan|execute/.test(c.route)),false);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 const result={passed:true,mode:'single global mode, all five stages, one sidebar switch, default 2D',persistence:'2D and 3D refresh restore; exact Camera/Candidate/Assembly/Tutorial and 2D Build progress retained',isolation:'no business storage writes or API POSTs while switching/navigation; no replacement dialogs',widths:[1650,1100,680],productionWrites:0,modelCalls:0,explicitAdoptions:postCount,buildOrderWorkers:workers,errors,consoleErrors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

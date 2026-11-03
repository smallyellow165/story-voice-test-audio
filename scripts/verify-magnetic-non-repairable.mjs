// Existing Back records copied to a disposable service; never executes a model,
// planning or Geometry Execution, and never writes the official storage.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,official=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'magnetic-angle-hints-')),out='/tmp/magnetic-non-repairable/browser',originals=new Map(),calls=[],errors=[]
async function copy(relative){const file=path.join(official,relative),bytes=await readFile(file);originals.set(file,bytes);await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),bytes);return JSON.parse(bytes)}
async function sourceCopy(id){const s=await copy('sources/'+id+'.json');for(const hash of new Set([s.originalHash,s.view.hash]))await copy('assets/'+hash+'.json');return s}
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 const origin=await copy('visible3d/origins/dcb39710-5ed3-4039-ba56-690307fa40f6.json'),execution=await copy('visible3d/executions/'+origin.executionId+'.json'),plan=await copy('visible3d/plans/'+origin.planId+'.json'),review=await copy('visible3d/reviews/'+origin.reviewId+'.json'),analysis=await copy('visible3d/analyses/'+review.analysisId+'.json'),source=await sourceCopy(origin.sourceId)
 for(const i of source.images??[])await sourceCopy(i.sourceId)
 for(const id of new Set([analysis.traceId,plan.traceId].filter(Boolean)))await copy('visible3d/model-traces/'+id+'.json')
 await cp(path.join(official,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 const head=await copy('visible3d/module-heads/'+review.id+'.json');for(const id of new Set([head.recordId,plan.reconstructionScope.modulePlan.id]))await copy('visible3d/module-plans/'+id+'.json')
 await mkdir(path.join(dir,'visible3d/heads'),{recursive:true});await writeFile(path.join(dir,'visible3d/heads',source.id+'.json'),JSON.stringify({revision:1,reviewId:review.id,reviewHash:review.hash}))
 const api=createMagneticIntake(dir)
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-angle-hints',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route});try{if(req.method!=='GET')throw Error('Read only browser test');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch('GET',route)))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1780,height:1100},acceptDownloads:true});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.addInitScript(o=>{if(sessionStorage.getItem('angle-seeded'))return;localStorage.setItem('magnetic-tiles.assembly3d-draft.v1',JSON.stringify(o.assembly));localStorage.setItem('magnetic-tiles.assembly3d-origin.v1',JSON.stringify({origin:o,assemblyRaw:JSON.stringify(o.assembly)}));sessionStorage.setItem('angle-seeded','yes')},origin)
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),panel=()=>page.getByRole('region',{name:'Auto Constraint Repair',exact:true}),collision=()=>page.getByRole('region',{name:'Collision Diagnostics',exact:true}),hints=()=>page.getByLabel('Spatial Planning Angle Hints',{exact:true}),banner=()=>page.getByTestId('repair-viewer-preview')
 async function open(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function exported(){await open(page.locator('.magnetic-3d-load'));const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25))}throw Error('Timed out waiting for UI')}
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`);await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor({state:'attached'});await studioMode(page,'3d');await stage(page,'assembly','inspector');await hints().waitFor();await button('Edit Draft').click();await until(()=>button('Find Fix').isEnabled());const original=await exported();assert.deepEqual(original,origin.assembly)
 const nr=()=>page.getByRole('checkbox',{name:'不可修复碰撞 p01 / p09',exact:true}),repair=n=>page.getByRole('checkbox',{name:'修复目标 '+n,exact:true})
 assert.equal(await collision().locator('tbody tr').count(),3)
 await repair('p01 / p09').check();await repair('p03 / p09').check();await collision().getByRole('button',{name:'p01 / p09',exact:true}).click();await page.locator('[data-collision-overlay]').waitFor({state:'attached'});await nr().check();await page.locator('[data-collision-overlay]').waitFor({state:'attached'});assert.equal(await repair('p01 / p09').isChecked(),false);assert.equal(await repair('p01 / p09').isDisabled(),true);assert.equal(await repair('p03 / p09').isChecked(),true);assert.deepEqual(await exported(),original)
 for(const checkbox of await collision().getByRole('checkbox',{name:/^接受碰撞 /}).all())assert.equal(await checkbox.isChecked(),false)
 await button('3D Undo').click();assert.equal(await nr().isChecked(),false);assert.equal(await repair('p01 / p09').isEnabled(),true);assert.deepEqual(await exported(),original);await button('3D Redo').click();assert.equal(await nr().isChecked(),true);assert.deepEqual(await exported(),original)
 await button('保存 3D Draft').click();await page.reload();await hints().waitFor();assert.equal(await nr().isChecked(),true);assert.equal(await repair('p01 / p09').isDisabled(),true);assert.deepEqual(await exported(),original)
 await button('Edit Draft').click();await button('重新加载来源').click();await hints().waitFor();assert.equal(await nr().isChecked(),true);await button('Edit Draft').click();await repair('p03 / p09').check();await until(()=>button('Find Fix').isEnabled());await button('Find Fix').click();await banner().waitFor();assert.match(await banner().textContent(),/Geometry Invalid.*碰撞 1/)
 const optimized=panel().locator('table tbody tr');assert.match(await optimized.filter({hasText:'p01 / p09'}).textContent(),/不可修复 · 不计分/);assert.match(await optimized.filter({hasText:'p03 / p09'}).textContent(),/修复目标/);assert.deepEqual(await exported(),original)
 await page.screenshot({path:out+'/preview.png'});await button('应用修复').click();await banner().waitFor({state:'hidden'});const applied=await exported();assert.equal(applied.revision,original.revision+1);assert.equal(applied.connections.length,9);assert.deepEqual(applied.connections.map(({dihedralDeg,...c})=>c),original.connections.map(({dihedralDeg,...c})=>c));assert.equal(applied.connections[2].dihedralDeg,25);assert.equal(applied.connections[3].dihedralDeg,25)
 for(const id of ['p01','p02','p03'])assert.deepEqual(applied.pieces.find(p=>p.id===id).pose,original.pieces.find(p=>p.id===id).pose)
 assert.equal(await collision().locator('tbody tr').count(),1);await button('3D Undo').click();assert.equal(await nr().isChecked(),true);assert.equal(await repair('p01 / p09').isDisabled(),true);assert.deepEqual(await exported(),original);await button('3D Redo').click();assert.deepEqual(await exported(),applied)
 await button('保存 3D Draft').click();await page.reload();await hints().waitFor();assert.deepEqual(await exported(),applied);const metadata=await page.evaluate(()=>JSON.parse(localStorage.getItem('magnetic-tiles.assembly3d-collision-policy.v1')));assert.deepEqual(metadata.nonRepairable,[JSON.stringify(['p01','p09'])]);assert.deepEqual(JSON.parse(metadata.assemblyRaw),applied)
 await button('Edit Draft').click();await page.getByRole('checkbox',{name:'不可修复碰撞 p03 / p11',exact:true}).check();assert.equal(await button('Find Fix').isDisabled(),true);assert.match(await panel().textContent(),/均已标记为不可修复/);assert.match(await page.getByRole('region',{name:'Geometry Check',exact:true}).textContent(),/Geometry Invalid/);await button('3D Undo').click();assert.equal(await page.getByRole('checkbox',{name:'不可修复碰撞 p03 / p11',exact:true}).isChecked(),false)
 for(const width of [1780,1100,680]){await page.setViewportSize({width,height:1000});await stage(page,'assembly','inspector');await panel().scrollIntoViewIfNeeded();assert.equal(await panel().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:`${out}/${width}.png`})}
 assert.equal(calls.some(c=>c.method!=='GET'),false);assert.ok(calls.some(c=>c.route==='visible3d/plans/'+plan.id));assert.deepEqual(errors,[])
 for(const [file,bytes] of originals)assert.deepEqual(await readFile(file),bytes)
 const result={passed:true,source:{origin:origin.id,plan:plan.id,execution:execution.id},checks:['Non-repairable unchecks/disables repair target; other target retained','metadata-only Undo/Redo does not change geometry/revision or acceptance','save/refresh/reload-source restores flags','real Worker excludes marked pair from targets and all scoring','all connections and reference Poses preserved; no collision worsens','apply/Undo/Redo preserves marks even when collision disappears','all-marked disables search; Validator remains Invalid','1780/1100/680 layout'],modelCalls:0,executionCalls:0,formalWrites:0,errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

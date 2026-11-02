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
const root=new URL('../',import.meta.url).pathname,official=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'magnetic-angle-hints-')),out='/tmp/magnetic-angle-hints/browser',originals=new Map(),calls=[],errors=[]
async function copy(relative){const file=path.join(official,relative),bytes=await readFile(file);originals.set(file,bytes);await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),bytes);return JSON.parse(bytes)}
async function sourceCopy(id){const s=await copy('sources/'+id+'.json');for(const hash of new Set([s.originalHash,s.view.hash]))await copy('assets/'+hash+'.json');return s}
let server,browser,page,failPlanRead=false
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
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route});try{if(req.method!=='GET')throw Error('Read only browser test');if(failPlanRead&&route==='visible3d/plans/'+plan.id)throw Error('测试：当前 Plan 文件不可读取');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch('GET',route)))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1780,height:1100},acceptDownloads:true});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.addInitScript(o=>{if(sessionStorage.getItem('angle-seeded'))return;localStorage.setItem('magnetic-tiles.assembly3d-draft.v1',JSON.stringify(o.assembly));localStorage.setItem('magnetic-tiles.assembly3d-origin.v1',JSON.stringify({origin:o,assemblyRaw:JSON.stringify(o.assembly)}));sessionStorage.setItem('angle-seeded','yes')},origin)
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),hints=()=>page.getByLabel('Spatial Planning Angle Hints',{exact:true}),row=pair=>hints().locator(`[data-angle-pair="${pair}"]`)
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`);await studioMode(page,'3d');await stage(page,'assembly','inspector');await hints().waitFor();assert.match(await hints().textContent(),/m_back \/ 所有图片/)
 for(const [pair,angle,min,max] of [['p01/p11','45°','25°','65°'],['p11/p12','0°','-5°','5°'],['p09/p11','90°','65°','115°']]){const text=await row(pair).textContent();for(const val of [angle,min,max,'范围内'])assert.ok(text.includes(val),pair+' '+val)}
 await row('p09/p11').locator('summary').click();assert.match(await row('p09/p11').textContent(),/不确定性：/)
 const rawBefore=await page.evaluate(()=>localStorage.getItem('magnetic-tiles.assembly3d-draft.v1'))
 await page.getByLabel('角度建议方案',{exact:true}).selectOption('1');await page.getByLabel('角度建议方案',{exact:true}).selectOption('0');assert.equal(await page.evaluate(()=>localStorage.getItem('magnetic-tiles.assembly3d-draft.v1')),rawBefore)
 await row('p09/p11').getByRole('button',{name:'查看角度连接 #4',exact:true}).click();assert.equal(await page.locator('[data-selected-3d-connection="4"]').count(),1)
 await button('Edit Draft').click();await row('p09/p11').getByRole('button',{name:'查看角度连接 #4',exact:true}).click();const property=page.locator('.magnetic-3d-editor-properties');await property.locator('input[type=number]').fill('120');await button('应用约束角度').click();assert.match(await row('p09/p11').textContent(),/范围外/)
 await button('3D Undo').click();assert.match(await row('p09/p11').textContent(),/范围内/);await row('p09/p11').getByRole('button',{name:'查看角度连接 #4',exact:true}).click();await button('断开连接').click();assert.match(await row('p09/p11').textContent(),/未连接/);await button('3D Undo').click();assert.match(await row('p09/p11').textContent(),/范围内/)
 await page.reload();await hints().waitFor();assert.match(await row('p09/p11').textContent(),/范围内/)
 for(const width of [1780,1100,680]){await page.setViewportSize({width,height:1000});await stage(page,'assembly','inspector');await hints().scrollIntoViewIfNeeded();assert.equal(await hints().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:`${out}/${width}.png`})}
 failPlanRead=true;await page.reload();await stage(page,'assembly','inspector');await page.getByText('空间规划角度建议：Error: 测试：当前 Plan 文件不可读取',{exact:true}).waitFor();assert.equal(await hints().count(),0);failPlanRead=false;await page.reload();await stage(page,'assembly','inspector');await hints().waitFor();
 assert.equal(calls.some(c=>c.method!=='GET'),false);assert.ok(calls.some(c=>c.route==='visible3d/plans/'+plan.id));assert.deepEqual(errors,[])
 for(const [file,bytes] of originals)assert.deepEqual(await readFile(file),bytes)
 const result={passed:true,source:{origin:origin.id,plan:plan.id,execution:execution.id},checks:['Back 8/14 exact angles/ranges/evidence','read-only alternative browsing','shared Connection selection','live angle edit + Undo','unconnected relation + Undo','refresh','1780/1100/680 layout','missing source clears hints without fallback'],modelCalls:0,executionCalls:0,formalWrites:0,errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

// Replay the reported TruckRamp Analysis against a disposable copy of the API.
// All writes stay in tmpdir; model endpoints are forbidden.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {stage} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root=new URL('../',import.meta.url).pathname,official=path.join(root,'generated/magnetic-intake')
const dir=await mkdtemp(path.join(tmpdir(),'magnetic-disabled-reasons-')),out='/tmp/magnetic-module-disabled-reasons',originals=new Map(),calls=[],errors=[]
async function copy(relative){
 const file=path.join(official,relative),bytes=await readFile(file)
 originals.set(file,bytes);await mkdir(path.dirname(path.join(dir,relative)),{recursive:true});await writeFile(path.join(dir,relative),bytes)
 return JSON.parse(bytes)
}
async function sourceCopy(id){const s=await copy('sources/'+id+'.json');for(const hash of new Set([s.originalHash,s.view.hash]))await copy('assets/'+hash+'.json');return s}
let server,browser,page,holdModuleRead,releaseModuleRead,failModuleRead=false
try{
 await mkdir(out,{recursive:true})
 const analysis=await copy('visible3d/analyses/020e9fcc-a842-4e1c-b8f3-7d3ecff83e4a.json'),source=await sourceCopy(analysis.sourceId)
 for(const i of source.images)await sourceCopy(i.sourceId)
 await copy('visible3d/model-traces/'+analysis.traceId+'.json')
 // Recreate the original unsaved state in the disposable copy even if the
 // user's real project has since saved a Review.
 await copy(`visible3d/heads/${analysis.projectId}/${source.id}.json`)
 await writeFile(path.join(dir,`visible3d/heads/${analysis.projectId}/${source.id}.json`),JSON.stringify({revision:0,selectedRevision:1,analysisId:analysis.id,analysisHash:analysis.hash,reviewId:null,reviewHash:null,groups:{}}))
 assert.equal(analysis.evidence.observations.length,24)
 await cp(path.join(official,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 const api=createMagneticIntake(dir)
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'module-blockers',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
   const route=req.url.slice(1).split('?')[0],action=route.replace(/^visible3d\/project\/[a-f0-9-]+\//,'visible3d/')
   calls.push({method:req.method,route})
   try{
    if(req.method!=='GET'&&!['visible3d/reviews','visible3d/module-plans','visible3d/selected','visible3d/workspace-history'].includes(action))throw Error('Models and unrelated writes forbidden: '+route)
    if(action.startsWith('visible3d/module-state/')){if(holdModuleRead)await holdModuleRead;if(failModuleRead)throw Error('测试：模块来源 Hash 校验失败')}
    let raw='';for await(const chunk of req)raw+=chunk
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{})))
   }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
  })
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1734,height:1244}});page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message))
 let answer='Ramp';page.on('dialog',d=>d.type()==='prompt'?d.accept(answer):d.accept())
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?workspace=create&workspaceId=${analysis.projectId}&stage=source`
 const field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true})
 const wrapper=n=>page.getByRole('group',{name:n+'禁用原因',exact:true}),tip=()=>page.getByRole('tooltip')
 async function tooltip(name,pattern,screenshot){
  assert.equal(await button(name).isDisabled(),true)
  await page.mouse.move(1,1)
  const b=await button(name).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2)
  await tip().waitFor({state:'visible'});assert.match(await tip().innerText(),pattern)
  assert.equal(await tip().evaluate(e=>getComputedStyle(e).color),'rgb(161, 38, 38)')
  assert.notEqual(await button(name).evaluate(e=>getComputedStyle(e).color),'rgb(161, 38, 38)')
  const r=await tip().boundingBox(),v=page.viewportSize();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=v.width&&r.y+r.height<=v.height)
  if(screenshot)await page.screenshot({path:out+'/'+screenshot+'.png'})
  await page.keyboard.press('Escape');await tip().waitFor({state:'hidden'})
  await page.mouse.move(1,1);await wrapper(name).focus();await tip().waitFor({state:'visible'});assert.match(await tip().innerText(),pattern)
  await page.keyboard.press('Escape');await tip().waitFor({state:'hidden'});await wrapper(name).blur()
 }
 async function choose(ids){if(await button('清空勾选').isEnabled())await button('清空勾选').click();for(const id of ids)await field('显示证据 '+id).check()}
 await page.goto(base)
 await field('Analysis History').locator(`option[value="${analysis.id}"]`).waitFor({state:'attached'})
 await field('Analysis History').selectOption(analysis.id);await stage(page,'review')
 await button('采用所有 AI 建议').click();await button('Known 24').waitFor();await button('Unknown 0').waitFor()
 await choose(['r03','r04','r05'])
 for(const id of ['r03','r04','r05'])assert.match(await page.locator(`[data-review-id="${id}"]`).innerText(),/人工已确认/)
 assert.equal(await field('3D Review 历史').inputValue(),'')
 await tooltip('创建模块',/尚未保存 3D Review.*保存 3D Review/s,'unsaved-review')
 await tooltip('重命名模块',/尚未保存 3D Review/)
 // Save through the real UI, then deliberately hold the module-state response.
 holdModuleRead=new Promise(resolve=>{releaseModuleRead=resolve})
 await button('保存 3D Review').click()
 await page.waitForFunction(()=>!!document.querySelector('[aria-label="3D Review 历史"]')?.value)
 await tooltip('创建模块',/正在加载.*模块状态/)
 releaseModuleRead();holdModuleRead=null
 await page.waitForFunction(()=>document.querySelector('[aria-label="模块筛选"]')?.disabled===false)
 await choose(['r03','r04','r05'])
 assert.equal(await button('创建模块').isEnabled(),true)
 await button('创建模块').hover();assert.equal(await page.locator('[role="tooltip"]').count(),1,'only the disabled rename owns a tooltip')
 assert.equal(await button('创建模块').getAttribute('aria-describedby'),null)
 assert.equal(await page.locator('[role="tooltip"]:popover-open').count(),0)
 await tooltip('重命名模块',/选择一个已有模块/)
 await button('清空勾选').click();await tooltip('创建模块',/至少勾选 1 个模块成员/,'no-selection')
 await choose(['r03','r04','r05'])
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/module-plans'))
 await button('创建模块').click();const saved=await(await response).json();assert.ok(saved.record,JSON.stringify(saved))
 assert.deepEqual(saved.record.modules[0].observationIds,['r03','r04','r05'])
 const module=saved.record.modules[0];await field('模块筛选').selectOption(module.id)
 assert.equal(await button('重命名模块').isEnabled(),true);assert.equal(await button('重命名模块').getAttribute('aria-describedby'),null)
 answer='Ramp renamed';const rename=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/module-plans'))
 await button('重命名模块').click();assert.equal((await(await rename).json()).record.modules[0].name,answer)
 await field('模块筛选').selectOption('unassigned');await tooltip('重命名模块',/未分配.*不能重命名/)
 await field('模块筛选').selectOption('all')
 // A fresh read failure remains an actual blocker, including the server's reason.
 failModuleRead=true;await page.reload();await stage(page,'review')
 await page.getByRole('alert').filter({hasText:'测试：模块来源 Hash 校验失败'}).waitFor()
 await tooltip('创建模块',/模块状态加载失败.*Hash 校验失败/,'load-failure')
 await tooltip('重命名模块',/模块状态加载失败.*Hash 校验失败/)
 failModuleRead=false;await page.reload();await stage(page,'review')
 await page.waitForFunction(()=>document.querySelector('[aria-label="模块筛选"]')?.disabled===false)
 await choose([])
 for(const width of [1100,680]){await page.setViewportSize({width,height:1000});await stage(page,'review');await tooltip('创建模块',/至少勾选 1 个/,`tooltip-${width}`)}
 for(const [file,bytes]of originals)assert.ok(bytes.equals(await readFile(file)),file+' changed')
 assert.deepEqual(errors,[])
 const result={passed:true,reportedCase:'Known 24 / Unknown 0, confirmed r03+r04+r05, unsaved Review',checks:['native disabled button hover','keyboard focus / Escape','red tooltip, ordinary disabled button','unsaved Review before selection blocker','loading / failed module state','empty selection needs one member','rename requires an existing module','enabled buttons have no error tooltip','saved Review allows create then rename','1100px / 680px viewport fit'],modelCalls:0,productionWrites:0,errors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText()+'\n'+JSON.stringify(calls))}throw e}
finally{releaseModuleRead?.();await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

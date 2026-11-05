// Isolated Studio UI regression. Existing registry and real immutable fixture
// records; provider requests and production writes are forbidden.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {multiFixture} from '../test/magnetic-multi-image-fixtures.mjs'
import {stage} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-reconstruction-inspector-')),out='/tmp/magnetic-reconstruction-inspector'
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 const f=await multiFixture(dir),project=randomUUID(),freshProject=randomUUID(),prefix='visible3d/project/'+project+'/',post=(route,body)=>f.api.dispatch('POST',prefix+route,body)
 const analysis=await post('annotate',{sourceId:f.source.id,evidence:f.evidence})
 await post('selected',{sourceId:f.source.id,stage:'analysis',id:analysis.id,hash:analysis.hash,expectedRevision:0})
 const review=await post('reviews',{analysisId:analysis.id,review:f.review,expectedRevision:0}),plan=await post('manual-plan',{reviewId:review.record.id,plan:f.plan})
 const execution=await post('execute',{requestId:randomUUID(),planId:plan.id}),failed=await post('execute',{requestId:randomUUID(),planId:plan.id,options:{maxAssignments:0}})
 assert.equal(execution.state,'complete');assert.equal(failed.state,'complete')
 const originals=new Map()
 for(const [kind,r]of [['analyses',analysis],['reviews',review.record],['plans',plan],['executions',execution.record],['executions',failed.record]]){
  const file=path.join(dir,'visible3d',kind,r.id+'.json');originals.set(file,await readFile(file))
 }
 const calls=[],errors=[]
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'reconstruction-inspector-qa',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
   const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route})
   try{
    if(req.method!=='GET'&&![prefix+'selected','library-image'].includes(route))throw Error('Unexpected write / model call: '+route)
    let raw='';for await(const c of req)raw+=c
    const value=await f.api.dispatch(req.method,route,raw?JSON.parse(raw):{})
    // Enable only the UI choices, using the actual registered model options.
    // All model POST routes above remain forbidden.
    if(route.endsWith('/status'))value.providers={openai:true,gemini:true}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))
   }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
  })
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1734,height:1000}});page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message))
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html`,url=id=>base+`?workspace=create&workspaceId=${id}&stage=reconstruction`
 const field=name=>page.getByLabel(name,{exact:true}).filter({visible:true}),inspector=page.locator('.visible3d-reconstruction-inspector:visible'),planning=()=>field('3D Spatial Planning 模型')
 const idle=async()=>{await planning().waitFor();await page.waitForFunction(()=>!document.querySelector('.visible3d-reconstruction-inspector')?.textContent.includes('正在处理；'))}
 await page.goto(url(freshProject));await stage(page,'reconstruction','inspector');await idle()
 assert.equal(await planning().inputValue(),'gpt-6.1-sol','fresh Planning defaults to registered GPT-6.1 Sol')
 assert.match(await planning().locator('option:checked').innerText(),/OpenAI GPT-6.1 Sol/)
 const neutral=await page.getByTestId('visible3d-execution-state').evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderStyle}))
 assert.deepEqual(neutral,{color:'rgb(36, 62, 58)',background:'rgba(0, 0, 0, 0)',border:'none'})
 await planning().selectOption('gemini-3.6-flash')
 await page.waitForFunction(id=>JSON.parse(localStorage.getItem('magnetic-studio.workspace.v1.create.'+id+'.workflow-draft.v1')||'null')?.planningModel==='gemini-3.6-flash',freshProject)
 await page.reload();await stage(page,'reconstruction','inspector');await idle();assert.equal(await planning().inputValue(),'gemini-3.6-flash','explicit saved choice survives refresh')
 await stage(page,'source','inspector');assert.equal(await field('3D Vision 模型').inputValue(),'gpt-6.1-sol','Analysis default remains unchanged')
 await page.goto(url(project));await stage(page,'reconstruction','inspector');await idle();assert.equal(await planning().inputValue(),'gpt-6.1-sol','another Project retains its own default')
 await field('Analysis History').selectOption(analysis.id)
 await field('Geometry Execution History').locator(`option[value="${execution.record.id}"]`).waitFor({state:'attached'})
 await field('Geometry Execution History').selectOption(execution.record.id)
 await page.getByTestId('visible3d-execution-state').filter({hasText:'Geometry Valid'}).waitFor()
 const candidate=await field('3D Reconstruction Candidate').inputValue()
 for(const [name,value]of [['3D 连接组合预算','128'],['3D 几何检查预算','256'],['3D 局部子图预算','1024']])assert.equal(await field(name).inputValue(),value)
 assert.equal(await inspector.locator('h2').count(),0,'no duplicate page title')
 assert.equal(await inspector.getByRole('button',{name:'Spatial Planning（调用模型）',exact:true}).count(),1)
 assert.equal(await inspector.getByRole('button',{name:'Geometry Execution（不调用模型）',exact:true}).count(),1)
 for(const width of [1734,1100,760]){
  await page.setViewportSize({width,height:1000});await stage(page,'reconstruction','inspector')
  const controls=await inspector.locator('button,select,input').filter({visible:true}).evaluateAll(es=>es.map(e=>({tag:e.tagName,height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontSize})))
  assert.ok(controls.length>5);for(const c of controls){assert.ok(c.height>=28&&c.height<=34,JSON.stringify(c));assert.equal(c.font,'12px')}
  const participation=await page.getByTestId('visible3d-planning-participation').evaluate(e=>({font:getComputedStyle(e).fontSize,weight:getComputedStyle(e).fontWeight}));assert.equal(participation.font,'12px');assert.equal(participation.weight,'400')
  const fonts=await inspector.locator('h3').evaluateAll(es=>es.map(e=>getComputedStyle(e).fontSize));assert.ok(fonts.every(f=>f==='13px'))
  assert.equal(await page.getByTestId('visible3d-execution-state').evaluate(e=>getComputedStyle(e).color),neutral.color)
  assert.equal(await inspector.evaluate(e=>e.scrollWidth>e.clientWidth+1),false,'no Inspector horizontal overflow')
  const header=page.locator('.studio-inspector-actions .trace-open:visible');assert.equal(await header.count(),1);assert.ok((await header.boundingBox()).y<150)
  await page.screenshot({path:out+`/inspector-${width}.png`})
 }
 await page.setViewportSize({width:1734,height:1000});await stage(page,'reconstruction','inspector')
 await page.getByRole('button',{name:'Trace / Raw',exact:true}).filter({visible:true}).click()
 await page.getByRole('dialog',{name:'Magnetic Tiles Trace',exact:true}).waitFor();await page.getByRole('button',{name:'关闭 Trace',exact:true}).click()
 assert.equal(await field('3D Reconstruction Candidate').inputValue(),candidate)
 await field('Geometry Execution History').selectOption(failed.record.id);await page.getByTestId('visible3d-execution-state').filter({hasText:'搜索预算已耗尽'}).waitFor()
 assert.equal(await page.getByTestId('visible3d-execution-state').evaluate(e=>getComputedStyle(e).color),'rgb(161, 38, 38)','blocking error remains red')
 await page.screenshot({path:out+'/inspector-error.png'})
 await page.goto(url(freshProject));await stage(page,'reconstruction','inspector');await idle();assert.equal(await planning().inputValue(),'gemini-3.6-flash','saved choice survives Project switching')
 for(const [file,bytes]of originals)assert.ok(bytes.equals(await readFile(file)),'immutable record changed: '+file)
 assert.deepEqual(errors,[]);assert.equal(calls.some(c=>c.method==='POST'&&/\/(analyze|plan|execute)$/.test(c.route)),false)
 const report={passed:true,widths:[1734,1100,760],checks:['fresh GPT-6.1 Sol default','saved explicit model across refresh and Project switches','Analysis default unchanged','12px text / 13px sections / 28–34px controls','neutral waiting and completed status, red blocking errors','Trace reachable, candidate selection and budget defaults unchanged','immutable records unchanged'],modelCalls:0,productionWrites:0,errors}
 await writeFile(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

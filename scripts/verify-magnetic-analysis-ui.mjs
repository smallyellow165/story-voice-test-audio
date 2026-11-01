// Isolated Source/library APIs, synthetic aspect-ratio fixtures and copied saved
// real-photo histories. No paid models or changes to official images/records.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,readdir,cp,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)),official=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'magnetic-analysis-ui-')),library=path.join(dir,'library'),out='/tmp/magnetic-analysis-ui'
let browser,server,page
try{
 await mkdir(out,{recursive:true});await mkdir(library)
 const fixture=JSON.parse(await readFile(path.join(root,'test/fixtures/magnetic-intake/rose-relative-size.json'),'utf8'))
 for(const [kind,id] of [['sources',fixture.sourceId],['analyses',fixture.analysisId],['reviews',fixture.reviewId]]){await mkdir(path.join(dir,kind),{recursive:true});await cp(path.join(official,kind,id+'.json'),path.join(dir,kind,id+'.json'))}
 const sources=await Promise.all((await readdir(path.join(official,'sources'))).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(path.join(official,'sources',f),'utf8')))),purple=sources.find(s=>s.name==='qisimiaoxiang_square.png');assert.ok(purple)
 await cp(path.join(official,'sources',purple.id+'.json'),path.join(dir,'sources',purple.id+'.json'));await mkdir(path.join(dir,'assets'))
 for(const s of [sources.find(s=>s.id===fixture.sourceId),purple])for(const id of new Set([s.originalHash,s.view.hash]))await cp(path.join(official,'assets',id+'.json'),path.join(dir,'assets',id+'.json'))
 await cp(path.join(official,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 for(const kind of ['analyses','reviews','plans','executions','heads','model-traces'])await cp(path.join(official,'visible3d',kind),path.join(dir,'visible3d',kind),{recursive:true})
 const api=createMagneticIntake(dir,{libraryDirectory:library}),calls=[],errors=[],consoleErrors=[]
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-analysis-ui',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route})
  if(req.method!=='GET'&&!['sources','source-sets','library-image','visible3d/annotate'].includes(route)){res.statusCode=403;res.end(JSON.stringify({error:'Vision/model and non-fixture writes forbidden'}));return}
  try{let body='';for await(const c of req)body+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,body?JSON.parse(body):{})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen()
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html`
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1650,height:1050}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
 await page.goto(base+'?stage=source');const fixtures=[]
 for(const [name,width,height] of [['landscape',1200,600],['portrait',600,1200],['square',900,900]]){
  const bytes=await page.evaluate(({width,height,name})=>{const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');x.fillStyle='#ffffff';x.fillRect(0,0,width,height);x.strokeStyle='#111111';x.lineWidth=8;x.strokeRect(5,5,width-10,height-10);for(const [a,b,color] of [[.1,.4,'#b895cf'],[.6,.9,'#55b8ac']]){x.fillStyle=color;x.fillRect(a*width,.2*height,(b-a)*width,.6*height)}x.fillStyle='#111111';x.font='25px sans-serif';x.fillText(name,20,40);return c.toDataURL('image/png').split(',')[1]},{width,height,name})
  const buffer=Buffer.from(bytes,'base64'),file=name+'.png';await writeFile(path.join(library,file),buffer);fixtures.push({name,file,width,height,buffer})
 }
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),inspector=()=>page.locator('.source-inspector').filter({visible:true})
 const selected2=[],selected3=[]
 const observations=[{id:'p1',color:'#b895cf',box:[.1,.2,.4,.8]},{id:'p2',color:'#55b8ac',box:[.6,.2,.9,.8]}]
 async function selectImage(id){await stage(page,'source','inspector');await inspector().getByRole('tab',{name:'上传图片',exact:true}).click();const details=inspector().locator('details').filter({has:page.getByText('重新打开图片集合',{exact:true})});if(!await details.evaluate(d=>d.open))await details.locator('summary').click();await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${id}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(id)}
 async function idleImages(){await page.waitForFunction(()=>{const selected=document.querySelector('[data-stage="source"]')?.getAttribute('aria-current');return selected==='step'&&![...document.querySelectorAll('.source-image-picker')].filter(e=>e.checkVisibility()).some(e=>[...e.querySelectorAll('p[role="status"]')].some(p=>p.textContent.includes('保存图片集合')))})}
 async function clearCollection(){await stage(page,'source','inspector');const remove=inspector().getByRole('button',{name:/^移除 /});while(await remove.count()){await remove.first().click();await idleImages()}}
 async function uploadSingle(f){await clearCollection();await inspector().getByRole('tab',{name:'上传图片',exact:true}).click();const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/source-sets')&&r.request().method()==='POST');await inspector().getByTestId('intake-upload').setInputFiles({name:f.file,mimeType:'image/png',buffer:f.buffer});const source=await(await response).json();await idleImages();return source}
 async function librarySingle(name){await clearCollection();await inspector().getByRole('tab',{name:'服务器图片',exact:true}).click();await inspector().getByLabel('搜索服务器图片',{exact:true}).fill(name);const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/source-sets')&&r.request().method()==='POST');await inspector().getByLabel('加入 '+name,{exact:true}).click();const source=await(await response).json();await idleImages();return source}
 async function chooseAnalysis(mode,id){const item=field(mode==='3d'?'3D Analysis 历史':'历史 Analysis');if(!await item.count())await button('工作阶段').click();await item.selectOption(id)}
 async function openDetails(text){const d=inspector().locator('details').filter({has:page.getByText(text,{exact:true})}).last();if(!await d.evaluate(e=>e.open))await d.locator(':scope > summary').click();return d}
 async function inspectImage(mode,f){
  await stage(page,'source','workspace')
  const svg=page.locator('.analysis-image-preview .analysis-image-fit>svg').filter({visible:true});await svg.waitFor()
  await page.waitForFunction(()=>[...document.querySelectorAll('.analysis-image-fit>svg')].some(s=>{const b=s.getBoundingClientRect();return b.width>0&&b.height>0&&s.querySelector('image')?.getAttribute('href')?.startsWith('data:')}))
  const map=await svg.evaluate(s=>{const b=s.getBoundingClientRect(),m=s.getScreenCTM(),v=s.viewBox.baseVal,fit=s.parentElement,workspace=s.closest('.studio-workspace');const point=(x,y)=>{const p=new DOMPoint(x,y).matrixTransform(m);return [p.x,p.y]};return {scale:[m.a,m.d,m.b,m.c],tl:point(0,0),br:point(v.width,v.height),center:point(v.width*.75,v.height*.5),ratio:v.width/v.height,box:{x:b.x,y:b.y,right:b.right,bottom:b.bottom},scroll:[fit.scrollWidth-fit.clientWidth,fit.scrollHeight-fit.clientHeight],viewport:innerHeight,parents:[s,fit,fit.parentElement,fit.parentElement.parentElement,workspace,workspace.parentElement,workspace.parentElement.parentElement].map(e=>{const c=getComputedStyle(e),b=e.getBoundingClientRect();return {tag:e.tagName,class:e.className.baseVal??e.className,y:b.y,height:b.height,client:e.clientHeight,scroll:e.scrollHeight,css:{display:c.display,height:c.height,minHeight:c.minHeight,maxHeight:c.maxHeight,flex:c.flex,overflow:c.overflow}}}),workspaceScroll:workspace.scrollHeight-workspace.clientHeight}})
  if(map.box.bottom>map.viewport+1)await writeFile(out+'/overflow.json',JSON.stringify(map,null,2))
  assert.ok(map.box.bottom<=map.viewport+1,'image preview fits within the screen')
  assert.ok(Math.abs(map.scale[0]-map.scale[1])<1e-7,'uniform image/overlay transform');assert.ok(Math.abs(map.ratio-f.width/f.height)<1e-7)
  assert.ok(map.tl[0]>=map.box.x-1&&map.tl[1]>=map.box.y-1&&map.br[0]<=map.box.right+1&&map.br[1]<=map.box.bottom+1,'entire image lies within viewport')
  assert.ok(map.scroll.every(n=>n<=1),'no image scrollbar');assert.ok(map.workspaceScroll<=1,'image fits available center height')
  const hit=await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest('[data-observation]')?.getAttribute('data-observation'),map.center);assert.equal(hit,'p2','normalized observation matches photo position')
  await page.mouse.click(...map.center);assert.equal(await svg.locator('[data-observation="p2"]').getAttribute(mode==='3d'?'aria-pressed':'class'),mode==='3d'?'true':'observation selected')
  // The bbox/polygon extent is checked independently of the click location.
  const extent=await svg.locator(mode==='3d'?'[data-observation="p2"] rect':'[data-observation="p2"]').evaluate(e=>{const b=e.getBoundingClientRect();return [b.left,b.right]})
  const expected=[map.tl[0]+(map.br[0]-map.tl[0])*.6,map.tl[0]+(map.br[0]-map.tl[0])*.9];extent.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1,'overlay position preserved'))
 }
 for(const f of fixtures){
  const source=await uploadSingle(f);await page.waitForFunction(id=>new URL(location.href).searchParams.get('sourceId')===id,source.id);assert.equal(source.view.width,f.width);assert.equal(source.view.height,f.height)
  const evidence={sourceKind:'unsupported',reason:'Synthetic offline UI coordinates; no Vision accuracy claim',observations:observations.map(o=>({id:o.id,color:o.color,profileId:'unknown',profileVersion:1,outline:[[o.box[0],o.box[1]],[o.box[2],o.box[1]],[o.box[2],o.box[3]],[o.box[0],o.box[3]]],confidence:0,evidence:'Offline coordinate fixture',uncertainty:'Not a model result',origin:'observed',excluded:false})),relations:[]}
  const payload={schemaVersion:1,id:randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',model:'offline-ui-fixture',provider:'fixture',usageMetadata:{fixture:true},rawOutput:JSON.stringify(evidence),evidence,createdAt:new Date().toISOString()};await writeFile(path.join(dir,'analyses',payload.id+'.json'),JSON.stringify({...payload,hash:await contentHash(payload)}))
  await button('刷新图片历史').click();await field('历史 Analysis').selectOption(payload.id);selected2.push({...f,source,analysis:payload.id});await inspectImage('2d',f)
 }
 // Shared Server Images also works in 2D and deduplicates the upload's Source.
 const fromLibrary=await librarySingle('landscape.png');assert.equal(fromLibrary.images[0].sourceId,selected2[0].source.images[0].sourceId);await selectImage(selected2[0].source.id);let response;
 await field('历史 Analysis').selectOption(selected2[0].analysis);const d=await openDetails('Analysis · 实际模型 / Usage / 原始输出');assert.match(await d.innerText(),/fixture/);await button('Trace / Raw').click();await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Trace JSON"]')?.value.includes('offline-ui-fixture'));await button('关闭 Trace').click()
 await studioMode(page,'3d');await stage(page,'source','inspector');await button('Analyze Visible 3D（调用模型）').waitFor()
 assert.equal(await page.locator('.studio-workspace').getByRole('button',{name:'Analyze Visible 3D（调用模型）',exact:true}).count(),0);assert.equal(await inspector().getByRole('button',{name:'Analyze Visible 3D（调用模型）',exact:true}).count(),1)
 for(const f of selected2){
  const source=await librarySingle(f.file);assert.equal(source.images[0].sourceId,f.source.images[0].sourceId);await page.waitForFunction(id=>JSON.parse(localStorage.getItem('magnetic-visible3d-context.v1')||'{}').sourceId===id,source.id);assert.equal(await field('3D Analysis 历史').inputValue(),'')
  const evidence={version:1,observations:observations.map(o=>({id:o.id,color:o.color,bbox:o.box,features:[{id:o.id+'-edge',points:[[o.box[0],o.box[1]],[o.box[2],o.box[1]]],visibility:'visible',note:'Known synthetic edge'}],occlusion:'none',evidence:'Manual UI fixture, not Vision',uncertainty:'Unverified Profile',profileCandidates:[]})),unknowns:['No model called']}
  const manual=await openDetails('人工标注 / 离线验证（不调用模型）');assert.deepEqual(JSON.parse(await field('Visible 3D 人工标注 JSON').inputValue()).observations,[],'old annotation input is cleared on Source change')
  await field('Visible 3D 人工标注 JSON').fill(JSON.stringify(evidence));response=page.waitForResponse(r=>r.url().endsWith('/visible3d/annotate')&&r.request().method()==='POST');await button('保存人工标注并 Review').click();const a=await(await response).json();assert.equal(a.sourceId,source.id);assert.equal(a.sourceHash,source.hash);selected3.push({...f,source,analysis:a.id});await stage(page,'source','workspace');await inspectImage('3d',f)
 }
 // 3D local upload reuses the identical normalization/Source API, too.
 const uploadedAgain=await uploadSingle(fixtures[2]);assert.equal(uploadedAgain.images[0].sourceId,selected2[2].source.images[0].sourceId);await selectImage(selected3[2].source.id);await field('3D Analysis 历史').selectOption(selected3[2].analysis)
 for(const width of [1650,1100,680])for(const [mode,list] of [['2d',selected2],['3d',selected3]]){
  await page.setViewportSize({width,height:1000});await studioMode(page,mode)
  for(const f of list){await selectImage(f.source.id);await chooseAnalysis(mode,f.analysis);await inspectImage(mode,f);if(f.name==='portrait')await page.screenshot({path:out+`/${mode}-${width}-portrait.png`})}
 }
 await page.setViewportSize({width:1650,height:1050});await studioMode(page,'2d');await stage(page,'source','inspector');assert.equal(await field('历史 Analysis').inputValue(),selected2[2].analysis);await page.reload();await page.waitForFunction(id=>document.querySelector('select[aria-label="历史 Analysis"]')?.value===id&&!document.querySelector('select[aria-label="当前图片"]')?.disabled,selected2[2].analysis);assert.equal(await field('历史 Analysis').inputValue(),selected2[2].analysis);await inspectImage('2d',fixtures[2])
 const outline=page.locator('.analysis-image-fit svg').filter({visible:true}),points=await outline.evaluate(s=>{const v=s.viewBox.baseVal,m=s.getScreenCTM();return [[.9,.8],[.92,.82]].map(([x,y])=>{const p=new DOMPoint(x*v.width,y*v.height).matrixTransform(m);return [p.x,p.y]})})
 await page.mouse.move(...points[0]);await page.mouse.down();await page.mouse.move(...points[1],{steps:6});await page.mouse.up()
 const corner=await outline.locator('[data-observation="p2"]').evaluate(p=>{const v=p.ownerSVGElement.viewBox.baseVal,n=p.points.getItem(2);return [n.x/v.width,n.y/v.height]});assert.ok(Math.abs(corner[0]-.92)<.003&&Math.abs(corner[1]-.82)<.003,'existing manual corner edit uses the fitted SVG transform')
 await studioMode(page,'3d');await stage(page,'source','inspector');assert.equal(await field('3D Analysis 历史').inputValue(),selected3[2].analysis);await page.reload();await page.waitForFunction(id=>document.querySelector('select[aria-label="3D Analysis 历史"]')?.value===id,selected3[2].analysis);assert.equal(await field('3D Analysis 历史').inputValue(),selected3[2].analysis);await inspectImage('3d',fixtures[2])
 // Saved real photos/history and actual persisted Trace remain inspectable.
 await selectImage(purple.id);const real=(await api.dispatch('GET','visible3d/history')).analyses.find(a=>a.sourceId===purple.id&&a.traceId);assert.ok(real);await field('3D Analysis 历史').selectOption(real.id)
 const provenance=page.locator('.visible3d-inspector details').filter({has:page.getByText('来源、Trace 与导出',{exact:true})});await provenance.locator(':scope > summary').click();await provenance.getByRole('button',{name:/原始 Trace/}).first().click();const trace=page.locator('.visible3d-inspector details').filter({has:page.getByText('实际保存的模型 Trace',{exact:true})});assert.match(await trace.locator('pre').textContent(),/rawOutput/);await button('关闭 Trace').click()
 await stage(page,'source','workspace');await page.screenshot({path:out+'/real-purple-analysis.png'})
 assert.equal(calls.some(c=>c.method==='POST'&&/recognize|visible3d\/(analyze|plan|execute|adopt)/.test(c.route)),false);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[])
 const result={passed:true,sharedPicker:'upload + saved Source + server list/read/refresh using existing APIs',identity:'same upload/library bytes share Source ID/hash; Analysis histories remain isolated',images:'landscape, portrait, square; uniform contain, no image scroll/crop, matching annotations/clicks',widths:[1650,1100,680],history:'both modes restore on mode switch and refresh; saved real-photo model Trace accessible',modelCalls:0,productionWrites:0,errors,consoleErrors}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

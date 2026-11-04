import {openSavedImageSources} from './magnetic-studio-browser.mjs'
// Isolated browser/layout regression. Synthetic image evidence is not a Vision
// accuracy test. Saved real-photo records are copied read-only into a temp API.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,readFile,writeFile,readdir,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'

const root=fileURLToPath(new URL('..',import.meta.url)),official=path.join(root,'generated/magnetic-intake'),dir=await mkdtemp(path.join(tmpdir(),'visible3d-review-fit-')),out='/tmp/magnetic-visible3d-review-fit'
let server,browser,page
try{
 await mkdir(out,{recursive:true});await cp(path.join(official,'profile-registry'),path.join(dir,'profile-registry'),{recursive:true})
 const api=createMagneticIntake(dir),errors=[],consoleErrors=[],calls=[],fixtures=[]
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'review-fit-isolated-api',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
  const route=req.url.slice(1).split('?')[0];calls.push({method:req.method,route})
  if(req.method!=='GET'&&!['visible3d/reviews'].includes(route)){res.statusCode=403;res.end(JSON.stringify({error:'Models and non-fixture writes forbidden'}));return}
  try{let body='';for await(const c of req)body+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,body?JSON.parse(body):{})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
 })}}]});await server.listen()
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
 page=await browser.newPage({viewport:{width:1650,height:1050}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html`
 await page.goto(base+'?stage=source')
 for(const [name,width,height] of [['landscape',1200,600],['portrait',600,1200],['square',900,900]]){
  const imageBase64=await page.evaluate(({name,width,height})=>{const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,width,height);x.strokeStyle='#111';x.lineWidth=8;x.strokeRect(5,5,width-10,height-10);for(const [a,b,color] of [[.1,.4,'#b895cf'],[.6,.9,'#55b8ac']]){x.fillStyle=color;x.fillRect(a*width,.2*height,(b-a)*width,.6*height)}x.fillStyle='#111';x.font='25px sans-serif';x.fillText(name,20,40);return c.toDataURL('image/png').split(',')[1]},{name,width,height})
  const source=await api.dispatch('POST','sources',{name:name+'.png',original:{mimeType:'image/png',imageBase64},view:{mimeType:'image/png',imageBase64}})
  const evidence={version:1,observations:[['p1',.1,.4],['p2',.6,.9]].map(([id,left,right])=>({id,color:id==='p1'?'#b895cf':'#55b8ac',bbox:[left,.2,right,.8],features:[...[[[left,.2],[right,.2]],[[right,.2],[right,.8]],[[right,.8],[left,.8]],[[left,.8],[left,.2]]].map((points,i)=>({id:id+'-edge'+i,points,visibility:'visible',note:'Synthetic contour segment'})),{id:id+'-corner',points:[[left,.2]],visibility:'visible',note:'Synthetic vertex'}],profileCandidates:[],occlusion:'none',evidence:'Synthetic image and evidence for fit/selection regression',uncertainty:'Not a Vision result'})),unknowns:[]}
  const analysis=await api.dispatch('POST','visible3d/annotate',{sourceId:source.id,evidence});fixtures.push({name,width,height,source,analysis,evidence})
 }
 await page.reload();await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor();await studioMode(page,'3d')
 const field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true})
 async function openFixture(f){
  await stage(page,'source','inspector');await openSavedImageSources(page);await field('已有图片来源').focus();await field('已有图片来源').locator(`option[value="${f.source.id}"]`).waitFor({state:'attached'});await field('已有图片来源').selectOption(f.source.id)
  await page.locator('select[aria-label="Analysis History"]').locator(`option[value="${f.analysis.id}"]`).waitFor({state:'attached'})
  if(!await field('Analysis History').count())await button('工作阶段').click()
  await field('Analysis History').selectOption(f.analysis.id);await stage(page,'review','workspace')
 }
 const svg=()=>page.locator('.review-evidence-fit svg').filter({visible:true})
 async function inspect(f){
  await svg().waitFor()
  const info=await svg().evaluate(s=>{const m=s.getScreenCTM(),v=s.viewBox.baseVal,b=s.getBoundingClientRect(),point=(x,y)=>{const p=new DOMPoint(x,y).matrixTransform(m);return [p.x,p.y]};return {scale:[m.a,m.d,m.b,m.c],size:[v.width,v.height],box:[b.left,b.top,b.right,b.bottom],tl:point(0,0),br:point(v.width,v.height),hit:point(v.width*.75,v.height*.5),vertex:point(v.width*.6,v.height*.2),viewport:[innerWidth,innerHeight],wrappers:[s.parentElement,s.parentElement.parentElement].map(e=>({scroll:[e.scrollWidth-e.clientWidth,e.scrollHeight-e.clientHeight],overflow:getComputedStyle(e).overflow,box:[e.getBoundingClientRect().top,e.getBoundingClientRect().bottom]}))}})
  assert.deepEqual(info.size,[f.width,f.height]);assert.ok(Math.abs(info.scale[0]-info.scale[1])<1e-7,'photo/evidence have a uniform scale');assert.equal(info.scale[2],0);assert.equal(info.scale[3],0)
  assert.ok(info.box[3]-info.box[1]>20,'preview retains usable height');assert.ok(info.box[1]>=0&&info.box[3]<=info.viewport[1]+1,'preview is within the available workspace')
  assert.ok(info.tl[0]>=info.box[0]-1&&info.tl[1]>=info.box[1]-1&&info.br[0]<=info.box[2]+1&&info.br[1]<=info.box[3]+1,'all four image edges are visible, not clipped')
  for(const w of info.wrappers){assert.deepEqual(w.overflow,'hidden');assert.ok(w.scroll.every(n=>n<=1),'no hidden overflowing image or internal scrollbar')}
  const hit=await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest('[data-observation]')?.getAttribute('data-observation'),info.hit);assert.equal(hit,'p2','screen-space hit agrees with normalized photo evidence')
  await page.mouse.click(...info.hit);assert.equal(await svg().locator('[data-observation="p2"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('tr[aria-selected=true]').filter({visible:true}).getAttribute('data-review-id'),'p2')
  const marks=await svg().locator('[data-observation="p2"]').evaluate(g=>{const rect=g.querySelector('rect').getBoundingClientRect(),corner=g.querySelector('circle'),m=corner.getScreenCTM(),p=new DOMPoint(corner.cx.baseVal.value,corner.cy.baseVal.value).matrixTransform(m);return {bounds:[rect.left,rect.top,rect.right,rect.bottom],vertex:[p.x,p.y],label:g.querySelector('text').textContent,polyline:g.querySelector('polyline').getAttribute('points')}})
  const expected=[info.tl[0]+(info.br[0]-info.tl[0])*.6,info.tl[1]+(info.br[1]-info.tl[1])*.2,info.tl[0]+(info.br[0]-info.tl[0])*.9,info.tl[1]+(info.br[1]-info.tl[1])*.8]
  marks.bounds.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1,'bbox matches the photo'));marks.vertex.forEach((n,i)=>assert.ok(Math.abs(n-info.vertex[i])<1,'corner matches the photo'));assert.equal(marks.label,'p2');assert.ok(marks.polyline.startsWith(`${f.width*.6},${f.height*.2}`),'polygon uses the same pixel coordinate system')
  // Keyboard and table selection must update the same overlay, without mutation.
  await svg().getByRole('button',{name:'识别零件 p1',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('tr[aria-selected=true]').filter({visible:true}).getAttribute('data-review-id'),'p1')
  await page.locator('[data-review-id="p2"]').filter({visible:true}).click();assert.equal(await svg().locator('[data-observation="p2"]').getAttribute('aria-pressed'),'true')
  return info
 }
 for(const viewport of [{width:1650,height:1050},{width:1100,height:800},{width:680,height:900}]){
  await page.setViewportSize(viewport)
  for(const f of fixtures){await openFixture(f);await inspect(f);await page.screenshot({path:`${out}/${f.name}-${viewport.width}.png`})}
 }
 // A resizable evidence pane must recompute its contain transform, too.
 await page.setViewportSize({width:1650,height:1050});await openFixture(fixtures[1]);const before=await svg().boundingBox(),separator=page.getByRole('separator',{name:'调整零件表与原图高度',exact:true});await separator.focus();for(let i=0;i<6;i++)await page.keyboard.press('ArrowUp');const after=await svg().boundingBox();assert.ok(after.height>before.height+10);await inspect(fixtures[1])
 const description=page.locator('.review-spatial-evidence-description').filter({visible:true});await description.locator('summary').click();assert.match(await description.innerText(),/Synthetic image/);await inspect(fixtures[1]);await description.locator('summary').click()
 // Exclusion, profile confirmation and persistence retain the original schema.
 await stage(page,'review','inspector');await field('排除实例（保留证据）').check();await stage(page,'review','workspace');assert.equal(await svg().locator('[data-observation="p2"]').getAttribute('opacity'),'0.35');await inspect(fixtures[1])
 await stage(page,'review','inspector');await field('排除实例（保留证据）').uncheck();await field('3D Review Profile').selectOption('square@1');await field('确认可见实例').check();await stage(page,'review','workspace');await button('保存 3D Review').click();await page.getByRole('status').filter({hasText:'3D Review 已保存'}).waitFor()
 const saved=(await api.dispatch('GET','visible3d/history')).reviews[0];assert.equal(saved.input.review.pieces.find(p=>p.id==='p2').profileId,'square');assert.deepEqual((await api.dispatch('GET','visible3d/analyses/'+fixtures[1].analysis.id)).analysis.evidence,fixtures[1].evidence)
 await page.reload();await page.waitForFunction(id=>document.querySelector('select[aria-label="3D Review 历史"]')?.value===id,saved.id);await inspect(fixtures[1])
 // Use the existing real photo/Observation record as an additional layout check.
 const sourceFiles=await readdir(path.join(official,'sources')),sources=await Promise.all(sourceFiles.filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(path.join(official,'sources',f),'utf8')))),real=sources.find(s=>s.name==='qisimiaoxiang_silengtai.png')??sources.find(s=>s.name==='qisimiaoxiang_square.png')
 let realPhoto=null
 if(real){
  const analyses=await Promise.all((await readdir(path.join(official,'visible3d/analyses'))).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(path.join(official,'visible3d/analyses',f),'utf8')))),a=analyses.find(a=>a.sourceId===real.id)
  if(a){await cp(path.join(official,'sources',real.id+'.json'),path.join(dir,'sources',real.id+'.json'));for(const h of new Set([real.originalHash,real.view.hash]))await cp(path.join(official,'assets',h+'.json'),path.join(dir,'assets',h+'.json'));await cp(path.join(official,'visible3d/analyses',a.id+'.json'),path.join(dir,'visible3d/analyses',a.id+'.json'));await page.reload();await openFixture({source:real,analysis:a});const bounds=await svg().evaluate(s=>{const m=s.getScreenCTM(),v=s.viewBox.baseVal,b=s.getBoundingClientRect(),p=new DOMPoint(v.width,v.height).matrixTransform(m);return {bottom:p.y,right:p.x,limitBottom:b.bottom,limitRight:b.right}});assert.ok(bounds.bottom<=bounds.limitBottom+1&&bounds.right<=bounds.limitRight+1);await page.screenshot({path:out+'/real-photo.png'});realPhoto=real.name}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.ok(calls.every(c=>c.method==='GET'||c.route==='visible3d/reviews'))
 const result={passed:true,shapes:fixtures.map(f=>f.name),widths:[1650,1100,680],checks:'full contain / no image overflow / normalized clicks / bbox, polygon, vertex and label / keyboard, table, exclusion and profile Review / pane resize / save and refresh',realPhoto,paidCalls:0,productionWrites:0,errors,consoleErrors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

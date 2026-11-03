// Isolated real HTTP + Chrome/WebGL test. No model requests or personal data writes.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {mkdtemp,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {selectedProject} from '../test/magnetic-selected-project-fixture.mjs'
import {selectFixture} from '../test/magnetic-selected-fixture.mjs'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {moduleStep} from '../src/magnetic-tiles/three-d/module-transform.ts'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-gallery-browser-'))
const out='/tmp/magnetic-gallery-browser',api=createMagneticIntake(dir),f=await selectedProject(api),calls=[],errors=[]
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
    if(req.method!=='GET'&&route!=='gallery/publish'&&!['assembly3d/save',].includes(route))throw Error('No model calls or unrelated writes in Gallery test: '+route)
    let raw='';for await(const chunk of req)raw+=chunk
    res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{},{request:req})))
   }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
  })
 }}]})
 await server.listen()
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/`
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'magnetic-gallery.html');await page.getByText('还没有作品。请从家长制作入口保存作品，再加入 Gallery。').waitFor()
 // Opening the Studio uses a separate working draft; Gallery will never replace it.
 await page.addInitScript(({front})=>{
  if(sessionStorage.getItem('gallery-seeded'))return
  localStorage.setItem('magnetic-studio.mode.v1','3d')
  localStorage.setItem('magnetic-visible3d-context.v1',JSON.stringify({sourceId:front.project.id}))
  localStorage.setItem('magnetic-tiles.assembly3d-draft.v1',JSON.stringify(front.snapshot.assembly))
  localStorage.setItem('magnetic-tiles.assembly3d-origin.v1',JSON.stringify(front.snapshot.photoOrigin))
  localStorage.setItem('magnetic-tiles.assembly3d-saved-ref.v1',JSON.stringify({id:front.assembly.id,hash:front.hash,projectId:front.project.id}))
  sessionStorage.setItem('gallery-seeded','yes')
 },{front})
 await page.goto(base+'magnetic-tiles.html?stage=assembly&sourceId='+f.source.id)
 const studioAdd=page.getByRole('link',{name:'Add to Gallery Front',exact:true});await studioAdd.waitFor()
 const sourceUrl=await studioAdd.getAttribute('href');assert.ok(sourceUrl.includes('version='+front.version));assert.ok(sourceUrl.includes('hash='+front.hash))
 await page.getByRole('link',{name:'我的作品集 ↗',exact:true}).waitFor()
 // Follow the same saved-reference link, without leaving popup ownership behind.
 await page.goto(new URL(sourceUrl,base).href)
 await page.getByLabel('作品描述',{exact:true}).fill('我的小房子')
 await page.getByRole('button',{name:'加入 Gallery',exact:true}).click()
 await page.waitForURL(/magnetic-gallery\.html\?id=/)
 await page.locator('canvas').waitFor()
 assert.equal(await page.getByRole('alert').count(),0)
 const firstId=new URL(page.url()).searchParams.get('id'),firstUrl=page.url()
 for(const [record,description] of [[back,'花园'],[combinedSaved,'房子和花园的组合']]){
  await page.goto(base+'magnetic-gallery.html?'+new URLSearchParams({mode:'add',assemblyId:record.assembly.id,version:String(record.version),hash:record.hash}))
  await page.getByLabel('作品描述',{exact:true}).fill(description)
  await page.getByRole('button',{name:'加入 Gallery',exact:true}).click();await page.waitForURL(/magnetic-gallery\.html\?id=/);await page.locator('canvas').waitFor()
 }
 await page.goto(base+'magnetic-gallery.html');await page.getByRole('link',{name:'打开作品：房子和花园的组合',exact:true}).waitFor()
 assert.equal(await page.locator('.gallery-card').count(),3)
 await page.screenshot({path:path.join(out,'gallery-desktop.png'),fullPage:true})
 // A new save must not retarget the card, even on reload.
 const changed=structuredClone(front.snapshot);changed.assembly.revision++;changed.assembly.pieces[0].color='#123456'
 const newer=await save(changed,front.hash);assert.ok(newer.version>front.version)
 await page.getByRole('link',{name:'打开作品：我的小房子',exact:true}).click();await page.waitForURL(firstUrl)
 await page.locator('canvas').waitFor();await page.reload();await page.locator('canvas').waitFor()
 const loaded=await page.evaluate(async id=>{const r=await fetch('/api/magnetic-intake/gallery/items/'+id);return r.json()},firstId)
 assert.deepEqual(loaded.assembly,front.snapshot.assembly);assert.deepEqual(loaded.item.assemblyRef,ref(front))
 assert.equal(await page.evaluate(()=>localStorage.getItem('magnetic-tiles.assembly3d-draft.v1')),JSON.stringify(front.snapshot.assembly))
 await page.getByRole('button',{name:'Fit to View',exact:true}).click()
 await page.screenshot({path:path.join(out,'assembly-desktop.png'),fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.goto(base+'magnetic-gallery.html')
 await page.getByRole('link',{name:'打开作品：我的小房子',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.screenshot({path:path.join(out,'gallery-mobile.png'),fullPage:true})
 await page.getByRole('link',{name:'打开作品：房子和花园的组合',exact:true}).click();await page.locator('canvas').waitFor()
 assert.equal(await page.getByRole('alert').count(),0)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.screenshot({path:path.join(out,'combined-mobile.png'),fullPage:true})
 assert.deepEqual(errors,[])
 assert.ok(calls.some(([method,route])=>method==='POST'&&route==='gallery/publish'))
 assert.ok(!calls.some(([method,route])=>method==='POST'&&/(generate|execute|plan|annotate)/.test(route)))
 console.log('PASS: Studio saved-version link; 3 publications; text grid; ordinary/Combined WebGL; pinned v1 after v2 save/reload; working draft unchanged; mobile layout; zero model calls. Screenshots: '+out)
}catch(e){
 if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(0,7000))}
 console.error({errors,calls});throw e
}finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

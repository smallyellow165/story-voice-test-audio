import {stage} from './magnetic-studio-browser.mjs'
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {canonicalProfileSnapshot} from '../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {combineAssemblySnapshots,moduleCenter} from '../src/magnetic-tiles/three-d/module-transform.ts'
import {createMoveObjectSearch} from '../src/magnetic-tiles/three-d/move-object-snap.ts'
import {validateAssembly3D} from '../src/magnetic-tiles/three-d/engine-adapter.ts'
import {OrthographicCamera,Vector3} from 'three'
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'object-snap-browser-')),out='/tmp/magnetic-move-object-snap',api=createMagneticIntake(dir),registry=await api.dispatch('GET','profiles'),profile=canonicalProfileSnapshot(registry.profiles.find(p=>p.id==='square'&&p.version===1))
const pose=(x,y=0,z=0)=>({position:[x,y,z],quaternion:[0,0,0,1]}),piece=(id,x,y=0)=>({id,profileId:'square',profileVersion:1,pose:pose(x,y),color:'#55b8ac'})
function sample(id,groupMoving=false,groupFixed=false,ambiguous=false,collision=false){
 const fixedX=groupMoving?0:.45
 const one=(id,pieces)=>({kind:'magnetic-assembly-3d',schemaVersion:1,id,revision:0,profiles:[profile],pieces,connections:pieces.length===2?[{pieceA:pieces[0].id,portA:'e1-p0',pieceB:pieces[1].id,portB:'e3-p0',dihedralDeg:0,flip:true}]:[]})
 let a
 if(groupMoving||groupFixed){
  const fixed=one('parent-a',groupFixed?(ambiguous?[piece('fixed',fixedX),piece('fixed-right',fixedX+1)]:[piece('fixed',fixedX)]):[piece('parked-a',-3,3)])
  const moving=one('parent-b',groupMoving?[piece('moving',.9,-1),piece('member',1.9,-1)]:[piece('parked-b',4,3)])
  const parent=id=>({id,version:1,revision:0,hash:'a'.repeat(64),snapshotHash:'b'.repeat(64)})
  a=combineAssemblySnapshots(id,[{name:'Fixed Group',parent:parent('a'),assembly:fixed},{name:'Moving Group',parent:parent('b'),assembly:moving}])
  if(!groupFixed)a.pieces.push(piece('fixed',fixedX));if(!groupMoving)a.pieces.push(piece('moving',.9,-1))
 }else a=one(id,[piece('fixed',fixedX),piece('moving',.9,-1)])
 // The ordinary pair has no existing connection, unlike the synthetic grouped parent.
 if(!groupMoving&&!groupFixed)a.connections=[]
 if(collision)a.pieces.push(piece('obstacle',fixedX,-1))
 const movingId=groupMoving?a.modules[1].pieces[0].id:'moving',fixedId=groupFixed?a.modules[0].pieces[0].id:'fixed',scope=groupMoving?{kind:'group',groupId:'module-1'}:{kind:'tile',tileId:movingId}
 return {a,movingId,fixedId,scope,groupMoving,fixedX}
}
let browser,page,server
const errors=[],calls=[]
try{
 await mkdir(out,{recursive:true});server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'vite'),server:{host:'127.0.0.1',port:0},plugins:[{name:'object-snap-read-only-api',configureServer(s){s.middlewares.use('/favicon.ico',(_q,r)=>{r.statusCode=204;r.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{calls.push([req.method,req.url]);if(req.method!=='GET'){res.statusCode=403;res.end('No writes or models');return}try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch('GET',req.url.slice(1).split('?')[0])))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})}}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1840,height:1100},acceptDownloads:true});page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>(n==='Move Object Snap'?page.getByRole('checkbox',{name:n,exact:true}):page.getByLabel(n,{exact:true})).filter({visible:true}),canvas=()=>page.locator('.magnetic-3d-editor-canvas canvas').filter({visible:true}),panel=()=>page.getByRole('region',{name:'Move Object Snap',exact:true})
 async function until(fn){for(let i=0;i<250;i++){if(await fn())return;await page.waitForTimeout(40)}throw Error('UI did not settle')}
 async function frames(){await page.locator('.studio-workspace').evaluate(e=>e.scrollTop=0);await page.evaluate(()=>new Promise(resolve=>{let n=0;const tick=()=>++n===6?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick)}))}
 async function jsonOpen(){const d=page.locator('.magnetic-3d-load');if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function exported(){await jsonOpen();const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 async function load(f){await jsonOpen();await field('Assembly3D JSON').fill(JSON.stringify(f.a));await button('加载 JSON').click();await button('Edit Draft').click();await frames();if(f.groupMoving){await button('Group').click();await field('当前 Group').selectOption('module-1')}else{if(f.a.modules)await button('Tile').click();await page.locator(`[data-3d-piece="${f.movingId}"]`).click()}await button('Move').click();await field('Move Object Snap').check();await field('Move 拖拽约束').selectOption('X');await field('Move Grid Snap').uncheck();await field('Object Snap 验证模式').selectOption('strict');await button('Fit to View').click();await page.waitForTimeout(300);await button('前').click();await frames();assert.deepEqual(await exported(),f.a)}
 async function screen(v){const state=JSON.parse(await page.getByLabel('3D Editor 相机状态',{exact:true}).textContent()),f=state.frustum,c=new OrthographicCamera(f.left,f.right,f.top,f.bottom,f.near,f.far);c.position.fromArray(state.position);c.quaternion.fromArray(state.quaternion);c.zoom=state.zoom;c.updateProjectionMatrix();c.updateMatrixWorld(true);const p=v.clone().project(c),b=await canvas().boundingBox();return {x:b.x+(p.x+1)*b.width/2,y:b.y+(1-p.y)*b.height/2}}
 async function drag(f,{grid=false,cancel=false,far=false}={}){
  await field('Move Grid Snap').setChecked(grid);await field('Move 网格间距').fill('1');await field('Move 网格间距').blur();await frames()
  const origin=f.groupMoving?moduleCenter(f.a,'module-1'):new Vector3(...f.a.pieces.find(p=>p.id===f.movingId).pose.position),o=await screen(origin),end=await screen(origin.clone().add(new Vector3(far?1.4:-.7,0,0))),unit=await screen(origin.clone().add(new Vector3(1,0,0))),l=Math.hypot(unit.x-o.x,unit.y-o.y),d={x:(unit.x-o.x)/l,y:(unit.y-o.y)/l}
  for(const r of [35,-35,45,-45,55,-55,70,-70,85,-85,100,-100]){
   await page.mouse.move(o.x+d.x*r,o.y+d.y*r);await page.mouse.down();await page.mouse.move(o.x+d.x*r+end.x-o.x,o.y+d.y*r+end.y-o.y,{steps:14});await frames()
   const pos=await field('Move 世界位置').count()?(await field('Move 世界位置').getAttribute('data-position'))?.split(',').map(Number):null
   if(pos&&new Vector3(...pos).distanceTo(origin)>1e-5){
    assert.equal(Number(await page.locator('[data-workspace-revision]').getAttribute('data-workspace-revision')),f.a.revision,'live preview never commits')
    if(!far)assert.ok(await field('Object Snap 候选').count()>0,'nearby ports found with real mouse motion')
    if(cancel){await page.keyboard.press('Escape');await page.mouse.move(o.x+d.x*r+end.x-o.x+8,o.y+d.y*r+end.y-o.y,{steps:2})}
    await page.mouse.up();await frames();return
   }
   await page.mouse.up();await frames();if(f.groupMoving){await button('Group').click();await field('当前 Group').selectOption('module-1')}else{if(f.a.modules)await button('Tile').click();await page.locator(`[data-3d-piece="${f.movingId}"]`).click()}await button('Move').click();await button('前').click();await frames()
  }throw Error('Failed to drag Move Gizmo '+f.a.id)
 }
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`);await button('3D').click();await jsonOpen();await field('Assembly3D JSON').waitFor()
 for(const [i,[gm,gf]]of [[false,false],[false,true],[true,false],[true,true]].entries()){
  const f=sample('objects-'+i,gm,gf);await load(f);assert.equal(await field('Move Object Snap').isChecked(),true)
  await drag(f,{grid:true});const next=await exported();assert.equal(next.connections.length,f.a.connections.length+1);assert.equal(validateAssembly3D(next).valid,true);assert.equal(next.revision,f.a.revision+1)
  const ids=gm?new Set(f.a.modules[1].pieces.map(p=>p.id)):new Set([f.movingId]);assert.deepEqual(next.pieces.filter(p=>!ids.has(p.id)),f.a.pieces.filter(p=>!ids.has(p.id)));assert.deepEqual(next.connections.slice(0,f.a.connections.length),f.a.connections);assert.ok(Math.abs(next.pieces.find(p=>p.id===f.movingId).pose.position[0]-f.fixedX)<1e-8,'Object candidate overrides coarse world grid 1 without moving Fixed')
  await button('3D Undo').click();assert.deepEqual(await exported(),f.a);await button('3D Redo').click();assert.deepEqual(await exported(),next);await button('保存 3D Draft').click();await page.reload();await button('Edit Draft').click();assert.deepEqual(await exported(),next)
  console.log('PASS native Object Snap',gm?'Group':'Tile','->',gf?'Group':'Tile','Grid priority / Undo / save / refresh')
 }
 const ambiguous=sample('objects-ambiguous',true,true,true);await load(ambiguous);await drag(ambiguous);assert.deepEqual(await exported(),ambiguous.a);assert.equal(await field('Object Snap 候选').inputValue(),'');assert.equal(await button('确认对象吸附').isDisabled(),true)
 let options=await field('Object Snap 候选').locator('option').evaluateAll(es=>es.map(e=>({value:e.value,text:e.textContent})));const desired=options.find(o=>o.value&&JSON.parse(o.value).fixed.tileId===ambiguous.fixedId);await field('Object Snap 候选').selectOption(desired.value);await page.getByTestId('move-object-anchor').waitFor();await button('确认对象吸附').click();assert.equal((await exported()).connections.length,ambiguous.a.connections.length+1);console.log('PASS explicit ambiguous seam selection')
 const collision=sample('objects-collision',false,false,false,true);await load(collision);await drag(collision);assert.deepEqual(await exported(),collision.a)
 options=await field('Object Snap 候选').locator('option').evaluateAll(es=>es.map(e=>e.value));let chosen=options.find(v=>v&&JSON.parse(v).fixed.tileId===collision.fixedId&&JSON.parse(v).moving.portId==='e2-p0');await field('Object Snap 候选').selectOption(chosen);assert.equal(await button('确认对象吸附').isDisabled(),true);await panel().getByRole('alert').waitFor()
 await field('Object Snap 验证模式').selectOption('less-strict');await page.getByRole('status',{name:'Object Snap 碰撞 Warning',exact:true}).waitFor();assert.equal(await button('确认对象吸附').isEnabled(),true);assert.deepEqual(await exported(),collision.a);await panel().scrollIntoViewIfNeeded();await page.screenshot({path:out+'/warning.png'});await button('确认对象吸附').click();const invalid=await exported();assert.equal(invalid.connections.length,1);assert.equal(validateAssembly3D(invalid).valid,false);await button('Revalidate Geometry').click();assert.match(await page.locator('.magnetic-3d-summary').innerText(),/Geometry Invalid/);console.log('PASS Strict blocked; Less Strict explicit Warning confirmation')
 const cancel=sample('objects-cancel');await load(cancel);await drag(cancel,{cancel:true});assert.deepEqual(await exported(),cancel.a);assert.equal(await button('3D Undo').isDisabled(),true);console.log('PASS Escape cancels candidate and movement')
 const far=sample('objects-far');await load(far);await drag(far,{grid:true,far:true});const normal=await exported();assert.equal(normal.connections.length,0);assert.notDeepEqual(normal.pieces[1].pose,far.a.pieces[1].pose);assert.ok(Math.abs(normal.pieces[1].pose.position[0]-Math.round(normal.pieces[1].pose.position[0]))<1e-8);console.log('PASS no nearby Port falls back to Grid Move')
 for(const width of [1840,1100,680,430]){await page.setViewportSize({width,height:1100});await stage(page,'assembly','inspector');await panel().scrollIntoViewIfNeeded();assert.equal(await panel().evaluate(e=>e.scrollWidth>e.clientWidth+1),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:out+`/${width}.png`})}
 assert.deepEqual(errors,[]);assert.equal(calls.some(([method])=>method!=='GET'),false);await writeFile(out+'/result.json',JSON.stringify({passed:true,checks:['four combinations with native Gizmo input','automatic collision-free release + exactly one real Connection','Object Snap takes precedence over Grid without changing Fixed','explicit selection for competing shared seams','Strict refuses; Less Strict full Warning requires explicit confirm','Cancel and Escape; no target Grid fallback','Undo/Redo and exact save/reload; responsive layouts'],modelCalls:0,productionWrites:0,errors},null,2));console.log('PASS Move Object Snap browser: '+out)
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

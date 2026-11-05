// Real Editor / WebGL against disposable records only. No paid providers.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {selectedProject} from '../test/magnetic-selected-project-fixture.mjs'
import {selectFixture} from '../test/magnetic-selected-fixture.mjs'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {stage} from './magnetic-studio-browser.mjs'
import {OrthographicCamera,Vector3} from 'three'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'editor-toolbar-')),out='/tmp/magnetic-editor-toolbar'
let server,browser,page
try{
 await mkdir(out,{recursive:true});const api=createMagneticIntake(dir),f=await selectedProject(api),ref=r=>({id:r.assembly.id,version:r.version,hash:r.hash})
 async function parent(name){const p=f.plans[name][1],x=f.executions[name][1];await selectFixture(api,f.source.id,'plan',p);await selectFixture(api,f.source.id,'execution',x);const o=await api.dispatch('POST','visible3d/adopt',{executionId:x.id,executionHash:x.hash,candidateId:'candidate-1'});return api.dispatch('POST','assembly3d/save',{snapshot:{assembly:o.assembly,photoOrigin:{origin:o,assemblyRaw:serializeAssembly3D(o.assembly)},nonRepairable:[]},expectedHash:null})}
 const front=await parent('Front'),back=await parent('Back'),combined=await api.dispatch('POST','assembly3d/combine',{name:'Toolbar Combined',parents:[ref(front),ref(back)]})
 const redOrigin=JSON.parse(await readFile(path.join(root,'generated/magnetic-intake/visible3d/origins/8ea6bc12-0517-4bad-a1aa-253f3d26916c.json'),'utf8')),redId=randomUUID(),redAssembly={...structuredClone(redOrigin.assembly),id:'creation-'+redId}
 const red=await api.dispatch('POST','assembly3d/save-editor',{workspaceId:redId,assembly:redAssembly})
 const yellowOrigin=JSON.parse(await readFile(path.join(root,'generated/magnetic-intake/visible3d/origins/620a4363-6508-4b7c-9fa2-8b35663d9edf.json'),'utf8')),yellowId=randomUUID();
 const yellow=await api.dispatch('POST','assembly3d/save-editor',{workspaceId:yellowId,assembly:{...structuredClone(yellowOrigin.assembly),id:'creation-'+yellowId}});
 const items=[];for(const r of [red,front,combined,yellow])items.push((await api.dispatch('POST','gallery/publish',{description:'Isolated toolbar QA',assemblyRef:ref(r)})).item)
 const calls=[],errors=[]
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'editor-toolbar-qa',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{const route=req.url.slice(1).split('?')[0];calls.push([req.method,route]);try{if(req.method!=='GET'&&!route.startsWith('assembly3d/')&&route!=='library-image')throw Error('Unexpected write / model request: '+route);let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await api.dispatch(req.method,route,raw?JSON.parse(raw):{},{request:req})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})
 }}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1734,height:1100},acceptDownloads:true});page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 const base=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/`,url=item=>base+'magnetic-tiles.html?'+new URLSearchParams({workspace:'edit',galleryId:item.id,assemblyId:item.assemblyRef.id,version:String(item.assemblyRef.version),hash:item.assemblyRef.hash,stage:'assembly'})
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),toolbar=()=>page.getByRole('toolbar',{name:'3D Editor Toolbar',exact:true}),tool=n=>toolbar().getByRole('button',{name:n,exact:true})
 async function open(item){await page.goto(url(item));await stage(page,'assembly','workspace');await button('保存 3D Draft').waitFor();await page.waitForFunction(()=>document.querySelector('.magnetic-3d-editor-canvas canvas')?.width>200);await button('Edit Draft').click()}
 async function exported(){const d=page.locator('.magnetic-3d-load');if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click();const next=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await next).path(),'utf8'))}
 async function select(id){await page.locator(`[data-3d-piece="${id}"]`).click()}
 async function highlights(expected){await page.waitForFunction(ids=>JSON.stringify([...document.querySelectorAll('.magnetic-3d-editor-canvas [data-tile-label][data-selected="true"]')].map(e=>e.dataset.tileLabel).sort())===JSON.stringify(ids),[...expected].sort())}
 async function viewerClick(id){
  const state=JSON.parse(await page.getByLabel('3D Editor 相机状态',{exact:true}).textContent()),f=state.frustum,camera=new OrthographicCamera(f.left,f.right,f.top,f.bottom,f.near,f.far);camera.position.fromArray(state.position);camera.quaternion.fromArray(state.quaternion);camera.zoom=state.zoom;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const point=new Vector3(...redAssembly.pieces.find(p=>p.id===id).pose.position).project(camera),box=await page.locator('.magnetic-3d-editor-canvas canvas').boundingBox();await page.mouse.click(box.x+(point.x+1)*box.width/2,box.y+(1-point.y)*box.height/2);
 }
 async function symmetryButtons(preview,confirm,cancel){for(const [name,enabled]of [['预览补全',preview],['确认加入',confirm],['取消预览',cancel]]){assert.equal(await button(name).count(),1,name+' is always visible');assert.equal(await button(name).isEnabled(),enabled,name+' state')}}
 async function number(name,value){await field(name).fill(String(value));await field(name).press('Enter')}
 await open(items[0]);assert.equal(await tool('Copy').isDisabled(),true);assert.match(await tool('Copy').locator('..').getAttribute('title'),/选择 Tile/)
 assert.equal(await page.locator('.magnetic-3d-workspace h2').count(),0);assert.equal(await page.locator('.magnetic-3d-inspector').getByRole('button',{name:'Move',exact:true}).count(),0)
 const emptyHeight=(await page.locator('.magnetic-3d-assembly-actions').boundingBox()).height;assert.ok(emptyHeight<=105,'compact top <=105px')
 await select('r04');const original=await exported();const detail=page.getByRole('region',{name:'Selection Detail',exact:true}),currentTool=page.getByRole('region',{name:'Current Tool',exact:true});
 assert.equal(await detail.locator('h4').first().innerText(),'Selection Detail · r04');assert.equal(await detail.getByTestId('selection-size').innerText(),'1 × 1 × 0.06');assert.equal(await detail.getByTestId('selection-size').isVisible(),true);assert.equal(await page.locator('.assembly-edit-toolbar').count(),0);
 const order=await page.locator('.magnetic-3d-inspector > section, .magnetic-3d-inspector > details').evaluateAll(es=>es.slice(0,4).map(e=>e.getAttribute('aria-label')||e.querySelector('summary')?.textContent));assert.deepEqual(order,['Current Tool','Selection Detail','Edit Tools','Geometry Check']);
 await tool('Select').click();assert.equal(await tool('Select').getAttribute('aria-pressed'),'true');assert.equal(await field('3D 位置 X').count(),0)
 await tool('Move').click();assert.match(await currentTool.locator('h4').first().innerText(),/Move/);assert.equal(await currentTool.getByLabel('3D 位置 X',{exact:true}).isVisible(),true);await number('3D 位置 X',2);let changed=await exported();assert.equal(changed.pieces.find(p=>p.id==='r04').pose.position[0],2);await button('3D Undo').click()
 await select('r04');await tool('Rotate').click();assert.equal(await currentTool.getByLabel('3D 旋转 Z',{exact:true}).isVisible(),true);await number('3D 旋转 Z',15);changed=await exported();assert.notDeepEqual(changed.pieces.find(p=>p.id==='r04').pose.quaternion,original.pieces.find(p=>p.id==='r04').pose.quaternion);await button('3D Undo').click()
 await select('r04');await tool('Orient').click();await button('所选面朝上').click();assert.notDeepEqual((await exported()).pieces.find(p=>p.id==='r04').pose,original.pieces.find(p=>p.id==='r04').pose);await button('3D Undo').click()
 await select('r04');await tool('Snap').click();await field('3D 吸附方式').selectOption('click');await field('3D 自身端口 B').waitFor();await tool('Select').click();assert.equal(await field('3D 自身端口 B').count(),0);await tool('Snap').click();await field('3D 吸附方式').selectOption('drag')
 assert.ok(Math.abs((await page.locator('.magnetic-3d-assembly-actions').boundingBox()).height-emptyHeight)<1,'no tool/selection layout jump')
 await tool('Copy').click();const copied=await exported(),newPiece=copied.pieces.find(p=>!original.pieces.some(o=>o.id===p.id));assert.equal(copied.pieces.length,12);assert.equal(copied.connections.length,16);assert.equal(newPiece.pose.position[0],2)
 await field('3D 目标零件 A').selectOption('r06');await field('3D 自身端口 B').selectOption('e3-p0');await field('3D 目标端口 A').selectOption('e1-p0');await field('新连接二面角').fill('0');await field('新连接 flip').check();
 await button('预览吸附').click();await button('取消吸附').click();assert.deepEqual(await exported(),copied);await button('预览吸附').click();await button('确认吸附').click();assert.equal((await exported()).connections.length,17);await button('3D Undo').click();await select(newPiece.id);
 await tool('Delete').click();assert.equal((await exported()).pieces.length,11);await button('3D Undo').click();assert.equal((await exported()).pieces.length,12);await button('3D Redo').click();assert.equal((await exported()).pieces.length,11)
 await tool('对称补全').click();assert.equal(await currentTool.getByRole('region',{name:'Symmetry Fill',exact:true}).count(),1);assert.equal(await page.getByRole('region',{name:'Symmetry Fill',exact:true}).count(),1);await symmetryButtons(false,false,false);assert.match(await button('确认加入').locator('..').getAttribute('title'),/先预览/);await field('对称来源 r10').check();await symmetryButtons(false,false,false);await field('对称来源 r10').uncheck();for(const id of ['r01','r02','r03','r04','r05','r06'])await field('对称来源 '+id).check()
 await symmetryButtons(true,false,false);
 const six=['r01','r02','r03','r04','r05','r06'],selectionBaseline=await exported();await highlights(six);
 await select('r10');await highlights(six);assert.equal(await detail.locator('h4').first().innerText(),'Selection Detail · r10','focus does not replace sources');
 await field('对称来源 r01').uncheck();await highlights(six.filter(id=>id!=='r01'));
 await field('对称来源 r01').check();await highlights(six);
 await button('前').click();await page.waitForFunction(()=>{try{return JSON.parse(document.querySelector('[aria-label="3D Editor 相机状态"]').textContent).position[2]>5}catch{return false}});
 await viewerClick('r02');await page.waitForFunction(()=>!document.querySelector('[aria-label="对称来源 r02"]')?.checked);await highlights(six.filter(id=>id!=='r02'));assert.equal(await detail.locator('h4').first().innerText(),'Selection Detail · r02');
 await viewerClick('r02');await page.waitForFunction(()=>document.querySelector('[aria-label="对称来源 r02"]')?.checked);await highlights(six);
 await page.screenshot({path:out+'/symmetry-multi-highlight.png'});
 for(const id of six)await field('对称来源 '+id).uncheck();await highlights([]);assert.equal(await detail.locator('h4').first().innerText(),'Selection Detail · r02','empty source set retains focus without highlighting it');
 await button('关闭工具').click();await highlights(['r02']);await select('r03');await highlights(['r03']);
 await tool('对称补全').click();for(const id of six)await field('对称来源 '+id).check();await highlights(six);
 await select('r03');await highlights(six);await tool('Move').click();await highlights(['r03']);assert.deepEqual(await exported(),selectionBaseline,'source selection and focus never edit geometry or revision');
 await tool('对称补全').click();for(const id of six)await field('对称来源 '+id).check();await highlights(six);
 const actionLayout=()=>page.locator('.magnetic-symmetry-actions button').evaluateAll(es=>es.map(e=>[e.offsetLeft,e.offsetTop,e.offsetWidth,e.offsetHeight]));const buttonsBefore=await actionLayout();
 await button('预览补全').click();await page.getByTestId('symmetry-preview-summary').filter({hasText:'新增 6 片 · 12 条连接 · 总计 17 片'}).waitFor();assert.equal((await exported()).pieces.length,11);await symmetryButtons(false,true,true);assert.deepEqual(await actionLayout(),buttonsBefore);
 await button('取消预览').click();await symmetryButtons(true,false,false);assert.deepEqual(await actionLayout(),buttonsBefore);await highlights(six);
 await button('预览补全').click();await symmetryButtons(false,true,true);
 // Simulate another page changing only the origin binding in disposable storage.
 const conflict=await page.evaluate(()=>{const p=new URL(location.href).searchParams,key='magnetic-studio.workspace.v1.edit.'+p.get('galleryId')+'.'+p.get('hash')+'.magnetic-tiles.assembly3d-origin.v1',raw=localStorage.getItem(key),v=JSON.parse(raw);v.origin.hash='0'.repeat(64);localStorage.setItem(key,JSON.stringify(v));return {key,raw}});
 await button('确认加入').click();await page.getByRole('alert').filter({hasText:'照片来源已被其他页面更新'}).waitFor();await symmetryButtons(false,true,true);assert.equal(await tool('对称补全').getAttribute('aria-pressed'),'true');await highlights(six);assert.equal((await exported()).pieces.length,11);
 await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),conflict);
 await button('确认加入').click();let filled=await exported();assert.equal(filled.pieces.length,17);assert.equal(filled.connections.length,28);await symmetryButtons(false,false,false);assert.equal(await tool('对称补全').getAttribute('aria-pressed'),'true');assert.equal(await page.getByTestId('symmetry-source-count').innerText(),'来源 0 片');await highlights([]);assert.deepEqual(await actionLayout(),buttonsBefore);
 for(const id of ['r10','r11'])await field('对称来源 '+id).check();await symmetryButtons(true,false,false);await button('预览补全').click();await symmetryButtons(false,true,true);await button('确认加入').click();assert.equal((await exported()).pieces.length,19);assert.equal(await tool('对称补全').getAttribute('aria-pressed'),'true');await symmetryButtons(false,false,false);
 await button('3D Undo').click();assert.equal((await exported()).pieces.length,17);assert.equal(await tool('对称补全').getAttribute('aria-pressed'),'true');await button('3D Redo').click();assert.equal((await exported()).pieces.length,19);await button('3D Undo').click();assert.deepEqual(await exported(),filled);
 await button('3D Undo').click();assert.equal((await exported()).pieces.length,11);await button('3D Redo').click();assert.deepEqual(await exported(),filled)

 await button('Revalidate Geometry').click();await button('保存 3D Draft').click();await page.getByRole('status').filter({hasText:'3D Draft 已保存'}).waitFor();await page.reload();await stage(page,'assembly','workspace');await toolbar().waitFor();assert.equal((await exported()).pieces.length,17)
 await button('View').click();for(const name of ['Select','Move','Rotate','Orient','Snap','Copy','对称补全','Delete'])assert.equal(await tool(name).isDisabled(),true)
 await button('Edit Draft').click();await tool('Select').click();assert.equal(await tool('Select').isEnabled(),true)
 for(const width of [1734,1100,680]){await page.setViewportSize({width,height:1100});await stage(page,'assembly','workspace');const rects=await toolbar().locator('button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().y));assert.ok(rects.every(y=>Math.abs(y-rects[0])<1),'toolbar stays on one row');assert.ok((await page.locator('.magnetic-3d-assembly-actions').boundingBox()).height<=115);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:out+`/toolbar-${width}.png`})}
 await page.setViewportSize({width:1734,height:1100});await open(items[2]);assert.equal(await tool('Copy').isDisabled(),true);assert.match(await tool('对称补全').locator('..').getAttribute('title'),/Group/)
 await field('当前 Group').selectOption('module-1');assert.equal(await detail.locator('h4').first().innerText(),'Selection Detail · Back');assert.equal(await detail.getByTestId('selection-size').isVisible(),true);const groupBaseline=await exported(),ids=new Set(groupBaseline.modules[1].pieces.map(p=>p.id)),fixed=groupBaseline.pieces.filter(p=>!ids.has(p.id));await highlights([...ids])
 await tool('Move').click();await field('模块轴').selectOption('x');await field('模块位移').fill('2');await button('移动 Group').click();const moved=await exported();assert.deepEqual(moved.pieces.filter(p=>!ids.has(p.id)),fixed);for(const p of moved.pieces.filter(p=>ids.has(p.id)))assert.ok(Math.abs(p.pose.position[0]-groupBaseline.pieces.find(o=>o.id===p.id).pose.position[0]-2)<1e-9);await button('3D Undo').click();assert.deepEqual(await exported(),groupBaseline)
 await field('当前 Group').selectOption('module-1');await tool('Rotate').click();await field('模块旋转角度').fill('15');await button('旋转 Group').click();assert.notDeepEqual((await exported()).pieces,groupBaseline.pieces);await button('3D Undo').click()
 await field('当前 Group').selectOption('module-1');await tool('Orient').click();await button('所选面朝上').waitFor();await tool('Snap').click();await field('模块 Snap 移动 Port').waitFor();await tool('Select').click();assert.equal(await page.getByLabel('模块 Gizmo',{exact:true}).count(),0)
 await button('Tile').click();await select(groupBaseline.modules[0].pieces[0].id);assert.equal(await tool('Copy').isEnabled(),true);assert.equal(await tool('Delete').isDisabled(),true);assert.match(await tool('Delete').locator('..').getAttribute('title'),/Parent/)
 await open(items[1]);const sourceBaseline=await exported();await select(sourceBaseline.pieces[0].id);await tool('Move').click();await number('3D 位置 X',5);
 const aside=page.locator('.studio-panel-inspector');await aside.evaluate(e=>{e.style.width='280px';e.style.minWidth='280px';e.style.maxWidth='280px';e.style.flexBasis='280px'});await page.getByRole('button',{name:'View',exact:true}).filter({visible:true}).click();
 const grid=detail.locator('.assembly-property-grid').first();assert.equal((await grid.evaluate(e=>getComputedStyle(e).gridTemplateColumns)).split(' ').length,1);assert.equal(await detail.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);await page.screenshot({path:out+'/inspector-narrow.png'});
 await aside.evaluate(e=>{e.style.width='';e.style.minWidth='';e.style.maxWidth='';e.style.flexBasis=''});await button('Edit Draft').click();await button('重新加载来源').click();assert.deepEqual((await exported()).pieces,sourceBaseline.pieces)
 await open(items[3]);await tool('对称补全').click();await symmetryButtons(false,false,false);
 for(const [sources,total]of [[['y01','y02','y03','y04'],12],[['y07','y08'],14]]){
  for(const id of sources)await field('对称来源 '+id).check();await symmetryButtons(true,false,false);await highlights(sources);await button('预览补全').click();await symmetryButtons(false,true,true);await button('取消预览').click();await symmetryButtons(true,false,false);await button('预览补全').click();await button('确认加入').click();assert.equal((await exported()).pieces.length,total);await symmetryButtons(false,false,false);assert.equal(await tool('对称补全').getAttribute('aria-pressed'),'true');assert.equal(await page.getByTestId('symmetry-source-count').innerText(),'来源 0 片');
 }
 await page.screenshot({path:out+'/yellow-continuous-fill.png'});await button('保存 3D Draft').click();await page.getByRole('status').filter({hasText:'3D Draft 已保存'}).waitFor();await page.reload();await stage(page,'assembly','workspace');assert.equal((await exported()).pieces.length,14);
 assert.deepEqual(errors,[]);assert.equal(calls.some(([m,r])=>m==='POST'&&/\/(analyze|plan|execute)$/.test(r)),false)
 const report={passed:true,topHeight:emptyHeight,widths:[1734,1100,680],checks:['three persistent action buttons, fixed positions and reason tooltips; cancel/re-preview; failed confirmation retains context; red/yellow consecutive fills remain in tool; cleared sources/previews and Undo/Redo','Symmetry checkbox/viewer multi-highlight sync, independent focus, empty sources, exit cleanup and unchanged geometry','Current Tool first; single live tool panel; Selection Detail ID once and actual dimensions visible; narrow single column','Select + Move/Rotate/Orient/Snap Inspector controls','single Copy/Delete + Undo/Redo','red-pole six-source preview ->17 pieces/28 connections, Undo/Redo/save/reload','Group transform scope and disabled unsupported tools','View/Edit and source reload','one stable toolbar row, disabled hover reasons, no duplicate Inspector tools'],modelCalls:0,productionWrites:0,errors};await writeFile(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

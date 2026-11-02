// Isolated local UI + real server authorization; saved orange geometry is read-only.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {mkdtemp,mkdir,readFile,rm,writeFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-human-browser-')),out='/tmp/magnetic-human-collision-browser'
const official=path.join(root,'generated/magnetic-intake/visible3d/executions/21b18495-3ff3-4d5f-95d3-dc7902ea7cb7.json'),original=await readFile(official,'utf8'),orange=JSON.parse(original).diagnosticCandidates.find(c=>c.assembly.pieces.length===6).assembly
const api=createMagneticIntake(dir,{enableHumanReview:true}),errors=[],consoleErrors=[],calls=[]
let server,browser,page
try{
 await mkdir(out,{recursive:true})
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'vite-cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'isolated-human-review',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{calls.push([req.method,req.url]);try{res.setHeader('Content-Type','application/json');const route=req.url.slice(1).split('?')[0];if(req.method!=='GET'&&!route.startsWith('assembly3d-review/'))throw Object.assign(Error('No models/formal writes'),{statusCode:403});let body='';for await(const chunk of req)body+=chunk;res.end(JSON.stringify(await api.dispatch(req.method,route,body?JSON.parse(body):{},{request:req})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})}}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1660,height:1100},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});page.on('dialog',d=>d.accept())
 // Existing Draft storage and global mode, without introducing test-only application code.
 await page.addInitScript(a=>{if(!sessionStorage.getItem('human-test-seeded')){localStorage.setItem('magnetic-tiles.assembly3d-draft.v1',JSON.stringify(a,null,2));localStorage.setItem('magnetic-studio.mode.v1','3d');sessionStorage.setItem('human-test-seeded','yes')}},orange)
 const url=`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=assembly`
 const button=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}),field=n=>page.getByLabel(n,{exact:true}).filter({visible:true}),review=()=>page.getByRole('region',{name:'Collision Review',exact:true}),rows=()=>review().locator('tbody tr'),overlay=()=>page.locator('[data-collision-overlay]')
 async function until(fn){for(let i=0;i<160;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out waiting for UI state')}
 const approved=()=>page.getByTestId('human-collision-approved')
 async function progress(n){await until(async()=> (await page.getByTestId('collision-review-progress').innerText()).includes(`${n}/4`))}
 async function open(d){if(!await d.evaluate(e=>e.open))await d.locator(':scope>summary').click()}
 async function exportedAssembly(){await open(page.locator('.magnetic-3d-load'));const event=page.waitForEvent('download');await button('导出 Assembly3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 async function exportedTutorial(){await open(page.locator('.magnetic-tutorial-advanced'));await open(page.locator('.magnetic-tutorial-io'));const event=page.waitForEvent('download');await button('导出 Tutorial3D').click();return JSON.parse(await readFile(await(await event).path(),'utf8'))}
 async function acceptAll(){for(let i=0;i<4;i++){const c=rows().nth(i).getByRole('checkbox',{name:/^接受碰撞 /});await until(()=>c.isEnabled());if(!await c.isChecked()){await c.click();await progress(i+1)}}await until(()=>button('批准当前作品').isEnabled())}
 await page.goto(url);await review().waitFor();assert.equal(await rows().count(),4);await progress(0);assert.equal(await button('批准当前作品').isDisabled(),true)
 // Selecting/focusing all four exact overlap volumes never accepts a collision.
 for(let i=0;i<4;i++){await rows().nth(i).locator('td').first().click();await overlay().waitFor({state:'attached'});assert.equal(await overlay().getAttribute('data-collision-kind'),'volume');assert.match(await overlay().textContent(),/0.015/);await button('聚焦碰撞').click();assert.equal(await rows().nth(i).getByRole('checkbox',{name:/^接受碰撞 /}).isChecked(),false);await button('取消碰撞选择').click();assert.equal(await overlay().count(),0)}
 await rows().nth(0).getByRole('checkbox',{name:/^接受碰撞 /}).click();await progress(1);assert.equal(await overlay().count(),0,'acceptance does not select collision')
 for(let i=1;i<3;i++){await until(()=>rows().nth(i).getByRole('checkbox',{name:/^接受碰撞 /}).isEnabled());await rows().nth(i).getByRole('checkbox',{name:/^接受碰撞 /}).click();await progress(i+1)}assert.equal(await button('批准当前作品').isDisabled(),true)
 await until(()=>rows().nth(3).getByRole('checkbox',{name:/^接受碰撞 /}).isEnabled());await rows().nth(3).getByRole('checkbox',{name:/^接受碰撞 /}).click();await progress(4);await until(()=>button('批准当前作品').isEnabled());await button('批准当前作品').click();await approved().waitFor();assert.match(await review().innerText(),/Geometry Invalid \+ Human Approved/);assert.deepEqual(await exportedAssembly(),orange)
 await button('Edit Draft').click();await page.reload();await approved().waitFor();await progress(4);assert.deepEqual(await exportedAssembly(),orange)
 await button('Revalidate Geometry').click();await approved().waitFor();await progress(4)
 // Native BuildOrder and Player: six steps, final strict Invalid preserved.
 await page.locator('[data-stage="build"]').click();await until(()=>button('生成搭建教程').isEnabled());await button('生成搭建教程').click();await page.getByTestId('tutorial-player').waitFor();const tutorial=await exportedTutorial();assert.equal(tutorial.steps.length,6);assert.deepEqual(tutorial.assembly,orange);assert.ok(tutorial.source.humanCollisionApproval)
 assert.match(await page.getByTestId('tutorial-validation').innerText(),/Invalid \+ Human Approved/)
 await button('下一步').click();assert.match(await page.getByTestId('tutorial-progress').innerText(),/2 \/ 6/);await button('上一步').click();await button('自动播放').click();await until(()=>button('暂停').count());await button('暂停').click();await button('重新开始').click();assert.match(await page.getByTestId('tutorial-progress').innerText(),/1 \/ 6/)
 await button('保存教程').click();await until(async()=> (await page.getByTestId('tutorial-save-status').innerText()).includes('已保存'));await page.reload();await page.getByTestId('tutorial-player').waitFor();assert.deepEqual(await exportedTutorial(),tutorial);await button('打开教程').click();assert.deepEqual(await exportedTutorial(),tutorial)
 assert.equal((await readdir(path.join(dir,'assembly3d-review','tutorials'))).length,1,'formal human-approved save is checked and persisted server-side')
 // Undo back to byte-identical snapshot MUST NOT resurrect authorization.
 await page.locator('[data-stage="assembly"]').click();await button('Edit Draft').click();await page.locator('[data-3d-piece="tile1"]').click();const x=Number(await field('3D 位置 X').inputValue());await field('3D 位置 X').fill(String(x+.1));await field('3D 位置 X').press('Enter');assert.equal(await approved().count(),0);await button('3D Undo').click();await progress(0);assert.deepEqual(await exportedAssembly(),orange);assert.equal(await approved().count(),0)
 await button('Revalidate Geometry').click();await progress(0);await until(()=>rows().nth(0).getByRole('checkbox',{name:/^接受碰撞 /}).isEnabled());assert.equal(await button('批准当前作品').isDisabled(),true)
 await page.locator('[data-stage="build"]').click();assert.equal(await button('重新生成教程').isDisabled(),true);assert.equal(await page.getByTestId('tutorial-player').count(),0);assert.equal(await button('保存教程').isDisabled(),true)
 await page.locator('[data-stage="assembly"]').click();await acceptAll();await button('批准当前作品').click();await approved().waitFor();await button('保存 3D Draft').click();await page.reload();await approved().waitFor();await progress(4)
 // Normal geometry gate is unchanged; unknown/connection errors cannot be approved.
 await button('Edit Draft').click();await page.locator('[data-3d-connection="0"]').first().click();const angle=field('3D 连接二面角');
 // Detail label discovery is tied to the existing Connection form, not a new editor.
 if(await angle.count()){await angle.fill('20');await angle.press('Tab')}else{await page.locator('[data-3d-piece="tile1"]').click();await field('3D 位置 X').fill(String(x+.2));await field('3D 位置 X').press('Enter')}
 await until(async()=>!await approved().count());assert.equal(await button('批准当前作品').isDisabled(),true);assert.ok(await review().getByText('存在结构性、未知或不可定位错误，不能批准当前作品。',{exact:true}).count());assert.equal(await rows().first().getByRole('checkbox',{name:/^接受碰撞 /}).isDisabled(),true)
 await button('3D Undo').click();await progress(0);await until(()=>rows().nth(0).getByRole('checkbox',{name:/^接受碰撞 /}).isEnabled());await acceptAll();await button('批准当前作品').click();await approved().waitFor()
 // A saved Draft may be older than an unsaved server review head after a crash.
 // Explicit Revalidate/CAS can start a fresh review; loading alone cannot restore approval.
 await page.locator('[data-3d-piece="tile1"]').click();await field('3D 位置 X').fill(String(x+.1));await field('3D 位置 X').press('Enter');await until(async()=>!(await review().getByText('正在提交审核，请稍候。',{exact:true}).count()));await page.reload();await review().getByRole('alert').filter({hasText:'服务端作品已被其他页面更新'}).waitFor();assert.equal(await approved().count(),0);await button('Revalidate Geometry').click();await progress(0);await until(()=>rows().nth(0).getByRole('checkbox',{name:/^接受碰撞 /}).isEnabled());await acceptAll();await button('批准当前作品').click();await approved().waitFor();
 // Unchecking is a new server transaction and revokes the permission immediately.
 await rows().nth(0).getByRole('checkbox',{name:/^接受碰撞 /}).click();await progress(3);assert.equal(await approved().count(),0);assert.equal(await button('批准当前作品').isDisabled(),true);await until(()=>rows().nth(0).getByRole('checkbox',{name:/^接受碰撞 /}).isEnabled());await rows().nth(0).getByRole('checkbox',{name:/^接受碰撞 /}).click();await progress(4);await until(()=>button('批准当前作品').isEnabled());await button('批准当前作品').click();await approved().waitFor();
 for(const width of [1660,1100,680]){await page.setViewportSize({width,height:1000});if(width<761)await button('检查器').click();await review().scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);assert.equal(await review().evaluate(e=>e.scrollWidth>e.clientWidth+2),false);await page.screenshot({path:`${out}/review-${width}.png`})}
 await page.setViewportSize({width:1660,height:1100});await rows().first().locator('td').first().click();await button('聚焦碰撞').click();await page.screenshot({path:out+'/approved-overlap.png'})
 assert.equal(await readFile(official,'utf8'),original);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.ok(calls.every(([m,r])=>m==='GET'||r.startsWith('/assembly3d-review/')))
 const result={passed:true,orange:'4 collision rows; independent selection/acceptance; 0–4/4; explicit approval; strict Invalid preserved',build:'real 6-step plan, Player controls, server-checked save, reload/open',lifecycle:'unchanged Revalidate preserves; edit+Undo revokes; unapproved saved Tutorial cannot play/save; explicit stale saved-Draft recovery; uncheck revokes; re-review works; structural errors blocked',widths:[1660,1100,680],apiCalls:calls.length,modelCalls:0,productionWrites:0,errors,consoleErrors};await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

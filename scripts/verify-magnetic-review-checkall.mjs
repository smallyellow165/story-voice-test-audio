// Isolated, offline 3D Review test; no production writes or provider calls.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {multiFixture} from '../test/magnetic-multi-image-fixtures.mjs'
import {stage} from './magnetic-studio-browser.mjs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(path.join(tmpdir(),'review-checkall-')),f=await multiFixture(dir),workspaceId=randomUUID(),errors=[]
let browser,server,page
function rename(v){if(typeof v==='string')return v.replace(/^(base|wall)(?=:|$)/,x=>'r-'+x);if(Array.isArray(v))return v.map(rename);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rename(x)]));return v}
try{
 const evidence=rename(f.evidence);evidence.observations.push({...structuredClone(evidence.observations[0]),id:'other',imageEvidence:evidence.observations[0].imageEvidence.filter(e=>e.imageId===f.source.primaryImageId)})
 const analysis=await f.api.dispatch('POST','visible3d/annotate',{sourceId:f.source.id,evidence})
 await f.api.dispatch('POST','visible3d/selected',{sourceId:f.source.id,stage:'analysis',id:analysis.id,hash:analysis.hash,expectedRevision:0})
 const before=JSON.stringify(await f.api.dispatch('GET','visible3d/analyses/'+analysis.id))
 server=await createServer({configFile:false,root,cacheDir:path.join(dir,'cache'),base:'/story-voice-test-audio/',server:{host:'127.0.0.1',port:0},plugins:[{name:'offline-checkall',configureServer(s){s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()});s.middlewares.use('/api/magnetic-intake',async(req,res)=>{try{const route=req.url.slice(1).split('?')[0];if(req.method==='POST'&&!['visible3d/workspace-history','library-image'].includes(route))throw Error('Unexpected write or provider call: '+route);let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await f.api.dispatch(req.method,route,raw?JSON.parse(raw):{})))}catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}})}}]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(({workspaceId,sourceId,analysis})=>{const p='magnetic-studio.workspace.v1.create.'+workspaceId+'.';if(!localStorage.getItem(p+'history')){localStorage.setItem(p+'history',JSON.stringify({refs:[{id:analysis.id,hash:analysis.hash}],requestIds:[]}));localStorage.setItem(p+'magnetic-visible3d-context.v1',JSON.stringify({sourceId}))}},{workspaceId,sourceId:f.source.id,analysis})
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?workspace=create&workspaceId=${workspaceId}&stage=review`);await stage(page,'review','workspace')
 const table=page.locator('.review-parts-table'),header=table.getByLabel('全选当前筛选结果',{exact:true}),row=id=>table.getByLabel('显示证据 '+id,{exact:true}),button=name=>page.getByRole('button',{name,exact:true}).filter({visible:true}),popup=page.getByRole('dialog',{name:'Observation ID 筛选',exact:true})
 const rows=()=>table.locator('tbody tr').evaluateAll(es=>es.map(e=>e.dataset.reviewId)),mixed=()=>header.evaluate(e=>e.indeterminate)
 async function filter(value){await button('筛选 Observation ID').click();await popup.getByLabel('Observation ID 筛选文本',{exact:true}).fill(value);await popup.getByRole('button',{name:'Apply',exact:true}).click()}
 await row('other').waitFor();assert.deepEqual(await rows(),['r-base','r-wall','other']);assert.equal(await header.isChecked(),true)
 // Changing ordinary filters while in automatic-selection mode retains marks.
 await page.getByLabel('搜索审核零件',{exact:true}).fill('r-base');assert.deepEqual(await rows(),['r-base']);await page.getByLabel('搜索审核零件',{exact:true}).fill('');assert.equal(await row('r-wall').isChecked(),true);assert.equal(await row('other').isChecked(),true)
 await page.getByLabel('当前证据图片',{exact:true}).selectOption(f.source.images[1].sourceId);assert.equal(await row('other').isChecked(),false,'active-image auto sync remains available');await page.getByLabel('当前证据图片',{exact:true}).selectOption(f.source.images[0].sourceId);assert.equal(await row('other').isChecked(),true)
 await button('清空勾选').click();await row('other').check();await filter('r-');assert.deepEqual(await rows(),['r-base','r-wall']);assert.equal(await header.isChecked(),false);assert.equal(await mixed(),false)
 await row('r-base').check();assert.equal(await header.isChecked(),false);assert.equal(await mixed(),true)
 await header.check();assert.equal(await row('r-base').isChecked(),true);assert.equal(await row('r-wall').isChecked(),true);assert.equal(await header.isChecked(),true);assert.equal(await mixed(),false)
 await header.uncheck();assert.equal(await row('r-base').isChecked(),false);assert.equal(await row('r-wall').isChecked(),false)
 await filter('missing');assert.deepEqual(await rows(),[]);assert.equal(await header.isDisabled(),true);assert.equal(await mixed(),false)
 await filter('');assert.deepEqual(await rows(),['r-base','r-wall','other']);assert.equal(await row('other').isChecked(),true,'hidden selection survives check and uncheck');assert.equal(await row('r-base').isChecked(),false);assert.equal(await row('r-wall').isChecked(),false);assert.equal(await mixed(),true)
 await row('r-wall').check();await filter('r-');assert.equal(await mixed(),true);await page.getByLabel('搜索审核零件',{exact:true}).fill('r-base');assert.deepEqual(await rows(),['r-base']);assert.equal(await header.isChecked(),false);assert.equal(await mixed(),false,'hidden checked rows do not affect header')
 await page.getByLabel('搜索审核零件',{exact:true}).fill('');assert.equal(await mixed(),true)
 const statuses=page.getByRole('group',{name:'Review 统计与筛选'});await statuses.getByRole('button',{name:/^Known /}).click();assert.deepEqual(await rows(),[]);assert.equal(await header.isDisabled(),true);await statuses.getByRole('button',{name:/^Unknown /}).click();assert.deepEqual(await rows(),['r-base','r-wall']);assert.equal(await mixed(),true)
 await button('图片 4/4 ▾').click();const images=page.getByRole('dialog',{name:'Review 图片筛选',exact:true});await images.getByRole('button',{name:'清除图片',exact:true}).click();await images.getByRole('button',{name:'关闭图片筛选',exact:true}).click();assert.equal(await header.isDisabled(),true)
 await button('图片 0/4 ▾').click();await images.getByRole('button',{name:'全部图片',exact:true}).click();await images.getByRole('button',{name:'关闭图片筛选',exact:true}).click();assert.equal(await mixed(),true)
 await filter('');assert.equal(await row('other').isChecked(),true);assert.equal(await row('r-wall').isChecked(),true);assert.equal(await row('r-base').isChecked(),false)
 assert.equal(JSON.stringify(await f.api.dispatch('GET','visible3d/analyses/'+analysis.id)),before);assert.equal((await f.api.dispatch('GET','visible3d/history')).reviews.length,0);assert.deepEqual(errors,[])
 console.log('PASS: visible-only header selection; hidden marks retained; all/none/mixed/empty states; ID/status/search/image filter composition; automatic-selection preservation; unchanged Review data; no model calls.')
}finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

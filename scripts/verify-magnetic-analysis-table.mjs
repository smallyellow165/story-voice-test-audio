// Actual Studio UI, disposable storage and intercepted provider. Never calls a model.
import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import {createServer} from 'vite'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {buildVisibleRequest} from '../server/magnetic-visible3d-vision.mjs'
import {sourceImages} from '../src/magnetic-tiles/intake/image-set.ts'
import {stage,studioMode} from './magnetic-studio-browser.mjs'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root=new URL('../',import.meta.url).pathname,dir=await mkdtemp(path.join(tmpdir(),'magnetic-analysis-table-')),out='/tmp/magnetic-analysis-table'
const api=createMagneticIntake(dir),errors=[],providerInputs=[],calls=[],layouts=[]
const workflow=createVisible3DWorkflow(path.join(dir,'visible3d'),{
 readSource:id=>api.dispatch('GET','sources/'+id),readImage:s=>api.dispatch('GET','image/'+s.id),
 readImages:s=>Promise.all(sourceImages(s).map(async e=>({...e,...await api.dispatch('GET','image/'+e.sourceId)}))),
 getRegistry:()=>api.dispatch('GET','profiles'),runModel:async(prepared,options,kind)=>{
  providerInputs.push({prepared,request:buildVisibleRequest(options.model,prepared,kind)})
  throw Error('离线测试停止：已检查请求元数据，未调用模型')
 }
})
let browser,server,page,currentSource=null
try{
 await mkdir(out,{recursive:true})
 server=await createServer({root,configFile:false,base:'/story-voice-test-audio/',cacheDir:path.join(dir,'cache'),server:{host:'127.0.0.1',port:0},plugins:[{name:'analysis-table-fixture',configureServer(s){
  s.middlewares.use('/favicon.ico',(_req,res)=>{res.statusCode=204;res.end()})
  s.middlewares.use('/api/magnetic-intake',async(req,res)=>{
   const route=req.url.slice(1).split('?')[0];calls.push([req.method,route])
   try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{}
    if(req.method==='POST'&&!['sources','source-sets','library-image','visible3d/analyze'].includes(route))throw Error('Unrelated writes forbidden')
    let value=route==='visible3d/analyze'?await workflow.dispatch(req.method,'analyze',body):await api.dispatch(req.method,route,body)
    if(route==='source-sets'&&req.method==='POST')currentSource=value
    if(route==='status'||route==='visible3d/status')value={...value,providers:{...value.providers,openai:true}}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))
   }catch(e){res.statusCode=e.statusCode??422;res.end(JSON.stringify({error:e.message}))}
  })
 } }]});await server.listen()
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 page=await browser.newPage({viewport:{width:1680,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/story-voice-test-audio/magnetic-tiles.html?stage=source`)
 await page.getByRole('group',{name:'Studio 工作模式',exact:true}).waitFor({state:'attached'});await studioMode(page,'3d');await stage(page,'source','inspector')
 const pane=()=>page.locator('.source-inspector:visible'),table=()=>pane().getByRole('table',{name:'本次 Analysis 图片',exact:true}),field=n=>pane().getByLabel(n,{exact:true})
 async function idle(){await page.waitForFunction(()=>![...document.querySelectorAll('.source-image-picker')].filter(e=>e.checkVisibility()).some(e=>e.querySelector('[role="status"]')))}
 async function change(n,value){const response=page.waitForResponse(r=>r.url().endsWith('/source-sets')&&r.request().method()==='POST');await field(n).selectOption(value);assert.equal((await response).status(),200);await idle()}
 async function menu(name){await pane().getByRole('button',{name:'更多操作 '+name,exact:true}).click();return page.getByRole('menu',{name:'图片操作 '+name,exact:true})}
 async function action(name,operation){const m=await menu(name),response=page.waitForResponse(r=>r.url().endsWith('/source-sets')&&r.request().method()==='POST');await m.getByRole('menuitem',{name:operation+' '+name,exact:true}).click();assert.equal((await response).status(),200);await idle();await m.waitFor({state:'hidden'})}

 const names=['car-1.png','car-2.png','car-3.png','car-all.png']
 await pane().getByRole('tab',{name:'服务器图片',exact:true}).click();await field('搜索服务器图片').fill('car-')
 for(const name of names.slice(0,2)){await Promise.all([page.waitForResponse(r=>r.url().endsWith('/source-sets')&&r.request().method()==='POST'),field('加入 '+name).click()]);await idle()}
 await pane().getByRole('tab',{name:'上传图片',exact:true}).click()
 const upload=page.waitForResponse(r=>r.url().endsWith('/source-sets')&&r.request().method()==='POST')
 await pane().getByTestId('intake-upload').setInputFiles(names.slice(2).map(n=>path.join(root,'public/test-images/maganetic',n)));await upload;await idle()
 assert.equal(await table().locator('tbody tr').count(),4)
 assert.deepEqual(await table().getByRole('columnheader').allTextContents(),['图片','角色','方向','备注','操作'])
 assert.equal(await pane().locator('.source-image-metadata, .source-set-list').count(),0)
 assert.equal(await pane().getByRole('button',{name:'上传磁力片图片',exact:true}).isDisabled(),true)
 assert.equal(await field('图片角色 car-1.png').isVisible(),true);assert.equal(await field('拍摄方向 car-1.png').isVisible(),true)
 assert.deepEqual(await field('图片角色 car-1.png').locator('option').allTextContents(),['Unknown','Final','Step','Alternate View'])
 assert.deepEqual(await field('拍摄方向 car-1.png').locator('option').allTextContents(),['Unknown','Front','Back','Left','Right','Top','Oblique'])

 await change('图片角色 car-all.png','Final');await change('图片角色 car-1.png','Step');await change('拍摄方向 car-1.png','Back')
 await change('图片角色 car-2.png','Alternate View');await change('拍摄方向 car-2.png','Left')
 const note='绿色斜坡展开；保持同一实例身份',saved=page.waitForResponse(r=>r.url().endsWith('/source-sets')&&r.request().method()==='POST')
 assert.equal(await field('图片备注 car-2.png').getAttribute('maxlength'),'500')
 await field('图片备注 car-2.png').fill(note);await field('图片备注 car-2.png').press('Tab');await saved;await idle()
 let m=await menu('car-1.png');assert.equal(await m.getByRole('menuitem',{name:'上移 car-1.png',exact:true}).isDisabled(),true)
 const beforeCancel=currentSource.id;await page.keyboard.press('Escape');assert.equal(currentSource.id,beforeCancel)
 m=await menu('car-all.png');assert.equal(await m.getByRole('menuitem',{name:'下移 car-all.png',exact:true}).isDisabled(),true);await page.keyboard.press('Escape')
 await action('car-3.png','上移');assert.deepEqual(currentSource.images.map(e=>e.name),['car-1.png','car-3.png','car-2.png','car-all.png'])
 await action('car-3.png','下移');assert.deepEqual(currentSource.images.map(e=>e.name),names)
 assert.equal(currentSource.primaryImageId,currentSource.images[3].sourceId,'Final rule is unchanged by table/order')
 assert.deepEqual(currentSource.images.map(e=>e.origin),['server','server','upload','upload'])
 assert.equal(currentSource.images[1].note,note)
 const source=currentSource;assert.equal(providerInputs.length,0,'editing/selection must not invoke a model')
 await pane().getByRole('button',{name:'查看 car-2.png',exact:true}).click()
 await stage(page,'source','workspace');assert.equal(await page.locator('.source-frame-strip:visible').getByRole('button',{name:/^2 · car-2.png/}).getAttribute('aria-pressed'),'true')
 await page.reload();await stage(page,'source','inspector');await field('图片备注 car-2.png').waitFor();assert.equal(await field('图片备注 car-2.png').inputValue(),note)
 assert.equal(await field('图片角色 car-all.png').inputValue(),'Final');assert.equal(await field('拍摄方向 car-1.png').inputValue(),'Back')
 assert.equal(await pane().getByRole('button',{name:'查看 car-2.png',exact:true}).getAttribute('aria-pressed'),'true')

 // Top-layer menus remain usable when the narrow table scrolls horizontally.
 for(const width of [1680,1100,680]){
  await page.setViewportSize({width,height:1000});await stage(page,'source','inspector');await table().scrollIntoViewIfNeeded()
  const layout=await table().evaluate(t=>({rowHeights:[...t.tBodies[0].rows].map(r=>r.getBoundingClientRect().height),tableWidth:t.getBoundingClientRect().width,scrollWidth:t.parentElement.scrollWidth,clientWidth:t.parentElement.clientWidth,inspectorOverflow:t.closest('.studio-inspector').scrollWidth-t.closest('.studio-inspector').clientWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth}))
  assert.ok(layout.rowHeights.every(h=>h<=42),JSON.stringify(layout));assert.ok(layout.inspectorOverflow<=2,JSON.stringify(layout));assert.ok(layout.pageOverflow<=2,JSON.stringify(layout));layouts.push({width,...layout})
  await pane().getByRole('button',{name:'更多操作 car-2.png',exact:true}).focus();await page.keyboard.press('Enter');m=page.getByRole('menu',{name:'图片操作 car-2.png',exact:true});await m.waitFor()
  const bounds=await m.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);assert.ok(bounds.y>=0&&bounds.y+bounds.height<=1000)
  await page.screenshot({path:`${out}/table-${width}.png`});await page.keyboard.press('Escape')
 }
 await page.setViewportSize({width:1680,height:1000});await stage(page,'source','inspector')
 // Exercise the real frontend request and server preparation, stopping before provider execution.
 await page.getByRole('button',{name:'Analyze Visible 3D（调用模型）',exact:true}).click()
 await page.getByText('Analysis Failed',{exact:true}).waitFor();assert.equal(providerInputs.length,1)
 const prepared=providerInputs[0].prepared
 assert.equal(prepared.source.id,source.id);assert.deepEqual(prepared.input.images,source.images)
 assert.deepEqual(prepared.images.map(({sourceId,role,direction,note})=>({sourceId,role,direction,note})),source.images.map(({sourceId,role,direction,note})=>({sourceId,role,direction,note})))
 const requestText=JSON.stringify(providerInputs[0].request);assert.ok(requestText.includes(note));assert.ok(requestText.includes('Alternate View'));assert.ok(requestText.includes('Back'))
 await action('car-3.png','移除');assert.deepEqual(currentSource.images.map(e=>e.name),['car-1.png','car-2.png','car-all.png']);assert.equal(currentSource.images[1].note,note)
 assert.equal(await pane().getByRole('button',{name:'上传磁力片图片',exact:true}).isEnabled(),true)
 await studioMode(page,'2d');await stage(page,'source','inspector');await pane().getByTestId('intake-upload').setInputFiles(path.join(root,'public/test-images/maganetic/car-1.png'))
 await table().getByRole('button',{name:'查看 car-1.png',exact:true}).waitFor();await idle();assert.equal(await table().locator('tbody tr').count(),1)
 await change('图片角色 car-1.png','Final');assert.equal(await field('图片角色 car-1.png').inputValue(),'Final')
 await studioMode(page,'3d');await stage(page,'source','inspector');await table().getByRole('button',{name:'查看 car-all.png',exact:true}).waitFor();assert.equal(await table().locator('tbody tr').count(),3)
 assert.deepEqual(errors,[])
 const result={passed:true,modelCalls:0,providerInterceptions:providerInputs.length,formalWrites:0,layouts,checks:['mixed sources','four-image limit','visible role/direction options','note blur save and max length','menu boundaries/Escape/keyboard','reorder preserves IDs and Final','thumbnail selection','refresh metadata/selection','actual Analysis request metadata','remove','2D shared picker and mode isolation']}
 await writeFile(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(e){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(e)+'\n'+await page.locator('body').innerText())}throw e}
finally{await browser?.close();await server?.close();await rm(dir,{recursive:true,force:true})}

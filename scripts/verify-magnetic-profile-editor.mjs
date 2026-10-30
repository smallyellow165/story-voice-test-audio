import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import {startMagneticSandbox} from './magnetic-sandbox.mjs'
import {stage,rightTab,studioButton} from './magnetic-studio-browser.mjs'
const sandbox=await startMagneticSandbox(),origin=sandbox.origin,url=origin+'/story-voice-test-audio/magnetic-tiles.html',out='/tmp/magnetic-profile-editor'
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1550,height:1000}}),errors=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
const json=async route=>(await fetch(origin+'/api/magnetic-intake/'+route)).json(),initial=await json('profiles'),historyBefore=await json('history')
const page=await context.newPage(),editor=p=>p.getByRole('region',{name:'参数化 Profile 编辑器',exact:true}),row=(p,key)=>p.locator(`[data-catalog-profile="${key}"]`)
const create=async(p,id,shape,dimensions)=>{
 await p.getByRole('button',{name:'新增 Profile',exact:true}).click();const e=editor(p)
 await e.getByLabel('Profile 名称',{exact:true}).fill(id);await e.getByLabel('Profile ID',{exact:true}).fill(id);await e.getByLabel('参数化形状',{exact:true}).selectOption(shape)
 const names={side:'边长',width:'宽',height:'高度',base:'底边',legA:'直角边 A',legB:'直角边 B'}
 for(const[k,v]of Object.entries(dimensions))await e.getByLabel(names[k],{exact:true}).fill(String(v))
 return e
}
await mkdir(out,{recursive:true})
try{
 await page.goto(url+'?stage=assembly&rightTab=catalog');await row(page,'square@1').waitFor()
 const fixtures=[['square',{side:1.2}],['rectangle',{width:1.3,height:.8}],['equilateral-triangle',{side:1.1}],['isosceles-triangle',{base:1,height:1.4}],['right-triangle',{legA:.9,legB:1.4}]]
 for(const [shape,dims]of fixtures){
  const id='acceptance-'+shape,e=await create(page,id,shape,dims),polygon=e.locator('polygon'),before=await polygon.getAttribute('points')
  assert.ok(before);assert.match(await e.getByTestId('profile-live-preview').innerText(),/角度/)
  const dim=e.locator('input[type=number]').first(),valid=await dim.inputValue();await dim.fill('0');assert.equal(await e.getByRole('button',{name:'保存 Profile',exact:true}).isDisabled(),true);await dim.fill(valid)
  if(shape==='isosceles-triangle'){assert.match(before,/0\.5,1\.4/);await page.screenshot({path:out+'/editor.png'})}
  await e.getByRole('button',{name:'保存 Profile',exact:true}).click();await row(page,id+'@1').waitFor();assert.equal(await row(page,id+'@1').getAttribute('aria-pressed'),'true')
 }
 // Duplicate IDs rejected by the actual API, retaining the form.
 const dup=await create(page,'acceptance-square','square',{side:2});await dup.getByRole('button',{name:'保存 Profile',exact:true}).click();await dup.getByRole('alert').waitFor();assert.match(await dup.getByRole('alert').innerText(),/ID 已存在/);await dup.getByRole('button',{name:'取消',exact:true}).click()
 // Edit appends v2; v1 row/geometry remains byte-for-byte intact.
 const key='acceptance-isosceles-triangle',v1=(await json('profiles')).profiles.find(p=>p.id===key),points1=await row(page,key+'@1').locator('polygon').getAttribute('points')
 await row(page,key+'@1').click();await page.getByRole('button',{name:'编辑',exact:true}).click();let e=editor(page)
 assert.equal(await e.getByLabel('Profile ID',{exact:true}).isDisabled(),true);await e.getByLabel('高度',{exact:true}).fill('1.8');assert.notEqual(await e.locator('polygon').getAttribute('points'),points1)
 await e.getByRole('button',{name:'保存新版本',exact:true}).click();await row(page,key+'@2').waitFor();assert.equal(await row(page,key+'@1').locator('polygon').getAttribute('points'),points1)
 // Duplicate creates independent ID, including connector/Estimated configuration.
 await page.getByRole('button',{name:'复制为新 Profile',exact:true}).click();e=editor(page);await e.getByLabel('Profile ID',{exact:true}).fill('acceptance-copy');await e.getByLabel('Profile 名称',{exact:true}).fill('acceptance-copy');await e.getByLabel('允许连接 e1',{exact:true}).uncheck();await e.getByRole('button',{name:'保存 Profile',exact:true}).click();await row(page,'acceptance-copy@1').waitFor();assert.equal(await row(page,'acceptance-copy@1').locator('line').count(),2)
 // Independent browser context: stale CAS is rejected without overwriting either draft.
 const otherContext=await browser.newContext({viewport:{width:1550,height:1000}}),other=await otherContext.newPage();await other.goto(url+'?stage=assembly&rightTab=catalog');await row(other,key+'@2').waitFor();await row(other,key+'@2').click();await other.getByRole('button',{name:'编辑',exact:true}).click();await editor(other).getByLabel('高度',{exact:true}).fill('2.2')
 await row(page,key+'@2').click();await page.getByRole('button',{name:'编辑',exact:true}).click();await editor(page).getByLabel('高度',{exact:true}).fill('2');await editor(page).getByRole('button',{name:'保存新版本',exact:true}).click();await row(page,key+'@3').waitFor()
 await editor(other).getByRole('button',{name:'保存新版本',exact:true}).click();await editor(other).getByRole('alert').waitFor();assert.match(await editor(other).getByRole('alert').innerText(),/已被其他操作更新/);assert.equal(await editor(other).getByLabel('高度',{exact:true}).inputValue(),'2.2')
 await editor(other).getByRole('button',{name:'读取最新 Catalog',exact:true}).click();await row(other,key+'@3').waitFor();await editor(other).getByRole('button',{name:'保存新版本',exact:true}).click();await row(other,key+'@4').waitFor();await otherContext.close()
 // Invalidation refresh is explicit/focus-based, without remounting work state.
 await page.getByRole('button',{name:'刷新',exact:true}).click();await row(page,key+'@4').waitFor();await row(page,key+'@1').click();await rightTab(page,'inspector');await studioButton(page,'添加'+v1.name).first().click();assert.equal(await page.locator('[data-tile-id]').count(),1)
 const tileBefore=await page.locator('[data-tile-id]').first().getAttribute('points');await studioButton(page,'生成搭建步骤').click();await page.getByRole('button',{name:'保存教程',exact:true}).waitFor();assert.equal(await page.locator('[data-build-tile]').count(),1)
 await page.getByRole('button',{name:'保存教程',exact:true}).click();await rightTab(page,'catalog');const more=await create(page,'acceptance-late','rectangle',{width:1,height:2});await more.getByRole('button',{name:'保存 Profile',exact:true}).click();await row(page,'acceptance-late@1').waitFor();await rightTab(page,'inspector');assert.equal(await page.locator('[data-build-tile]').count(),1,'Catalog additions preserve running Build view')
 await stage(page,'assembly');assert.equal(await page.locator('[data-tile-id]').first().getAttribute('points'),tileBefore)
 await rightTab(page,'catalog');await row(page,key+'@1').click();const copied=page.url();await page.reload();await row(page,key+'@1').waitFor();assert.equal(await row(page,key+'@1').getAttribute('aria-pressed'),'true');await rightTab(page,'inspector');assert.equal(await page.locator('[data-tile-id]').count(),1,'dynamic registry loads before workspace recovery')
 const reopened=await context.newPage();await reopened.goto(copied);await row(reopened,key+'@1').waitFor();assert.equal(await row(reopened,key+'@1').getAttribute('aria-pressed'),'true');await reopened.close()
 // Existing real rose evidence and Matching stay intact across editor use.
 const f=JSON.parse(await readFile(new URL('../test/fixtures/magnetic-intake/rose-relative-size.json',import.meta.url),'utf8'))
 await page.goto(url+`?stage=review&sourceId=${f.sourceId}&analysisId=${f.analysisId}&reviewId=${f.reviewId}&observationId=p1&rightTab=inspector`)
 await page.getByRole('button',{name:'Find Matching Profile',exact:true}).click();await page.getByRole('button',{name:'查看全部候选',exact:true}).click();assert.ok(await page.locator(`[data-match-profile="${key}"]`).count()>0)
 const reviewBefore=await page.getByLabel('历史 Review',{exact:true}).inputValue();await rightTab(page,'catalog');await page.getByRole('button',{name:'新增 Profile',exact:true}).click();await editor(page).getByLabel('Profile 名称',{exact:true}).fill('unsaved editor');await rightTab(page,'inspector');assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),reviewBefore);assert.ok(await page.locator(`[data-match-profile="${key}"]`).count()>0)
 await rightTab(page,'catalog');assert.equal(await editor(page).getByLabel('Profile 名称',{exact:true}).inputValue(),'unsaved editor')
 await page.setViewportSize({width:1024,height:650});assert.ok(await page.locator('.tiles-catalog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:out+'/narrow.png'})
 const final=await json('profiles');assert.deepEqual(final.profiles.slice(0,5),initial.profiles);assert.deepEqual(final.profiles.find(p=>p.id===key&&p.version===1),v1);assert.deepEqual((await json('history')).selectedSnapshots,historyBefore.selectedSnapshots);assert.deepEqual(errors,[]);assert.equal(sandbox.calls.recognize,0)
 console.log(JSON.stringify({pass:true,shapes:5,versions:final.profiles.length,CAS:'two contexts and immutable versions',oldVersions:'unchanged',assembly:true,build:true,matching:true,refresh:true,paidCalls:0,screenshots:out}))
}finally{await context.close();await browser.close();await sandbox.close()}

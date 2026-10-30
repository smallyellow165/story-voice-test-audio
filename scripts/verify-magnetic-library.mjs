import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,copyFile,writeFile,unlink} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {stage} from './magnetic-studio-browser.mjs'
const base=process.env.MAGNETIC_ORIGIN||'http://127.0.0.1:5187',directory=new URL('../public/test-images/maganetic/',import.meta.url)
const rose='connetix-rose.png',duck='26d33ab7b7de237be0538c7a88da290a.jpg',extra=`library-test-${randomUUID()}.png`,broken=`library-broken-${randomUUID()}.png`
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/magnetic-intake/recognize',()=>{throw Error('Paid calls forbidden')})
const idle=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='刷新图片历史'&&!b.disabled))
const list=page.getByLabel('服务器图片',{exact:true})
async function choose(name){const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/sources')&&r.request().method()==='POST');await list.selectOption(name);const s=await(await response).json();await idle();assert.ok(s.id);return s}
try{
 await page.goto(base+'/story-voice-test-audio/magnetic-tiles.html');await stage(page,'source');await idle()
 await page.getByLabel('图片来源',{exact:true}).selectOption('server');await idle()
 await list.locator(`option[value="${rose}"]`).waitFor({state:'attached'});const names=await list.locator('option').allTextContents();assert.ok(names.includes(rose));assert.ok(names.includes(duck))
 const r=await choose(rose);assert.equal(r.originalHash,createHash('sha256').update(await readFile(new URL(rose,directory))).digest('hex'))
 await page.screenshot({path:'/tmp/magnetic-library-rose.png'})
 const d=await choose(duck);assert.equal(d.originalHash,createHash('sha256').update(await readFile(new URL(duck,directory))).digest('hex'))
 assert.ok(await page.getByLabel('历史 Analysis',{exact:true}).locator('option').count()>1)
 const history=await(await page.request.get(base+'/api/magnetic-intake/history')).json(),a=history.analyses.find(a=>a.sourceId===d.id&&a.status==='complete');assert.ok(a)
 await page.getByLabel('历史 Analysis',{exact:true}).selectOption(a.id);await idle();assert.ok(await page.locator('[data-observation]').count()>0)
 assert.equal((await choose(rose)).id,r.id)
 await copyFile(new URL(rose,directory),new URL(extra,directory));await page.getByRole('button',{name:'刷新 Server Library',exact:true}).click();await idle();assert.ok((await list.locator('option').allTextContents()).includes(extra))
 assert.equal((await choose(extra)).id,r.id)
 await unlink(new URL(extra,directory));await page.getByRole('button',{name:'刷新 Server Library',exact:true}).click();await idle();assert.ok(!(await list.locator('option').allTextContents()).includes(extra))
 await page.getByLabel('已保存图片',{exact:true}).selectOption(d.id);await idle();await page.getByLabel('已保存图片',{exact:true}).selectOption(r.id);await idle();assert.ok(await page.locator('.intake-image image').getAttribute('href'))
 const uploaded=page.waitForResponse(x=>x.url().endsWith('/api/magnetic-intake/sources')&&x.request().method()==='POST');await page.getByTestId('intake-upload').setInputFiles(new URL(rose,directory).pathname);assert.equal((await(await uploaded).json()).id,r.id);await idle()
 const after=await(await page.request.get(base+'/api/magnetic-intake/history')).json();assert.equal(after.sources.length,history.sources.length)
 assert.deepEqual(after.analyses,history.analyses)
 await writeFile(new URL(broken,directory),'not an image');await page.getByLabel('图片来源',{exact:true}).selectOption('server');await idle();await list.selectOption(broken);await idle();assert.match(await page.getByRole('alert').filter({hasText:'图片类型与内容不匹配'}).innerText(),/图片类型与内容不匹配/)
 for(const name of ['../connetix-rose.png','/etc/passwd','..\\secret.png']){const response=await page.request.post(base+'/api/magnetic-intake/library-image',{data:{name}});assert.equal(response.status(),400)}
 await stage(page,'catalog');assert.equal(await page.locator('.catalog-row').count(),5)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));assert.deepEqual(errors,[])
 console.log('PASS: rose + duck preview, existing Analysis association, hot library refresh, same-content upload/library dedup, saved source after library deletion, corrupt-file error, path rejection, Catalog navigation; 0 model calls. Screenshot /tmp/magnetic-library-rose.png')
}finally{await browser.close();for(const name of [extra,broken])await unlink(new URL(name,directory)).catch(e=>{if(e.code!=='ENOENT')throw e})}

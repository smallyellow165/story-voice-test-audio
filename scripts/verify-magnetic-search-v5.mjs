import {chromium} from '../../story-voice-pipecat-poc-v4/client/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {startMagneticSandbox} from './magnetic-sandbox.mjs'
import {rightTab,stage} from './magnetic-studio-browser.mjs'
const sandbox=await startMagneticSandbox(),out='/tmp/magnetic-search-v5',base=sandbox.origin,url=base+'/story-voice-test-audio/magnetic-tiles.html'
const old=JSON.parse(await readFile(new URL('../test/fixtures/magnetic-intake/palm-connected-v4.json',import.meta.url))),get=async route=>{const r=await fetch(base+'/api/magnetic-intake/'+route);assert.equal(r.status,200);return r.json()},historyBefore=await get('history'),registryBefore=await get('profiles'),sourceId=old.sourceId,selectedBefore=await get('selected/'+sourceId)
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1600,height:1000}}),errors=[]
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
try{
 await mkdir(out,{recursive:true});const page=await context.newPage()
 await page.goto(url+`?stage=reconstruction&rightTab=inspector&sourceId=${sourceId}&analysisId=${old.trace.references.analysisId}&reviewId=${old.reviewId}&reconstructionId=${old.id}&candidateId=diagnostic-1`)
 const selector=page.getByLabel('几何重建候选',{exact:true});await selector.waitFor();await page.getByRole('img',{name:'Diagnostic 几何摆放',exact:true}).waitFor()
 assert.match(await selector.locator('option:checked').innerText(),/14 片.*0\.310/)
 const response=page.waitForResponse(r=>r.url().endsWith('/api/magnetic-intake/reconstruct')&&r.request().method()==='POST',{timeout:60000})
 await page.getByRole('button',{name:'生成几何重建',exact:true}).click();const http=await response;assert.equal(http.status(),200);const r=await http.json();assert.equal(r.algorithm,'planar-outline-v5');assert.equal(r.reviewHash,old.reviewHash)
 await page.waitForFunction(id=>new URL(location.href).searchParams.get('reconstructionId')===id,r.id)
 await selector.selectOption('diagnostic-1');const first=r.diagnosticCandidates[0];assert.ok(first.tiles.length>=14);assert.ok(r.trace.search.stats.efficiency.maxAcceptedProposalPieces>=14);assert.ok(r.trace.search.stats.efficiency.registrationRescued>0);assert.equal(r.trace.search.registrationWitness.validator.valid,true)
 assert.equal(await page.locator('[data-preview-piece]').count(),first.tiles.length);assert.equal(await page.getByRole('button',{name:'在作品编辑器中打开',exact:true}).count(),0)
 await page.getByRole('button',{name:'Trace / Raw',exact:true}).click();await page.getByRole('button',{name:'Geometry Execution',exact:true}).click()
 const raw=page.getByLabel('Trace JSON',{exact:true});await page.waitForFunction(()=>{try{return JSON.parse(document.querySelector('textarea[aria-label="Trace JSON"]').value).execution?.algorithm==='planar-outline-v5'}catch{return false}})
 const trace=JSON.parse(await raw.inputValue());assert.deepEqual(trace.execution.trace.search.stats,r.trace.search.stats);assert.equal(trace.references.review.hash,r.reviewHash)
 await page.screenshot({path:out+'/trace.png'});await page.getByRole('button',{name:'关闭 Trace',exact:true}).click()
 const copied=page.url();await rightTab(page,'catalog');assert.equal(await page.locator('[data-catalog-profile]').count(),registryBefore.profiles.length);await rightTab(page,'inspector');assert.equal(await selector.inputValue(),'diagnostic-1')
 await page.reload();await selector.waitFor();await page.getByRole('img',{name:'Diagnostic 几何摆放',exact:true}).waitFor();assert.equal(await selector.inputValue(),'diagnostic-1')
 const reopened=await context.newPage();await reopened.goto(copied);await reopened.getByRole('img',{name:'Diagnostic 几何摆放',exact:true}).waitFor();assert.equal(await reopened.locator('[data-preview-piece]').count(),first.tiles.length);await reopened.close()
 await stage(page,'review');assert.equal(await page.getByLabel('历史 Review',{exact:true}).inputValue(),old.reviewId);await page.goBack();await page.getByRole('img',{name:'Diagnostic 几何摆放',exact:true}).waitFor()
 await page.setViewportSize({width:1024,height:700});await page.screenshot({path:out+'/diagnostic.png'})
 assert.deepEqual(await get('profiles'),registryBefore);assert.deepEqual(await get('selected/'+sourceId),selectedBefore);const after=await get('history');assert.deepEqual(after.reviews,historyBefore.reviews);assert.deepEqual(after.analyses,historyBefore.analyses);assert.deepEqual(await get('reconstructions/'+old.id),old);assert.equal(sandbox.calls.recognize,0);assert.deepEqual(errors,[])
 const summary={algorithm:r.algorithm,palm:{before:{explored:old.explored,trials:old.trials,maxDiagnostic:Math.max(...old.diagnosticCandidates.map(d=>d.tiles.length)),valid:old.candidates.length},after:{explored:r.explored,trials:r.trials,maxDiagnostic:Math.max(...r.diagnosticCandidates.map(d=>d.tiles.length)),valid:r.candidates.length,stats:r.trace.search.stats,registrationWitness:r.trace.search.registrationWitness.registration,firstDiagnostic:{unplaced:first.unplacedIds,issues:first.validator.report.issues,maxRms:first.registration?.afterMaxRms}}},paidCalls:sandbox.calls.recognize,historyUnchanged:true,registryUnchanged:true,deepLinkRestored:true}
 await writeFile(out+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary))
}finally{await context.close();await browser.close();await sandbox.close()}

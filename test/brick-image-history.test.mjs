import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { planRepair, applyRepair } from '../scripts/repair-source-image-links.mjs'
import { validateImage } from '../server/brick-image-validation.mjs'
import { createSourceImageStore } from '../server/brick-source-images.mjs'
import { createBrickReverse } from '../server/brick-reverse.mjs'
import { imageHistoryGroups, historyForImage } from '../src/brick-vision/image-history.mjs'
const sha=b=>createHash('sha256').update(b).digest('hex')
const original = {mimeType:'image/png',imageBase64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}
async function fixture(t) {
 const root=await mkdtemp(path.join(tmpdir(),'image-history-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await mkdir(path.join(root,'brick-reverse'))
 const ids=[randomUUID(),randomUUID()]
 for(const id of ids) await writeFile(path.join(root,'brick-reverse',id+'.json'),JSON.stringify({id,kind:'reverse-analysis',status:'complete',originalImage:original,image:validateImage(original),image_reference:{sha256:validateImage(original).sha256},createdAt:'same date',analysis:{appearance:'fixture',observations:[]}}))
 return {root,ids}
}
test('explicit repair preserves all old fields and protected files; canonical History groups independent runs by exact reference',async t=>{
 const {root,ids}=await fixture(t),review=path.join(root,'brick-reverse',ids[0]+'.json.review')
 await writeFile(review,'protected review bytes')
 const plan=await planRepair(root,ids),audit=path.join(root,'audit')
 assert.equal(new Set(plan.actions.map(a=>a.sourceImageId)).size,1)
 const result=await applyRepair(root,plan,audit);assert.equal(result.status,'complete')
 assert.equal(await readFile(review,'utf8'),'protected review bytes')
 for(const a of plan.actions){const before=JSON.parse(await readFile(path.join(audit,a.id+'.before.json'))),after=JSON.parse(await readFile(path.join(root,a.file)));const {sourceImageId,...rest}=after;assert.deepEqual(rest,before);assert.equal(sourceImageId,a.sourceImageId)}
 const history=await createBrickReverse(path.join(root,'brick-reverse'),{sourceImages:createSourceImageStore(path.join(root,'brick-source-images'))}).history()
 assert.equal(history.items.length,2);assert.deepEqual(history.warnings,[])
 assert.deepEqual(imageHistoryGroups(history.items),[{imageId:plan.actions[0].sourceImageId,count:2}])
 assert.deepEqual(historyForImage(history.items,plan.actions[0].sourceImageId),history.items)
 assert.deepEqual(historyForImage(history.items,'sha256:'+'f'.repeat(64)),[])
 assert.deepEqual(historyForImage(history.items,''),history.items)
 await assert.rejects(planRepair(root,ids),/unlinked/)
})
test('whole-file hash dependencies prevent repair before any mutation',async t=>{
 const {root,ids}=await fixture(t),file=path.join(root,'brick-reverse',ids[0]+'.json'),bytes=await readFile(file)
 await writeFile(path.join(root,'brick-reverse',randomUUID()+'.json'),JSON.stringify({revision:{parentSha256:sha(bytes)}}))
 await assert.rejects(planRepair(root,[ids[0]]),/hash dependencies/)
 assert.deepEqual(await readFile(file),bytes)
 await assert.rejects(readdir(path.join(root,'brick-source-images')),{code:'ENOENT'})
})
test('stale plan and conflicting image evidence refuse writes',async t=>{
 const {root,ids}=await fixture(t),plan=await planRepair(root,ids),file=path.join(root,'brick-reverse',ids[0]+'.json')
 const r=JSON.parse(await readFile(file));r.analysis.appearance='changed';await writeFile(file,JSON.stringify(r))
 await assert.rejects(applyRepair(root,plan,path.join(root,'audit')),/Data changed/)
 await assert.rejects(readdir(path.join(root,'audit')),{code:'ENOENT'})
 r.originalImage.sha256='f'.repeat(64);await writeFile(file,JSON.stringify(r))
 await assert.rejects(planRepair(root,ids),/Original hash mismatch/)
})
test('image filters never infer identity from filename, date, status or model image hash',()=>{
 const a='sha256:'+'a'.repeat(64),b='sha256:'+'b'.repeat(64)
 const runs=[{id:'one',sourceImageId:a,status:'failed',name:'same.png'},{id:'two',sourceImageId:b,status:'complete',name:'same.png'},{id:'three',sourceImageId:a,status:'complete',name:'renamed.png'}]
 assert.deepEqual(historyForImage(runs,a).map(r=>r.id),['one','three'])
 assert.throws(()=>imageHistoryGroups([{id:'missing',name:'same.png'}]),/formal sourceImageId/)
})
test('History filter renders explicit image options and keeps all-history action without a second data source',async()=>{
 const ts=await import('typescript'),{createRequire}=await import('node:module'),require=createRequire(import.meta.url)
 const {renderToStaticMarkup}=await import('react-dom/server'),React=await import('react')
 const url=new URL('../src/brick-vision/SourceImageHistoryFilter.tsx',import.meta.url)
 const code=ts.transpileModule(await readFile(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  .replaceAll('"react/jsx-runtime"',JSON.stringify((await import('node:url')).pathToFileURL(require.resolve('react/jsx-runtime')).href))
  .replaceAll("'react'",JSON.stringify((await import('node:url')).pathToFileURL(require.resolve('react')).href))
  .replaceAll("'./image-history.mjs'",JSON.stringify(new URL('../src/brick-vision/image-history.mjs',import.meta.url).href))
 const {SourceImageHistoryFilter}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
 const id='sha256:'+'a'.repeat(64)
 const html=renderToStaticMarkup(React.createElement(SourceImageHistoryFilter,{records:[{sourceImageId:id},{sourceImageId:id}],value:'',onChange:()=>assert.fail('Rendering must not select a run'),disabled:false}))
 assert.match(html,/按 Source Image 查看/);assert.match(html,/全部图片/);assert.match(html,/2 次 Analysis/);assert.ok(html.includes(id))
})

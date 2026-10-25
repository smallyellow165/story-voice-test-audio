import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createBrickReverse} from '../server/brick-reverse.mjs'
import {reviewedSource} from '../server/brick-spatial-workflow.mjs'
import {addItem} from '../src/brick-inventory/inventory.ts'
const original='848fe628-5766-4f8c-8f73-5cf9235ef76d'
const file=name=>new URL('../generated/brick-reverse/'+name,import.meta.url)
test('Brown and Reddish Brown stay separate; repeated observations aggregate only identical part/color',()=>{
 let items=[]
 for(const color of [4,6,70,6])items=addItem(items,{part_num:'3437',color_id:color,quantity:1})
 assert.deepEqual(items.map(r=>[r.color_id,r.quantity]),[[4,1],[6,2],[70,1]])
})
test('corrected part/color persists in Review and Spatial source, never rewriting original Analysis',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'brown-review-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const raw=await readFile(file(original+'.json'),'utf8'),review=JSON.parse(await readFile(file(original+'.json.review')))
 await writeFile(path.join(dir,original+'.json'),raw)
 for(const row of Object.values(review.rows))await writeFile(path.join(dir,row.searchId+'.json'),await readFile(file(row.searchId+'.json')))
 // Set an explicit Brown control row in the isolated fixture; the user's live review may evolve.
 const control=JSON.parse(await readFile(file(review.rows.brown_lower.searchId+'.json')))
 review.rows.brown_lower.index=control.rows.findIndex(c=>c.source.part_num==='3437'&&c.source.color_id===6&&c.sourceAllowed)
 review.rows.brown_lower.features.color='6'
 assert.ok(review.rows.brown_lower.index>=0)
 const search=JSON.parse(await readFile(file(review.rows.brown_upright.searchId+'.json')))
 search.observationId='orange_middle';search.id='a6f57c05-f4d5-4ff2-9db3-d54bbdb273ca'
 await writeFile(path.join(dir,search.id+'.json'),JSON.stringify(search))
 const changed=review.rows.orange_middle
 changed.features.partNumber='4066';changed.features.color='70';changed.searchId=search.id
 changed.index=search.rows.findIndex(c=>c.source.part_num==='4066'&&c.source.color_id===70&&c.sourceAllowed)
 assert.ok(changed.index>=0)
 const reverse=createBrickReverse(dir,{getCatalog:async()=>({colors:[{id:6,name:'Brown'},{id:70,name:'Reddish Brown'}]})})
 await reverse.saveReview({analysisId:original,rows:review.rows})
 const restored=await reverse.restore(original),source=reviewedSource(restored)
 assert.equal(source.ready,true);assert.equal(source.rows.length,9)
 assert.equal(source.rows.find(r=>r.id==='orange_middle').confirmedPart.part_num,'4066')
 assert.equal(source.rows.find(r=>r.id==='orange_middle').confirmedPart.color_id,70)
 assert.equal(source.rows.find(r=>r.id==='brown_lower').confirmedPart.color_id,6)
 assert.equal(restored.rows.orange_middle.features.color,'70')
 assert.equal(await readFile(path.join(dir,original+'.json'),'utf8'),raw)
})

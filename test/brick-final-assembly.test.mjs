import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {executePlan} from '../experiments/geometry-execution/execute.mjs'
const rules=await loadBrickRules()
const file=new URL('../generated/brick-refinements/69b3ee1d-0c83-44e2-a815-2b9df54f4eac.json',import.meta.url)
const saved=await readFile(file),r=JSON.parse(saved),p=r.proposals.find(p=>p.id==='proposal-2')
test('saved, unapproved rooster is connected by actual top mates; final and placement validation are distinct',async()=>{
 const g=rules.validateFinalAssembly(p.assembly.bricks)
 assert.equal(g.valid,true)
 assert.equal(rules.validateAssembly(p.assembly.bricks).code,'UNSUPPORTED','manual placement rule unchanged')
 const upper=id=>g.connections.filter(c=>c.lowerId===id).map(c=>[c.upperId,c.points.length])
 assert.deepEqual(upper('yellow_front'),[['red_top',2]])
 assert.deepEqual(upper('brown_lower'),[['orange_middle',2],['black_middle',2]])
 assert.deepEqual(upper('orange_base'),[['dark_lower',4]])
 assert.equal(executePlan(p.refinedPlan,r.input,rules).candidates.length,1)
 assert.equal(p.approved,false)
 assert.deepEqual(await readFile(file),saved)
})
test('final validation still rejects detached bricks, side-only contact, misaligned studs and body collision',()=>{
 const b=(id,x,layer=0)=>({id,part:'3437',color:'4',x,z:0,layer,rotation:0})
 assert.equal(rules.validateFinalAssembly([b('a',0),b('b',2)]).code,'DISCONNECTED')
 assert.equal(rules.validateFinalAssembly([b('a',0),b('b',4,1)]).code,'DISCONNECTED')
 assert.equal(rules.validateFinalAssembly([b('a',0),b('b',.5,1)]).code,'COLLISION')
 assert.equal(rules.validateFinalAssembly([b('a',0),b('b',0)]).code,'COLLISION')
 assert.equal(rules.validateFinalAssembly(r.originalAssembly.bricks).code,'COLLISION')
})

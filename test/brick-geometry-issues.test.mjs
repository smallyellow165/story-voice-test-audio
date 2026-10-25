import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {geometryIssuesForDisplay,expectedConnections} from '../src/brick-test/geometry-issues.mjs'
const read=async p=>JSON.parse(await readFile(new URL('../generated/'+p,import.meta.url)))
const geometry=await read('brick-spatial-geometry/69c33742-bc26-4d07-8c1f-ab0968c30db1.json')
const refinement=await read('brick-refinements/6ae06e11-ea40-4464-8de9-af1d8eddbc49.json')
test('saved penguin: one collision and six unique impossible mates, without invented overlap measurements',()=>{
 const before=JSON.stringify({geometry,refinement}),issues=geometryIssuesForDisplay(geometry,refinement)
 assert.equal(issues.length,7);assert.equal(issues.filter(i=>i.type==='Collision').length,1)
 const wing=issues.find(i=>i.ids.join('/')==='white_strip/wing_upper');assert.equal(wing.details.length,2);assert.equal(wing.details[0].minimumAxisGapLdu.y,24)
 const eye=issues.find(i=>i.ids.join('/')==='eye_block/white_strip');assert.equal(eye.scope,'domain')
 const connections=expectedConnections(geometry.sourcePlan,eye.ids);assert.ok(connections.some(c=>c.id==='eye_block'&&c.ownConnector===0&&c.otherConnector===2&&c.visibility==='inferred'))
 assert.equal(JSON.stringify({geometry,refinement}),before)
})
test('short-circuited mating flags are not presented as confirmed missing connections',()=>{
 assert.deepEqual(geometryIssuesForDisplay({attempts:[{connections:[{id:'a',other:'b',satisfied:false}]}]},null),[])
 assert.deepEqual(geometryIssuesForDisplay(null,{diagnostics:[{code:'UNKNOWN',id:'a',other:'b'}]}),[])
})
test('no special observation IDs; retain evidence for both directions and separate scopes',()=>{
 const r={diagnosticAssembly:{geometry:{code:'COLLISION',brickIds:['b','a'],reason:'collision'}}}
 const f={diagnostics:[{code:'IMPOSSIBLE_MATING_IN_DOMAIN',id:'a',other:'b'},{code:'IMPOSSIBLE_MATING_IN_DOMAIN',id:'b',other:'a'}]}
 const issues=geometryIssuesForDisplay(r,f);assert.equal(issues.length,2);assert.deepEqual(issues[0].ids,['a','b']);assert.equal(issues[1].details.length,2)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {refineGeometry} from '../experiments/geometry-refinement/refine.mjs'
const rules=await loadBrickRules()
const source=JSON.parse(await readFile(new URL('../generated/brick-spatial-geometry/69c33742-bc26-4d07-8c1f-ab0968c30db1.json',import.meta.url)))
for(const radiusLdu of [20,40])test(`penguin ${radiusLdu}: independent impossible mating diagnostics; no unapproved constraint changes`,()=>{
 const before=JSON.stringify(source),r=refineGeometry(source.sourcePlan,source.input,rules,{radiusLdu})
 assert.equal(r.status,'no_solution_in_bounds');assert.equal(r.completeSearch,true);assert.equal(r.proposals.length,0)
 const mate=(a,b)=>r.diagnostics.find(d=>d.id===a&&d.other===b)
 assert.equal(mate('white_strip','wing_upper').minimumAxisGapLdu.y,24)
 assert.equal(mate('wing_lower','white_lower').minimumAxisGapLdu.y,24)
 assert.equal(mate('white_strip','white_belly').minimumAxisGapLdu.z,20)
 if(radiusLdu===20)assert.ok(mate('eye_block','white_strip').minimumL1GapLdu>0)
 else assert.equal(mate('eye_block','white_strip'),undefined)
 assert.equal(JSON.stringify(source),before)
})
test('moving beak left half a stud clears only that body overlap, not the assembly',()=>{
 const bs=source.diagnosticAssembly.bricks,eye=bs.find(b=>b.id==='eye_block'),beak=bs.find(b=>b.id==='beak')
 assert.equal(rules.validateFinalAssembly([eye,beak]).code,'COLLISION')
 const shifted={...beak,x:beak.x-.5}
 assert.equal(rules.validateFinalAssembly([eye,shifted]).code,'DISCONNECTED')
 assert.equal(rules.validateFinalAssembly(bs.map(b=>b.id===beak.id?shifted:b)).code,'COLLISION')
})

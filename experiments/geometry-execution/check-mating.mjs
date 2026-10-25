// Read-only, deterministic comparison of saved poses and shared connector rules.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {loadBrickRules} from '../../server/brick-rules.mjs'
import {explainMating} from '../../src/brick-test/mating-explanation.mjs'
import {executePlan} from './execute.mjs'
const rules=await loadBrickRules(),r=JSON.parse(await readFile(new URL('../../generated/brick-spatial-geometry/69c33742-bc26-4d07-8c1f-ab0968c30db1.json',import.meta.url)))
const bs=r.diagnosticAssembly.bricks,own=bs.find(b=>b.id==='eye_block'),other=bs.find(b=>b.id==='white_strip'),c=r.sourcePlan.parts.find(p=>p.id===own.id).connections.find(c=>c.other===other.id)
const explanation=explainMating(own,other,c,rules),placements=[]
for(const rotation of [0,90,180,270])for(const x of [-1,0,1]){
 const lower={...other,x:0,z:0,layer:0,rotation:0},upper={...own,x,z:0,layer:.5,rotation}
 placements.push({x,rotation,validation:rules.validateFinalAssembly([lower,upper])})
}
const shifts=[]
for(const rotation of [0,180])for(const x of [-2,-1.5,-1,-.5,0]){
 const shifted={...other,x,rotation},e=explainMating(own,shifted,c,rules)
 shifts.push({x,rotation,specifiedSatisfied:e.specifiedSatisfied,pairValid:e.current?.valid,leftRelation:x<own.x,whole:rules.validateFinalAssembly(bs.map(b=>b.id===other.id?shifted:b))})
}
const withoutIndices=structuredClone(r.sourcePlan)
for(const p of withoutIndices.parts)for(const link of p.connections)if([own.id,other.id].includes(p.id)&&[own.id,other.id].includes(link.other)){link.ownConnector=null;link.otherConnector=null}
const result={explanation,placements,shifts,withoutIndicesWhole:executePlan(withoutIndices,r.input,rules)}
const out=new URL('../../output/mating-investigation/',import.meta.url);await mkdir(out,{recursive:true});await writeFile(new URL('report.json',out),JSON.stringify(result,null,2));console.log(JSON.stringify({explanation,validPlacements:placements.filter(p=>p.validation.valid).length,shifts:shifts.filter(s=>s.specifiedSatisfied),whole:result.withoutIndicesWhole.status},null,2))

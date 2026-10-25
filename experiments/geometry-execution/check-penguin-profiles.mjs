// Local deterministic verification only. No Analysis, Review, Mapping or LLM writes.
import {mkdir,writeFile} from 'node:fs/promises'
import {loadBrickRules} from '../../server/brick-rules.mjs'
import {prepareGeometryInput} from '../../server/brick-geometry-input.mjs'
import {executePlan} from './execute.mjs'
import {penguinProfileFixture} from './fixtures/penguin-profiles.mjs'
for(const part of ['11170','98223']){
const {input,plan}=penguinProfileFixture(part),rules=await loadBrickRules()
const prepared=await prepareGeometryInput(input,rules)
if(prepared.issues.length)throw Error(prepared.issues.join('; '))
const result=executePlan(plan,prepared.input,rules)
const directory=new URL('../../output/penguin-profiles/'+part+'/',import.meta.url)
await mkdir(directory,{recursive:true})
const save=(name,data)=>writeFile(new URL(name,directory),JSON.stringify(data,null,2),{flag:'w'})
await save('report.json',{purpose:'Deterministic interface verification, not a photo reconstruction',...result,input:prepared.input,enrichments:prepared.enrichments,plan})
for(const c of result.candidates)await save(c.id+'.json',c)
// Blank photo slot: this fixture has no reference photograph.
await save('viewer.json',{status:result.status,completeSearch:result.completeSearch,diagnostics:result.diagnostics,groups:result.groups,
 candidates:result.candidates.map(c=>({id:c.id,layoutId:c.layoutId,file:c.id+'.json',bricks:c.assembly.bricks})),
 image:{mimeType:'image/png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='},sourcePlan:plan})
console.log(JSON.stringify({status:result.status,output:directory.pathname,viewer:'/story-voice-test-audio/experiments/geometry-execution/viewer.html?result='+encodeURIComponent('/story-voice-test-audio/output/penguin-profiles/'+part+'/viewer.json')},null,2))
if(result.status!=='candidates_found')process.exitCode=1

}

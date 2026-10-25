import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {spatialMapping} from '../server/brick-spatial-mapping.mjs'
import {loadBrickRules} from '../server/brick-rules.mjs'
import {inputFromSavedAnalysis} from '../experiments/geometry-solver/input.mjs'
import {prepareInput} from '../experiments/spatial-planning/input.mjs'
import {executePlan} from '../experiments/geometry-execution/execute.mjs'
import {curvedBottomFixture} from '../experiments/geometry-execution/fixtures/98224.mjs'
const rules=await loadBrickRules()
// Captured official P relationship and base LD export, not number-prefix inference.
const child={status:'unavailable',source:'rb_part_mappings',known_colors:[0],mappings:[]}
const base={status:'available',source:'rb_part_mappings',known_colors:[0],mappings:[
 {part_num:'3437',ext_system:'LD',ext_id:'31460',is_export_id:false},
 {part_num:'3437',ext_system:'LD',ext_id:'3437',is_export_id:true}]}
const relation={rel_type:'P',child_part_num:'3437pr0068',parent_part_num:'3437'}
const color={status:'available',name:'Black',external_ids:{LDraw:{ext_ids:[0,256],ext_descrs:[['Black'],['Rubber_Black']]}}}
async function run({p=child,b=base,relations=[relation],shared=rules,partNum='3437pr0068'}={}){
 return spatialMapping({items:[{part_num:partNum,color_id:0,quantity:1}]},shared,{getMetadata:async(route,params)=>{
  if(route==='mapping-color')return color
  if(route==='parts')return {items:[{part_num:partNum,print_relationships:relations}]}
  return params.part_num===partNum?p:b
 }})
}
function saved(mapping){
 const analysis={id:'analysis',status:'complete',analysis:{observations:[{id:'eye'}],relations:[]}}
 const trace={reference:{analysisId:'analysis',review:{eye:{quantity:1,confirmedPart:{part_num:'3437pr0068',color_id:0}}}},inventorySource:{mapping:mapping.mapping.rows},requestInput:{inventory:[{part:'3437',color:'0',quantity:1}]}}
 return {analysis,trace}
}
test('official P relationship preserves print/color identity and reuses reviewed base geometry',async()=>{
 const m=await run(),row=m.mapping.rows[0]
 assert.equal(m.mapping.valid,true);assert.equal(row.source.part_num,'3437pr0068')
 assert.deepEqual(row.target,{part:'3437',color:'0',colorName:'Black'})
 assert.deepEqual(row.evidence.part.mappings,[],'never invent an official child LD mapping')
 assert.equal(row.geometryBinding.appearance.printRendered,false)
 assert.equal(row.partCandidateChecks[0].supported,true)
 const {analysis,trace}=saved(m),before=JSON.stringify({analysis,trace})
 const input=inputFromSavedAnalysis(analysis,trace)
 assert.equal(input.observations[0].evidence.confirmedPart.part_num,'3437pr0068')
 assert.equal(input.observations[0].part,'3437')
 assert.equal(JSON.stringify({analysis,trace}),before)
 // Real saved image + official binding pass the formal request input builder.
 const photo=JSON.parse(await readFile(new URL('../generated/brick-reverse/0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa.json',import.meta.url)))
 const prepared=prepareInput({...photo,...analysis},trace,rules)
 assert.deepEqual(prepared.input.observations[0].geometry,rules.geometrySupport('3437').geometry)
 const dimensions=prepared.input.observations[0].dimensionsMm
 assert.equal(dimensions.x,32);assert.equal(dimensions.z,32);assert.ok(Math.abs(dimensions.y-19.2)<1e-8)
 assert.equal(prepared.input.observations[0].confirmedPart.part_num,'3437pr0068')
})
test('missing, ambiguous, non-print and self relationships fail; prefixes never prove geometry',async()=>{
 for(const relations of [[],[{...relation,parent_part_num:'3437pr0068'}],[relation,{...relation,parent_part_num:'3011'}],[{...relation,rel_type:'M'}]]){
  assert.equal((await run({relations})).mapping.valid,false)
 }
 assert.equal((await run({p:{...child,known_colors:[4]}})).mapping.valid,false)
 const different='unrelated-print-id'
 const r=await run({partNum:different,relations:[{...relation,child_part_num:different}]})
 assert.equal(r.mapping.valid,true,'only explicit relation matters, not matching numbers')
})
test('direct ambiguity, unreviewed base, changed files and forged saved evidence cannot pass',async()=>{
 const ambiguous={...child,status:'available',mappings:[{part_num:'3437pr0068',ext_system:'LD',ext_id:'3437',is_export_id:true},{part_num:'3437pr0068',ext_system:'LD',ext_id:'3011',is_export_id:true}]}
 assert.equal((await run({p:ambiguous})).mapping.valid,false)
 assert.equal((await run({b:{...base,mappings:[...base.mappings,{part_num:'3437',ext_system:'LD',ext_id:'3011',is_export_id:true}]}})).mapping.valid,false)
 assert.equal((await run({shared:{...rules,geometrySupport:()=>({supported:false,geometry:null,reasons:['missing']})}})).mapping.valid,false)
 const g=structuredClone(rules.geometrySupport('3437'));g.geometry.sourceFiles=[{path:'parts/3437.dat',sha256:'changed'}]
 assert.equal((await run({shared:{...rules,geometrySupport:()=>g}})).mapping.valid,false)
 const m=await run(),{analysis,trace}=saved(m)
 for(const mutate of [r=>{r.geometryBinding.relationships[0].parent_part_num='3011'},r=>{r.geometryBinding.baseMapping.mappings=[]},r=>{r.partCandidateChecks[0].supported=false}]){
  const altered=structuredClone(trace);mutate(altered.inventorySource.mapping[0])
  assert.throws(()=>inputFromSavedAnalysis(analysis,altered),/No verified saved/)
 }
})
test('mapped print geometry has real upper/lower mates; collisions and off-grid mating fail',async()=>{
 const mapping=await run(),{analysis,trace}=saved(mapping),mapped=inputFromSavedAnalysis(analysis,trace).observations[0]
 const {input,plan}=curvedBottomFixture()
 input.observations=input.observations.map(o=>({...o,part:mapped.part,color:mapped.color,geometry:rules.geometrySupport(mapped.part).geometry,confirmedPart:mapped.evidence.confirmedPart,mapping:mapped.evidence.mapping}))
 input.inventory=[{part:'3437',color:'0',quantity:3}]
 const result=executePlan(plan,input,rules)
 assert.equal(result.status,'candidates_found',JSON.stringify(result.diagnostics))
 assert.equal(result.candidates[0].geometry.valid,true)
 assert.equal(result.candidates[0].geometry.connections.length,2)
 assert.ok(result.candidates[0].geometry.connections.every(c=>c.points.length===4))
 const invalid=structuredClone(plan);invalid.parts[1].pose.offsetLdu.x={min:20,max:20}
 assert.equal(executePlan(invalid,input,rules).status,'no_solution')
 const collide=structuredClone(plan);collide.parts[1].pose.offsetLdu.y={min:24,max:24}
 const rejected=executePlan(collide,input,rules)
 assert.equal(rejected.status,'no_solution');assert.ok(rejected.attempts.some(a=>a.geometry.code==='COLLISION'))
 const wrong=structuredClone(plan);wrong.parts[1].pose.yawCandidates=[45]
 assert.equal(executePlan(wrong,input,rules).status,'invalid_input')
})

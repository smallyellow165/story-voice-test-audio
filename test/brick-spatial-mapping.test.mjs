import test from 'node:test'
import assert from 'node:assert/strict'
import {spatialMapping} from '../server/brick-spatial-mapping.mjs'
const session={items:[{part_num:'rb-part',color_id:70,quantity:1}]}
const part={status:'available',source:'rb_part_mappings',known_colors:[70],mappings:[{part_num:'rb-part',ext_system:'LD',ext_id:'official-a',is_export_id:true},{part_num:'rb-part',ext_system:'LD',ext_id:'official-b',is_export_id:false}]}
const color={status:'available',name:'Reddish Brown',external_ids:{LDraw:{ext_ids:[70],ext_descrs:[['Reddish_Brown']]}}}
const rules={geometrySupport:()=>({supported:false,reasons:['unreviewed'],geometry:null})}
const local={available:true,errors:[],sourceFiles:[]}
const run=(p=part,c=color,l=local,r=rules)=>spatialMapping(session,r,{getMetadata:async route=>route==='mapping-part'?p:c,inspect:async()=>l})
test('planning selects official export identity independently of Generator palette/profile',async()=>{
 const m=await run();assert.equal(m.mapping.valid,true);assert.deepEqual(m.mapping.rows[0].target,{part:'official-a',color:'70',colorName:'Reddish Brown'});assert.equal(m.mapping.rows[0].partCandidateChecks[0].supported,false)
})
test('Black uses exact official description, preserving the alternative material evidence',async()=>{
 const m=await run(part,{status:'available',name:'Black',external_ids:{LDraw:{ext_ids:[0,256],ext_descrs:[['Black'],['Rubber_Black']]}}});assert.equal(m.mapping.rows[0].target.color,'0');assert.deepEqual(m.mapping.rows[0].selection.allColorCandidates,['0','256'])
})
test('ambiguous export IDs are rejected, never resolved by similarity',async()=>{
 const p=structuredClone(part);p.mappings[1].is_export_id=true;assert.equal((await run(p)).mapping.valid,false)
 const absent={...part,mappings:[],external_ids:{LDraw:['rb-part']}};assert.equal((await run(absent)).mapping.valid,false)
})
test('ambiguous colors and missing local resources remain errors',async()=>{
 assert.equal((await run(part,{...color,external_ids:{LDraw:{ext_ids:[70,6],ext_descrs:[['Reddish_Brown'],['Reddish_Brown']]}}})).mapping.valid,false)
 assert.equal((await run(part,color,{available:false,errors:['missing dependency']})).mapping.valid,false)
})
test('reviewed geometry source drift is rejected rather than discarded as unknown',async()=>{
 const r={geometrySupport:()=>({supported:true,geometry:{sourceFiles:[{path:'part.dat',sha256:'expected'}]}})}
 assert.equal((await run(part,color,local,r)).mapping.valid,false)
})
test('planning retains unreviewed geometry as null; strict experiment path still rejects it',async()=>{
 const {readFile}=await import('node:fs/promises')
 const {prepareInput}=await import('../experiments/spatial-planning/input.mjs')
 const {loadBrickRules}=await import('../server/brick-rules.mjs')
 const a=JSON.parse(await readFile(new URL('../generated/brick-reverse/0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa.json',import.meta.url)))
 const t=JSON.parse(await readFile(new URL('../generated/brick-design-traces/0faf5079-d553-430f-9f12-fc95d190b769.json',import.meta.url)))
 const shared=await loadBrickRules(),unknown={...shared,geometrySupport:part=>part==='3437'?{supported:false,reasons:['test unreviewed profile'],geometry:null}:shared.geometrySupport(part)}
 assert.throws(()=>prepareInput(a,t,unknown),/Unsupported geometry/)
 const result=prepareInput(a,t,unknown,{allowUnknownGeometry:true})
 assert.equal(result.input.observations.length,7)
 const head=result.input.observations.find(o=>o.id==='head')
 assert.equal(head.geometry,null);assert.equal(head.dimensionsMm,null);assert.equal(head.geometryStatus,'missing_reviewed_profile')
 assert.ok(result.input.observations.find(o=>o.id==='neck').geometry)
})

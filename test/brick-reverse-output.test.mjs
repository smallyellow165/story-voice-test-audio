import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { geometryAnalysisIssues, validateGeometryAnalysis } from '../server/brick-reverse-geometry.mjs'
import { inspectGeometryOutput } from '../server/brick-reverse-output.mjs'
import { createBrickReverse } from '../server/brick-reverse.mjs'
const dimension = { value: null, status: 'unknown', confidence: .3, evidence: 'hidden', alternatives: [{value:2,evidence:'possible'}], anchor_ids: [] }
const fixture = () => ({ appearance:'test',scale_evidence:'visible',unknowns:[],anchors:[], observations:[{id:'a',color:'Yellow',bbox:null,confidence:.8, dimensions:{width_studs:structuredClone(dimension),depth_studs:structuredClone(dimension),height_brick_units:structuredClone(dimension)},orientation:{description:'upright',yaw_degrees:null,status:'inferred',evidence:'qualitative only'},visible_studs:null,visible_seams:[],evidence:'visible',occlusion:'hidden',unknowns:[],alternatives:[]}],relations:[] })
test('uncertain yaw and unknown depth with alternatives preserve all evidence',()=>{
 const value=fixture(),before=structuredClone(value)
 assert.equal(validateGeometryAnalysis(value),value);assert.deepEqual(value,before)
})
test('invalid states, values, references and containers remain rejected with paths',()=>{
 for(const mutate of [v=>v.observations[0].orientation.status='validated',v=>v.observations[0].dimensions.depth_studs.value=2,v=>v.observations[0].dimensions.depth_studs.anchor_ids=['a'],v=>v.observations[0].confidence=2,v=>v.observations[0].dimensions=null,v=>v.relations=[{from:'a',to:'missing',relation:'connected',status:'observed',confidence:.5,evidence:'touch'}]]) {
 const value=fixture();mutate(value);assert.throws(()=>validateGeometryAnalysis(value),e=>e.statusCode===422&&e.validationIssues.every(i=>i.path.startsWith('$')))
 }
})
test('offline endpoint never writes history or calls model; malformed JSON is distinguished',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'reverse-output-'));const id='12345678-1234-1234-1234-123456789abc'
 const record={id,kind:'reverse-analysis',analysis_mode:'geometry_only',status:'failed',rawOutput:JSON.stringify(fixture())}
 try {const bytes=JSON.stringify(record);await writeFile(path.join(dir,id+'.json'),bytes)
 const service=createBrickReverse(dir,{callModel:()=>assert.fail('No model call permitted')})
 const report=await service.revalidate({analysisId:id});assert.equal(report.valid,true)
 assert.equal((await service.read(id)).status,'failed');assert.equal(await readFile(path.join(dir,id+'.json'),'utf8'),bytes)
 assert.equal(inspectGeometryOutput({...record,rawOutput:'{'}).parsed,false)
 } finally {await rm(dir,{recursive:true,force:true})}
})
for(const [name,id,count] of [['penguin','68f4a642-75e6-47b6-b3eb-a719362f5a1e',11],['camel','0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa',7],['rooster','848fe628-5766-4f8c-8f73-5cf9235ef76d',9]]) test(`saved ${name} raw evidence (read only)`,async t=>{
 let bytes;try {bytes=await readFile(new URL(`../generated/brick-reverse/${id}.json`,import.meta.url),'utf8')}catch(e){if(e.code==='ENOENT')return t.skip('Local saved trace absent');throw e}
 const record=JSON.parse(bytes),report=inspectGeometryOutput(record)
 assert.equal(report.observationCount,count)
 if(name==='penguin'){
 assert.equal(report.relationCount,15);assert.equal(report.issues.length,1)
 assert.equal(report.issues[0].path,'$.observations[6].dimensions.width_studs.anchor_ids[0]')
 assert.deepEqual(report.issues[0].expected,['eye_block','head_front']);assert.equal(report.issues[0].actual,'white_strip')
 }else assert.deepEqual(geometryAnalysisIssues(JSON.parse(record.rawOutput)),[])
 assert.equal(JSON.stringify(record),JSON.stringify(JSON.parse(bytes)))
})

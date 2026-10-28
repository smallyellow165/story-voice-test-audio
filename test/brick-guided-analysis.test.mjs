import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {reversePrompts,geometryPromptVersions,selectReversePrompt} from '../server/brick-reverse-prompts.mjs'
import {createBrickReverse} from '../server/brick-reverse.mjs'
const d={value:null,status:'unknown',confidence:.2,evidence:'occluded',alternatives:[],anchor_ids:[]}
const observation=id=>({id,color:'Black',bbox:null,confidence:.6,dimensions:{width_studs:d,depth_studs:d,height_brick_units:d},orientation:{description:'uncertain',yaw_degrees:null,status:'inferred',evidence:'visible'},visible_studs:null,visible_seams:[],evidence:'visible contour',occlusion:'partly hidden',unknowns:[],alternatives:[]})
const value={appearance:'construction',scale_evidence:'unknown',anchors:[],unknowns:[],observations:[observation('selected'),observation('other')],relations:[{from:'selected',to:'other',relation:'above',status:'inferred',confidence:.5,evidence:'relative image positions'}]}
test('v3 default preserved; v4 is explicit with same evidence contract',()=>{
 assert.equal(selectReversePrompt('geometry_only'),reversePrompts.geometry_only);assert.equal(geometryPromptVersions[3].version,3)
 for(const word of ['Occlusion','Symmetry','over-segmentation','WHOLE footprint','anchor_ids','unknown'])assert.ok(geometryPromptVersions[4].text.includes(word))
 for(const invalid of ['__proto__','4',5])assert.throws(()=>selectReversePrompt('geometry_only',invalid))
})
test('guided request reuses source image, records independent lineage, validates output and never copies approvals',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'guided-analysis-'));let calls=0,output=value
 const service=createBrickReverse(dir,{getCatalog:async()=>({colors:[]}),callModel:async({record,request})=>{calls++;assert.ok(JSON.stringify(request).includes('JSON'));record.rawOutput=JSON.stringify(output);record.finishReason='completed';record.httpStatus=200}})
 try{
 const image={mimeType:'image/jpeg',imageBase64:Buffer.from([255,216,255]).toString('base64')}
 const body={requestId:randomUUID(),model:'gpt-4.1',analysis_mode:'geometry_only',originalImage:image,...image}
 const old=await service.analyze(body),v4=await service.analyze({...body,requestId:randomUUID(),promptVersion:4});assert.equal(old.prompt_version,3);assert.equal(v4.prompt_version,4);assert.notEqual(old.id,v4.id);assert.equal(old.image.sha256,v4.image.sha256)
 const before=await readFile(path.join(dir,old.id+'.json'));await writeFile(path.join(dir,old.id+'.json.review'),'original review sentinel')
 const guided={requestId:randomUUID(),model:'gpt-4.1',analysis_mode:'geometry_only',promptVersion:4,guidance:{analysisId:old.id,observationIds:['selected'],hint:'Consider a continuous shape, not two pieces.'}}
 for(const guidance of [{...guided.guidance,observationIds:[]},{...guided.guidance,observationIds:['invented']},{...guided.guidance,hint:''}])await assert.rejects(service.analyze({...guided,requestId:randomUUID(),guidance}))
 assert.equal(calls,2)
 output=structuredClone(value);output.observations[0].alternatives=['May be a continuous shape']
 const result=await service.analyze(guided);assert.equal(result.status,'complete');assert.equal(calls,3)
 const req=JSON.stringify(result.request);assert.ok(req.includes(guided.guidance.hint));assert.ok(req.includes(image.imageBase64));assert.ok(req.includes('visible contour'));assert.ok(req.includes('hypothesis, not validated fact'))
 assert.deepEqual(result.guidedChanges.changed,['selected']);assert.deepEqual(result.guidedChanges.unchanged,['other']);assert.equal(result.guidance.sourceAnalysisId,old.id)
 assert.deepEqual(await readFile(path.join(dir,old.id+'.json')),before);assert.equal(await readFile(path.join(dir,old.id+'.json.review'),'utf8'),'original review sentinel')
 assert.ok(!(await readdir(dir)).includes(result.id+'.json.review'));const restored=await service.restore(result.id);assert.ok(Object.values(restored.rows).every(r=>r.index===undefined))
 await service.analyze(guided);assert.equal(calls,3)
 output={...value,relations:[{...value.relations[0],status:'validated'}]};const bad=await service.analyze({...guided,requestId:randomUUID()});assert.equal(bad.status,'failed');assert.equal(bad.analysis,null);assert.ok(bad.outputValidation.issues.length)
 }finally{await rm(dir,{recursive:true,force:true})}
})

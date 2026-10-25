import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createBrickReverse} from '../server/brick-reverse.mjs'
import {inspectGeometryOutput} from '../server/brick-reverse-output.mjs'
import {validateGeometryAnalysis} from '../server/brick-reverse-geometry.mjs'
const id='68f4a642-75e6-47b6-b3eb-a719362f5a1e', field='$.observations[6].dimensions.width_studs.anchor_ids[0]'
const operation={path:field,action:'remove',reason:'Isolated test: remove undeclared scale reference, retain all visual evidence and inferred value.',confirmed:true}
test('isolated saved penguin revision, restart, review drafts and immutable lineage',async t=>{
 let bytes;try{bytes=await readFile(new URL('../generated/brick-reverse/'+id+'.json',import.meta.url))}catch(e){if(e.code==='ENOENT')return t.skip('Saved local trace absent');throw e}
 const dir=await mkdtemp(path.join(tmpdir(),'anchor-revision-'));const deps={getCatalog:async()=>({colors:[]}),callModel:()=>assert.fail('No LLM')}
 try{
 await writeFile(path.join(dir,id+'.json'),bytes);let service=createBrickReverse(dir,deps)
 const initial=await service.restore(id);assert.equal(initial.analysis.outputValidation.issues[0].path,field)
 const names=await readdir(dir);await service.revalidate({analysisId:id});assert.deepEqual(await readdir(dir),names)
 for(const op of [{...operation,confirmed:false},{...operation,reason:''},{...operation,path:'$.observations[0].color'},{...operation,action:'replace',anchorId:'white_strip'},{...operation,action:'add'}]) await assert.rejects(service.revise({analysisId:id,requestId:randomUUID(),operation:op}),e=>e.statusCode===422)
 const replaced=await service.revise({analysisId:id,requestId:randomUUID(),operation:{...operation,action:'replace',anchorId:'head_front'}})
 assert.equal(replaced.status,'complete');assert.equal(replaced.analysis.observations[6].dimensions.width_studs.anchor_ids[0],'head_front')
 const requestId=randomUUID(),revision=await service.revise({analysisId:id,requestId,operation})
 assert.equal(revision.status,'complete');assert.equal(revision.analysis.observations.length,11);assert.equal(revision.analysis.relations.length,15);validateGeometryAnalysis(revision.analysis)
 const original=JSON.parse(JSON.parse(bytes).rawOutput),expected=structuredClone(original);expected.observations[6].dimensions.width_studs.anchor_ids.splice(0,1)
 assert.deepEqual(revision.analysis,expected);assert.equal(revision.rawOutput,JSON.parse(bytes).rawOutput)
 assert.equal(revision.revision.originalAnalysisId,id);assert.equal((await service.revise({analysisId:id,requestId,operation})).id,requestId)
 service=createBrickReverse(dir,deps);const restored=await service.restore(requestId)
 assert.equal(Object.keys(restored.rows).length,11);assert.ok(Object.values(restored.rows).every(r=>r.index===undefined&&!r.search))
 await service.saveReview({analysisId:requestId,rows:restored.rows});assert.ok((await service.restore(requestId)).updatedAt)
 assert.equal((await service.restore(id)).analysis.outputValidation.issues.length,1)
 assert.deepEqual(await readFile(path.join(dir,id+'.json')),bytes)
 // Additional errors survive a local repair; failed revision remains editable.
 const bad=JSON.parse(bytes),badOutput=JSON.parse(bad.rawOutput);badOutput.relations[0].from='nonexistent';bad.id=randomUUID();bad.rawOutput=JSON.stringify(badOutput);await writeFile(path.join(dir,bad.id+'.json'),JSON.stringify(bad))
 const failed=await service.revise({analysisId:bad.id,requestId:randomUUID(),operation});assert.equal(failed.status,'failed');assert.ok(failed.outputValidation.issues.some(i=>i.path.includes('relations')))
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('provider, JSON parsing and schema failure stages stay distinct',()=>{
 const record={id,kind:'reverse-analysis',analysis_mode:'geometry_only',rawOutput:'{',httpStatus:200,finishReason:'completed'}
 assert.equal(inspectGeometryOutput(record).stage,'json_parse_failed')
 assert.equal(inspectGeometryOutput({...record,httpStatus:500}).stage,'provider_failed')
 assert.equal(inspectGeometryOutput({...record,rawOutput:'{}'}).stage,'output_validation_failed')
 assert.equal(inspectGeometryOutput({...record,finishReason:'incomplete'}).stage,'provider_failed')
})

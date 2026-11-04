import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {multiFixture} from './magnetic-multi-image-fixtures.mjs'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {createVisible3DWorkflow} from '../server/magnetic-visible3d.mjs'
import {serializeAssembly3D} from '../src/magnetic-tiles/three-d/assembly.ts'
import {analysisHistoryEntries} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-display.ts'

export function evidenceFor(source,template,count=25){
 const value=structuredClone(template)
 if(!source.images){delete value.referenceImageId;value.observations.forEach(o=>delete o.imageEvidence);return value}
 value.referenceImageId=source.primaryImageId
 while(value.observations.length<count)value.observations.push({...structuredClone(value.observations[0]),id:'tile-'+value.observations.length})
 const ids=new Set(source.images.map(e=>e.sourceId))
 for(const o of value.observations){o.imageEvidence=o.imageEvidence.filter(e=>ids.has(e.imageId));const anchor=o.imageEvidence.find(e=>e.imageId===source.primaryImageId);o.bbox=anchor.bbox;o.features=anchor.features}
 return value
}
async function setup(t){
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-project-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f={dir,...await multiFixture(dir)},calls=[]
 const workflow=createVisible3DWorkflow(path.join(dir,'visible3d'),{readSource:id=>f.api.dispatch('GET','sources/'+id),readImage:s=>f.api.dispatch('GET','image/'+s.id),readImages:s=>Promise.all((s.images??[{sourceId:s.id}]).map(async e=>({...e,...await f.api.dispatch('GET','image/'+e.sourceId)}))),getRegistry:()=>f.api.dispatch('GET','profiles'),runModel:async(prepared,options)=>{
  calls.push(prepared.input);const value=evidenceFor(prepared.source,f.evidence),id=randomUUID(),trace={id,status:'plan_ready_for_review',parseStatus:'parsed',wireStatus:'response_saved',finishReason:'completed',validation:{valid:true},requestInput:prepared.input,sources:options.sources,plan:value,rawOutput:JSON.stringify(value)}
  await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,id+'.json'),JSON.stringify(trace));return trace
 }})
 const three=await f.api.dispatch('POST','source-sets',{images:f.images.slice(0,3).map((e,i)=>({...e,role:i===2?'Final':'Step'}))}),two=await f.api.dispatch('POST','source-sets',{images:f.images.slice(0,2).map((e,i)=>({...e,role:i===1?'Final':'Step'}))})
 return {...f,workflow,calls,three,two,project:randomUUID()}
}
const run=(f,method,route,body,owner=f.project)=>f.workflow.dispatch(method,'project/'+owner+'/'+route,body)
const analyze=(f,source)=>run(f,'POST','analyze',{requestId:randomUUID(),model:'gpt-6.1-sol',sourceId:source.id,sourceHash:source.hash})

test('one stable Project owns three-image and two-image Analysis snapshots, through restart and fresh clients',async t=>{
 const f=await setup(t);assert.notEqual(f.three.id,f.two.id)
 const before=JSON.stringify(await f.api.dispatch('GET','sources/'+f.three.id)),a=await analyze(f,f.three),b=await analyze(f,f.two)
 assert.equal(a.usable,true);assert.equal(b.usable,true);assert.equal(a.record.projectId,f.project);assert.equal(b.record.projectId,f.project);assert.equal(a.record.evidence.observations.length,25)
 assert.equal(a.record.sourceHash,f.three.hash);assert.equal(b.record.sourceHash,f.two.hash);assert.notEqual(a.record.hash,b.record.hash)
 assert.deepEqual(f.calls.map(c=>c.projectId),[f.project,f.project]);assert.equal(f.calls[0].images[2].role,'Final');assert.equal(f.calls[1].images[1].role,'Final')
 const restarted=createMagneticIntake(f.dir),h=await restarted.dispatch('GET',`visible3d/project/${f.project}/history`),requests=await run(f,'GET','requests')
 assert.equal(h.analyses.length,2);assert.equal(h.sources.length,2);assert.equal(analysisHistoryEntries(requests,h.analyses,f.project).length,2)
 for(const [record,source] of [[a.record,f.three],[b.record,f.two]]){
  const l=await restarted.dispatch('GET',`visible3d/project/${f.project}/analyses/${record.id}`);assert.equal(l.source.hash,source.hash);assert.deepEqual(l.source.images,source.images)
 }
 assert.equal(JSON.stringify(await f.api.dispatch('GET','sources/'+f.three.id)),before)
 const single=await analyze(f,f.sources[0]);assert.equal(single.usable,true);assert.equal(single.record.projectId,f.project);assert.equal((await run(f,'GET','history')).analyses.length,3)
})

test('Project heads and histories stay independent even with identical image snapshots; old records are not adopted',async t=>{
 const f=await setup(t),other=randomUUID(),old=await f.api.dispatch('POST','visible3d/annotate',{sourceId:f.three.id,evidence:evidenceFor(f.three,f.evidence)})
 assert.equal((await run(f,'GET','history')).analyses.length,0)
 await assert.rejects(run(f,'POST','workspace-history',{refs:[],requestIds:[]}),/不使用浏览器收据查询/)
 const a=await analyze(f,f.three),b=await run(f,'POST','annotate',{sourceId:f.three.id,evidence:evidenceFor(f.three,f.evidence)},other)
 await run(f,'POST','selected',{sourceId:f.three.id,stage:'analysis',id:a.record.id,hash:a.record.hash,expectedRevision:0})
 assert.equal((await run(f,'GET','head/'+f.three.id,undefined,other)).analysisId,null)
 await assert.rejects(f.api.dispatch('POST','visible3d/reviews',{analysisId:a.record.id,review:f.review,expectedRevision:0}),/所属作品 Project/)
 await assert.rejects(run(f,'GET','analyses/'+a.record.id,undefined,other),/不属于当前作品/)
 await assert.rejects(run(f,'POST','reviews',{analysisId:a.record.id,review:f.review,expectedRevision:0},other),/不属于当前作品/)
 await assert.rejects(run(f,'POST','resume-analyze',{requestId:a.id,sourceId:f.three.id,sourceHash:f.three.hash},other),/不属于当前作品/)
 await assert.rejects(run(f,'GET','trace/'+a.trace.id,undefined,other),/不属于当前作品/)
 assert.deepEqual((await run(f,'GET','history')).analyses.map(r=>r.id),[a.record.id]);assert.deepEqual((await run(f,'GET','history',undefined,other)).analyses.map(r=>r.id),[b.id])
 assert.deepEqual(await f.api.dispatch('GET','visible3d/analyses/'+old.id).then(l=>l.analysis),old)
})

test('Review/Plan/Execution stay attached to their exact Analysis and input; new Project origins still save in the existing Assembly library',async t=>{
 const f=await setup(t),a=await run(f,'POST','annotate',{sourceId:f.three.id,evidence:evidenceFor(f.three,f.evidence,2)}),b=await run(f,'POST','annotate',{sourceId:f.two.id,evidence:evidenceFor(f.two,f.evidence,2)})
 const ar=await run(f,'POST','reviews',{analysisId:a.id,review:f.review,expectedRevision:0}),br=await run(f,'POST','reviews',{analysisId:b.id,review:f.review,expectedRevision:0})
 assert.equal(ar.record.analysisHash,a.hash);assert.equal(br.record.sourceHash,f.two.hash)
 await assert.rejects(run(f,'POST','selected',{sourceId:f.two.id,stage:'review',id:ar.record.id,hash:ar.record.hash,expectedRevision:br.head.selectedRevision}),/Project \/ Hash/)
 const p=await run(f,'POST','manual-plan',{reviewId:ar.record.id,plan:f.plan}),x=await run(f,'POST','execute',{planId:p.id,requestId:randomUUID()})
 assert.equal(x.state,'complete');assert.equal(x.record.projectId,f.project);assert.equal(x.record.candidates.length,1)
 await assert.rejects(run(f,'POST','selected',{sourceId:f.two.id,stage:'plan',id:p.id,hash:p.hash,expectedRevision:br.head.selectedRevision}),/Project \/ Hash/)
 const origin=await run(f,'POST','adopt',{executionId:x.record.id,candidateId:x.record.candidates[0].id})
 const root=createMagneticIntake(f.dir),verified=await root.dispatch('GET','visible3d/selected-origin/'+origin.id)
 assert.equal(verified.projectId,f.project);assert.equal(verified.sourceHash,f.three.hash)
 const saved=await root.dispatch('POST','assembly3d/save',{snapshot:{assembly:origin.assembly,photoOrigin:{origin,assemblyRaw:serializeAssembly3D(origin.assembly)},nonRepairable:[]},expectedHash:null});assert.equal(saved.lineage.selected,true);assert.equal(saved.snapshot.photoOrigin.origin.projectId,f.project)
 const sourceFile=path.join(f.dir,'visible3d/analyses',a.id+'.json');assert.equal(JSON.parse(await readFile(sourceFile,'utf8')).sourceId,f.three.id)
})

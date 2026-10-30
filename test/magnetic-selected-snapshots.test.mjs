import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,unlink,readdir} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {mergeSelectedHistory,resolveSelectedDefaults,selectedFirst,sourceReviews} from '../src/magnetic-tiles/intake/selected-snapshots.ts'
const evidence={sourceKind:'diagram',reason:'retained',observations:[],relations:[]}
async function setup(run){
 const dir=await mkdtemp(path.join(os.tmpdir(),'magnetic-selected-')),files=new Map()
 async function seed(kind,value){const {hash:_,...payload}=value;const record={...payload,hash:await contentHash(payload)},file=path.join(dir,kind,value.id+'.json');await mkdir(path.dirname(file),{recursive:true});const data=JSON.stringify(record);await writeFile(file,data);files.set(file,data);return record}
 try{
  const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),createdAt:'2026-10-29T00:00:00Z',view:{width:100,height:100}})
  const other=await seed('sources',{...source,id:crypto.randomUUID(),hash:undefined})
  const analysis=(s,n,status='complete')=>seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:s.id,sourceHash:s.hash,status,evidence,createdAt:`2026-10-29T00:00:0${n}Z`})
  const a=await analysis(source,1),b=await analysis(source,2),foreign=await analysis(other,3),processing=await analysis(source,4,'processing'),failed=await analysis(source,5,'failed')
  const api=createMagneticIntake(dir),r=await api.dispatch('POST','reviews',{analysisId:b.id,analysisHash:b.hash,evidence})
  files.set(path.join(dir,'reviews',r.id+'.json'),await readFile(path.join(dir,'reviews',r.id+'.json'),'utf8'))
  const get=()=>api.dispatch('GET','selected/'+source.id)
  const set=(stage,snapshotId,expectedRevision)=>api.dispatch('POST','selected',{sourceId:source.id,stage,snapshotId,expectedRevision})
  await run({dir,files,source,other,a,b,foreign,processing,failed,r,api,get,set,seed})
 }finally{await rm(dir,{recursive:true,force:true})}
}
test('independent per-Source/stage Selected mappings persist; browse and save never select; snapshots stay byte-identical',()=>setup(async({dir,files,source,a,b,r,api,get,set})=>{
 assert.deepEqual((await get()).map(s=>[s.stage,s.snapshotId,s.revision,s.valid]),[['analysis',null,0,true],['review',null,0,true]])
 await set('analysis',a.id,0);await set('review',r.id,0)
 const selected=await get();assert.equal(selected[0].snapshotId,a.id);assert.equal(selected[1].snapshotId,r.id);assert.equal(selected[1].analysisId,b.id)
 assert.deepEqual(await createMagneticIntake(dir).dispatch('GET','selected/'+source.id),selected)
 await api.dispatch('GET','analyses/'+b.id)
 await api.dispatch('POST','reviews',{analysisId:b.id,analysisHash:b.hash,evidence})
 assert.deepEqual(await get(),selected)
 const history=await api.dispatch('GET','history');assert.equal(history.selectedSnapshots.filter(s=>s.sourceId===source.id&&s.snapshotId).length,2)
 assert.equal(history.selectedSnapshots.filter(s=>s.sourceId!==source.id&&s.snapshotId).length,0)
 await set('analysis',b.id,1);assert.equal((await get())[0].snapshotId,b.id)
 await set('analysis',null,2);assert.equal((await get())[0].snapshotId,null)
 await assert.rejects(set('analysis',a.id,1),e=>e.statusCode===409)
 assert.equal((await get())[0].revision,3,'cancel retains the revision; stale ABA writes cannot succeed')
 for(const [file,data] of files)assert.equal(await readFile(file,'utf8'),data)
}))
test('CAS rejects concurrent writes from two instances and two actual processes; exactly one reference wins',()=>setup(async({dir,source,a,b,get,set})=>{
 const second=createMagneticIntake(dir)
 const results=await Promise.allSettled([set('analysis',a.id,0),second.dispatch('POST','selected',{sourceId:source.id,stage:'analysis',snapshotId:b.id,expectedRevision:0})])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.statusCode===409))
 assert.equal((await get())[0].revision,1)
 const script=`import {createMagneticIntake} from ${JSON.stringify(new URL('../server/magnetic-intake.mjs',import.meta.url).href)};try{await createMagneticIntake(process.argv[1]).dispatch('POST','selected',{sourceId:process.argv[2],stage:'analysis',snapshotId:process.argv[3],expectedRevision:1});console.log('won')}catch(e){if(e.statusCode!==409)throw e;console.log('conflict')}`
 const run=promisify(execFile),outcomes=await Promise.all([a,b].map(s=>run(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,dir,source.id,s.id])))
 assert.deepEqual(outcomes.map(o=>o.stdout.trim()).sort(),['conflict','won'])
 assert.equal((await get())[0].revision,2)
}))
test('invalid stage, IDs, source, source hash, mutable Analysis and broken Review lineage are rejected',()=>setup(async({source,a,foreign,processing,failed,r,api,get,set,seed})=>{
 for(const input of [()=>set('build',a.id,0),()=>set('analysis','../x',0),()=>set('analysis',foreign.id,0),()=>set('analysis',crypto.randomUUID(),0),()=>set('analysis',a.id,-1),()=>set('analysis',a.id,NaN),()=>set('analysis',processing.id,0)])await assert.rejects(input())
 await assert.rejects(api.dispatch('POST','selected',{sourceId:'../source',stage:'review',snapshotId:r.id,expectedRevision:0}))
 const broken=await seed('reviews',{...r,id:crypto.randomUUID(),analysisHash:'wrong'})
 await assert.rejects(set('review',broken.id,0),/来源 Analysis/)
 const wrongSourceHash=await seed('analyses',{...a,id:crypto.randomUUID(),sourceId:source.id,sourceHash:'wrong'})
 await assert.rejects(set('analysis',wrongSourceHash.id,0),/Source Image/)
 assert.ok((await get()).every(s=>s.revision===0))
 await set('analysis',failed.id,0);assert.equal((await get())[0].valid,true,'terminal failed records can be explicitly selected without invoking a model')
}))
test('missing selected target/parent is reported with its original ID; no alternate record is chosen; invalid reference can be cleared',()=>setup(async({dir,a,b,r,api,get,set})=>{
 await set('analysis',a.id,0);await set('review',r.id,0)
 await unlink(path.join(dir,'analyses',a.id+'.json'))
 let state=await get();assert.equal(state[0].snapshotId,a.id);assert.equal(state[0].valid,false);assert.match(state[0].error,/缺失/)
 const h=await api.dispatch('GET','history');assert.ok(h.analyses.some(s=>s.id===b.id));assert.equal(h.selectedSnapshots.find(s=>s.stage==='analysis'&&s.snapshotId)?.snapshotId,a.id)
 await set('analysis',null,1);assert.equal((await get())[0].snapshotId,null)
 await unlink(path.join(dir,'analyses',b.id+'.json'));state=await get();assert.equal(state[1].snapshotId,r.id);assert.equal(state[1].valid,false)
 await set('review',null,1);assert.equal((await get())[1].snapshotId,null)
}))
test('damaged latest metadata blocks recovery and writes instead of falling back; unpublished temp files are ignored',()=>setup(async({dir,source,a,b,get,set})=>{
 await set('analysis',a.id,0);await set('analysis',b.id,1)
 const folder=path.join(dir,'selected',source.id,'analysis')
 await writeFile(path.join(folder,'interrupted.tmp'),'partial bytes')
 assert.equal((await get())[0].snapshotId,b.id)
 const latest=(await readdir(folder)).filter(f=>f.endsWith('.json')).sort().at(-1)
 await writeFile(path.join(folder,latest),'corrupt')
 const state=(await get())[0];assert.equal(state.valid,false);assert.equal(state.revision,null)
 await assert.rejects(set('analysis',a.id,2))
 assert.equal((await get())[0].valid,false)
}))
test('default restoration respects stage, protects local drafts and preserves a Review’s actual Analysis even when Selected differs',()=>setup(async({source,a,b,r,api,set})=>{
 await set('analysis',a.id,0);await set('review',r.id,0)
 const h=await api.dispatch('GET','history')
 assert.deepEqual(resolveSelectedDefaults(h,source.id,'source',()=>false),{analysisId:a.id})
 assert.deepEqual(resolveSelectedDefaults(h,source.id,'review',()=>false),{reviewId:r.id,analysisId:b.id})
 assert.deepEqual(resolveSelectedDefaults(h,source.id,'reconstruction',()=>false),{reviewId:r.id,analysisId:b.id})
 assert.deepEqual(resolveSelectedDefaults(h,source.id,'assembly',()=>false),{})
 assert.deepEqual(resolveSelectedDefaults(h,source.id,'review',id=>id===a.id),{analysisId:a.id,draftBlocked:true})
 const bad=structuredClone(h);bad.selectedSnapshots.find(s=>s.sourceId===source.id&&s.stage==='review').valid=false
 assert.throws(()=>resolveSelectedDefaults(bad,source.id,'review',()=>false),/无效/)
 assert.equal(sourceReviews(h,source.id).length,1)
 const rows=[{id:'new'},{id:'selected'},{id:'old'}];assert.deepEqual(selectedFirst(rows,'selected').map(r=>r.id),['selected','new','old']);assert.deepEqual(rows.map(r=>r.id),['new','selected','old'])
}))

test('late history responses cannot replace a newer Selected revision; fresh integrity errors remain visible',()=>setup(async({api,source,a,b})=>{
 const newer=await api.dispatch('GET','history'),older=structuredClone(newer)
 const latest=newer.selectedSnapshots.find(s=>s.sourceId===source.id&&s.stage==='analysis'),stale=older.selectedSnapshots.find(s=>s.sourceId===source.id&&s.stage==='analysis')
 Object.assign(latest,{revision:5,snapshotId:a.id});Object.assign(stale,{revision:4,snapshotId:b.id})
 assert.equal(mergeSelectedHistory(newer,older).selectedSnapshots.find(s=>s.sourceId===source.id&&s.stage==='analysis').snapshotId,a.id)
 Object.assign(stale,{revision:5,valid:false,error:'selected snapshot missing'})
 assert.equal(mergeSelectedHistory(newer,older).selectedSnapshots.find(s=>s.sourceId===source.id&&s.stage==='analysis').valid,false)
 Object.assign(stale,{revision:null,error:'metadata damaged'})
 assert.equal(mergeSelectedHistory(newer,older).selectedSnapshots.find(s=>s.sourceId===source.id&&s.stage==='analysis').error,'metadata damaged')
}))

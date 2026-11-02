import {selectFixture} from './magnetic-selected-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {assertModules,changeModules,moduleAssignments,moduleFilterIds} from '../src/magnetic-tiles/three-d/reconstruction/module-plan.ts'
import {reviewDisplayDefaults,normalizeReviewDisplay,reviewImageSelection,imageFilteredIds,filteredReviewRows} from '../src/magnetic-tiles/intake/review-display.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {visibleFixture,png} from './magnetic-visible3d-fixtures.mjs'
const car=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/car-reviewed-geometry.json',import.meta.url),'utf8')),review=car.input.review
const rear=['p01','p02','p03','p09','p11','p12','p13','p14'],front=['p15','p16','p17','p18','p19','p20','p21','p22','p23']
test('manual module commands retain exact Observation identity and unique membership without changing Review',()=>{
 const before=JSON.stringify(review),a=randomUUID(),b=randomUUID(),one=changeModules([],review,{kind:'create',name:'后部 + 绿色斜坡',observationIds:rear},a),two=changeModules(one.modules,review,{kind:'create',name:'前部',observationIds:front},b)
 assert.equal(two.modules.length,2);assert.equal(Object.keys(moduleAssignments(two.modules)).length,17);assert.equal(moduleFilterIds(two.modules,'unassigned',review).length,6);assert.deepEqual(moduleFilterIds(two.modules,a,review),rear);assert.equal(moduleFilterIds(two.modules,'all',review).length,23)
 const renamed=changeModules(two.modules,review,{kind:'rename',moduleId:a,name:'后部'},randomUUID());assert.equal(renamed.modules[0].id,a);assert.deepEqual(renamed.modules[0].observationIds,rear)
 assert.throws(()=>changeModules(two.modules,review,{kind:'members',moduleId:b,observationIds:[...front,'p01']},randomUUID()),/明确移动/)
 const moved=changeModules(two.modules,review,{kind:'members',moduleId:b,observationIds:[...front,'p01'],move:true},randomUUID());assert.ok(!moved.modules[0].observationIds.includes('p01'));assert.equal(moved.modules[1].observationIds.filter(id=>id==='p01').length,1);assert.deepEqual(moved.change.moved,[{observationId:'p01',fromModuleId:a,toModuleId:b}])
 const deleted=changeModules(moved.modules,review,{kind:'delete',moduleId:b},randomUUID());assert.equal(moduleFilterIds(deleted.modules,'unassigned',review).length,16);assert.equal(JSON.stringify(review),before)
})
test('bad IDs, duplicate members, unsupported fields, cross-Review members and unnamed modules are rejected',()=>{
 const id=randomUUID()
 for(const command of [{kind:'create',name:'x',observationIds:['p01','p01']},{kind:'create',name:'x',observationIds:['foreign']},{kind:'create',name:'',observationIds:['p01']},{kind:'create',name:'x',observationIds:[]}])assert.throws(()=>changeModules([],review,command,id))
 assert.throws(()=>assertModules([{id,name:'x',observationIds:['p01']},{id:randomUUID(),name:'y',observationIds:['p01']}],review),/两个模块/)
 assert.throws(()=>assertModules([{id,name:'x',observationIds:[],pose:[]}],review),/无效/)
})
test('3D auto selection becomes persistent only after explicit selection; image/filter changes never overwrite manual IDs',()=>{
 const d=reviewDisplayDefaults(),auto=reviewImageSelection(d,'one',['p01','p03'],rear,true);assert.deepEqual(auto.markedIds,['p01','p03']);assert.deepEqual(reviewImageSelection(d,'two',['p02'],rear,true).markedIds,['p02'])
 const manual=normalizeReviewDisplay({...d,manualSelection:true,markedIds:rear},['one','two'],review.pieces.map(p=>p.id)),switched=reviewImageSelection(manual,'two',['p02'],['p02'],true);assert.deepEqual(switched.markedIds,rear);assert.deepEqual(switched.eligibleIds,['p02']);assert.equal(switched.markedIds.filter(id=>!switched.eligibleIds.includes(id)).length,7)
 const empty={...manual,markedIds:[]};assert.deepEqual(reviewImageSelection(empty,'one',rear,rear,true).markedIds,[])
 assert.deepEqual(reviewImageSelection(manual,'one',['p01'],rear,false).markedIds,['p01'],'2D keeps its previous picture-based rule')
})
test('module AND image OR AND text/status filters do not duplicate or mutate evidence',()=>{
 const id=randomUUID(),modules=[{id,name:'rear',observationIds:rear}],obs=car.input.evidence.observations,before=JSON.stringify(obs),images=[...new Set(obs.flatMap(o=>(o.imageEvidence??[]).map(e=>e.imageId)))],imageIds=imageFilteredIds(obs,images.slice(0,2),car.input.evidence.referenceImageId),allowed=moduleFilterIds(modules,id,review).filter(id=>imageIds.includes(id)),rows=obs.map(o=>({id:o.id,profileId:review.pieces.find(p=>p.id===o.id).profileId,profileVersion:1,color:o.color,outline:[],excluded:false,confidence:0,evidence:o.evidence,uncertainty:o.uncertainty,origin:'observed'})),filtered=filteredReviewRows(rows,allowed,{...reviewDisplayDefaults(),filter:'Known'})
 assert.ok(filtered.every(o=>rear.includes(o.id)&&imageIds.includes(o.id)));assert.equal(new Set(filtered.map(o=>o.id)).size,filtered.length);assert.equal(JSON.stringify(obs),before)
})
async function setup(t){const dir=await mkdtemp(path.join(tmpdir(),'magnetic-module-plan-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir),f=await visibleFixture('closed-cube'),post=(r,b)=>api.dispatch('POST','visible3d/'+r,b),source=await api.dispatch('POST','sources',{name:'module offline fixture.png',original:png,view:png}),a=await post('annotate',{sourceId:source.id,evidence:f.evidence}),review=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:0}),plan=await post('manual-plan',{reviewId:review.record.id,plan:f.plan});return {dir,api,post,f,source,a,review:review.record,plan}}
test('immutable Module Plan revisions, CAS, explicit moves, history restore and lineage survive API restart',async t=>{
 const {dir,api,post,review,plan}=await setup(t),before=await api.dispatch('GET','visible3d/history'),ids=review.input.review.pieces.map(p=>p.id),state=()=>api.dispatch('GET','visible3d/module-state/'+review.id)
 assert.equal((await state()).head.revision,0)
 async function save(command){const {head}=await state();return post('module-plans',{reviewId:review.id,reviewHash:review.hash,expectedRevision:head.revision,expectedHash:head.recordHash,command})}
 const one=await save({kind:'create',name:'A',observationIds:ids.slice(0,2)}),first=one.record.modules[0].id,two=await save({kind:'create',name:'B',observationIds:ids.slice(2,4)}),second=two.record.modules[1].id
 assert.equal(one.record.modulePlanId,two.record.modulePlanId);assert.deepEqual(two.record.parent,{id:one.record.id,hash:one.record.hash});assert.equal(two.record.reviewHash,review.hash)
 const head=(await state()).head;await assert.rejects(post('module-plans',{reviewId:review.id,reviewHash:review.hash,expectedRevision:0,expectedHash:null,command:{kind:'rename',moduleId:first,name:'stale'}}),/其他页面/)
 await assert.rejects(save({kind:'members',moduleId:second,observationIds:[ids[0],ids[2]]}),/明确移动/)
 const moved=await save({kind:'members',moduleId:second,observationIds:[ids[0],ids[2]],move:true});assert.equal(moved.record.change.moved.length,1);assert.equal(moved.head.revision,head.revision+1)
 await save({kind:'rename',moduleId:first,name:'renamed'});await save({kind:'delete',moduleId:second});const restored=await save({kind:'restore',recordId:one.record.id});assert.deepEqual(restored.record.modules,one.record.modules);assert.equal(restored.record.revision,6)
 const reboot=createMagneticIntake(dir),s=await reboot.dispatch('GET','visible3d/module-state/'+review.id);assert.equal(s.history.length,6);assert.equal(s.record.id,restored.record.id);assert.deepEqual((await reboot.dispatch('GET','visible3d/module-plans/'+one.record.id)).record,one.record);assert.equal((await reboot.dispatch('GET','visible3d/module-plans/'+one.record.id)).review.id,review.id)
 const after=await api.dispatch('GET','visible3d/history');for(const k of ['analyses','reviews','plans','executions','origins'])assert.deepEqual(after[k],before[k]);assert.deepEqual((await api.dispatch('GET','visible3d/plans/'+plan.id)).record,plan)
})
test('grouping an older Review is allowed; exact source Hash, concurrent writes and membership checks remain strict',async t=>{
 const {dir,api,post,review,f,a}=await setup(t),ids=review.input.review.pieces.map(p=>p.id),body={reviewId:review.id,reviewHash:review.hash,expectedRevision:0,expectedHash:null,command:{kind:'create',name:'A',observationIds:[ids[0]]}}
 await assert.rejects(post('module-plans',{...body,reviewHash:'forged'}),/Hash/)
 const results=await Promise.allSettled([post('module-plans',body),post('module-plans',body)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const saved=results.find(r=>r.status==='fulfilled').value
 const next=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:1});assert.equal((await api.dispatch('GET','visible3d/module-state/'+review.id)).outdated,true);const grouped=await post('module-plans',{...body,expectedRevision:1,expectedHash:saved.record.hash,command:{kind:'create',name:'Older Review group',observationIds:[ids[1]]}});assert.equal(grouped.record.modules.length,2);assert.equal(grouped.record.reviewId,review.id);const renamed=await post('module-plans',{...body,expectedRevision:2,expectedHash:grouped.record.hash,command:{kind:'rename',moduleId:grouped.record.change.moduleId,name:'Renamed'}});assert.equal(renamed.record.modules[1].name,'Renamed');assert.deepEqual((await api.dispatch('GET','visible3d/module-state/'+next.record.id)).record.modules,saved.record.modules)
 const inheritedHead=(await api.dispatch('GET','visible3d/module-state/'+next.record.id)).head;await assert.rejects(post('module-plans',{...body,reviewId:next.record.id,reviewHash:next.record.hash,expectedRevision:inheritedHead.revision,expectedHash:inheritedHead.recordHash,command:{kind:'restore',recordId:saved.record.id}}),/跨 Review/)
 const forged=structuredClone(saved.record);forged.modules[0].observationIds.push(ids[0]);delete forged.hash;forged.hash=createHash('sha256').update(JSON.stringify(forged)).digest('hex');await writeFile(path.join(dir,'visible3d/module-plans',forged.id+'.json'),JSON.stringify(forged));await assert.rejects(api.dispatch('GET','visible3d/module-plans/'+forged.id),/重复/)
})

test('obsolete module history preference is ignored without changing actual selection or grouping filter',()=>{
 const state=normalizeReviewDisplay({...reviewDisplayDefaults(),moduleRecordId:'old-back-only-record',moduleFilter:'all',manualSelection:true,markedIds:['p15']},[],review.pieces.map(p=>p.id));assert.equal('moduleRecordId' in state,false);assert.deepEqual(state.markedIds,['p15']);assert.equal(state.moduleFilter,'all')
})

test('saving a Profile edit inherits the selected Review module IDs and members as an independent immutable snapshot',async t=>{
 const {dir,api,post,review,f,a}=await setup(t),ids=review.input.review.pieces.map(p=>p.id)
 let head=(await api.dispatch('GET','visible3d/module-state/'+review.id)).head
 const back=await post('module-plans',{reviewId:review.id,reviewHash:review.hash,expectedRevision:head.revision,expectedHash:head.recordHash,command:{kind:'create',name:'m_back',observationIds:ids.slice(0,3)}})
 const front=await post('module-plans',{reviewId:review.id,reviewHash:review.hash,expectedRevision:back.head.revision,expectedHash:back.head.recordHash,command:{kind:'create',name:'m_front',observationIds:ids.slice(3)}})
 const oldReviewBytes=await readFile(path.join(dir,'visible3d/reviews',review.id+'.json')),oldModulesBytes=await readFile(path.join(dir,'visible3d/module-plans',front.record.id+'.json'))
 const edited=structuredClone(f.review);edited.pieces[0].profileId='equilateral-triangle'
 const next=await post('reviews',{analysisId:a.id,review:edited,expectedRevision:1,baseReview:{id:review.id,hash:review.hash}})
 assert.deepEqual(next.record.parentReview,{id:review.id,hash:review.hash});assert.deepEqual(next.record.input.review.pieces.slice(1),review.input.review.pieces.slice(1));assert.equal(next.record.input.review.pieces[0].profileId,'equilateral-triangle')
 const state=await api.dispatch('GET','visible3d/module-state/'+next.record.id)
 assert.deepEqual(state.record.modules,front.record.modules);assert.equal(state.record.reviewHash,next.record.hash);assert.equal(state.record.reviewId,next.record.id);assert.equal(state.head.revision,1);assert.notEqual(state.record.modulePlanId,front.record.modulePlanId)
 assert.deepEqual(state.record.change.inheritedFrom,{id:front.record.id,hash:front.record.hash});assert.equal(state.history.length,1)
 // No shared mutable grouping: changing the new Review never edits the old one.
 const rename=await post('module-plans',{reviewId:next.record.id,reviewHash:next.record.hash,expectedRevision:state.head.revision,expectedHash:state.head.recordHash,command:{kind:'rename',moduleId:state.record.modules[0].id,name:'changed'}})
 assert.deepEqual((await api.dispatch('GET','visible3d/module-state/'+review.id)).record.modules,front.record.modules)
 // A historical editing base must first become the explicitly selected Review.
 await selectFixture(api,review.sourceId,'review',review)
 const branch=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:2,baseReview:{id:review.id,hash:review.hash}})
 assert.deepEqual((await api.dispatch('GET','visible3d/module-state/'+branch.record.id)).record.modules,front.record.modules)
 assert.notDeepEqual(rename.record.modules,front.record.modules)
 assert.deepEqual(await readFile(path.join(dir,'visible3d/reviews',review.id+'.json')),oldReviewBytes);assert.deepEqual(await readFile(path.join(dir,'visible3d/module-plans',front.record.id+'.json')),oldModulesBytes)
 const reboot=createMagneticIntake(dir);assert.deepEqual((await reboot.dispatch('GET','visible3d/module-state/'+next.record.id)).record.modules,rename.record.modules)
 await assert.rejects(post('reviews',{analysisId:a.id,review:f.review,expectedRevision:3,baseReview:{id:review.id,hash:'forged'}}),/Hash/)
 await assert.rejects(post('reviews',{analysisId:a.id,review:f.review,expectedRevision:1,baseReview:{id:review.id,hash:review.hash}}),/其他页面/)
})
test('deleted groups remain deleted; excluded and Unknown pieces keep membership; a new Analysis never inherits unrelated groups',async t=>{
 const {api,post,review,f,a,source}=await setup(t),ids=review.input.review.pieces.map(p=>p.id)
 const one=await post('module-plans',{reviewId:review.id,reviewHash:review.hash,expectedRevision:0,expectedHash:null,command:{kind:'create',name:'all',observationIds:ids}})
 const edited=structuredClone(f.review);edited.pieces[0].excluded=true;edited.pieces[0].confirmed=false;edited.pieces[1].profileId=null;edited.pieces[1].profileVersion=null;edited.pieces[1].confirmed=false
 const next=await post('reviews',{analysisId:a.id,review:edited,expectedRevision:1})
 let state=await api.dispatch('GET','visible3d/module-state/'+next.record.id);assert.deepEqual(state.record.modules,one.record.modules)
 await post('module-plans',{reviewId:next.record.id,reviewHash:next.record.hash,expectedRevision:state.head.revision,expectedHash:state.head.recordHash,command:{kind:'delete',moduleId:one.record.modules[0].id}})
 const third=await post('reviews',{analysisId:a.id,review:edited,expectedRevision:2});state=await api.dispatch('GET','visible3d/module-state/'+third.record.id);assert.deepEqual(state.record.modules,[]);assert.equal(state.head.revision,1)
 const other=await post('annotate',{sourceId:source.id,evidence:f.evidence})
 await selectFixture(api,source.id,'analysis',other)
 await assert.rejects(post('reviews',{analysisId:other.id,review:f.review,expectedRevision:3,baseReview:{id:review.id,hash:review.hash}}),/来源|Selected/)
 const fresh=await post('reviews',{analysisId:other.id,review:f.review,expectedRevision:3});assert.equal((await api.dispatch('GET','visible3d/module-state/'+fresh.record.id)).record,null)
})
test('legacy missing module inheritance is repaired with exact provenance and CAS, never replacing an existing grouping',async t=>{
 const {dir,api,post,review,f,a}=await setup(t),ids=review.input.review.pieces.map(p=>p.id)
 const saved=await post('module-plans',{reviewId:review.id,reviewHash:review.hash,expectedRevision:0,expectedHash:null,command:{kind:'create',name:'m_back',observationIds:ids}})
 const next=await post('reviews',{analysisId:a.id,review:f.review,expectedRevision:1}),inherited=await api.dispatch('GET','visible3d/module-state/'+next.record.id)
 // Isolated reproduction of a Review written before the inheritance fix.
 await rm(path.join(dir,'visible3d/module-heads',next.record.id+'.json'));await rm(path.join(dir,'visible3d/module-plans',inherited.record.id+'.json'))
 const targetBefore=await readFile(path.join(dir,'visible3d/reviews',next.record.id+'.json')),body={reviewId:next.record.id,reviewHash:next.record.hash,expectedRevision:0,expectedHash:null,command:{kind:'inherit',recordId:saved.record.id,recordHash:saved.record.hash}}
 assert.equal((await api.dispatch('GET','visible3d/module-state/'+next.record.id)).record,null)
 await assert.rejects(post('module-plans',{...body,command:{...body.command,recordHash:'forged'}}),/来源|Selected/)
 const requests=await Promise.allSettled([post('module-plans',body),post('module-plans',body)]);assert.equal(requests.filter(r=>r.status==='fulfilled').length,1)
 const restored=await api.dispatch('GET','visible3d/module-state/'+next.record.id);assert.deepEqual(restored.record.modules,saved.record.modules)
 await assert.rejects(post('module-plans',{...body,expectedRevision:restored.head.revision,expectedHash:restored.head.recordHash}),/不能覆盖/)
 assert.deepEqual(await readFile(path.join(dir,'visible3d/reviews',next.record.id+'.json')),targetBefore)
 const foreign=await post('annotate',{sourceId:(await api.dispatch('POST','sources',{name:'other.png',original:png,view:png})).id,evidence:f.evidence})
 await selectFixture(api,foreign.sourceId,'analysis',foreign)
 const newReview=await post('reviews',{analysisId:foreign.id,review:f.review,expectedRevision:2})
 await assert.rejects(post('module-plans',{...body,reviewId:newReview.record.id,reviewHash:newReview.record.hash}),/Analysis|来源|时间/)
})

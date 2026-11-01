import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {executeVisible3D} from '../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {executionDisplay} from '../src/magnetic-tiles/three-d/reconstruction/reconstruction-display.ts'
import {png} from './magnetic-visible3d-fixtures.mjs'
const fixture=JSON.parse(await readFile(new URL('../checks/magnetic-3d/fixtures/orange-reviewed-geometry.json',import.meta.url),'utf8'))
test('partial coverage is a visible completeness blocker, not a geometry or photo success',()=>{
 const c={geometry:{valid:true},coverage:{reconstructed:['a'],totalConfirmed:6}},x={status:'candidates_found',candidates:[c],diagnosticCandidates:[{}],diagnostics:[]};
 const display=executionDisplay(null,x,undefined,false);assert.equal(display.tone,'error');assert.match(display.label,/1\/6.*5/);assert.match(display.message,/Photo Match 未验证/);
 const full=executionDisplay(null,{...x,candidates:[{...c,coverage:{reconstructed:['a','b','c','d','e','f'],totalConfirmed:6}}]},undefined,false);assert.equal(full.tone,'valid');
 assert.equal(executionDisplay(null,{...x,candidates:[]},undefined,false).tone,'error');
})
test('V3 history preserves diagnostics; strict adoption rejects diagnostic IDs and replay forgery, accepts only explicit legal partials',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-execution-v3-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const api=createMagneticIntake(dir),post=(route,body)=>api.dispatch('POST','visible3d/'+route,body),f=structuredClone(fixture),source=await api.dispatch('POST','sources',{name:'orange geometry fixture.png',original:png,view:png});
 const a=await post('annotate',{sourceId:source.id,evidence:f.input.evidence}),r=await post('reviews',{analysisId:a.id,review:f.input.review,thickness:.06,expectedRevision:0}),p=await post('manual-plan',{reviewId:r.record.id,plan:f.plan});
 const x=await post('execute',{planId:p.id,requestId:randomUUID(),options:{algorithmVersion:2}});assert.equal(x.record.version,5,'client cannot choose legacy mode for a new run');assert.equal(x.record.diagnosticCandidates[0].assembly.pieces.length,6);
 // Freeze the historical V3 artifact: new V5 runs conservatively protect manual Plan constraints.
 const saved={...x.record,...executeVisible3D(p.plan,r.record.input,{algorithmVersion:3})};delete saved.hash;saved.hash=createHash('sha256').update(JSON.stringify(saved)).digest('hex');await writeFile(path.join(dir,'visible3d/executions',saved.id+'.json'),JSON.stringify(saved));x.record=saved;
 const reboot=createMagneticIntake(dir);assert.deepEqual((await reboot.dispatch('GET','visible3d/executions/'+x.record.id)).record,x.record);
 await assert.rejects(post('adopt',{executionId:x.record.id,candidateId:'diagnostic-1',visualChecked:true}),/Diagnostic/);
 assert.equal((await api.dispatch('GET','visible3d/history')).origins.length,0);
 const origin=await post('adopt',{executionId:x.record.id,candidateId:'candidate-1',visualChecked:true});assert.equal(origin.coverage.reconstructed.length,3);assert.equal(origin.coverage.unresolved.length,3);assert.deepEqual(origin.assembly.pieces,x.record.candidates[0].assembly.pieces);
 const file=path.join(dir,'visible3d/executions',x.record.id+'.json'),forged=structuredClone(x.record);forged.candidates=[{...forged.diagnosticCandidates[0],id:'candidate-1',kind:'candidate',geometry:{valid:true,issues:[]}}];delete forged.hash;forged.hash=createHash('sha256').update(JSON.stringify(forged)).digest('hex');await writeFile(file,JSON.stringify(forged));
 await assert.rejects(post('adopt',{executionId:forged.id,candidateId:'candidate-1',visualChecked:true}),/复核失败/);
})
test('orange V2 historical single-piece candidate is still replayed exactly and adoptable without rewriting history',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'magnetic-execution-v2-'));t.after(()=>rm(dir,{recursive:true,force:true}));const api=createMagneticIntake(dir),post=(route,body)=>api.dispatch('POST','visible3d/'+route,body),f=structuredClone(fixture);
 const source=await api.dispatch('POST','sources',{name:'historical fixture.png',original:png,view:png}),a=await post('annotate',{sourceId:source.id,evidence:f.input.evidence}),r=await post('reviews',{analysisId:a.id,review:f.input.review,thickness:.06,expectedRevision:0}),p=await post('manual-plan',{reviewId:r.record.id,plan:f.plan}),x=await post('execute',{planId:p.id,requestId:randomUUID()});
 const legacy={...x.record,...executeVisible3D(p.plan,r.record.input,{algorithmVersion:2})};delete legacy.diagnosticCandidates;delete legacy.hash;legacy.hash=createHash('sha256').update(JSON.stringify(legacy)).digest('hex');const file=path.join(dir,'visible3d/executions',legacy.id+'.json');await writeFile(file,JSON.stringify(legacy));const before=await readFile(file,'utf8');
 const origin=await post('adopt',{executionId:legacy.id,candidateId:'candidate-1',visualChecked:true});assert.deepEqual(origin.coverage.reconstructed,['tile6']);assert.equal(await readFile(file,'utf8'),before);
})

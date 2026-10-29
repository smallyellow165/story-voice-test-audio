import test from 'node:test'
import assert from 'node:assert/strict'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {validate,vertices} from '../src/magnetic-tiles/geometry.ts'
import {generateBuild,validateBuild} from '../src/magnetic-tiles/build-plan.ts'
import {parseAssembly,saveWorkspace,loadWorkspace} from '../src/magnetic-tiles/storage.ts'
import {checkArtwork} from '../src/magnetic-tiles/artwork.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {tile,evidenceFor} from './fixtures/magnetic-intake/cases.mjs'
const mosaic=()=>({schemaVersion:2,mode:'flat-mosaic',id:'mosaic',revision:1,name:'组件测试',instances:[tile('a'),tile('b','square',1),tile('c','right-triangle',4),tile('d','equilateral-triangle',6)]})
test('Flat Mosaic persists explicit semantics, real components and immutable tutorial snapshots',async()=>{
 const a=mosaic(),report=validate(a.instances,profiles);assert.equal(report.draftValid,true);assert.equal(report.valid,false);assert.equal(report.components.length,3);assert.equal(report.connections.length,1)
 const mem={setItem(k,v){this[k]=v},getItem(k){return this[k]??null}}
 saveWorkspace(mem,{schemaVersion:1,current:a,saved:[a]},profiles);assert.deepEqual(loadWorkspace(mem,profiles).current,a)
 const b=await generateBuild(a,profiles);assert.equal(b.plan.schemaVersion,2);assert.equal(b.plan.mode,'flat-mosaic');assert.equal(b.plan.steps.filter(s=>s.startsComponent).length,3);assert.equal(b.plan.steps.filter(s=>s.anchor).length,1)
 assert.deepEqual(await validateBuild(JSON.parse(JSON.stringify(b)),profiles),b)
 a.instances[0].pose.x=100;assert.equal(b.snapshot.assembly.instances[0].pose.x,0)
 for(const mutate of [b=>{b.plan.mode='connected-construction'},b=>{b.plan.steps[2].anchor={ownEdgeId:'e0',targetInstanceId:'a',targetEdgeId:'e0'}},b=>{delete b.plan.steps[2].startsComponent},b=>{b.plan.steps[1].addInstanceId='a'},b=>{b.snapshot.hash='bad'}]){const bad=structuredClone(b);mutate(bad);await assert.rejects(validateBuild(bad,profiles))}
 const old={...mosaic(),schemaVersion:1};delete old.mode;assert.equal(checkArtwork(old,profiles).ready,false);await assert.rejects(generateBuild(old,profiles));assert.throws(()=>parseAssembly({...old,mode:'flat-mosaic'},profiles))
})
test('25 pieces with cycles and rotation reconstruct deterministically under budget',()=>{
 const a=.37,c=Math.cos(a),s=Math.sin(a),tiles=Array.from({length:25},(_,i)=>tile('t'+String(i).padStart(2,'0'),'square',c*(i%5)-s*Math.floor(i/5),s*(i%5)+c*Math.floor(i/5),a))
 const f=evidenceFor(tiles,profiles,vertices,validate)
 const r=reconstruct(f.evidence,f.width,f.height,profiles,'large');assert.ok(r.candidates.length,JSON.stringify(r));assert.equal(r.truncated,false);assert.equal(r.candidates[0].connections,40);assert.equal(r.candidates[0].assembly.instances.length,25);assert.ok(r.explored<100);assert.deepEqual(reconstruct(f.evidence,f.width,f.height,profiles,'large'),r)
 const limited=reconstruct(f.evidence,f.width,f.height,profiles,'large','connected-construction',{trials:1});assert.equal(limited.outcome,'budget_exhausted');assert.equal(limited.truncated,true);assert.equal(limited.trials,1)
})
test('multiple components preserve image positions without invented contacts; collision and false links rejected',async()=>{
 const f=evidenceFor(mosaic().instances,profiles,vertices,validate),r=reconstruct(f.evidence,f.width,f.height,profiles,'flat','flat-mosaic')
 assert.ok(r.candidates.length,JSON.stringify(r));assert.equal(r.candidates[0].components.length,3);assert.equal(r.candidates[0].connections,1);assert.equal((await generateBuild(r.candidates[0].assembly,profiles)).plan.steps.length,4)
 assert.equal(reconstruct(f.evidence,f.width,f.height,profiles,'connected').candidates.length,0)
 const bad=structuredClone(f.evidence);bad.relations.push({from:'a',to:'c',intent:'connect',evidence:'contradiction'});assert.equal(reconstruct(bad,f.width,f.height,profiles,'bad','flat-mosaic').candidates.length,0)
 const overlap=structuredClone(f.evidence);overlap.observations[1].outline=structuredClone(overlap.observations[0].outline);overlap.relations=[];assert.equal(reconstruct(overlap,f.width,f.height,profiles,'bad','flat-mosaic').candidates.length,0)
})
import {reconstructionSummary} from '../src/magnetic-tiles/intake/contracts.ts'
test('success, no candidate and unfinished search have distinct feedback (including old records)',()=>{
 assert.match(reconstructionSummary({candidates:[{}],truncated:false}),/成功/)
 assert.match(reconstructionSummary({candidates:[],truncated:false}),/没有找到/)
 assert.match(reconstructionSummary({candidates:[],truncated:true}),/搜索未完成/)
 assert.match(reconstructionSummary({candidates:[{}],truncated:true}),/搜索未完成/)
})
test('25 independent pieces preserve separate locations in Flat Mosaic',async()=>{
 const tiles=Array.from({length:25},(_,i)=>tile('p'+i,'square',i%5*2,Math.floor(i/5)*2))
 const f=evidenceFor(tiles,profiles,vertices,validate),r=reconstruct(f.evidence,f.width,f.height,profiles,'many','flat-mosaic')
 assert.equal(r.candidates[0].components.length,25);assert.equal(r.candidates[0].connections,0);assert.equal(r.truncated,false)
 const b=await generateBuild(r.candidates[0].assembly,profiles);assert.equal(b.plan.steps.filter(s=>s.startsComponent).length,25);assert.ok(b.plan.steps.every(s=>!s.anchor))
})

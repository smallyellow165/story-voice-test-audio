import test from 'node:test'
import assert from 'node:assert/strict'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {generateBuild,contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {emptyLibrary,retainBuildPreview,storeBundle,bundleFor,parseLibrary,saveLibrary,loadLibrary} from '../src/magnetic-tiles/build-storage.ts'
import {matchingBuild,buildSaveState,buildHistory} from '../src/magnetic-tiles/build-context.ts'
const source=(id,name='Same name')=>({schemaVersion:1,id,revision:1,name,instances:[{id:'tile',profileId:'square',profileVersion:1,color:'#f5b942',pose:{x:0,y:0,angleRad:0}}]})
const progress=async b=>({planHash:await contentHash(b.plan),step:0,completed:false})
test('matching requires exact Assembly identity, revision and contents; global last active and equal names never select another work',async()=>{
 const a=source('a'),b=source('b'),ba=await generateBuild(a,profiles),bb=await generateBuild(b,profiles)
 let l=await storeBundle(emptyLibrary(),bb,profiles);assert.equal(l.activeId,bb.plan.id);assert.equal(matchingBuild(l,a),null)
 l=await storeBundle(l,ba,profiles);l.activeId=bb.plan.id
 assert.equal(matchingBuild(l,a).plan.id,ba.plan.id);assert.equal(matchingBuild(l,{...a,revision:2}),null)
 const changed=structuredClone(a);changed.instances[0].color='#000000';assert.equal(matchingBuild(l,changed),null);assert.equal(matchingBuild(l,undefined),null)
})
test('generating a different preview retains old unsaved tutorial and progress in the same backwards-compatible library',async()=>{
 const a=await generateBuild(source('a'),profiles),b=await generateBuild(source('b'),profiles)
 let l=await retainBuildPreview(emptyLibrary(),a,profiles);l.progress[a.plan.id]=await progress(a)
 l=await retainBuildPreview(l,b,profiles);l.progress[b.plan.id]=await progress(b)
 assert.equal(l.plans.length,0);assert.deepEqual(bundleFor(l,a.plan.id),a);assert.deepEqual(l.progress[a.plan.id],await progress(a));assert.equal(buildSaveState(l,a),'unsaved');assert.equal(buildHistory(l).length,2)
 const m=new Map(),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};await saveLibrary(storage,l,profiles);assert.deepEqual(await loadLibrary(storage,profiles),l)
 const saved=await storeBundle(l,a,profiles);assert.equal(buildSaveState(saved,a),'saved');assert.equal(saved.preview.plan.id,b.plan.id);assert.equal(saved.retainedPreviews.length,0);assert.deepEqual(saved.progress[a.plan.id],l.progress[a.plan.id]);assert.equal(buildSaveState(saved,b),'unsaved')
 const legacy=emptyLibrary();delete legacy.retainedPreviews;assert.deepEqual(await parseLibrary(legacy,profiles),legacy)
})
test('retained previews reject corruption, duplicate IDs and immutable conflicts without overwriting original data',async()=>{
 const a=await generateBuild(source('a'),profiles),b=await generateBuild(source('b'),profiles);let l=await retainBuildPreview(await retainBuildPreview(emptyLibrary(),a,profiles),b,profiles)
 const conflict=structuredClone(a);conflict.plan.title='changed'
 await assert.rejects(storeBundle(l,conflict,profiles),/未覆盖/);await assert.rejects(retainBuildPreview(l,conflict,profiles),/未覆盖/)
 for(const mutate of [x=>{x.retainedPreviews[0].snapshot.hash='bad'},x=>{x.retainedPreviews.push(x.preview)},x=>{x.retainedPreviews=Array(51).fill(a)}]){const bad=structuredClone(l);mutate(bad);await assert.rejects(parseLibrary(bad,profiles))}
 l=await storeBundle(l,a,profiles);assert.equal(buildSaveState(l,conflict),'different');assert.equal(buildSaveState(l,null),'none')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {alignEdge,edges,validate} from '../src/magnetic-tiles/geometry.ts'
import {contentHash,generateBuild,validateBuild,validateProgress} from '../src/magnetic-tiles/build-plan.ts'
import {BUILD_KEY,bundleFor,emptyLibrary,loadLibrary,saveLibrary,storeBundle} from '../src/magnetic-tiles/build-storage.ts'
import {parseAssembly} from '../src/magnetic-tiles/storage.ts'
const tile=(id,profileId='square',x=0,y=0,angleRad=0)=>({id,profileId,profileVersion:1,color:'#f5b942',pose:{x,y,angleRad}})
const assembly=instances=>({schemaVersion:1,id:'demo',revision:1,name:'小作品',instances})
const squareLoop=()=>assembly([tile('a'),tile('b','square',1),tile('c','square',0,1),tile('d','square',1,1)])
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}}
test('all profiles and arbitrary rotations yield steps using original poses',async()=>{
 for(const p of profiles){
  const root=tile('base','square',2,3,.37), raw=tile('new',p.id)
  // A large profile may have no unit edge: use an equal-length catalog anchor.
  const anchor=p.id==='large-equilateral-triangle'?tile('base',p.id,2,3,.37):root
  const own=edges(raw,profiles).find(e=>Math.abs(e.length-edges(anchor,profiles)[2].length)<1e-7)
  const moving=alignEdge(raw,own,edges(anchor,profiles)[2],profiles)
  const a=assembly([moving,anchor]),b=await generateBuild(a,profiles)
  assert.deepEqual(new Set(b.plan.steps.map(s=>s.addInstanceId)),new Set(['base','new']))
  if(anchor.profileId==='square')assert.equal(b.plan.steps[0].addInstanceId,'base')
  assert.deepEqual(b.snapshot.assembly,a)
  assert.deepEqual(await validateBuild(b,profiles),b)
  assert.deepEqual(b.plan.steps,(await generateBuild(a,profiles)).plan.steps)
  assert.ok(!JSON.stringify(b.plan.steps).includes('pose'))
 }
 const a=assembly([tile('t','equilateral-triangle')]);assert.equal((await generateBuild(a,profiles)).plan.steps.length,1)
})
test('closed loop preserves all connections and each prefix is connected',async()=>{
 const a=squareLoop(),b=await generateBuild(a,profiles)
 assert.equal(validate(a.instances,profiles).connections.length,4)
 const ids=new Set()
 for(const s of b.plan.steps){ids.add(s.addInstanceId);assert.equal(validate(a.instances.filter(t=>ids.has(t.id)),profiles).valid,true)}
 assert.deepEqual(b.plan.steps.map(s=>s.addInstanceId),['a','b','c','d'])
 assert.equal(validate(a.instances.filter(t=>t.id!=='d'),profiles).connections.length,2)
 assert.equal(validate(b.snapshot.assembly.instances,profiles).connections.length,4)
 // Instance array order has no influence on generated traversal.
 assert.deepEqual((await generateBuild({...a,instances:[...a.instances].reverse()},profiles)).plan.steps,b.plan.steps)
})
test('reject empty, disconnected, overlap, partial edge and missing profile',async()=>{
 for(const a of [assembly([]),assembly([tile('a'),tile('b','square',3)]),assembly([tile('a'),tile('b','square',.9)]),assembly([tile('a'),tile('b','square',1,.5)]),assembly([{...tile('a'),profileVersion:99}])])await assert.rejects(generateBuild(a,profiles))
})
test('tamper rejection: hash, source, duplicate/missing instance, false/future edge, added pose, profile mutation',async()=>{
 const b=await generateBuild(squareLoop(),profiles)
 const mutations=[
  x=>{x.snapshot.assembly.instances[0].color='#000000'},
  x=>{x.snapshot.hash='bad'},x=>{x.plan.assemblyRef.revision++},x=>{x.plan.assemblyRef.hash='bad'},
  x=>{x.plan.steps[1].addInstanceId='a'},x=>{x.plan.steps.pop()},x=>{x.plan.steps[1].addInstanceId='unknown'},
  x=>{x.plan.steps[1].anchor.ownEdgeId='e0'},x=>{x.plan.steps[1].anchor.targetInstanceId='d'},
  x=>{x.plan.steps[1].pose={x:0,y:0,angleRad:0}},x=>{x.plan.steps[0].anchor=x.plan.steps[1].anchor},
  x=>{[x.plan.steps[1],x.plan.steps[3]]=[x.plan.steps[3],x.plan.steps[1]]}
 ]
 for(const mutate of mutations){const x=structuredClone(b);mutate(x);await assert.rejects(validateBuild(x,profiles))}
 await assert.rejects(validateBuild(b,profiles.map(p=>({...p,name:p.name+'改'}))),/Profile/)
 await assert.rejects(validateBuild(b,profiles.filter(p=>p.id!=='square')))
})
test('source frozen, saved plans coexist, progress survives reload and JSON roundtrip',async()=>{
 const storage=memory(),a=squareLoop(),b=await generateBuild(a,profiles)
 let l=emptyLibrary();l.preview=b;l.activeId=b.plan.id
 l.progress[b.plan.id]={planHash:await contentHash(b.plan),step:2,completed:false}
 l=await saveLibrary(storage,l,profiles)
 assert.equal(l.plans.length,0,'preview is not a saved plan')
 assert.deepEqual(await loadLibrary(storage,profiles),l)
 l=await storeBundle(l,b,profiles);assert.equal(l.preview,null)
 a.instances[0].pose.x=40
 assert.equal(bundleFor(l,b.plan.id).snapshot.assembly.instances[0].pose.x,0)
 const second=await generateBuild(assembly([tile('other')]),profiles)
 l=await storeBundle(l,second,profiles);await saveLibrary(storage,l,profiles)
 const restored=await loadLibrary(storage,profiles)
 assert.equal(restored.plans.length,2)
 assert.equal(restored.progress[b.plan.id].step,2)
 const imported=await storeBundle(emptyLibrary(),JSON.parse(JSON.stringify(b)),profiles)
 assert.deepEqual(bundleFor(imported,b.plan.id),b)
 const conflict=structuredClone(b);conflict.plan.title='冲突'
 await assert.rejects(storeBundle(l,conflict,profiles),/未覆盖/)
 const raw=storage.getItem(BUILD_KEY)
 const broken=structuredClone(l);broken.plans[0].steps=[]
 await assert.rejects(saveLibrary(storage,broken,profiles))
 assert.equal(storage.getItem(BUILD_KEY),raw)
 assert.deepEqual(parseAssembly(b.snapshot.assembly,profiles),b.snapshot.assembly)
})
test('progress bound to immutable plan, invalid step and premature completion rejected',async()=>{
 const b=await generateBuild(squareLoop(),profiles),hash=await contentHash(b.plan)
 for(const p of [{planHash:'other',step:0,completed:false},{planHash:hash,step:99,completed:false},{planHash:hash,step:0,completed:true}])assert.throws(()=>validateProgress(p,b.plan,hash))
 assert.equal(validateProgress({planHash:hash,step:3,completed:true},b.plan,hash).completed,true)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {EPS, alignEdge, edges, findSnap, profileIssues, rotateTile, validate, vertices} from '../src/magnetic-tiles/geometry.ts'
import {emptyAssembly, loadWorkspace, parseAssembly, saveWorkspace} from '../src/magnetic-tiles/storage.ts'
const tile=(id,profileId='square',x=0,y=0,angleRad=0)=>({id,profileId,profileVersion:1,color:'#f5b942',pose:{x,y,angleRad}})
const pair=()=>[tile('a'),tile('b','square',1,0)]
test('versioned profiles: real side lengths, CCW, convexity, bad edge IDs and self-intersection',()=>{
 assert.equal(profiles.length,3)
 profiles.forEach(p=>assert.deepEqual(profileIssues(p),[]))
 const lens=edges(tile('t','right-triangle'),profiles).map(e=>e.length)
 assert.deepEqual(lens,[1,Math.SQRT2,1])
 edges(tile('t','equilateral-triangle'),profiles).forEach(e=>assert.ok(Math.abs(e.length-1)<EPS))
 const p=profiles[0]
 for(const vertices of [[[0,0],[0,1],[1,1],[1,0]],[[0,0],[1,1],[0,1],[1,0]],[[0,0],[1,0],[.5,.2],[0,1]],[[0,0],[1,0],[1,0],[0,1]]])assert.ok(profileIssues({...p,vertices}).length)
 assert.ok(profileIssues({...p,connectableEdges:['e9']}).length)
})
test('contacts: full edges connect; vertices alone do not; partial edges and overlaps are invalid',()=>{
 const r=validate(pair(),profiles);assert.equal(r.valid,true);assert.equal(r.connections.length,1)
 assert.deepEqual(r.connections[0],{a:{tileId:'a',edgeId:'e1'},b:{tileId:'b',edgeId:'e3'}})
 const corner=validate([tile('a'),tile('b','square',1,1)],profiles)
 assert.equal(corner.draftValid,true);assert.equal(corner.valid,false);assert.equal(corner.components.length,2)
 assert.ok(validate([tile('a'),tile('b','square',1,.5)],profiles).issues.some(i=>i.code==='EDGE_CONTACT'))
 assert.ok(validate([tile('a'),tile('b','square',.99,0)],profiles).issues.some(i=>i.code==='OVERLAP'))
 assert.equal(validate([tile('a'),tile('b','square',1+EPS*10,0)],profiles).connections.length,0)
 const disabled=profiles.map(p=>p.id==='square'?{...p,connectableEdges:[]}:p)
 assert.ok(validate(pair(),disabled).issues.some(i=>i.code==='EDGE_CONTACT'))
})
test('snap transforms every compatible profile edge without scaling, in arbitrary world orientation',()=>{
 for(const a of profiles)for(const b of profiles){
  const targetTile=tile('target',a.id,2,-3,.37),moving=tile('moving',b.id)
  for(const e of edges(moving,profiles))for(const target of edges(targetTile,profiles)){
   if(Math.abs(e.length-target.length)>EPS)continue
   const aligned=alignEdge(moving,e,target,profiles),r=validate([targetTile,aligned],profiles)
   assert.equal(r.valid,true,JSON.stringify({a:a.id,b:b.id,e:e.id,target:target.id,issues:r.issues}))
   assert.equal(r.connections.length,1)
  }
 }
})
test('capture tolerance does not weaken final geometry; occupied edges and wrong lengths do not snap',()=>{
 const a=tile('a'),b=tile('b','square',1.08,.03)
 const snap=findSnap(b,[a],profiles,.2)
 assert.ok(snap);assert.equal(validate([a,snap.tile],profiles).valid,true)
 assert.equal(validate([a,b],profiles).connections.length,0)
 assert.equal(findSnap(tile('far','square',4,0),[a],profiles,.2),null)
 assert.equal(findSnap(tile('third','square',1.02,.02),pair(),profiles,.2),null)
 const hyp=tile('h','right-triangle',0,0,Math.PI/4)
 assert.equal(edges(hyp,profiles)[1].length>1.4,true)
})
test('moving, rotating, deleting and restoring a six-piece house recomputes connectivity',()=>{
 const house=[tile('a'),tile('b','square',1,0),tile('c','square',0,1),tile('d','square',1,1),tile('e','right-triangle',1,2,Math.PI/2),tile('f','right-triangle',1,2)]
 const r=validate(house,profiles);assert.equal(r.valid,true);assert.equal(r.connections.length,7)
 const moved=house.map(t=>t.id==='f'?{...t,pose:{...t.pose,x:4}}:t)
 assert.equal(validate(moved,profiles).components.length,2)
 const rot=rotateTile(house[5],Math.PI/12,profiles)
 assert.ok(validate([...house.slice(0,5),rot],profiles).issues.length)
 assert.equal(validate(house.slice(0,5),profiles).valid,true)
 assert.deepEqual(validate(structuredClone(house),profiles),r)
})
test('three equal triangles close a half hexagon; cycles and duplicate edge occupation are checked',()=>{
 const ring=Array.from({length:6},(_,i)=>tile('t'+i,'equilateral-triangle',0,0,i*Math.PI/3))
 assert.equal(validate(ring,profiles).valid,true);assert.equal(validate(ring,profiles).connections.length,6)
 const duplicates=validate([...pair(),tile('duplicate','square',1,0)],profiles)
 assert.ok(duplicates.issues.some(i=>i.code==='EDGE_OCCUPIED'));assert.ok(duplicates.issues.some(i=>i.code==='OVERLAP'))
 const broken=ring.map((t,i)=>i===5?{...t,pose:{...t.pose,x:.001}}:t)
 assert.equal(validate(broken,profiles).valid,false)
})
test('persistence round trip preserves poses and graph; disconnected drafts can reload',()=>{
 let data=null;const storage={getItem:()=>data,setItem:(_,v)=>{data=v}}
 assert.equal(loadWorkspace(storage,profiles),null)
 const current={...emptyAssembly(),instances:pair()},w={schemaVersion:1,current,saved:[current]}
 saveWorkspace(storage,w,profiles)
 assert.deepEqual(loadWorkspace(storage,profiles),w)
 assert.deepEqual(validate(loadWorkspace(storage,profiles).current.instances,profiles),validate(current.instances,profiles))
 assert.equal(parseAssembly({...current,instances:[tile('a'),tile('b','square',4,0)]},profiles).instances.length,2)
 data='{';assert.throws(()=>loadWorkspace(storage,profiles))
 assert.throws(()=>saveWorkspace({setItem(){throw Error('QuotaExceeded')}},w,profiles),/QuotaExceeded/)
})
test('imports fail closed: unknown versions, scaling, duplicate IDs, invalid floats and overlap',()=>{
 const a={...emptyAssembly(),instances:pair()}
 for(const bad of [{...a,schemaVersion:2},{...a,connections:[]},{...a,instances:[{...tile('a'),profileVersion:2}]},{...a,instances:[{...tile('a'),scale:2}]},{...a,instances:[tile('a'),tile('a','square',1,0)]},{...a,instances:[tile('a','square',NaN)]},{...a,instances:[tile('a'),tile('b','square',.5,0)]}])assert.throws(()=>parseAssembly(bad,profiles))
 assert.equal(validate([],profiles).valid,false);assert.equal(validate([],profiles).draftValid,true)
 assert.deepEqual(vertices(tile('s'),profiles),[[0,0],[1,0],[1,1],[0,1]])
})

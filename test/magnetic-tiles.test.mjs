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

test('rotated edge-centre capture works at close zoom for all compatible shapes, including 45 degrees',()=>{
 // Rotate about the already aligned edge centre: the edge is physically near,
 // but the old endpoint metric rejected it as zoom increased.
 const around=(t,pivot,angle)=>{const c=Math.cos(angle),s=Math.sin(angle),x=t.pose.x-pivot[0],y=t.pose.y-pivot[1];return {...t,pose:{x:pivot[0]+c*x-s*y,y:pivot[1]+s*x+c*y,angleRad:t.pose.angleRad+angle}}}
 for(const a of profiles)for(const b of profiles){
  const base=tile('base',a.id,1,-1,.21),source=tile('moving',b.id)
  for(const own of edges(source,profiles))for(const target of edges(base,profiles)){
   if(Math.abs(own.length-target.length)>EPS)continue
   const aligned=alignEdge(source,own,target,profiles),pivot=[(target.a[0]+target.b[0])/2,(target.a[1]+target.b[1])/2]
   for(const degrees of [-45,-30,-15,15,30,45]){
    const raw=around(aligned,pivot,degrees*Math.PI/180)
    const snap=findSnap(raw,[base],profiles,.05)
    assert.ok(snap,JSON.stringify({a:a.id,b:b.id,own:own.id,target:target.id,degrees}))
    assert.equal(validate([base,snap.tile],profiles).valid,true)
    assert.equal(snap.contactCount,1)
   }
  }
 }
})
test('nearby candidates have stable hysteresis but release to a materially closer target',()=>{
 const others=[tile('lower'),tile('upper','square',0,2.1)]
 const moving=y=>tile('m','square',0,y)
 const first=findSnap(moving(1.04),others,profiles,.2)
 assert.ok(first);assert.equal(first.target.tileId,'lower')
 for(const y of [1.049,1.051,1.055,1.045]){
  assert.equal(findSnap(moving(y),others,profiles,.2,first.key).key,first.key)
 }
 const switched=findSnap(moving(1.095),others,profiles,.2,first.key)
 assert.ok(switched);assert.equal(switched.target.tileId,'upper')
 const tie=findSnap(moving(1.05),others,profiles,.2)
 assert.equal(findSnap(moving(1.05),[...others].reverse(),profiles,.2).key,tie.key)
 assert.equal(findSnap(moving(4),others,profiles,.2,first.key),null)
})
test('capture radius hysteresis, invalid lengths and occupied targets do not bypass validation',()=>{
 const first=findSnap(tile('m','square',1.08,0),[tile('a')],profiles,.1)
 assert.ok(first)
 assert.equal(findSnap(tile('m','square',1.12,0),[tile('a')],profiles,.1),null)
 assert.ok(findSnap(tile('m','square',1.12,0),[tile('a')],profiles,.1,first.key))
 assert.equal(findSnap(tile('m','square',1.15,0),[tile('a')],profiles,.1,first.key),null)
 // Horizontal hypotenuse is close to a square's top edge but is sqrt(2), not 1.
 const hyp=tile('h','right-triangle',.5,1+Math.SQRT1_2+.01,-3*Math.PI/4)
 assert.equal(findSnap(hyp,[tile('a')],profiles,.05),null)
 assert.equal(findSnap(tile('third','square',1,0),pair(),profiles,.2),null)
 assert.equal(findSnap(tile('m','square',1,0),[tile('a')],profiles,NaN),null)
 assert.equal(findSnap(tile('m','square',1.5,0),[tile('a')],profiles,10),null,'zoom out must not capture half a tile away')
})
test('multi-edge placements and cyclic closure are evaluated at the one exact proposed pose',()=>{
 const others=[tile('a'),tile('b','square',1,0),tile('c','square',0,1)]
 const snap=findSnap(tile('d','square',1.04,1.03),others,profiles,.2)
 assert.ok(snap);assert.equal(snap.contactCount,2)
 const report=validate([...others,snap.tile],profiles)
 assert.equal(report.valid,true);assert.equal(report.connections.length,4)
 const ring=Array.from({length:6},(_,i)=>tile('t'+i,'equilateral-triangle',0,0,i*Math.PI/3))
 const last={...ring[5],pose:{...ring[5].pose,x:.03,y:.02}}
 const closure=findSnap(last,ring.slice(0,5),profiles,.2)
 assert.ok(closure);assert.equal(closure.contactCount,2)
 assert.equal(validate([...ring.slice(0,5),closure.tile],profiles).connections.length,6)
 // Detached pieces lose old occupancy naturally; returning the same piece reattaches.
 assert.equal(findSnap({...snap.tile,pose:{...snap.tile.pose,x:4}},others,profiles,.2,snap.key),null)
 assert.deepEqual(findSnap({...snap.tile,pose:{...snap.tile.pose,x:1.03}},others,profiles,.2)?.tile.pose,snap.tile.pose)
})

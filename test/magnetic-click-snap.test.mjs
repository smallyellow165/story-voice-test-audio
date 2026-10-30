import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {clickSnap} from '../src/magnetic-tiles/click-snap.ts'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {alignEdge,edges,findSnap,findSnapCandidates,rankSnapCandidates,validate,vertices} from '../src/magnetic-tiles/geometry.ts'
import {parseAssembly} from '../src/magnetic-tiles/storage.ts'
import {generateBuild,validateBuild} from '../src/magnetic-tiles/build-plan.ts'
const tile=(id,x=0,y=0)=>({id,profileId:'square',profileVersion:1,color:'#f5b942',pose:{x,y,angleRad:0}})
const assembly=instances=>({schemaVersion:1,id:'click-snap-test',revision:3,name:'Click Snap isolated',instances})
test('click calls the same candidates and ranking as drag, edits only one tile, and yields valid Assembly/Build',async()=>{
 const a=assembly([tile('anchor'),tile('loose',1.08,.04)]),original=structuredClone(a),drag=findSnap(a.instances[1],[a.instances[0]],profiles,.22),r=clickSnap(a,'loose',profiles,.22)
 assert.ok(drag);assert.equal(r.status,'snapped');assert.deepEqual(r.assembly.instances[1],drag.tile);assert.equal(r.assembly.instances[0],a.instances[0]);assert.deepEqual(a,original);assert.equal(r.assembly.revision,a.revision)
 assert.equal(validate(r.assembly.instances,profiles).valid,true);assert.deepEqual(parseAssembly(r.assembly,profiles),r.assembly);assert.deepEqual((await validateBuild(await generateBuild(r.assembly,profiles),profiles)).snapshot.assembly,r.assembly)
 assert.equal(clickSnap(r.assembly,'loose',profiles,.22).assembly,r.assembly)
})
test('connected tiles including partial contacts and closed loops are exact no-ops; no pose micro-adjustment',()=>{
 for(const instances of [[tile('a'),tile('b',1,0)],[tile('a'),tile('b',1,.4)],[tile('a'),tile('b',1),tile('c',0,1),tile('d',1,1)]]){
  const a=assembly(instances);assert.equal(validate(a.instances,profiles).valid,true)
  for(const t of instances){const r=clickSnap(a,t.id,profiles,.3);assert.equal(r.status,'unchanged');assert.equal(r.assembly,a);assert.deepEqual(r.assembly,assembly(instances))}
 }
})
test('ambiguous equally plausible different poses stay put, while a clearly closer one may snap',()=>{
 const a=assembly([tile('left',-1.08),tile('right',1.08),tile('loose')]),r=clickSnap(a,'loose',profiles,.3)
 assert.equal(validate(a.instances,profiles).draftValid,true);assert.ok(findSnap(a.instances[2],a.instances.slice(0,2),profiles,.3));assert.equal(r.status,'ambiguous');assert.equal(r.assembly,a)
 const b=assembly([tile('left',-1.04),tile('right',1.2),tile('loose')]),s=clickSnap(b,'loose',profiles,.3);assert.equal(s.status,'snapped');assert.ok(s.assembly.instances[2].pose.x<0)
})
test('equivalent candidates closing two edges are not mistaken for ambiguity; all old links survive',()=>{
 const a=assembly([tile('a'),tile('b',1),tile('c',0,1),tile('loose',1.06,1.04)]),candidates=rankSnapCandidates(findSnapCandidates(a.instances[3],a.instances.slice(0,3),profiles,.3));assert.ok(candidates.filter(c=>c.contactCount===2).length>=2)
 const r=clickSnap(a,'loose',profiles,.3),report=validate(r.assembly.instances,profiles);assert.equal(r.status,'snapped');assert.equal(report.valid,true);assert.equal(report.connections.length,4);assert.deepEqual(r.assembly.instances.slice(0,3),a.instances.slice(0,3))
})
test('far, point-only, invalid starting geometry, missing ID and invalid capture range do not move anything',()=>{
 for(const a of [assembly([tile('a'),tile('b',4,3)]),assembly([tile('a'),tile('b',1,1)]),assembly([tile('a'),tile('b',.9)]),assembly([tile('a'),tile('b')])]){const r=clickSnap(a,'b',profiles,.22);assert.equal(r.status,'unavailable');assert.equal(r.assembly,a)}
 const a=assembly([tile('a'),tile('b',1.05)]);for(const d of [NaN,Infinity,0,-1])assert.equal(clickSnap(a,'b',profiles,d).assembly,a);assert.equal(clickSnap(a,'missing',profiles,.22).assembly,a)
})
test('shared partial-edge and mirrored snap capability is retained, with progressive legal draft editing',()=>{
 const partial=assembly([tile('a'),tile('b',1.05,.5)]),r=clickSnap(partial,'b',profiles,.22);assert.equal(r.status,'snapped');assert.equal(validate(r.assembly.instances,profiles).connections[0].contact.length,.5)
 const anchor=tile('a'),raw={...tile('mirror'),profileId:'tall-right-triangle',pose:{x:0,y:0,angleRad:0,mirrored:true}},aligned=alignEdge(raw,edges(raw,profiles)[0],edges(anchor,profiles)[0],profiles),loose={...aligned,pose:{...aligned.pose,y:aligned.pose.y-.06}},m=clickSnap(assembly([anchor,loose]),'mirror',profiles,.22)
 assert.equal(m.status,'snapped');assert.equal(m.assembly.instances[1].pose.mirrored,true);assert.equal(validate(m.assembly.instances,profiles).valid,true)
 const a=assembly([tile('a'),tile('b',1.05),tile('distant',8)]),s=clickSnap(a,'b',profiles,.22);assert.equal(s.status,'snapped');assert.equal(validate(s.assembly.instances,profiles).draftValid,true);assert.equal(validate(s.assembly.instances,profiles).components.length,2);assert.equal(s.assembly.instances[2],a.instances[2])
})
test('saved cat candidate: all nine targets remain byte-for-byte unchanged, eight links and one component',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/cat-assembly-click-snap.json',import.meta.url))),a=fixture.assembly,p=fixture.profiles,old=JSON.stringify(a),report=validate(a.instances,p)
 assert.equal(a.instances.length,9);assert.equal(report.valid,true);assert.equal(report.connections.length,8);assert.equal(report.components.length,1)
 for(const t of a.instances){const r=clickSnap(a,t.id,p,.3);assert.equal(r.status,'unchanged');assert.equal(r.assembly,a);assert.equal(JSON.stringify(r.assembly),old);assert.deepEqual(validate(r.assembly.instances,p),report);assert.deepEqual(vertices(r.assembly.instances.find(x=>x.id===t.id),p),vertices(t,p))}
})

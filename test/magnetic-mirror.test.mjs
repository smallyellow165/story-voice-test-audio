import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {edges,vertices,alignEdge,validate,matched,distance,mirrorVariants,mirrorTile,rotateTile,findSnap} from '../src/magnetic-tiles/geometry.ts'
import {alignmentInspection,contourResidual} from '../src/magnetic-tiles/intake/alignment-inspection.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {parseAssembly,saveWorkspace,loadWorkspace} from '../src/magnetic-tiles/storage.ts'
import {generateBuild,validateBuild,contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {evidenceFor} from './fixtures/magnetic-intake/cases.mjs'
const record=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/rose-p3-p6-connected.json',import.meta.url),'utf8'))
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`)
const tile=(id,profileId='square',mirrored=false)=>({id,profileId,profileVersion:1,color:'#aabbcc',pose:{x:0,y:0,angleRad:0,...(mirrored?{mirrored:true}:{})}})
test('immutable real trial 468: short edges fully coincide; only RMS rejects P3; reflected actual alignment passes unchanged rules',async()=>{
 const {hash,...payload}=record;assert.equal(await contentHash(payload),hash)
 const a=alignmentInspection(record,'diagnostic-1');assert.equal(a.available,true);assert.equal(a.references.attemptIndex,468);assert.equal(a.references.stateIndex,10);assert.equal(a.savedSearchMirroring,false)
 assert.equal(a.actual.connection.from,'p3');assert.equal(a.actual.connection.to,'p6');assert.equal(a.actual.edges.own.id,'e0');assert.equal(a.actual.edges.target.id,'e2')
 near(a.actual.edges.own.length,1);near(a.actual.edges.target.length,1);assert.deepEqual(a.actual.edges.endpointErrors,[0,0]);assert.equal(a.actual.edges.opposed,true)
 assert.equal(a.actual.pairValidator.valid,true);assert.equal(a.actual.contextValidator.valid,true)
 near(a.actual.residual.rms,.5910235265278042);near(a.independent.rigid.residual.rms,.21459162940236026);near(a.independent.mirrored.residual.rms,.08871130202158427)
 const m=a.alternatives.find(v=>v.id==='mirror-e0-e2');near(m.residual.rms,.1583840162363413);assert.equal(m.opposed,true);assert.equal(m.pairValidator.valid,true);assert.equal(m.contextValidator.valid,true);assert.equal(m.withinRms,true);assert.equal(m.adoptable,false)
 assert.equal(m.tile.profileId,'tall-right-triangle');assert.equal(a.alternatives[0].id,'mirror-e0-e2');assert.ok(a.alternatives.filter(v=>v.ownEdgeId==='e0'&&v.targetEdgeId!=='e2').every(v=>v.residual.rms>1.6))
 near(Math.sqrt(m.residual.pairs.reduce((n,p)=>n+p.distance**2,0)/3),m.residual.rms)
 assert.equal(record.trace.search.parameters.mirroring,false);assert.equal(record.diagnosticCandidates[0].tiles.length,11)
 assert.equal(alignmentInspection({...record,trace:undefined},'diagnostic-1').available,false)
})
test('generic reflection keeps local edge IDs, proper opposed connections, snapping and strict collision/contact constraints',()=>{
 for(const p of profiles)assert.deepEqual(mirrorVariants(p),p.id==='tall-right-triangle'?[false,true]:[false])
 for(const sourceParity of [false,true])for(const targetParity of [false,true])for(const angleRad of [0,.37,-1.2]){
  const anchor={...tile('anchor','tall-right-triangle',targetParity),pose:{x:2,y:-3,angleRad,...(targetParity?{mirrored:true}:{})}},moving=tile('moving','tall-right-triangle',sourceParity),aligned=alignEdge(moving,edges(moving,profiles)[0],edges(anchor,profiles)[0],profiles)
  assert.ok(matched(edges(aligned,profiles)[0],edges(anchor,profiles)[0]));assert.equal(validate([anchor,aligned],profiles).valid,true);assert.equal(!!aligned.pose.mirrored,sourceParity)
 }
 const base=tile('s'),raw=tile('m','tall-right-triangle',true),own=edges(raw,profiles)[0],target=edges(base,profiles)[0],m=alignEdge(raw,own,target,profiles)
 assert.equal(m.pose.mirrored,true);assert.ok(matched(edges(m,profiles)[0],target));assert.equal(validate([base,m],profiles).valid,true)
 const vs=vertices(raw,profiles),es=edges(raw,profiles);assert.deepEqual(es[0].a,vs[1]);assert.deepEqual(es[0].b,vs[0]);assert.deepEqual(es.map(e=>e.id),['e0','e1','e2'])
 const noisy={...m,pose:{...m.pose,x:m.pose.x+.01}},snap=findSnap(noisy,[base],profiles,.1);assert.ok(snap);assert.equal(snap.tile.pose.mirrored,true);assert.equal(validate([base,snap.tile],profiles).valid,true)
 const collision={...m,pose:{...m.pose,y:m.pose.y+.1}};assert.ok(validate([base,collision],profiles).issues.some(i=>i.code==='OVERLAP'))
 const partial={...m,pose:{...m.pose,x:m.pose.x+.2}};assert.equal(validate([base,partial],profiles).valid,true)
 for(const parity of [null,1,'true'])assert.ok(validate([{...raw,pose:{...raw.pose,mirrored:parity}}],profiles).issues.some(i=>i.code==='POSE'))
 assert.ok(validate([{...raw,pose:{...raw.pose,scale:1}}],profiles).issues.some(i=>i.code==='INPUT'))
 const flipped=mirrorTile(raw,profiles),again=mirrorTile(flipped,profiles),centroid=t=>vertices(t,profiles).reduce((s,v)=>[s[0]+v[0]/3,s[1]+v[1]/3],[0,0]);near(distance(centroid(raw),centroid(flipped)),0)
 vertices(raw,profiles).forEach((v,i)=>near(distance(v,vertices(again,profiles)[i]),0))
 const rotated=rotateTile(raw,Math.PI/2,profiles);assert.equal(rotated.pose.mirrored,true);near(distance(centroid(raw),centroid(rotated)),0)
 // A reflected tall triangle cannot be expressed by ANY rotation+translation.
 const observed=vertices(raw,profiles),rigid={...raw,pose:{x:0,y:0,angleRad:0}};assert.ok(contourResidual(rigid,observed,profiles).rms>.3)
})
test('mirrored Assembly roundtrip and Build retain exact pose/edge identity; old poses keep prior geometry',async()=>{
 const s=tile('s'),m=alignEdge(tile('m','tall-right-triangle',true),edges(tile('m','tall-right-triangle',true),profiles)[0],edges(s,profiles)[0],profiles),a={schemaVersion:1,id:'mirror',revision:1,name:'Mirror generic',instances:[s,m]}
 assert.deepEqual(parseAssembly(JSON.parse(JSON.stringify(a)),profiles),a)
 const memory=new Map(),store={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};saveWorkspace(store,{schemaVersion:1,current:a,saved:[a]},profiles);assert.deepEqual(loadWorkspace(store,profiles).current,a)
 const b=await generateBuild(a,profiles);assert.deepEqual(await validateBuild(JSON.parse(JSON.stringify(b)),profiles),b);assert.deepEqual(b.snapshot.assembly,a);assert.match(b.plan.steps.find(s=>s.addInstanceId==='m').instruction,/翻面/)
 assert.deepEqual(vertices(tile('old'),profiles),[[0,0],[1,0],[1,1],[0,1]])
})
test('saved V3 searches both handed domains and advances rose to P2/real component collisions without inventing a valid full layout',async()=>{
 const input=record.trace.input
 for(const mode of ['connected-construction','flat-mosaic']){
  const r=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/'+(mode==='connected-construction'?'rose-connected-v3.json':'rose-flat-v3.json'),import.meta.url),'utf8'))
  assert.equal(r.trace.search.parameters.mirroring,true);assert.equal(r.candidates.length,0);assert.equal(r.truncated,false)
  const p3=r.trace.planning.fittedSeeds.find(s=>s.tile.id==='p3');assert.equal(p3.tile.pose.mirrored,true);near(p3.rms,.08871130202158427)
  const first=r.diagnosticCandidates[0];assert.equal(r.diagnosticCandidates.length,10)
  if(mode==='connected-construction'){
   assert.equal(r.explored,13);assert.equal(r.trials,708);assert.equal(first.tiles.length,14);assert.equal(first.attemptedConnection.from,'p2');near(first.attemptedTileRms,1.742852589630778);assert.equal(first.failureStage,'outline')
   const t=first.tiles.find(t=>t.id==='p3'),p6=first.tiles.find(t=>t.id==='p6'),image=input.evidence.observations.find(o=>o.id==='p3').outline.map(([x,y])=>[x*input.width/r.trace.planning.scalePixelsPerUnit,-y*input.height/r.trace.planning.scalePixelsPerUnit]);assert.equal(t.pose.mirrored,true);near(contourResidual(t,image,profiles).rms,.1583840162363413);assert.equal(validate([t,p6],profiles).valid,true)
  }else{
   assert.equal(r.explored,16);assert.equal(r.trials,264);assert.equal(first.failureStage,'geometry');assert.equal(first.tiles.length,13);assert.deepEqual(first.unplacedIds,['p2']);assert.deepEqual(first.validator.report.issues.filter(i=>i.code==='OVERLAP').map(i=>i.tileIds),[['s1','p6'],['s1','p5'],['s1','p4']])
  }
  const {hash,...payload}=r;assert.equal(await contentHash(payload),hash)
 }
})

test('general mirrored two-piece input produces a valid saved candidate and Build; rigid-only replay cannot fit its connected outline',async()=>{
 const s=tile('square'),raw=tile('triangle','tall-right-triangle',true),t=alignEdge(raw,edges(raw,profiles)[0],edges(s,profiles)[0],profiles),f=evidenceFor([s,t],profiles,vertices,validate)
 const old=reconstruct(f.evidence,f.width,f.height,profiles,'generic-mirror','connected-construction',{mirroring:false});assert.equal(old.candidates.length,0)
 for(const mode of ['connected-construction','flat-mosaic']){
  const r=reconstruct(f.evidence,f.width,f.height,profiles,'generic-mirror',mode);assert.ok(r.candidates.length);const a=r.candidates[0].assembly;assert.equal(validate(a.instances,profiles).valid,true);assert.equal(a.instances.find(t=>t.id==='triangle').pose.mirrored,true);assert.ok(r.candidates[0].imageError<1e-10);assert.deepEqual(parseAssembly(JSON.parse(JSON.stringify(a)),profiles),a);assert.deepEqual((await validateBuild(await generateBuild(a,profiles),profiles)).snapshot.assembly,a)
 }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {matchOutline,needsOutlineConfirmation} from '../src/magnetic-tiles/intake/profile-match.ts'
const outline=(v,{angle=0,scale=100,x=300,y=250,mirror=1,width=800,height=600}={})=>v.map(([a,b])=>[(x+scale*(mirror*a*Math.cos(angle)-b*Math.sin(angle)))/width,(y+scale*(mirror*a*Math.sin(angle)+b*Math.cos(angle)))/height])
test('ideal catalog profiles score 100 with invariant translation, rotation, uniform scale, winding, start and reflection',()=>{
 for(const p of profiles)for(const angle of [0,.4,1.9])for(const mirror of [1,-1]){
  const v=[...p.vertices.slice(1),p.vertices[0]].reverse(),a=outline(v,{angle,mirror,scale:70,x:400,y:300}),r=matchOutline(a,800,600,profiles)
  assert.equal(r.status,'scored');assert.equal(r.candidates[0].profileId,p.id);assert.ok(r.candidates[0].similarityScore>99.999999)
  assert.deepEqual(r,matchOutline(a,800,600,profiles))
  const resized=matchOutline(a,1600,1200,profiles);assert.ok(Math.abs(resized.candidates[0].similarityScore-r.candidates[0].similarityScore)<1e-8)
 }
})
test('noise decreases continuously; unequal legs/angles materially penalized; vertex mismatch not guessed',()=>{
 const p=profiles.find(p=>p.id==='equilateral-triangle');let last=101
 for(const delta of [0,.005,.02,.06,.15]){const v=structuredClone(p.vertices);v[2][0]+=delta;const r=matchOutline(outline(v),800,600,profiles).candidates.find(c=>c.profileId===p.id);assert.ok(r.similarityScore<last);last=r.similarityScore}
 const near=matchOutline(outline([[0,0],[1,0],[.51,.86]]),800,600,profiles).candidates[0];assert.ok(near.similarityScore>80)
 const unequal=matchOutline(outline([[0,0],[1,0],[0,2]]),800,600,profiles);assert.ok(unequal.candidates[0].similarityScore<50);assert.equal(unequal.candidates.find(c=>c.profileId==='square').similarityScore,0)
 const c=near,E=Math.max(c.outlineRms/.1,c.edgeRatioRms/.1,c.angleRmsDegrees/10);assert.ok(Math.abs(c.similarityScore-100*2**(-E*E))<1e-9)
})
test('missing, degenerate, nonconvex and self-intersecting outlines refuse scores; uncertain evidence needs confirmation',()=>{
 for(const v of [[],[[0,0],[0,0],[0,0]],[[0,0],[1,0],[.5,0]],[[0,0],[1,1],[0,1],[1,0]],[[0,0],[1,0],[.3,.3],[0,1]]])assert.equal(matchOutline(outline(v),800,600,profiles).status,'invalid')
 assert.equal(matchOutline([[0,0],[1,0],[0,1]],0,600,profiles).status,'invalid')
 assert.equal(needsOutlineConfirmation({uncertainty:'estimated behind another tile',confidence:.99}),true)
 assert.equal(needsOutlineConfirmation({uncertainty:'',confidence:.2}),true)
 assert.equal(needsOutlineConfirmation({uncertainty:'',confidence:.95}),false)
})

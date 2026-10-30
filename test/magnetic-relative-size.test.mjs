import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {profiles,profileSpec} from '../src/magnetic-tiles/profiles.ts'
import {estimateRelativeScale,matchRelativeProfiles,scoreRelativeSize} from '../src/magnetic-tiles/intake/relative-size.ts'
import {matchOutline,outlineEvidenceKey} from '../src/magnetic-tiles/intake/profile-match.ts'
import {parseEvidence} from '../src/magnetic-tiles/intake/contracts.ts'
import {generateBuild,validateBuild} from '../src/magnetic-tiles/build-plan.ts'
import {vertices,validate} from '../src/magnetic-tiles/geometry.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
const get=id=>profiles.find(p=>p.id===id)
const observation=(id,profile='square',scale=100,overrides={})=>({id,profileId:profile,profileVersion:1,color:'#00ff00',outline:get(profile).vertices.map(([x,y])=>[(200+x*scale)/1000,(200+y*scale)/1000]),confidence:.99,evidence:'complete outer contour',uncertainty:'',origin:'observed',excluded:false,...overrides})
const candidate=(result,id)=>result.candidates.find(c=>c.profileId===id)
const estimate=(all,id='target',confirmed=new Set())=>estimateRelativeScale(all,id,1000,1000,profiles,confirmed,'source')
const match=(target,all)=>matchRelativeProfiles(target,1000,1000,profiles,estimate(all,target.id))

test('catalog keeps the three original exact definitions and adds independently versioned estimated geometry',async()=>{
 const old=profiles.slice(0,3)
 assert.deepEqual(old,[
  {id:'square',version:1,name:'正方形',vertices:[[0,0],[1,0],[1,1],[0,1]],connectableEdges:['e0','e1','e2','e3']},
  {id:'right-triangle',version:1,name:'等腰直角三角形',vertices:[[0,0],[1,0],[0,1]],connectableEdges:['e0','e1','e2']},
  {id:'equilateral-triangle',version:1,name:'等边三角形',vertices:[[0,0],[1,0],[.5,Math.sqrt(3)/2]],connectableEdges:['e0','e1','e2']}
 ])
 for(const [id,expected,lengths] of [['large-equilateral-triangle',[[0,0],[2,0],[1,Math.sqrt(3)]],[2,2,2]],['tall-right-triangle',[[0,0],[1,0],[0,2]],[1,Math.sqrt(5),2]]]){
  const p=get(id);assert.equal(p.version,1);assert.deepEqual(p.vertices,expected);assert.equal(p.sizeEvidence.status,'estimated');assert.match(p.sizeEvidence.source,/V1 Estimated Geometry/)
  profileSpec(p).edges.forEach((e,i)=>assert.ok(Math.abs(e.length-lengths[i])<1e-12))
  const a={schemaVersion:1,id:'new',revision:1,name:id,instances:[{id:'t',profileId:id,profileVersion:1,color:'#00ff00',pose:{x:0,y:0,angleRad:.4}}]}
  assert.equal(validate(a.instances,profiles).valid,true)
  assert.deepEqual((await validateBuild(await generateBuild(a,profiles),profiles)).snapshot.assembly,a)
  const o=observation('target',id),e={sourceKind:'diagram',reason:'',observations:[o],relations:[]}
  const r=reconstruct(e,1000,1000,profiles,'new')
  assert.ok(r.candidates.length);assert.equal(r.candidates[0].assembly.instances[0].profileId,id)
  assert.equal(vertices(a.instances[0],profiles).length,3)
 }
 const historical=await generateBuild({schemaVersion:1,id:'old',revision:1,name:'old',instances:[{id:'s',profileId:'square',profileVersion:1,color:'#00ff00',pose:{x:0,y:0,angleRad:0}}]},old)
 assert.deepEqual(await validateBuild(historical,profiles),historical)
})

test('same shape at two physical sizes is separated by a known square, while Shape Score stays identical',()=>{
 const reference=observation('reference')
 for(const id of ['equilateral-triangle','large-equilateral-triangle']){
  const target=observation('target',id,100,{profileId:'unknown'}),r=match(target,[reference,target])
  assert.equal(r.candidates[0].profileId,id);assert.ok(r.candidates[0].relativeSizeScore>99.999)
  assert.ok(Math.abs(candidate(r,'equilateral-triangle').similarityScore-candidate(r,'large-equilateral-triangle').similarityScore)<1e-9)
  const wrong=id==='equilateral-triangle'?'large-equilateral-triangle':'equilateral-triangle'
  assert.ok(candidate(r,wrong).relativeSizeScore<1)
  for(const c of r.candidates)assert.equal(c.similarityScore,candidate(matchOutline(target.outline,1000,1000,profiles),c.profileId).similarityScore)
  assert.deepEqual(r,match(target,[reference,target]))
 }
})

test('no reference, self only, low confidence, excluded, invalid and ambiguous references produce Size Unknown',()=>{
 const target=observation('target','large-equilateral-triangle',100,{profileId:'unknown'})
 const refs=[observation('bad','square',100,{confidence:.7}),observation('excluded','square',100,{excluded:true}),observation('ambiguous','equilateral-triangle'),observation('invalid','square',100,{outline:[[.1,.1],[.1,.1],[.1,.1]]})]
 for(const all of [[],[target],refs,[observation('target')]]){
  const r=match(target,all);assert.equal(r.scale.status,'unknown')
  assert.ok(r.candidates.every(c=>c.relativeSizeScore===null&&c.sizeRatio===null))
  assert.equal(candidate(r,'equilateral-triangle').recommendationScore,candidate(r,'large-equilateral-triangle').recommendationScore)
 }
 const known=observation('confirmed','equilateral-triangle'),confirmed=new Set([outlineEvidenceKey(known,'source')])
 assert.equal(estimate([known],'target',confirmed).status,'known')
})

test('multiple references tolerate contour variation and reject outliers; conflicting references do not fake confidence',()=>{
 const target=observation('target','large-equilateral-triangle',100,{profileId:'unknown'})
 const refs=[observation('a','square',95),observation('b','square',100),observation('c','square',105),observation('outlier','square',220)]
 const r=match(target,refs);assert.equal(r.candidates[0].profileId,'large-equilateral-triangle');assert.ok(r.candidates[0].relativeSizeScore>99)
 assert.deepEqual(r.scale.references.map(r=>r.observationId),['a','b','c']);assert.deepEqual(r.scale.rejectedIds,['outlier']);assert.ok(Math.abs(r.scale.pixelsPerUnit-100)<1)
 assert.equal(estimate([observation('a','square',70),observation('b','square',160)]).status,'unknown')
 const squares=estimate([...refs,observation('triangle','right-triangle',180)])
 assert.ok(squares.references.every(r=>r.profileId==='square'))
 // Observation order and a uniform image resize cannot change the recommendation.
 assert.ok(Math.abs(match(target,[...refs].reverse()).candidates[0].relativeSizeScore-r.candidates[0].relativeSizeScore)<1e-9)
 const resized=estimateRelativeScale(refs,target.id,2000,2000,profiles)
 assert.ok(Math.abs(matchRelativeProfiles(target,2000,2000,profiles,resized).candidates[0].relativeSizeScore-r.candidates[0].relativeSizeScore)<1e-9)
})

test('size tolerance is continuous, symmetric in ratios, independent of shape and never excludes low scores',()=>{
 const ref=observation('reference'),scale=estimate([ref])
 const scores=[1,1.05,1.1,1.25,1.5,2].map(r=>scoreRelativeSize(observation('target','equilateral-triangle',100*r),get('equilateral-triangle'),1000,1000,scale).relativeSizeScore)
 assert.ok(Math.abs(scores[0]-100)<1e-9);assert.ok(Math.abs(scores[3]-50)<1e-9)
 scores.slice(1).forEach((s,i)=>assert.ok(s<scores[i]))
 const reciprocal=scoreRelativeSize(observation('target','equilateral-triangle',80),get('equilateral-triangle'),1000,1000,scale).relativeSizeScore
 assert.ok(Math.abs(reciprocal-scores[3])<1e-9)
 const o=observation('target','large-equilateral-triangle',100,{profileId:'unknown'}),r=match(o,[ref])
 const low=candidate(r,'equilateral-triangle');assert.ok(low.relativeSizeScore<1)
 // Same explicit assignment path used by the dropdown and candidate button: no score gate in the evidence contract.
 const e=parseEvidence({sourceKind:'diagram',reason:'',observations:[{...o,profileId:low.profileId,profileVersion:low.profileVersion}],relations:[]})
 assert.equal(e.observations[0].profileId,'equilateral-triangle')
})

test('captured rose Review: generic calibration explains P1/P2/P3 without changing P4/P5/P6 or evidence',async()=>{
 const f=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/rose-relative-size.json',import.meta.url),'utf8')),before=structuredClone(f.evidence)
 const scores={p1:[87.8323002448,92.2949909447],p2:[99.9958306927,99.9995872327],p3:[86.3232963842,92.6484545136]}
 for(const id of ['p1','p2','p3']){
  const o=f.evidence.observations.find(o=>o.id===id),scale=estimateRelativeScale(f.evidence.observations,id,f.width,f.height,profiles)
  assert.deepEqual(scale.references.map(r=>r.observationId),['s1','s2','s3','s4']);assert.ok(Math.abs(scale.pixelsPerUnit-113.0042)<.001)
  const r=matchRelativeProfiles(o,f.width,f.height,profiles,scale),best=r.candidates[0]
  assert.equal(best.profileId,id==='p2'?'large-equilateral-triangle':'tall-right-triangle')
  assert.ok(Math.abs(best.similarityScore-scores[id][0])<1e-6);assert.ok(Math.abs(best.relativeSizeScore-scores[id][1])<1e-6)
  if(id==='p2'){assert.equal(candidate(r,'equilateral-triangle').similarityScore,best.similarityScore);assert.ok(candidate(r,'equilateral-triangle').relativeSizeScore<1)}
 }
 assert.deepEqual(f.evidence,before)
 for(const id of ['p4','p5','p6'])assert.equal(f.evidence.observations.find(o=>o.id===id).profileId,'equilateral-triangle')
})

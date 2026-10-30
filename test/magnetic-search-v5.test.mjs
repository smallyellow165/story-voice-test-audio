import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createOutlineRegistration} from '../src/magnetic-tiles/intake/global-registration.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {parametricProfile} from '../src/magnetic-tiles/parametric-profile.ts'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {vertices,validate,edges,edgeContact,distance} from '../src/magnetic-tiles/geometry.ts'
import {contentHash,generateBuild,validateBuild} from '../src/magnetic-tiles/build-plan.ts'
import {evidenceFor,cases,tile} from './fixtures/magnetic-intake/cases.mjs'
const palm=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/palm-connected-v4.json',import.meta.url))),rose=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/rose-connected-v4.json',import.meta.url)))
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`)
const imageFor=record=>new Map(record.trace.input.evidence.observations.map(o=>[o.id,o.outline.map(([x,y])=>[x*record.trace.input.width/record.trace.planning.scalePixelsPerUnit,-y*record.trace.input.height/record.trace.planning.scalePixelsPerUnit])]))
test('historical Palm translation counterexample: actual poses pass unchanged .300 and preserve every relative pose/contact/collision',async()=>{
 const {hash,...payload}=palm;assert.equal(await contentHash(payload),hash)
 const p=palm.trace.input.profiles,old=palm.diagnosticCandidates[0],before=structuredClone(old.tiles),engine=createOutlineRegistration(imageFor(palm),p),r=engine.register(before,.3)
 near(engine.error(before.at(-1)),.309939618328481);assert.equal(r.registration.feasible,true);assert.ok(r.registration.afterMaxRms<=.3);assert.ok(Math.hypot(...r.registration.translation)>0)
 const original=validate(before,p),actual=validate(r.tiles,p);assert.equal(actual.valid,true);assert.deepEqual(actual.issues,[]);assert.deepEqual(actual.components,original.components);assert.equal(actual.connections.length,original.connections.length)
 for(let i=0;i<before.length;i++){
  assert.equal(r.tiles[i].profileId,before[i].profileId);assert.equal(r.tiles[i].profileVersion,before[i].profileVersion);assert.equal(r.tiles[i].pose.angleRad,before[i].pose.angleRad);assert.equal(r.tiles[i].pose.mirrored,before[i].pose.mirrored)
  for(let j=0;j<before.length;j++){near(r.tiles[i].pose.x-r.tiles[j].pose.x,before[i].pose.x-before[j].pose.x);near(r.tiles[i].pose.y-r.tiles[j].pose.y,before[i].pose.y-before[j].pose.y)}
 }
 for(let i=0;i<actual.connections.length;i++){const a=actual.connections[i],b=original.connections[i];assert.deepEqual(a.a,b.a);assert.deepEqual(a.b,b.b);if(a.contact)near(a.contact.length,b.contact.length)}
 assert.deepEqual(before,old.tiles);assert.deepEqual(engine.register(before,.3),r)
})
test('disc intersection handles constrained optimum, tangent, zero radius, impossible orientation, and mirrors without scaling',()=>{
 const t=tile('a'),b={...tile('b'),pose:{x:2,y:0,angleRad:0}},c={...tile('c'),pose:{x:4,y:0,angleRad:0}},image=new Map([['a',vertices(t,profiles)],['b',vertices(b,profiles)],['c',vertices(c,profiles).map(([x,y])=>[x+.56,y])]]),engine=createOutlineRegistration(image,profiles),r=engine.register([t,b,c],.3)
 assert.equal(r.registration.feasible,true);assert.ok(r.registration.translation[0]>.25);assert.ok(r.registration.afterMaxRms<=.3)
 const tangent=createOutlineRegistration(new Map([['a',vertices(t,profiles)],['b',vertices(b,profiles).map(([x,y])=>[x+.5,y])]]),profiles).register([t,b],.25);assert.equal(tangent.registration.feasible,true);near(tangent.registration.afterMaxRms,.25)
 const zero=engine.register([t],0);assert.equal(zero.registration.feasible,true);assert.equal(zero.registration.afterMaxRms,0)
 const bad=createOutlineRegistration(new Map([['a',[[0,0],[3,0],[3,3],[0,3]]]]),profiles).register([t],.3);assert.equal(bad.registration.feasible,false)
 const other=createOutlineRegistration(new Map([['a',vertices(t,profiles)],['b',vertices(b,profiles).map(([x,y])=>[x+1,y])]]),profiles).register([t,b],.3);assert.equal(other.registration.feasible,false)
 const mirrored={...tile('m','tall-right-triangle'),pose:{x:3,y:2,angleRad:.53,mirrored:true}},m=createOutlineRegistration(new Map([['m',vertices(mirrored,profiles).map(([x,y])=>[x+.12,y-.07])]]),profiles).register([mirrored],.3);assert.equal(m.registration.feasible,true);assert.equal(m.tiles[0].pose.mirrored,true);near(m.tiles[0].pose.angleRad,.53);near(m.registration.afterMaxRms,0)
})
test('registration actually admits a formerly rejected connected search and persists source poses through Build',async()=>{
 const f=evidenceFor(cases[0].tiles,profiles,vertices,validate),e=structuredClone(f.evidence);e.observations[1].outline=e.observations[1].outline.map(([x,y])=>[x+.5*180/f.width,y])
 const r=reconstruct(e,f.width,f.height,profiles,'global-translation'),s=r.trace.search
 assert.ok(r.candidates.length);assert.ok(s.stats.efficiency.registrationRescued>0);assert.ok(s.registrationWitness);assert.equal(s.registrationWitness.validator.valid,true)
 for(const c of r.candidates){assert.equal(validate(c.assembly.instances,profiles).valid,true);const actual=s.acceptedCandidates.find(a=>a.candidateId===c.id);assert.equal(actual.tiles.length,2);assert.ok(actual.perPieceRms.every(x=>x.rms<=.3));assert.deepEqual((await validateBuild(await generateBuild(c.assembly,profiles),profiles)).snapshot.assembly,c.assembly)}
 const bad=structuredClone(e);bad.relations[0].intent='separate';assert.equal(reconstruct(bad,f.width,f.height,profiles,'separate').candidates.length,0)
})
test('registration never changes Validator outcomes for point-only, overlap, occupied intervals or same-side contact',()=>{
 const long=tile('long','large-equilateral-triangle'),left=tile('left','square',0,-1),right=tile('right','square',1,-1)
 for(const tiles of [[tile('a'),tile('b','square',1,1)],[tile('a'),tile('b','square',.9,0)],[long,left,{...right,pose:{...right.pose,x:.5}}],[tile('a'),tile('b')]]){
  const before=validate(tiles,profiles);assert.equal(before.valid,false)
  const image=new Map(tiles.map(t=>[t.id,vertices(t,profiles).map(([x,y])=>[x+.08,y-.04])])),r=createOutlineRegistration(image,profiles).register(tiles,.3),after=validate(r.tiles,profiles)
  assert.equal(r.registration.feasible,true);assert.equal(after.valid,false);assert.deepEqual(after.issues.map(i=>[i.code,i.tileIds]),before.issues.map(i=>[i.code,i.tileIds]))
 }
})
test('new search keeps complete standard Connected cases; duplicate symmetry does not consume budget and results are deterministic',()=>{
 let skipped=0
 for(const f of cases){const e=evidenceFor(f.tiles,profiles,vertices,validate),r=reconstruct(e.evidence,e.width,e.height,profiles,f.id);assert.ok(r.candidates.length);assert.ok(r.candidates.every(c=>validate(c.assembly.instances,profiles).valid));assert.deepEqual(reconstruct(e.evidence,e.width,e.height,profiles,f.id),r);skipped+=r.trace.search.stats.efficiency.duplicatePosesSkipped}
 assert.ok(skipped>0)
})
test('large dynamic Profiles are not discarded by the old fixed centroid-distance cutoff',()=>{
 const custom=parametricProfile({id:'wide-test',name:'Wide',parameters:{shape:'rectangle',dimensions:{width:4,height:1}},connectableEdges:['e0','e1','e2','e3'],estimated:false,source:'deterministic test'},1),catalog=[...profiles,custom],tiles=[tile('a',custom.id),tile('b',custom.id,4,0)],f=evidenceFor(tiles,catalog,vertices,validate),r=reconstruct(f.evidence,f.width,f.height,catalog,'large')
 assert.ok(r.candidates.length);assert.ok(r.candidates.every(c=>validate(c.assembly.instances,catalog).valid));assert.equal(r.trace.search.parameters.anchorDistanceLimit,undefined)
})
test('Palm and Rose use actual V5 search: bounded persistent evidence, meaningful work reduction and deterministic execution',()=>{
 for(const record of [palm,rose]){
  const i=record.trace.input,run=()=>reconstruct(i.evidence,i.width,i.height,i.profiles,'v5-regression',i.mode),r=run(),s=r.trace.search
  assert.deepEqual(run(),r);assert.equal(s.parameters.maxOutlineRms,.3);assert.equal(s.parameters.eps,1e-7);assert.equal(s.parameters.globalRegistration,'shared-translation-disc-intersection-v1')
  assert.ok(s.stats.efficiency.orientationFamiliesRejected>0);assert.ok(s.stats.efficiency.duplicatePosesSkipped>0);assert.ok(r.trials<=record.trace.search.parameters.trialLimit);assert.ok(r.diagnosticCandidates.length<=10)
  if(record===palm){assert.ok(s.registrationWitness.tiles.length>=14);assert.equal(s.registrationWitness.validator.valid,true);assert.ok(s.registrationWitness.registration.afterMaxRms<=.3);assert.ok(r.explored>record.explored*2)}
  else{assert.ok(r.trials<record.trials/2);assert.equal(r.candidates.length,0);assert.ok(r.diagnosticCandidates.some(d=>d.tiles.length===14&&d.failureStage==='geometry'))}
  for(const d of r.diagnosticCandidates){assert.ok(d.attemptIndex<=r.trials);if(d.attemptedConnection?.contact){const a=d.attemptedConnection,own=edges(d.tiles.find(t=>t.id===a.from),i.profiles).find(e=>e.id===a.ownEdgeId),target=edges(d.tiles.find(t=>t.id===a.to),i.profiles).find(e=>e.id===a.targetEdgeId),contact=edgeContact(own,target);assert.ok(contact);near(distance(contact.start,a.contact.start),0);near(distance(contact.end,a.contact.end),0)}}
 }
})

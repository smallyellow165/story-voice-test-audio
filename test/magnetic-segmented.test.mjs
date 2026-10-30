import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {edgeContact,edges,validate,vertices,findSnap,segmentAlignments,EPS,connectionSegment} from '../src/magnetic-tiles/geometry.ts'
import {generateBuild,validateBuild,contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {parseAssembly,saveWorkspace,loadWorkspace} from '../src/magnetic-tiles/storage.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {polygonArea,intersectionPolygon} from '../src/magnetic-tiles/intake/segment-audit.ts'
import {tile,evidenceFor} from './fixtures/magnetic-intake/cases.mjs'
const scene=()=>[tile('long','large-equilateral-triangle'),tile('left','square',0,-1),tile('right','square',1,-1)]
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`)
test('unequal and equal partial contacts, one long edge with disjoint intervals, touching interval endpoints and graph connectivity',()=>{
 const tiles=scene(),r=validate(tiles,profiles);assert.equal(r.valid,true);assert.equal(r.connections.length,3)
 const parts=r.connections.filter(c=>c.a.tileId==='long');assert.equal(parts.length,2);assert.deepEqual(parts.map(c=>c.contact.aRange),[[0,.5],[.5,1]]);parts.forEach(c=>near(c.contact.length,1))
 const offset=[tile('a'),tile('b','square',1,.5)],partial=validate(offset,profiles);assert.equal(partial.valid,true);near(partial.connections[0].contact.length,.5)
 const gap=[tiles[0],tile('left','square',-.25,-1),tile('right','square',1.25,-1)],g=validate(gap,profiles);assert.equal(g.valid,true);assert.equal(g.connections.length,2);g.connections.forEach(c=>near(c.contact.length,.75))
 const full=validate([tile('a'),tile('b','square',1)],profiles);assert.deepEqual(full.connections[0],{a:{tileId:'a',edgeId:'e1'},b:{tileId:'b',edgeId:'e3'}});assert.equal(full.connections[0].contact,undefined)
})
test('point-only, out-of-tolerance lines, disabled or same-side edges do not connect; overlapping occupancy and area remain forbidden',()=>{
 const long=scene()[0]
 for(const b of [tile('point','square',2,-1),tile('gap','square',0,-1-EPS*10),tile('angle','square',0,-1-.001,.001)]){assert.equal(validate([long,b],profiles).connections.length,0)}
 const same=validate([long,tile('same')],profiles);assert.ok(same.issues.some(i=>i.code==='OVERLAP'));assert.ok(same.issues.some(i=>i.code==='EDGE_CONTACT'))
 const conflict=validate([long,tile('a','square',0,-1),tile('b','square',.5,-1)],profiles);assert.ok(conflict.issues.some(i=>i.code==='EDGE_OCCUPIED'));assert.ok(conflict.issues.some(i=>i.code==='OVERLAP'))
 const disabled=profiles.map(p=>p.id==='large-equilateral-triangle'?{...p,connectableEdges:['e1','e2']}:p);assert.ok(validate([long,scene()[1]],disabled).issues.some(i=>i.code==='EDGE_CONTACT'))
})
test('mirrored and rotated segmented graphs preserve local edge IDs, ranges, area and contact lengths',()=>{
 for(const flip of [false,true])for(const angle of [0,.37,-1.2]){
  const c=Math.cos(angle),s=Math.sin(angle),tiles=scene().map(t=>{const x=flip?-t.pose.x:t.pose.x,y=t.pose.y;return {...t,pose:{x:3+c*x-s*y,y:-2+s*x+c*y,angleRad:angle,...(flip?{mirrored:true}:{})}}})
  const r=validate(tiles,profiles);assert.equal(r.valid,true);assert.equal(r.connections.length,3);for(const contact of r.connections.filter(c=>c.contact)){near(contact.contact.length,1);assert.ok(['e0','e1','e2'].includes(contact.a.edgeId));const exact=connectionSegment(contact,tiles,profiles);near(exact.length,1)}
 }
 near(polygonArea(intersectionPolygon([[0,0],[1,0],[1,1],[0,1]],[[.5,0],[1.5,0],[1.5,1],[.5,1]])),.5)
})
test('shared Snap/Alignment generates partial offsets and one-to-many placement, with full Validator and no capture tolerance leakage',()=>{
 const [long,...others]=scene(),raw={...long,pose:{x:.02,y:.04,angleRad:0}},snap=findSnap(raw,others,profiles,.2);assert.ok(snap);assert.equal(snap.contactCount,2);near(snap.contactLength,2);assert.equal(validate([...others,snap.tile],profiles).valid,true)
 const proposals=segmentAlignments(raw,edges(raw,profiles)[0],edges(others[0],profiles)[2],profiles,vertices(raw,profiles),others.flatMap(t=>vertices(t,profiles)));assert.ok(proposals.some(p=>validate([...others,p.tile],profiles).valid));assert.ok(proposals.every(p=>p.contact.length>EPS))
 const row=[tile('a'),tile('b','square',1,0)],nearFull=findSnap(tile('c','square',.04,1.07),row,profiles,.27);assert.ok(nearFull);near(nearFull.tile.pose.x,0);near(nearFull.tile.pose.y,1);assert.equal(nearFull.coverageCount,1)
 const tooFar={...long,pose:{x:0,y:.5,angleRad:0}};assert.equal(findSnap(tooFar,others,profiles,.1),null)
})
test('actual Reconstruction generates partial connections from observations, for arbitrary rotation and reflection, and reaches Build',async()=>{
 for(const mirrored of [false,true]){
  const angle=.21,c=Math.cos(angle),s=Math.sin(angle),tiles=scene().map(t=>{const x=mirrored?-t.pose.x:t.pose.x,y=t.pose.y;return {...t,pose:{x:c*x-s*y,y:s*x+c*y,angleRad:angle,...(mirrored?{mirrored:true}:{})}}}),f=evidenceFor(tiles,profiles,vertices,validate),r=reconstruct(f.evidence,f.width,f.height,profiles,'segmented-valid')
  assert.ok(r.candidates.length);assert.equal(r.trace.search.parameters.connectionModel,'segmented-edge-v1');const candidate=r.candidates[0];assert.equal(candidate.assembly.instances.length,3);assert.ok(candidate.imageError<.01);const report=validate(candidate.assembly.instances,profiles);assert.equal(report.valid,true);assert.equal(report.connections.filter(c=>c.contact).length,2)
  const a={...candidate.assembly,revision:1},bundle=await generateBuild(a,profiles);assert.equal(bundle.plan.generatorVersion,'segmented-frontier-v1');assert.ok(bundle.plan.steps.some(s=>s.anchor?.contact));assert.deepEqual(await validateBuild(JSON.parse(JSON.stringify(bundle)),profiles),bundle)
  const rounded=structuredClone(bundle),roundedStep=rounded.plan.steps.find(s=>s.anchor?.contact);roundedStep.anchor.contact.ownRange[0]+=1e-14;assert.deepEqual(await validateBuild(rounded,profiles),rounded)
  const tampered=structuredClone(bundle),step=tampered.plan.steps.find(s=>s.anchor?.contact);step.anchor.contact.ownRange[1]/=2;await assert.rejects(validateBuild(tampered,profiles),/连接边/)
  const memory=new Map(),store={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};saveWorkspace(store,{schemaVersion:1,current:a,saved:[a]},profiles);assert.deepEqual(loadWorkspace(store,profiles).current,a);assert.deepEqual(parseAssembly(a,profiles),a)
 }
})
test('rose searches real segmented placements; one-to-many candidates retain actual intervals and collisions, not old whole-edge impossibility claims',async()=>{
 const historical=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/rose-connected-v3.json',import.meta.url),'utf8')),i=historical.trace.input,r=reconstruct(i.evidence,i.width,i.height,profiles,'rose-segment')
 assert.ok(r.diagnostics.some(s=>s.includes('p2 对已尝试连接邻居')&&s.includes('最小轮廓 RMS 0.018')));assert.equal(r.candidates.length,0);assert.equal(r.truncated,false);assert.equal(r.explored,132);assert.equal(r.trials,23422)
 const first=r.diagnosticCandidates[0];assert.equal(first.failureStage,'geometry');assert.equal(first.tiles.length,14);near(first.attemptedTileRms,.01799719681493965);assert.ok(first.validator.report.issues.some(i=>i.code==='OVERLAP'&&i.tileIds.includes('p2')))
 const multi=r.diagnosticCandidates.find(d=>d.attemptedConnection?.from==='p2'&&d.validator.report.connections.filter(c=>c.a.tileId==='p2'||c.b.tileId==='p2').length===2);assert.ok(multi);near(multi.attemptedTileRms,.06076446526555705);assert.ok(multi.validator.report.issues.some(i=>i.code==='EDGE_OCCUPIED'))
 for(const c of multi.validator.report.connections.filter(c=>c.a.tileId==='p2'||c.b.tileId==='p2'))assert.ok(c.contact?.length>0)
 assert.equal(r.trace.search.connectivityAudit.connectionModel,'whole-edge-v1');assert.equal(r.trace.search.segmentAudit.connectionModel,'segmented-edge-v1');assert.ok(r.diagnostics.some(s=>s.includes('不适用于当前分段连接结论')))
 assert.equal(new Set(r.diagnosticCandidates.map(d=>JSON.stringify(d.tiles))).size,10);assert.ok(r.diagnosticCandidates.every(d=>d.provenance==='observed-search-attempt'&&d.attemptIndex<=r.trials))
 const {hash,...payload}=historical;assert.equal(await contentHash(payload),hash);assert.equal(historical.trace.search.parameters.connectionModel,undefined)
})

test('segmented valid candidate persists and passes actual Origin adoption plus immutable Assembly/Build source checks',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'magnetic-segment-origin-'))
 try{
  const api=createMagneticIntake(dir),f=evidenceFor(scene(),profiles,vertices,validate),seed=async(kind,payload)=>{const r={...payload,hash:await contentHash(payload)};await mkdir(path.join(dir,kind),{recursive:true});await writeFile(path.join(dir,kind,r.id+'.json'),JSON.stringify(r));return r}
  const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),view:{width:f.width,height:f.height},createdAt:new Date().toISOString()}),analysis=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',evidence:f.evidence,createdAt:new Date().toISOString()}),review=await api.dispatch('POST','reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence:f.evidence}),r=await api.dispatch('POST','reconstruct',{reviewId:review.id,reviewHash:review.hash,mode:'connected-construction'}),c=r.candidates[0]
  assert.ok(c);assert.equal(r.algorithm,'planar-outline-v4');const assembly={...c.assembly,revision:1},origin=await api.dispatch('POST','origins',{reconstructionId:r.id,reconstructionHash:r.hash,candidateId:c.id,visualChecked:true,assembly})
  assert.deepEqual(origin.assembly,assembly);const next=createMagneticIntake(dir);assert.deepEqual(await next.read('origins',origin.id),origin);assert.deepEqual((await next.result(r.id)).reconstruction,r);const bundle=await generateBuild(origin.assembly,profiles);assert.deepEqual(await validateBuild(bundle,profiles),bundle)
  const forged=structuredClone(assembly);forged.instances[0].pose.x+=.1;await assert.rejects(api.dispatch('POST','origins',{reconstructionId:r.id,reconstructionHash:r.hash,candidateId:c.id,visualChecked:true,assembly:forged}))
 }finally{await rm(dir,{recursive:true,force:true})}
})

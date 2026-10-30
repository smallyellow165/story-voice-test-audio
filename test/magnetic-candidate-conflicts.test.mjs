import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {validate,distance,EPS} from '../src/magnetic-tiles/geometry.ts'
import {polygonArea,intersectionPolygon} from '../src/magnetic-tiles/intake/segment-audit.ts'
import {inspectDiagnosticConflicts,inspectLayoutConflicts} from '../src/magnetic-tiles/intake/candidate-conflicts.ts'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
const record=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/rose-connected-v4.json',import.meta.url),'utf8'))
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`),tile=(id,profileId='square',x=0,y=0)=>({id,profileId,profileVersion:1,color:'#aabbcc',pose:{x,y,angleRad:0}})

test('latest real Diagnostic #1: hash, all 14 saved poses, four exact overlap areas and six actual Validator errors',async()=>{
 const {hash,...payload}=record;assert.equal(await contentHash(payload),hash);const x=inspectDiagnosticConflicts(record,'diagnostic-1');assert.equal(x.available,true);assert.equal(x.references.reconstructionId,'7274e2c2-9353-4382-b0b6-6cbb60583227');assert.equal(x.geometryInputs.tileCount,14);assert.equal(x.geometryInputs.usesReviewContourForOverlay,false)
 assert.deepEqual(x.current.report,record.diagnosticCandidates[0].validator.report);assert.equal(x.current.savedReportMatchesCurrent,true);assert.equal(x.current.report.valid,false);assert.equal(x.current.report.components.length,1);assert.equal(x.current.report.connections.length,15);assert.equal(x.current.relationViolations.length,0)
 assert.deepEqual(x.current.report.issues.map(i=>i.code),['OVERLAP','EDGE_OCCUPIED','OVERLAP','EDGE_CONTACT','OVERLAP','OVERLAP'])
 const expected={'p2/p5':.001057011879739278,'p1/p2':.45348341321981867,'p2/p6':.008660939214799157,'p2/p3':.42958808896669254};assert.equal(x.current.overlaps.length,4)
 for(const o of x.current.overlaps){const key=[...o.tileIds].sort().join('/');near(o.area,expected[key]);near(polygonArea(o.polygon),o.area);assert.ok(o.polygon.length>=3)}
 const forged=structuredClone(record);forged.diagnosticCandidates[0].overlapAreas[0].area=99;assert.deepEqual(inspectDiagnosticConflicts(forged,'diagnostic-1').current.overlaps,x.current.overlaps)
})
test('exact duplicate occupancy identifies shared P4.e1 and both owners; same-side P1.e0/P2.e0 is independently rejected',()=>{
 const x=inspectDiagnosticConflicts(record,'diagnostic-1'),o=x.current.occupancy[0];assert.equal(x.current.occupancy.length,1);assert.deepEqual(o.sharedEdge,{tileId:'p4',edgeId:'e1'});assert.deepEqual(o.owners.map(p=>p.other),[{tileId:'p1',edgeId:'e0'},{tileId:'p2',edgeId:'e0'}]);near(o.range[0],0);near(o.range[1],.9884942865848054);near(o.length,.9884942865848054);near(distance(o.start,o.end),o.length)
 const c=x.current.edgeContacts[0];assert.equal(x.current.edgeContacts.length,1);assert.deepEqual([c.a.tileId,c.a.edgeId,c.b.tileId,c.b.edgeId],['p1','e0','p2','e0']);assert.equal(c.reason,'same-side-interiors');assert.equal(c.opposing,false);near(c.contact.length,o.length)
 // Independent of Validator encounter order: a duplicate interval is still on the same physical edge.
 const reversed=inspectLayoutConflicts([...record.diagnosticCandidates[0].tiles].reverse(),record.trace.input.profiles);assert.equal(reversed.occupancy.length,1);assert.deepEqual(reversed.occupancy[0].sharedEdge,o.sharedEdge);near(reversed.occupancy[0].length,o.length)
})
test('Review independent-fit issues stay separate; changing contours/seeds cannot change Candidate red geometry or actual errors',()=>{
 const before=inspectDiagnosticConflicts(record,'diagnostic-1');assert.equal(before.independentReviewFit.overlapCount,25);assert.equal(before.independentReviewFit.onlyInIndependentFit.length,21);assert.ok(before.independentReviewFit.onlyInIndependentFit.includes('l1/l2'));assert.ok(!before.current.overlaps.some(o=>o.tileIds.includes('l1')))
 const changed=structuredClone(record);for(const o of changed.trace.input.evidence.observations)o.outline=[[0,0],[1,0],[0,1]];changed.trace.planning.fittedSeeds=undefined
 const after=inspectDiagnosticConflicts(changed,'diagnostic-1');assert.deepEqual(after.current,before.current);assert.equal(after.independentReviewFit.available,false)
})
test('legal one-long/two-short intervals, point contact and sub-EPS penetration do not generate fake red areas or occupancy',()=>{
 const scene=[tile('long','large-equilateral-triangle'),tile('a','square',0,-1),tile('b','square',1,-1)]
 for(const flip of [false,true])for(const angle of [0,.37]){
  const c=Math.cos(angle),s=Math.sin(angle),tiles=scene.map(t=>{const x=flip?-t.pose.x:t.pose.x,y=t.pose.y;return {...t,pose:{x:3+c*x-s*y,y:-2+s*x+c*y,angleRad:angle,...(flip?{mirrored:true}:{})}}}),r=inspectLayoutConflicts(tiles,profiles)
  assert.equal(r.report.valid,true);assert.equal(r.overlaps.length,0);assert.equal(r.occupancy.length,0);assert.equal(r.edgeContacts.length,0)
 }
 const point=inspectLayoutConflicts([tile('a'),tile('b','square',1,1)],profiles);assert.equal(point.overlaps.length,0);assert.equal(point.report.components.length,2);assert.ok(point.report.issues.some(i=>i.code==='DISCONNECTED'))
 const tiny=inspectLayoutConflicts([tile('a'),tile('b','square',1-EPS/10,0)],profiles);assert.equal(tiny.overlaps.length,0)
})
test('generic edge faults and true overlaps have geometry, structural/graph faults do not invent intersection polygons',()=>{
 const conflict=inspectLayoutConflicts([tile('long','large-equilateral-triangle'),tile('a','square',0,-1),tile('b','square',.5,-1)],profiles);assert.equal(conflict.occupancy.length,1);near(conflict.occupancy[0].length,.5);assert.ok(conflict.overlaps.length)
 const disabled=profiles.map(p=>p.id==='square'?{...p,connectableEdges:[]}:p),edge=inspectLayoutConflicts([tile('a'),tile('b','square',1,0)],disabled);assert.equal(edge.overlaps.length,0);assert.equal(edge.edgeContacts[0].reason,'disabled-edge')
 const bad=inspectLayoutConflicts([{...tile('missing'),profileVersion:99}],profiles);assert.ok(bad.structuralIssues.some(i=>i.code==='PROFILE'));assert.equal(bad.overlaps.length,0)
 assert.equal(inspectDiagnosticConflicts({...record,trace:undefined},'diagnostic-1').available,false);assert.equal(inspectDiagnosticConflicts(record,'missing').available,false)
})
test('read-only conflict Trace uses immutable lineage, leaves original snapshots/Selected unchanged and reports missing diagnostics honestly',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'magnetic-conflicts-'))
 try{
  const api=createMagneticIntake(dir),seed=async(kind,payload)=>{const r={...payload,hash:await contentHash(payload)};await mkdir(path.join(dir,kind),{recursive:true});await writeFile(path.join(dir,kind,r.id+'.json'),JSON.stringify(r));return r}
  const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),view:{width:792,height:977},createdAt:new Date().toISOString()}),analysis=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',evidence:record.trace.input.evidence,createdAt:new Date().toISOString()}),review=await api.dispatch('POST','reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence:record.trace.input.evidence})
  const {hash,...payload}=structuredClone(record);payload.id=crypto.randomUUID();payload.sourceId=source.id;payload.sourceHash=source.hash;payload.reviewId=review.id;payload.reviewHash=review.hash;payload.trace.references={...payload.trace.references,reconstructionId:payload.id,sourceId:source.id,sourceHash:source.hash,analysisId:analysis.id,analysisHash:analysis.hash,reviewId:review.id,reviewHash:review.hash}
  const r=await seed('reconstructions',payload),selected=await api.dispatch('GET','selected/'+source.id),bytes=await readFile(path.join(dir,'reconstructions',r.id+'.json'),'utf8')
  const data=JSON.parse((await api.dispatch('GET','trace/reconstructions/'+r.id+'/conflicts/diagnostic-1')).text);assert.equal(data.references.reconstruction.hash,r.hash);assert.equal(data.conflicts.current.overlaps.length,4);assert.equal(data.conflicts.persisted,false);assert.equal(data.conflicts.adoptable,false);assert.equal(data.conflicts.references.reviewHash,review.hash)
  assert.equal(JSON.parse((await api.dispatch('GET','trace/reconstructions/'+r.id+'/conflicts/missing')).text).conflicts.available,false)
  assert.equal(await readFile(path.join(dir,'reconstructions',r.id+'.json'),'utf8'),bytes);assert.deepEqual(await api.dispatch('GET','selected/'+source.id),selected);assert.deepEqual(await api.read('reviews',review.id),review)
 }finally{await rm(dir,{recursive:true,force:true})}
})

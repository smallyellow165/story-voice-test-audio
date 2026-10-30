import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {profiles} from '../src/magnetic-tiles/profiles.ts'
import {edges,vertices,validate,distance,matched,alignEdge,transform} from '../src/magnetic-tiles/geometry.ts'
import {reconstruct} from '../src/magnetic-tiles/intake/reconstruct.ts'
import {fitConnectedPair} from '../src/magnetic-tiles/intake/connection-fit.ts'
import {connectivityAudit} from '../src/magnetic-tiles/intake/connectivity-audit.ts'
import {alignmentInspection,contourResidual} from '../src/magnetic-tiles/intake/alignment-inspection.ts'
import {contentHash,generateBuild,validateBuild} from '../src/magnetic-tiles/build-plan.ts'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {evidenceFor,tile} from './fixtures/magnetic-intake/cases.mjs'
const old=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/rose-p3-p6-connected.json',import.meta.url),'utf8')),input=old.trace.input
const historical=JSON.parse(await readFile(new URL('./fixtures/magnetic-intake/rose-connected-v3.json',import.meta.url),'utf8')),run=()=>structuredClone(historical),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`)

test('reproduce V3 P2 failure exactly; immutable V3 audit and Flat search remain readable',()=>{
 const r=run(),d=r.diagnosticCandidates[0];assert.equal(r.explored,13);assert.equal(r.trials,708);assert.equal(r.candidates.length,0);assert.equal(d.tiles.length,14);assert.equal(d.attemptIndex,696);assert.equal(d.failureStage,'outline');near(d.attemptedTileRms,1.742852589630778);assert.equal(d.validator.report.valid,true);assert.equal(d.domainBlocked,true)
 assert.match(r.diagnostics.join('\n'),/p2 对已尝试连接邻居/);assert.match(r.diagnostics.join('\n'),/增加搜索预算不能/)
 assert.ok(JSON.stringify(r).length<200000);assert.equal(new Set(r.diagnosticCandidates.map(d=>JSON.stringify(d.tiles))).size,10)
 const flat=reconstruct(input.evidence,input.width,input.height,profiles,'rose-p2','flat-mosaic');assert.equal(flat.explored,16);assert.equal(flat.trials,264);assert.equal(flat.trace.search.connectivityAudit,undefined)
 assert.deepEqual(run(),r)
})
test('all equal-edge neighbors of P2 are proven incompatible even with both poses free; fixed root/order/budget cannot repair this input',()=>{
 const r=run(),a=r.trace.search.connectivityAudit,p=a.parts.find(p=>p.id==='p2');assert.deepEqual(a.isolatedIds,['p2']);assert.equal(a.incompatible,true)
 assert.deepEqual(p.equalLengthNeighborIds,['p1','p3']);assert.deepEqual(p.notRuledOutNeighborIds,[]);assert.equal(p.edgeLengths.length,3);p.edgeLengths.forEach(e=>near(e.length,2))
 near(p.bounds.find(b=>b.other==='p1').lowerBound,.5635206387078651);near(p.bounds.find(b=>b.other==='p3').lowerBound,.5637283871282053)
 assert.ok(p.bounds.every(b=>b.excluded&&b.connectionOptions===6&&b.fittedCorrespondences===216));assert.equal(a.witnesses.length,2)
 for(const w of a.witnesses){const b=w.best;assert.equal(b.validator.valid,true);assert.ok(b.perPieceRms.every(s=>s.rms>.3));near(Math.sqrt(b.perPieceRms.reduce((n,s)=>n+s.rms**2,0)/2),w.lowerBound);const [x,y]=b.tiles;assert.equal(matched(edges(x,profiles).find(e=>e.id===b.ownEdgeId),edges(y,profiles).find(e=>e.id===b.targetEdgeId)),true)}
 assert.equal(r.trace.search.parameters.maxOutlineRms,.3);assert.equal(r.trace.search.parameters.mirroring,true)
 assert.equal(a.adoptable,false);assert.ok(!a.witnesses.some(w=>w.best.jointRms<=a.threshold))
})
test('near-image P2 is an actual accurate contour fit but collides with the frozen head; comparison does not invent a search attempt',()=>{
 const r=run(),d=r.diagnosticCandidates[0],p2=r.trace.planning.fittedSeeds.find(s=>s.tile.id==='p2'),observed=input.evidence.observations.find(o=>o.id==='p2').outline.map(([x,y])=>[x*input.width/r.trace.planning.scalePixelsPerUnit,-y*input.height/r.trace.planning.scalePixelsPerUnit])
 near(p2.rms,.0010181661566341844);assert.ok(Math.abs(p2.tile.pose.angleRad)<.001);assert.ok(Math.abs(distance(observed[0],observed[1])-2)<.002)
 const report=validate(d.tiles.map(t=>t.id==='p2'?p2.tile:t),profiles);assert.equal(report.valid,false);assert.deepEqual(report.issues.filter(i=>i.code==='OVERLAP').map(i=>i.tileIds.find(id=>id!=='p2')).sort(),['p1','p3','p4','p5','p6'])
 const a=alignmentInspection({...r,id:'computed-test',hash:'none'},d.id);near(a.independent.rigid.residual.rms,p2.rms);assert.equal(a.freePair.provenance,'computed-free-pair-relaxation');assert.equal(a.freePair.adoptable,false);assert.equal(a.freePair.poses.length,6);assert.ok(a.freePair.poses.every(p=>p.validator.valid&&p.jointRms>.3));assert.deepEqual(new Set(a.freePair.poses.map(p=>p.toMirrored)),new Set([false,true]))
 // Existing accepted P3 remains mirrored, with its original whole-edge RMS.
 const p3=d.tiles.find(t=>t.id==='p3'),p6=d.tiles.find(t=>t.id==='p6'),target=input.evidence.observations.find(o=>o.id==='p3').outline.map(([x,y])=>[x*input.width/r.trace.planning.scalePixelsPerUnit,-y*input.height/r.trace.planning.scalePixelsPerUnit]);assert.equal(p3.pose.mirrored,true);near(contourResidual(p3,target,profiles).rms,.1583840162363413);assert.equal(validate([p3,p6],profiles).valid,true)
})
test('generic free pair fit recovers rotations, translations, reflection and contour permutations, including unequal vertex counts',async()=>{
 for(const parity of [false,true]){
  const anchor={...tile('anchor'),pose:{x:2,y:3,angleRad:.37}},raw={...tile('other','tall-right-triangle'),pose:{x:0,y:0,angleRad:0,...(parity?{mirrored:true}:{})}},moving=alignEdge(raw,edges(raw,profiles)[0],edges(anchor,profiles)[2],profiles),a=vertices(anchor,profiles),b=vertices(moving,profiles),observedB=[b[1],b[0],b[2]]
  const fit=fitConnectedPair(anchor,moving,a,observedB,profiles);assert.ok(fit.poses[0].jointRms<1e-12);assert.equal(fit.poses[0].validator.valid,true);assert.ok(fit.poses[0].perPieceRms.every(s=>s.rms<1e-12))
  const f=evidenceFor([anchor,moving],profiles,vertices,validate),r=reconstruct(f.evidence,f.width,f.height,profiles,'generic');assert.ok(r.candidates.length);assert.equal(r.trace.search.connectivityAudit,undefined);const bundle=await generateBuild(r.candidates[0].assembly,profiles);assert.deepEqual(await validateBuild(bundle,profiles),bundle)
 }
})
test('relaxation never claims feasibility, does not bypass explicit relations, and accurately identifies missing edge lengths',()=>{
 const a=tile('a'),b=tile('b','square',1),f=evidenceFor([a,b],profiles,vertices,validate),seeds=[{tile:a,rms:0},{tile:b,rms:0}]
 const audit=connectivityAudit(f.evidence,1,1,profiles,seeds,1,.3,true);assert.equal(audit.provenance,'deterministic-computation-from-execution-input')
 // Use the same world frame for an exact pair: flip Y through the normalized image input.
 const frame={...f.evidence,observations:f.evidence.observations.map(o=>({...o,outline:vertices(o.id==='a'?a:b,profiles).map(([x,y])=>[x,-y])}))}
 const compatible=connectivityAudit(frame,1,1,profiles,seeds,1,.3,true);assert.equal(compatible.incompatible,false);assert.ok(compatible.parts.every(p=>p.notRuledOutNeighborIds.length===1));assert.equal(compatible.adoptable,false)
 const bad=structuredClone(f.evidence);bad.relations[0].intent='separate';const conflict=reconstruct(bad,f.width,f.height,profiles,'relations');assert.equal(conflict.candidates.length,0);assert.ok(conflict.diagnosticCandidates.some(d=>d.failureStage==='relation'))
 const large=tile('large','large-equilateral-triangle'),square=tile('unit'),g=evidenceFor([large,square],profiles,vertices,validate),none=connectivityAudit(g.evidence,g.width,g.height,profiles,[{tile:large,rms:0},{tile:square,rms:0}],180,.3,true);assert.deepEqual(none.parts.map(p=>p.equalLengthNeighborIds),[[],[]]);assert.equal(none.incompatible,true)
})
test('actual execution audit persists under immutable hash/lineage; metadata stays compact and diagnostics cannot enter Assembly',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'connected-audit-'))
 try{
  const api=createMagneticIntake(dir),seed=async(kind,payload)=>{const r={...payload,hash:await contentHash(payload)};await mkdir(path.join(dir,kind),{recursive:true});await writeFile(path.join(dir,kind,r.id+'.json'),JSON.stringify(r));return r}
  const source=await seed('sources',{schemaVersion:1,id:crypto.randomUUID(),view:{width:input.width,height:input.height},createdAt:new Date().toISOString()}),analysis=await seed('analyses',{schemaVersion:1,id:crypto.randomUUID(),sourceId:source.id,sourceHash:source.hash,status:'complete',evidence:input.evidence,createdAt:new Date().toISOString()}),review=await api.dispatch('POST','reviews',{analysisId:analysis.id,analysisHash:analysis.hash,evidence:input.evidence}),r=await api.dispatch('POST','reconstruct',{reviewId:review.id,reviewHash:review.hash,mode:'connected-construction'})
  const next=createMagneticIntake(dir),loaded=await next.read('reconstructions',r.id);assert.deepEqual(loaded,r);const {hash,...payload}=loaded;assert.equal(await contentHash(payload),hash)
  const trace=JSON.parse((await next.dispatch('GET','trace/reconstructions/'+r.id)).text);assert.deepEqual(trace.execution.trace.search.connectivityAudit,r.trace.search.connectivityAudit);assert.equal(trace.references.review.hash,review.hash)
  const alignment=JSON.parse((await next.dispatch('GET','trace/reconstructions/'+r.id+'/alignment/diagnostic-1')).text).alignment;assert.equal(alignment.actual.connection.connectionModel,'segmented-edge-v1');assert.ok(alignment.actual.edges.contact.length>0);assert.equal(r.trace.search.connectivityAudit.connectionModel,'whole-edge-v1')
  const h=await next.dispatch('GET','history');assert.equal(h.reconstructions[0].trace,undefined);await assert.rejects(next.dispatch('POST','origins',{reconstructionId:r.id,reconstructionHash:r.hash,candidateId:'diagnostic-1',visualChecked:true,assembly:r.diagnosticCandidates[0].tiles}),/选择候选/)
  assert.deepEqual(await next.read('reviews',review.id),review);assert.deepEqual(await next.read('analyses',analysis.id),analysis)
 }finally{await rm(dir,{recursive:true,force:true})}
})

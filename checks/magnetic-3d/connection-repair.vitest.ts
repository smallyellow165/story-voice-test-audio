import {describe,it,expect,vi} from 'vitest'
import {Quaternion,Vector3} from 'three'
import f from './fixtures/back-angle-hints.json'
import historical from './fixtures/back-repair-connection.json'
import {bindAngleHintSource} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import type {AnglePlanRecord,AngleExecutionRecord} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import {parseAssembly3D,serializeAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {repairConnectionInputs} from '../../src/magnetic-tiles/three-d/repair-connection-evidence.ts'
import {findConstraintRepairs,confirmConstraintRepair,repairAffectedConnections} from '../../src/magnetic-tiles/three-d/constraint-repair.ts'
import {collisionPairKey} from '../../src/magnetic-tiles/three-d/collision-visual.ts'
import * as engine from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {createInitialHistory,undo,redo} from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {edgeSnapTransform,previewEdgeSnap} from '../../src/magnetic-tiles/three-d/editor-snap.ts'
function setup(history=false){
 const fixture=structuredClone(f),assembly=parseAssembly3D(JSON.stringify(fixture.origin.assembly)),source=bindAngleHintSource({origin:fixture.origin,assemblyRaw:JSON.stringify(assembly)},fixture.origin,fixture.plan as unknown as AnglePlanRecord,fixture.execution as unknown as AngleExecutionRecord)
 source.reviewInput={profiles:assembly.profiles,evidence:{version:1,observations:[],unknowns:[]},review:{pieces:source.plan.parts.map(p=>({...p,confirmed:true,excluded:false,color:'#123456'})),constraints:[],spatialChecks:[]}}
 if(history)source.connectionEvidence={originId:fixture.origin.id,originHash:fixture.origin.hash,planId:fixture.plan.id,planHash:fixture.plan.hash,plans:[{record:{...structuredClone(fixture.plan),id:historical.id,hash:historical.hash,plan:{...structuredClone(source.plan),connections:structuredClone(historical.connections),alternatives:[]}} as AnglePlanRecord,profiles:assembly.profiles}],unavailable:[]}
 return {assembly,source}
}
const joint=(s:ReturnType<typeof setup>)=>s.source.connectionEvidence!.plans[0].record.plan.connections.find(c=>[c.pieceA,c.pieceB].sort().join('|')==='p03|p09')!
function articulated(){
 const s=setup(),ids=new Set(['p01','p11','p09']);s.assembly.pieces=s.assembly.pieces.filter(p=>ids.has(p.id));s.assembly.connections=s.assembly.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB)&&![c.pieceA,c.pieceB].every(id=>['p11','p09'].includes(id)))
 return s
}
describe('Connection-aware Auto Fix uses evidence + existing Snap + strict whole graph validation',()=>{
 it('Back: maps historical frames, establishes the tenth joint and preserves all nine original connections',()=>{
  const s=setup(true),before=serializeAssembly3D(s.assembly),inputs=repairConnectionInputs(s.assembly,s.source)
  expect(inputs.proposals).toHaveLength(1);expect(inputs.proposals[0].connection).toMatchObject({pieceA:'p03',portA:'e1-p0',pieceB:'p09',portB:'e1-p0',dihedralDeg:0,flip:true});expect(inputs.proposals[0].evidence[0].authority).toBe('historical-plan')
  expect(()=>edgeSnapTransform(s.assembly,inputs.proposals[0].connection)).not.toThrow()
  const r=findConstraintRepairs(s.assembly,s.source)
  expect(r.status).toBe('complete');expect(r.checks).toBe(90);expect(r.connectionAttempts![0].checks).toBe(81);expect(r.connectionAttempts![0].accepted).toBeGreaterThan(0)
  expect(r.candidates.length).toBeGreaterThan(0)
  for(const c of r.candidates){expect(c.assembly.connections.length).toBe(c.proposedConnection?10:9);expect(c.assembly.connections.slice(0,9).map(({dihedralDeg:_,...c})=>c)).toEqual(s.assembly.connections.map(({dihedralDeg:_,...c})=>c));expect(c.geometry.issues.every(i=>i.code==='intersection')).toBe(true)}
  expect(r.candidates[0].angles.map(a=>a.to)).toEqual([30,30]);expect(r.candidates[0].proposedConnection!.connection.dihedralDeg).toBe(0);expect(r.candidates[0].residuals.maxPositionError).toBeLessThan(1e-10);expect(r.candidates[0].collisions.map(c=>c.pieceIds)).toEqual([['p03','p11']]);expect(serializeAssembly3D(s.assembly)).toBe(before)
  const h=createInitialHistory(s.assembly);joint(s).flip=!joint(s).flip;expect(()=>confirmConstraintRepair(h,s.source,r,r.candidates[0])).toThrow(/过期/)
 })
 it('binds mapping to Observation identity and unchanged anchors, independent of Piece IDs and declaration direction',()=>{
  const s=setup(true),rename=(id:string)=>'instance-'+id
  for(const a of [s.assembly,s.source.original]){for(const p of a.pieces)p.id=rename(p.id);for(const c of a.connections){c.pieceA=rename(c.pieceA);c.pieceB=rename(c.pieceB)}}
  s.source.mapping=new Map([...s.source.mapping].map(([o,p])=>[o,rename(p)]))
  const c=s.assembly.connections[1];[c.pieceA,c.pieceB]=[c.pieceB,c.pieceA];[c.portA,c.portB]=[c.portB,c.portA]
  const r=findConstraintRepairs(s.assembly,s.source),best=r.candidates[0];expect(best.proposedConnection!.connection).toMatchObject({pieceA:'instance-p03',pieceB:'instance-p09',portA:'e1-p0',portB:'e1-p0',flip:true,dihedralDeg:0});expect(best.residuals.maxPositionError).toBeLessThan(1e-10)
  const t=setup(true);t.assembly.connections[1].portB='e1-p0';expect(repairConnectionInputs(t.assembly,t.source).proposals).toEqual([]);expect(repairConnectionInputs(t.assembly,t.source).skipped.some(s=>s.reason.includes('锚点'))).toBe(true)
 })
 it('adds a genuinely evidenced compatible joint and coordinates its connected substructure; preview is read-only, apply is one Undo step',()=>{
  const s=articulated(),raw=serializeAssembly3D(s.assembly),r=findConstraintRepairs(s.assembly,s.source),best=r.candidates.find(c=>c.proposedConnection&&c.geometry.valid)
  expect(best).toBeDefined();expect(best!.assembly.connections.length).toBe(s.assembly.connections.length+1);expect(best!.angles.length).toBeGreaterThan(0)
  expect(best!.assembly.connections[0]).toMatchObject({...s.assembly.connections[0],dihedralDeg:best!.assembly.connections[0].dihedralDeg})
  expect(best!.assembly.pieces.find(p=>p.id==='p01')!.pose).toEqual(s.assembly.pieces.find(p=>p.id==='p01')!.pose)
  expect(engine.validateAssembly3D(best!.assembly).valid).toBe(true);expect(best!.residuals.maxPositionError).toBeLessThan(1e-10);expect(best!.residuals.maxDihedralError).toBeLessThan(1e-10)
  expect(serializeAssembly3D(s.assembly)).toBe(raw)
  const h=createInitialHistory(s.assembly),applied=confirmConstraintRepair(h,s.source,r,best!)
  expect(undo(applied).current).toEqual(h.current);expect(redo(undo(applied)).current).toEqual(applied.current)
  // Ordinary manual Snap retains its existing protection of already linked pieces.
  expect(()=>previewEdgeSnap(s.assembly,{pieceA:'p09',portA:'e0-p0',pieceB:'p11',portB:'e3-p0',dihedralDeg:65,flip:true})).toThrow(/仍有连接/)
 })
 it('does not manufacture a Port pair from adjacency/occlusion, guess unknown ports, reuse old Profiles, or override human separation',()=>{
  const s=setup();expect(repairConnectionInputs(s.assembly,s.source).proposals).toHaveLength(0)
  const t=setup(true);t.source.connectionEvidence!.plans[0].record.plan.parts.find(p=>p.id==='p09')!.profileId='right-triangle';expect(repairConnectionInputs(t.assembly,t.source).proposals).toHaveLength(0);expect(repairConnectionInputs(t.assembly,t.source).skipped[0].reason).toMatch(/Profile/)
  const u=setup(true);joint(u).portA=null;expect(repairConnectionInputs(u.assembly,u.source).skipped[0].reason).toMatch(/未确定/)
  const v=setup(true);v.source.reviewInput!.review.constraints=[{...joint(v),intent:'separate'}];expect(repairConnectionInputs(v.assembly,v.source).proposals).toHaveLength(0)
 })
 it('never rewrites a human Port/Flip constraint to match historical suggestions',()=>{
  const s=setup(true),h=structuredClone(joint(s));h.portA='e1-p0';h.intent='connect';s.source.reviewInput!.review.constraints=[h]
  const proposals=repairConnectionInputs(s.assembly,s.source).proposals;expect(proposals.every(p=>p.connection.portA==='e1-p0')).toBe(true);expect(repairConnectionInputs(s.assembly,s.source).skipped.some(s=>/硬约束/.test(s.reason))).toBe(true)
  s.source.reviewInput!.review.constraints.push({...h,portA:'e3-p0'});expect(repairConnectionInputs(s.assembly,s.source).proposals).toEqual([])
 })
 it('does not optimize or gain score from Non-repairable joints; all remaining collisions still must not worsen',()=>{
  const s=setup(true),nr=collisionPairKey(['p01','p09']),target=collisionPairKey(['p03','p09']),r=findConstraintRepairs(s.assembly,s.source,[target],{nonRepairableKeys:[nr]})
  expect(r.nonRepairableKeys).toEqual([nr]);expect(r.targetKeys).toEqual([target]);expect(r.connectionAttempts![0].accepted).toBeGreaterThan(0)
  for(const c of r.candidates)for(const col of c.collisions){const b=r.baseline.find(b=>b.key===col.key)!;expect(col.depth).toBeLessThanOrEqual(b.depth+1e-9);expect(col.volume!).toBeLessThanOrEqual(b.volume!+1e-12)}
  const noJoint=findConstraintRepairs(s.assembly,s.source,undefined,{nonRepairableKeys:[target]});expect(noJoint.connectionAttempts).toEqual([])
 })
 it('shares absolute budgets fairly and rechecks evidence, geometry, proposed data and policy before applying',()=>{
  const s=articulated(),spy=vi.spyOn(engine,'validateAssembly3D');try{const r=findConstraintRepairs(s.assembly,s.source,undefined,{maxChecks:3});expect(r.checks).toBe(3);expect(spy).toHaveBeenCalledTimes(3);expect(r.connectionAttempts!.some(a=>a.checks>0)).toBe(true);expect(r.status).toBe('budget-exhausted')}finally{spy.mockRestore()}
  const r=findConstraintRepairs(s.assembly,s.source),best=r.candidates.find(c=>c.proposedConnection)!,h=createInitialHistory(s.assembly),bad=structuredClone(best);bad.assembly.connections.at(-1)!.portA='e2-p0';expect(()=>confirmConstraintRepair(h,s.source,r,bad)).toThrow(/快照不一致/)
  s.source.plan.connections[6].evidence+=' changed';expect(()=>confirmConstraintRepair(h,s.source,r,best)).toThrow(/过期/)
 })
 it('keeps loop coordination while excluding unrelated dangling branches from angle search',()=>{
  const s=setup(),a=s.assembly,branch=structuredClone(a.pieces[0]);branch.id='unrelated';a.pieces.push(branch);a.connections.push({pieceA:'p01',pieceB:branch.id,portA:'e0-p0',portB:'e2-p0',dihedralDeg:45,flip:true})
  const relevant=repairAffectedConnections(a,[['p03','p09']],'p01');expect(relevant.has(a.connections.length-1)).toBe(false);expect(relevant.has(2)).toBe(true);expect(relevant.has(3)).toBe(true)
 })
 it('can establish an evidenced connection without old angular freedoms, but not from proximity alone',()=>{
  const s=setup(),ids=new Set(['p01','p02']);s.assembly.pieces=s.assembly.pieces.filter(p=>ids.has(p.id));s.assembly.connections=[];s.assembly.pieces[1].pose=structuredClone(s.assembly.pieces[0].pose)
  const r=findConstraintRepairs(s.assembly,s.source),c=r.candidates.find(c=>c.proposedConnection&&c.geometry.valid)!
  expect(c).toBeDefined();expect(c.angles).toEqual([]);expect(c.assembly.connections).toHaveLength(1);expect(c.residuals.maxPositionError).toBeLessThan(1e-10)
  s.source.plan.connections=[];s.source.plan.alternatives=[];expect(findConstraintRepairs(s.assembly,s.source).candidates).toEqual([])
 })
 it('is invariant to global reference Pose and does not introduce forbidden collisions',()=>{
  const s=articulated(),r=findConstraintRepairs(s.assembly,s.source);expect(r.candidates.some(c=>c.proposedConnection)).toBe(true)
  const q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.7),offset=new Vector3(4,-2,3)
  for(const piece of s.assembly.pieces){piece.pose.position=new Vector3(...piece.pose.position).applyQuaternion(q).add(offset).toArray();piece.pose.quaternion=q.clone().multiply(new Quaternion(...piece.pose.quaternion)).toArray()}
  const moved=findConstraintRepairs(s.assembly,s.source),original=r.candidates.find(c=>c.proposedConnection&&c.geometry.valid)!,best=moved.candidates.find(c=>c.proposedConnection&&c.geometry.valid)!
  expect(best).toBeDefined();expect(best.angles).toEqual(original.angles);expect(best.proposedConnection!.connection).toEqual(original.proposedConnection!.connection);expect(best.referencePieces).toEqual(['p01'])
  expect(best.assembly.pieces.find(p=>p.id==='p01')!.pose).toEqual(s.assembly.pieces.find(p=>p.id==='p01')!.pose)

  for(const c of r.candidates){expect(c.geometry.issues.filter(i=>i.severity==='error').every(i=>i.code==='intersection')).toBe(true);expect(c.collisions.every(x=>r.baseline.some(b=>b.key===x.key))).toBe(true)}
 })
})

import {describe,it,expect,vi} from 'vitest'
import {Quaternion,Vector3} from 'three'
import fixture from './fixtures/back-angle-hints.json'
import {bindAngleHintSource} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import type {AnglePlanRecord,AngleExecutionRecord} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import {findConstraintRepairs,confirmConstraintRepair,repairCollisions,repairLimits} from '../../src/magnetic-tiles/three-d/constraint-repair.ts'
import {createInitialHistory,undo,redo} from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import * as engine from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {collisionPairKey} from '../../src/magnetic-tiles/three-d/collision-visual.ts'
import {parseAssembly3D,serializeAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
function setup(){
 const f=structuredClone(fixture),assembly=parseAssembly3D(JSON.stringify(f.origin.assembly)),source=bindAngleHintSource({origin:f.origin,assemblyRaw:JSON.stringify(assembly)},f.origin,f.plan as unknown as AnglePlanRecord,f.execution as unknown as AngleExecutionRecord)
 source.reviewInput={profiles:assembly.profiles,evidence:{version:1,observations:[],unknowns:[]},review:{pieces:source.plan.parts.map(p=>({...p,confirmed:true,excluded:false,color:'#123456'})),constraints:[],spatialChecks:[]}}
 return {assembly,source}
}
describe('Auto Constraint Repair V1 uses strict existing geometry',()=>{
 it('Back: coordinates both folds, preserves the fixed reference and every connection, returning only partial improvement',()=>{
  const {assembly,source}=setup(),raw=serializeAssembly3D(assembly),result=findConstraintRepairs(assembly,source),best=result.candidates[0]
  expect(result.baseline).toEqual(repairCollisions(assembly));expect(result.status).toBe('complete');expect(result.checks).toBe(9);expect(result.groups.map(g=>g.indices)).toEqual([[2,3]]);expect(result.referencePieces).toEqual(['p01','p02','p03'])
  expect(best.geometry.valid).toBe(false);expect(best.collisions.map(c=>c.pieceIds)).toEqual([['p03','p11']]);expect(best.collisions[0].depth).toBeCloseTo(.01267854785,9)
  expect(best.angles).toEqual([{index:2,from:45,to:25},{index:3,from:45,to:25}]);expect(best.residuals.maxDihedralError).toBeLessThan(1e-10);expect(best.residuals.maxPositionError).toBeLessThan(1e-10)
  expect(best.assembly.profiles).toEqual(assembly.profiles);expect(best.assembly.pieces.map(p=>[p.id,p.color,p.profileId,p.profileVersion])).toEqual(assembly.pieces.map(p=>[p.id,p.color,p.profileId,p.profileVersion]))
  expect(best.assembly.connections.map(({dihedralDeg:_,...c})=>c)).toEqual(assembly.connections.map(({dihedralDeg:_,...c})=>c))
  for(const id of result.referencePieces)expect(best.assembly.pieces.find(p=>p.id===id)!.pose).toEqual(assembly.pieces.find(p=>p.id===id)!.pose)
  expect(serializeAssembly3D(assembly)).toBe(raw)
  for(const c of result.candidates){expect(c.geometry.issues.every(i=>i.code==='intersection')).toBe(true);for(const issue of c.collisions){const before=result.baseline.find(b=>b.key===issue.key)!;expect(before).toBeDefined();expect(issue.depth).toBeLessThanOrEqual(before.depth+1e-9);expect(issue.volume!).toBeLessThanOrEqual(before.volume!+1e-12)}}
 })
 it('can fully repair a mixed-profile articulated substructure, without loosening thresholds',()=>{
  const s=setup(),ids=new Set(['p01','p11','p09']);s.assembly.pieces=s.assembly.pieces.filter(p=>ids.has(p.id));s.assembly.connections=s.assembly.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB))
  expect(validateAssembly3D(s.assembly).valid).toBe(false);const r=findConstraintRepairs(s.assembly,s.source);expect(r.candidates[0].geometry.valid).toBe(true);expect(validateAssembly3D(r.candidates[0].assembly).valid).toBe(true);expect(r.candidates[0].collisions).toEqual([])
 })
 it('supports explicit one/multiple collision targets; never worsens non-target collisions',()=>{
  const s=setup(),targets=[collisionPairKey(['p01','p09']),collisionPairKey(['p03','p09'])],r=findConstraintRepairs(s.assembly,s.source,targets)
  expect(r.targetKeys).toEqual(targets.sort());expect(r.candidates.length).toBeGreaterThan(0);expect(r.candidates[0].collisions.every(c=>!targets.includes(c.key))).toBe(true)
  expect(findConstraintRepairs(s.assembly,s.source,[collisionPairKey(['p03','p11'])]).candidates.length).toBeGreaterThan(0)
  expect(findConstraintRepairs(s.assembly,s.source,['forged']).status).toBe('blocked')
 })
 it('keeps manual hard-angle constraints and uncertain angles fixed instead of treating all nonzero folds as variables',()=>{
  const s=setup();s.source.reviewInput!.review.constraints=[structuredClone(s.source.plan.connections[1])]
  const r=findConstraintRepairs(s.assembly,s.source);expect(r.status).toBe('blocked');expect(r.candidates).toEqual([])
  const t=setup();t.source.plan.connections[1].intent='uncertain';t.source.plan.connections[2].intent='uncertain';expect(findConstraintRepairs(t.assembly,t.source).status).toBe('blocked')
 })
 it('honors reviewed relative plane constraints beyond the chosen connection angles',()=>{
  const s=setup();s.source.reviewInput!.review.spatialChecks=[{id:'locked-angle',pieceA:'p01',pieceB:'p11',relation:'plane-angle',minDeg:45,maxDeg:45,evidenceRefs:[],note:'explicit human geometric requirement'}]
  const r=findConstraintRepairs(s.assembly,s.source);expect(r.candidates).toEqual([]);expect(r.rejected.REVIEW_CONSTRAINT).toBeGreaterThan(0)
 })
 it('rejects bad loops, missing ranges and unknown provenance instead of attempting arbitrary pose fixes',()=>{
  const s=setup();s.assembly.pieces.find(p=>p.id==='p11')!.pose.position[0]+=.1;expect(findConstraintRepairs(s.assembly,s.source).reason).toMatch(/结构错误/)
  const t=setup();t.source.plan.connections[1].angleRange=null;t.source.plan.connections[2].angleRange=null;expect(findConstraintRepairs(t.assembly,t.source).candidates).toEqual([])
  const u=setup();delete u.source.reviewInput;expect(findConstraintRepairs(u.assembly,u.source).status).toBe('blocked')
 })
 it('returns a validated best partial result when the check budget is exhausted',()=>{
  const s=setup(),a=findConstraintRepairs(s.assembly,s.source,undefined,{maxChecks:2}),b=findConstraintRepairs(s.assembly,s.source,undefined,{maxChecks:2})
  expect(a.status).toBe('budget-exhausted');expect(a.checks).toBe(2);expect(a.candidates.length).toBe(1);expect(a.candidates).toEqual(b.candidates);expect(a.checks).toBeLessThanOrEqual(repairLimits.maxChecks)
  const capped=findConstraintRepairs(s.assembly,s.source,undefined,{maxNodes:1});expect(capped.status).toBe('budget-exhausted');expect(capped.nodes).toBe(1)
 })
 it('counts the baseline and every full Validator call in the same absolute check budget',()=>{
  const s=setup(),spy=vi.spyOn(engine,'validateAssembly3D')
  try{const r=findConstraintRepairs(s.assembly,s.source,undefined,{maxChecks:2});expect(r.checks).toBe(2);expect(spy).toHaveBeenCalledTimes(2)}finally{spy.mockRestore()}
 })
 it('applies once through existing history, rechecks all geometry, and supports exact Undo/Redo',()=>{
  const s=setup(),h=createInitialHistory(s.assembly),r=findConstraintRepairs(h.current,s.source),next=confirmConstraintRepair(h,s.source,r,r.candidates[0])
  expect(h.current).toEqual(s.assembly);expect(next.current.revision).toBe(h.current.revision+1);expect(undo(next).current).toEqual(h.current);expect(redo(undo(next)).current).toEqual(next.current);expect(validateAssembly3D(next.current).valid).toBe(false)
  const tampered=structuredClone(r.candidates[0]);tampered.assembly.connections[4].dihedralDeg=0;expect(()=>confirmConstraintRepair(h,s.source,r,tampered)).toThrow(/快照不一致/)
  expect(()=>confirmConstraintRepair(next,s.source,r,r.candidates[0])).toThrow(/过期/)
  s.source.plan.connections[1].angleRange={min:35,max:65};expect(()=>confirmConstraintRepair(h,s.source,r,r.candidates[0])).toThrow(/来源已变化/)
 })
 it('is root-pose invariant and supports an explicitly different fixed reference component',()=>{
  const s=setup(),original=findConstraintRepairs(s.assembly,s.source),q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.7),translation=new Vector3(3,2,-4)
  for(const p of s.assembly.pieces){p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(translation).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()}
  const moved=findConstraintRepairs(s.assembly,s.source);expect(moved.candidates[0].angles).toEqual(original.candidates[0].angles);expect(moved.candidates[0].collisions[0].depth).toBeCloseTo(original.candidates[0].collisions[0].depth,10)
  const other=findConstraintRepairs(s.assembly,s.source,undefined,{referencePieceId:'p13'});expect(other.referencePieces).toEqual(['p09','p11','p12','p13','p14']);for(const id of other.referencePieces)expect(other.candidates[0].assembly.pieces.find(p=>p.id===id)!.pose).toEqual(s.assembly.pieces.find(p=>p.id===id)!.pose)
 })
 it('handles reverse connection traversal and leaves uninvolved free pieces byte-exact',()=>{
  const s=setup(),c=s.assembly.connections[3];[c.pieceA,c.pieceB]=[c.pieceB,c.pieceA];[c.portA,c.portB]=[c.portB,c.portA]
  const free=structuredClone(s.assembly.pieces[0]);free.id='untouched';free.pose.position=[10,20,30];s.assembly.pieces.push(free)
  const r=findConstraintRepairs(s.assembly,s.source);expect(r.candidates[0].angles.map(a=>a.to)).toEqual([25,25]);expect(r.candidates[0].assembly.pieces.find(p=>p.id==='untouched')).toEqual(free)
 })
 it('rejects new collisions with an uninvolved obstacle instead of moving or ignoring it',()=>{
  const s=setup(),r=findConstraintRepairs(s.assembly,s.source),target=r.candidates[0].assembly.pieces.find(p=>p.id==='p13')!
  const profile=structuredClone(s.assembly.profiles[0]);profile.profile.id='repair-obstacle';profile.profile.name='small fixed obstacle';profile.profile.vertices=profile.profile.vertices.map(([x,y])=>[x*.1,y*.1]);s.assembly.profiles.push(profile)
  const obstacle={...structuredClone(target),id:'fixed-obstacle',profileId:profile.profile.id,pose:structuredClone(target.pose)};s.assembly.pieces.push(obstacle)
  const withObstacle=findConstraintRepairs(s.assembly,s.source);expect(withObstacle.rejected.NEW_COLLISION).toBeGreaterThan(0)
  for(const c of withObstacle.candidates){expect(c.assembly.pieces.find(p=>p.id==='fixed-obstacle')).toEqual(obstacle);expect(c.collisions.every(i=>withObstacle.baseline.some(b=>b.key===i.key))).toBe(true)}
 })
})

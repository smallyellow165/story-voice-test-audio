import {describe,it,expect} from 'vitest'
import fixture from './fixtures/back-angle-hints.json'
import {canonical} from '../../src/magnetic-tiles/build-plan.ts'
import {parseAssembly3D,serializeAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {bindAngleHintSource} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import type {AnglePlanRecord,AngleExecutionRecord} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import {findConstraintRepairs,confirmConstraintRepair,repairCandidateScore} from '../../src/magnetic-tiles/three-d/constraint-repair.ts'
import * as state from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {DRAFT_3D_KEY,DRAFT_COLLISION_POLICY_KEY,loadDraft3D,loadDraftCollisionPolicy,saveDraft3D} from '../../src/magnetic-tiles/three-d/draft-storage.ts'
import {collisionPairKey} from '../../src/magnetic-tiles/three-d/collision-visual.ts'
const intrinsic=collisionPairKey(['p01','p09']),target=collisionPairKey(['p03','p09'])
function setup(){
 const f=structuredClone(fixture),assembly=parseAssembly3D(JSON.stringify(f.origin.assembly)),source=bindAngleHintSource({origin:f.origin,assemblyRaw:JSON.stringify(assembly)},f.origin,f.plan as unknown as AnglePlanRecord,f.execution as unknown as AngleExecutionRecord)
 source.reviewInput={profiles:assembly.profiles,evidence:{version:1,observations:[],unknowns:[]},review:{pieces:source.plan.parts.map(p=>({...p,confirmed:true,excluded:false,color:'#123456'})),constraints:[],spatialChecks:[]}}
 return {assembly,source}
}
function storage(){const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}}
describe('Non-repairable is an optimization preference, never geometry approval',()=>{
 it('marks only current collisions; leaves geometry, revision and Validator report byte-exact',()=>{
  const s=setup(),h=state.createInitialHistory(s.assembly),before=canonical(h.current),report=validateAssembly3D(h.current),marked=state.setNonRepairableCollisionAction(h,intrinsic,true)
  expect(canonical(marked.current)).toBe(before);expect(marked.current.revision).toBe(h.current.revision);expect(validateAssembly3D(marked.current)).toEqual(report);expect(report.valid).toBe(false)
  expect(state.currentNonRepairable(marked)).toEqual([intrinsic]);expect(state.currentNonRepairable(h)).toEqual([])
  expect(state.setNonRepairableCollisionAction(marked,intrinsic,true)).toBe(marked)
  expect(()=>state.setNonRepairableCollisionAction(h,collisionPairKey(['p01','p02']),true)).toThrow(/当前 Validator/)
 })
 it('uses existing Undo/Redo for both preference-only and geometry edits, including branch edits',()=>{
  const {assembly}=setup(),h=state.createInitialHistory(assembly),marked=state.setNonRepairableCollisionAction(h,intrinsic,true),moved=state.setPieceTransformAction(marked,'p11',{...marked.current.pieces.find(p=>p.id==='p11')!.pose,position:[1,2,3]})
  expect(state.currentNonRepairable(state.undo(marked))).toEqual([]);expect(state.currentNonRepairable(state.redo(state.undo(marked)))).toEqual([intrinsic])
  expect(state.undo(moved).current).toEqual(marked.current);expect(state.currentNonRepairable(state.undo(moved))).toEqual([intrinsic])
  const deleted=state.deletePieceAction(moved,'p09');expect(state.currentNonRepairable(deleted)).toEqual([]);expect(state.currentNonRepairable(state.undo(deleted))).toEqual([intrinsic])
  const branch=state.setNonRepairableCollisionAction(state.undo(marked),target,true);expect(branch.future).toEqual([]);expect(branch.collisionPolicy!.past.length).toBe(branch.past.length)
 })
 it('restores sidecar metadata with the exact saved Draft without changing Assembly3D JSON or legacy loading',()=>{
  const {assembly}=setup(),store=storage(),raw=saveDraft3D(store,assembly,null,{nonRepairable:[intrinsic],expectedRaw:null})
  expect(loadDraft3D(store)).toEqual({raw,assembly});expect(loadDraftCollisionPolicy(store,assembly,raw).nonRepairable).toEqual([intrinsic]);expect(parseAssembly3D(raw)).toEqual(assembly)
  const restored=state.createInitialHistory(loadDraft3D(store).assembly!,loadDraftCollisionPolicy(store,assembly,raw).nonRepairable);expect(state.currentNonRepairable(restored)).toEqual([intrinsic])
  const other={...assembly,id:'different-work'};expect(loadDraftCollisionPolicy(store,other,serializeAssembly3D(other)).nonRepairable).toEqual([])
  saveDraft3D(store,other,raw);expect(loadDraftCollisionPolicy(store,other,serializeAssembly3D(other)).nonRepairable).toEqual([])
 })
 it('protects concurrent preference-only saves and rolls back metadata if saving geometry fails',()=>{
  const {assembly}=setup(),store=storage(),raw=saveDraft3D(store,assembly,null,{nonRepairable:[intrinsic],expectedRaw:null}),first=store.getItem(DRAFT_COLLISION_POLICY_KEY)
  saveDraft3D(store,assembly,raw,{nonRepairable:[target],expectedRaw:first})
  expect(()=>saveDraft3D(store,assembly,raw,{nonRepairable:[],expectedRaw:first})).toThrow(/其他页面/);expect(loadDraftCollisionPolicy(store,assembly,raw).nonRepairable).toEqual([target])
  const prior=store.getItem(DRAFT_COLLISION_POLICY_KEY),failing={...store,setItem:(k:string,v:string)=>{if(k===DRAFT_3D_KEY)throw Error('quota');store.setItem(k,v)}}
  expect(()=>saveDraft3D(failing,assembly,raw,{nonRepairable:[],expectedRaw:prior})).toThrow('quota');expect(store.getItem(DRAFT_COLLISION_POLICY_KEY)).toBe(prior);expect(store.getItem(DRAFT_3D_KEY)).toBe(raw)
 })
 it('Back: excludes p01/p09 while repairing p03/p09; still checks every collision and all connections',()=>{
  const {assembly,source}=setup(),before=serializeAssembly3D(assembly),r=findConstraintRepairs(assembly,source,[intrinsic,target],{nonRepairableKeys:[intrinsic]})
  expect(r.targetKeys).toEqual([target]);expect(r.nonRepairableKeys).toEqual([intrinsic]);expect(r.candidates.length).toBeGreaterThan(0)
  expect(r.candidates[0].angles.map(a=>a.to)).toEqual([25,25]);expect(r.candidates[0].collisions.map(c=>c.pieceIds)).toEqual([['p03','p11']]);expect(r.candidates[0].geometry.valid).toBe(false)
  expect(r.rejected.WORSE_DEPTH).toBeGreaterThan(0);expect(serializeAssembly3D(assembly)).toBe(before)
  const all=findConstraintRepairs(assembly,source,undefined,{nonRepairableKeys:[intrinsic]});expect(all.targetKeys).not.toContain(intrinsic)
  const marked=state.setNonRepairableCollisionAction(state.createInitialHistory(assembly),intrinsic,true),next=confirmConstraintRepair(marked,source,r,r.candidates[0],state.currentNonRepairable(marked))
  expect(state.currentNonRepairable(next)).toEqual([intrinsic]);expect(state.currentNonRepairable(state.undo(next))).toEqual([intrinsic]);expect(next.current.connections.length).toBe(assembly.connections.length)
  expect(()=>confirmConstraintRepair(marked,source,r,{...r.candidates[0],controls:[5]},[intrinsic])).toThrow(/WORSE_DEPTH/)
 })
 it('never optimizes only an excluded collision, even when explicitly requested',()=>{
  const {assembly,source}=setup(),r=findConstraintRepairs(assembly,source,[intrinsic],{nonRepairableKeys:[intrinsic]})
  expect(r.status).toBe('blocked');expect(r.candidates).toEqual([]);expect(r.reason).toMatch(/不可修复/)
  expect(findConstraintRepairs(assembly,source,undefined,{nonRepairableKeys:validateAssembly3D(assembly).issues.map(i=>collisionPairKey(i.relatedPieceIds!))}).candidates).toEqual([])
 })
 it('removes ALL scoring rewards, including full validity, for the excluded pair disappearing',()=>{
  const {assembly,source}=setup(),r=findConstraintRepairs(assembly,source,[target],{nonRepairableKeys:[intrinsic]}),c=r.candidates[0],marked=r.baseline.find(c=>c.key===intrinsic)!,excluded=new Set([intrinsic]),targets=new Set([target,intrinsic])
  // Counterfactual score inputs isolate the preference invariant; not candidates
  // offered as actual geometry. Raw Validator validity must not decide this tie.
  const withMark={...c,geometry:{valid:false,issues:[]},collisions:[marked]},withoutMark={...c,geometry:{valid:true,issues:[]},collisions:[]}
  expect(repairCandidateScore(withMark,targets,excluded)).toEqual(repairCandidateScore(withoutMark,targets,excluded))
  expect(repairCandidateScore(withMark,targets)).not.toEqual(repairCandidateScore(withoutMark,targets))
 })
 it('prefers less angular deviation once only non-repairable collisions differ',()=>{
  const {assembly,source}=setup(),r=findConstraintRepairs(assembly,source,[target],{nonRepairableKeys:[intrinsic,collisionPairKey(['p03','p11'])]})
  expect(r.candidates[0].angles.map(a=>a.to)).toEqual([30,30]);expect(r.candidates[0].geometry.valid).toBe(false)
 })
 it('keeps preference history aligned with the existing bounded Undo/Redo stack',()=>{
  const {assembly}=setup();let h=state.createInitialHistory(assembly)
  for(let i=0;i<105;i++)h=state.setNonRepairableCollisionAction(h,intrinsic,i%2===0)
  expect(h.past.length).toBe(state.MAX_HISTORY);expect(h.collisionPolicy!.past.length).toBe(state.MAX_HISTORY)
  for(let i=0;i<100;i++)h=state.undo(h)
  expect(h.collisionPolicy!.future.length).toBe(h.future.length)
  for(let i=0;i<100;i++)h=state.redo(h)
  expect(state.currentNonRepairable(h)).toEqual([intrinsic]);expect(h.current).toEqual(assembly)
 })
 it('invalidates a preview when only the Non-repairable preference changed',()=>{
  const {assembly,source}=setup(),h=state.createInitialHistory(assembly),r=findConstraintRepairs(assembly,source,[target],{nonRepairableKeys:[intrinsic]})
  expect(()=>confirmConstraintRepair(h,source,r,r.candidates[0],[])).toThrow(/标记已变化/)
  const original=findConstraintRepairs(assembly,source,[target]);expect(()=>confirmConstraintRepair(h,source,original,original.candidates[0],[intrinsic])).toThrow(/标记已变化/)
 })
})

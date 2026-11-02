import {describe,it,expect} from 'vitest'
// Projected saved Back fixture tests display association, not cryptographic verification.
// Runtime reads full immutable records through the existing server hash checks.
import fixture from './fixtures/back-angle-hints.json'
import {angleHintSourceKey,bindAngleHintSource,assemblyAngleHintRows,comparePlanAngle} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import type {AnglePlanRecord,AngleExecutionRecord} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import type {PhotoOrigin3D} from '../../src/magnetic-tiles/three-d/reconstruction/adopt-draft.ts'
import {parseAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
function setup(){
 const f=structuredClone(fixture),assembly=parseAssembly3D(JSON.stringify(f.origin.assembly)),sidecar:PhotoOrigin3D={origin:f.origin,assemblyRaw:JSON.stringify(assembly)},plan=f.plan as unknown as AnglePlanRecord,execution=f.execution as unknown as AngleExecutionRecord
 return {f,assembly,sidecar,plan,execution,source:bindAngleHintSource(sidecar,f.origin,plan,execution)}
}
describe('read-only source-bound Assembly angle hints',()=>{
 it('reads saved Back diagnostic-8; compares exact current connections without changing snapshots',()=>{
  const s=setup(),before=JSON.stringify(s.f),rows=assemblyAngleHintRows(s.assembly,s.source,0)
  expect(s.source.executedVariant).toBe(0);expect(s.source.scope).toBe('m_back / 所有图片');expect(rows).toHaveLength(9)
  for(const [a,b,angle,min,max] of [['p01','p11',45,25,65],['p11','p12',0,-5,5],['p09','p11',90,65,115]] as const){const r=rows.find(r=>[r.pieceA,r.pieceB].sort().join('/')===[a,b].sort().join('/'))!;expect(r.current!.dihedralDeg).toBeCloseTo(angle);expect(r.hint!.angleRange).toEqual({min,max});expect(r.comparison).toBe('in-range');expect(r.hint!.evidence).not.toBe('')}
  expect(JSON.stringify(s.f)).toBe(before)
 })
 it('updates current angle, missing connections and absent pieces; never creates suggestions',()=>{
  const s=setup();s.assembly.connections[2].dihedralDeg=80
  expect(assemblyAngleHintRows(s.assembly,s.source,0)[2].comparison).toBe('out-of-range')
  s.assembly.connections=s.assembly.connections.filter(c=>![c.pieceA,c.pieceB].includes('p09'));s.assembly.pieces=s.assembly.pieces.filter(p=>p.id!=='p09')
  const row=assemblyAngleHintRows(s.assembly,s.source,0).find(r=>r.comparison==='unconnected')!;expect(row.missingPieces).toEqual(['p09'])
  s.source.plan.connections=[];expect(assemblyAngleHintRows(s.assembly,s.source,0).every(r=>r.comparison==='no-hint')).toBe(true)
 })
 it('keeps source Plan independent from edits, refusing Port, Flip or Profile comparisons',()=>{
  const s=setup(),c=s.assembly.connections[2];c.portA='e3-p0';expect(assemblyAngleHintRows(s.assembly,s.source,0)[2].reason).toMatch(/Port/)
  c.portA='e0-p0';c.flip=false;expect(assemblyAngleHintRows(s.assembly,s.source,0)[2].reason).toMatch(/Flip/)
  c.flip=true;s.assembly.profiles[0].thickness=.12;expect(assemblyAngleHintRows(s.assembly,s.source,0)[2].reason).toMatch(/Profile/)
  expect(s.source.plan.connections[1].angleRange).toEqual({min:25,max:65})
 })
 it('matches exact ports for multiple relationships between the same pair',()=>{
  const s=setup(),other=structuredClone(s.source.plan.connections[1]);other.portA='e3-p0';other.portB='e1-p0';other.angles=[90];s.source.plan.connections.unshift(other)
  expect(assemblyAngleHintRows(s.assembly,s.source,0).find(r=>r.connectionIndex===2)!.hint!.portA).toBe('e0-p0')
  expect(assemblyAngleHintRows(s.assembly,s.source,0).some(r=>r.comparison==='unconnected'&&r.hint!.portA==='e3-p0')).toBe(true)
 })
 it('normalizes reverse traversal using actual flip; does not invent a range',()=>{
  const s=setup(),h=structuredClone(s.source.plan.connections[1]),c={...s.assembly.connections[2],pieceA:'p11',pieceB:'p01',portA:'e2-p0',portB:'e0-p0'}
  expect(comparePlanAngle(c,h,true).comparison).toBe('in-range')
  h.flip=false;c.flip=false;c.dihedralDeg=-45;expect(comparePlanAngle(c,h,true).comparison).toBe('in-range')
  h.angleRange=null;expect(comparePlanAngle(c,h,true).comparison).toBe('suggested');c.dihedralDeg=-50;expect(comparePlanAngle(c,h,true).comparison).toBe('other-angle')
  h.angles=[];expect(comparePlanAngle(c,h,true).comparison).toBe('no-angle');h.portA=null;expect(comparePlanAngle(c,h,true).comparison).toBe('not-comparable')
 })
 it.each(['planHash','reviewHash','sourceHash','executionHash'])('rejects wrong %s rather than using global history',k=>{
  const s=setup();s.sidecar.origin={...s.sidecar.origin,[k]:'wrong'};expect(()=>bindAngleHintSource(s.sidecar,s.sidecar.origin,s.plan,s.execution)).toThrow(/不一致/)
 })
 it('rejects cross-scope, altered snapshot and identity mismatch; unrelated assemblies have no source',()=>{
  const s=setup();s.execution.reconstructionScope={groupName:'Front'};expect(()=>bindAngleHintSource(s.sidecar,s.f.origin,s.plan,s.execution)).toThrow()
  const t=setup();t.sidecar.assemblyRaw=JSON.stringify({...t.assembly,revision:99});expect(()=>bindAngleHintSource(t.sidecar,t.f.origin,t.plan,t.execution)).toThrow()
  expect(angleHintSourceKey({...t.assembly,id:'example'},t.sidecar)).toBe('');expect(angleHintSourceKey(t.assembly,null)).toBe('')
 })
 it('binds a Refinement to its original alternative, refusing different candidate hashes',()=>{
  const s=setup(),reference={id:'refinement',hash:'rh',candidateId:'r1',candidateHash:'ch'}
  s.sidecar.origin={...s.f.origin,refinement:reference};s.execution.refinement=reference
  const record={id:'refinement',hash:'rh',planId:s.plan.id,planHash:s.plan.hash,sourceId:s.plan.sourceId,sourceHash:s.plan.sourceHash,reviewId:s.plan.reviewId,reviewHash:s.plan.reviewHash,candidateHashes:{r1:'ch'},refinement:{candidates:[{id:'r1',variantIndex:1}]}} as unknown as import('../../src/magnetic-tiles/three-d/assembly-angle-hints.ts').AngleRefinementRecord
  expect(bindAngleHintSource(s.sidecar,s.sidecar.origin,s.plan,s.execution,record).executedVariant).toBe(1)
  record.candidateHashes.r1='other';expect(()=>bindAngleHintSource(s.sidecar,s.sidecar.origin,s.plan,s.execution,record)).toThrow()
 })
 it('shows alternatives separately and flags missing construction provenance honestly',()=>{
  const s=setup();expect(assemblyAngleHintRows(s.assembly,s.source,1).length).toBeGreaterThan(0)
  delete s.execution.diagnosticCandidates![0].construction
  expect(bindAngleHintSource(s.sidecar,s.f.origin,s.plan,s.execution).executedVariant).toBe(null)
 })
})

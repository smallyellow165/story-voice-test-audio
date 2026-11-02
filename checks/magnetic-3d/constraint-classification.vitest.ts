import {describe,it,expect} from 'vitest'
import {Quaternion,Vector3} from 'three'
import fixture from './fixtures/back-angle-hints.json'
import {parseAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {bindAngleHintSource,assemblyAngleHintRows} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import type {AnglePlanRecord,AngleExecutionRecord} from '../../src/magnetic-tiles/three-d/assembly-angle-hints.ts'
import {classifyAssemblyConstraints} from '../../src/magnetic-tiles/three-d/constraint-classification.ts'
function setup(){
 const f=structuredClone(fixture),assembly=parseAssembly3D(JSON.stringify(f.origin.assembly)),source=bindAngleHintSource({origin:f.origin,assemblyRaw:JSON.stringify(f.origin.assembly)},f.origin,f.plan as unknown as AnglePlanRecord,f.execution as unknown as AngleExecutionRecord)
 const analyze=()=>{const rows=assemblyAngleHintRows(assembly,source,0),report=validateAssembly3D(assembly),results=classifyAssemblyConstraints(assembly,rows,report);return {rows,report,results,forPair:(a:string,b:string)=>results.get(rows.find(r=>[r.pieceA,r.pieceB].sort().join('|')===[a,b].sort().join('|'))!.key)!}}
 return {f,assembly,source,analyze}
}
describe('deterministic read-only constraint classification V1',()=>{
 it('Back: preserves the four green seams, couples the two folds, leaves uncertain side contacts undecided',()=>{
  const {analyze}=setup(),s=analyze()
  for(const [a,b] of [['p11','p12'],['p11','p13'],['p12','p14'],['p13','p14']]){const c=s.forPair(a,b);expect(c.kind).toBe('preserve-coplanar');expect(c.topology.inCycle).toBe(true);expect(c.topology.coplanarGroups).toEqual([['p11','p12','p13','p14']])}
  for(const [a,b,other] of [['p01','p11',3],['p02','p12',2]] as const){const c=s.forPair(a,b);expect(c.kind).toBe('adjustable-fold');expect(c.topology.coordination).toBe('coordinated');expect(c.topology.coupledConnections).toEqual([other]);expect(c.topology.coplanarGroups).toEqual([['p01','p02'],['p11','p12','p13','p14']])}
  expect(s.forPair('p09','p11').kind).toBe('undetermined');expect(s.forPair('p09','p11').reasons.join('')).toMatch(/不确定/)
  expect(s.forPair('p01','p03').kind).toBe('undetermined')
 })
 it('does not call a single variable in a loop independent when another fold lacks usable hints',()=>{
  const s=setup();s.source.plan.connections[2].angleRange=null
  const c=s.analyze().forPair('p01','p11');expect(c.kind).toBe('adjustable-fold');expect(c.topology.coordination).toBe('cycle-constrained');expect(c.topology.coupledConnections).toEqual([]);expect(c.reasons.join('')).toMatch(/并非独立自由度/)
 })
 it('does not turn an uncertain near-zero seam into a confirmed connection; requires an alternate evidenced coplanar path',()=>{
  const s=setup();expect(s.analyze().forPair('p13','p14').reasons.join('')).toMatch(/未升级为人工确认/)
  s.assembly.connections=s.assembly.connections.filter(c=>!(c.pieceA==='p11'&&c.pieceB==='p13'))
  expect(s.analyze().forPair('p13','p14').kind).toBe('undetermined')
 })
 it('responds to graph edits: same 45-degree ranges become bridge candidates when the roof cycle is opened',()=>{
  const s=setup();s.assembly.connections.shift()
  for(const [a,b] of [['p01','p11'],['p02','p12']]){const c=s.analyze().forPair(a,b);expect(c.kind).toBe('adjustable-fold');expect(c.topology.inCycle).toBe(false);expect(c.topology.coupledConnections).toEqual([])}
 })
 it('uses structured intent, not Tile IDs or prose keywords, for a wide-range leaf relation',()=>{
  const s=setup();s.source.plan.connections.find(c=>c.pieceB==='p09')!.intent='connect'
  const c=s.analyze().forPair('p09','p11');expect(c.kind).toBe('adjustable-fold');expect(c.topology.inCycle).toBe(false);expect(c.reasons.join('')).toMatch(/不代表物理铰链/)
 })
 it.each(['missing-range','missing-evidence','ambiguous-flip','mixed-angle-domain','wide-zero-range'])('keeps %s undecided instead of using angle alone',problem=>{
  const s=setup(),h=s.source.plan.connections[1]
  if(problem==='missing-range')h.angleRange=null
  if(problem==='missing-evidence')h.evidenceRefs=[]
  if(problem==='ambiguous-flip')h.flip=null
  if(problem==='mixed-angle-domain'){h.angles=[0,45];h.angleRange={min:-5,max:65}}
  if(problem==='wide-zero-range'){h.angles=[0];h.angleRange={min:-60,max:60}}
  expect(s.analyze().forPair('p01','p11').kind).toBe('undetermined')
 })
 it('does not treat changed Ports, Profiles, missing hints or unconnected hypotheses as usable current constraints',()=>{
  const s=setup();s.assembly.connections[2].portA='e3-p0';expect(s.analyze().forPair('p01','p11').kind).toBe('undetermined')
  const t=setup();t.assembly.profiles[0].thickness=.12;expect(t.analyze().forPair('p01','p11').kind).toBe('undetermined')
  const u=setup();u.assembly.connections=u.assembly.connections.filter((_,i)=>i!==2);expect(u.analyze().forPair('p01','p11').kind).toBe('undetermined')
 })
 it('reuses strict current structural errors; collision-only Invalid remains Invalid without erasing classification',()=>{
  const s=setup(),before=s.analyze();expect(before.report.valid).toBe(false);expect(before.report.issues.every(i=>i.code==='intersection')).toBe(true)
  s.assembly.pieces.find(p=>p.id==='p11')!.pose.position[0]+=.1
  const after=s.analyze();expect(after.report.issues.some(i=>i.code?.startsWith('loop-'))).toBe(true);expect([...after.results.values()].every(c=>c.kind==='undetermined')).toBe(true)
 })
 it('handles absent validation localization conservatively without globally exempting unknown errors',()=>{
  const s=setup(),{rows}=s.analyze(),report={valid:false,issues:[{modelId:s.assembly.id,severity:'error' as const,code:'other',message:'unknown structural failure'}]}
  expect([...classifyAssemblyConstraints(s.assembly,rows,report).values()].every(c=>c.kind==='undetermined')).toBe(true)
 })
 it('is invariant under global rigid transforms and never mutates input geometry, hints or validation',()=>{
  const s=setup(),a=s.analyze(),before=JSON.stringify({assembly:s.assembly,source:s.source.plan,report:a.report})
  classifyAssemblyConstraints(s.assembly,a.rows,a.report);expect(JSON.stringify({assembly:s.assembly,source:s.source.plan,report:a.report})).toBe(before)
  const q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),1.1),offset=new Vector3(6,-2,4)
  for(const p of s.assembly.pieces){p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(offset).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()}
  expect([...s.analyze().results.values()]).toEqual([...a.results.values()])
 })
})

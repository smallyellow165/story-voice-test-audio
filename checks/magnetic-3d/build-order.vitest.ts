import {describe,it,expect} from 'vitest'
import {Quaternion,Vector3} from 'three'
import {generateBuildOrder3D} from '../../src/magnetic-tiles/three-d/build-order.ts'
import {parseAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import type {Assembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {parseTutorial3D,serializeTutorial3D,validateTutorial3D,stepAssembly} from '../../src/magnetic-tiles/three-d/tutorial.ts'
import {validateAssembly3D,solveAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import * as state from '../../src/magnetic-tiles/three-d/vendor/editor/tutorial-state.ts'
import {saveTutorial3D,loadTutorial3D} from '../../src/magnetic-tiles/three-d/tutorial-storage.ts'
import right from '../../src/magnetic-tiles/three-d/examples/right-angle.json' with {type:'json'}
import cube from '../../src/magnetic-tiles/three-d/examples/closed-cube.json' with {type:'json'}
import mixed from '../../src/magnetic-tiles/three-d/examples/mixed-profiles.json' with {type:'json'}
const input=(data:unknown)=>parseAssembly3D(JSON.stringify(data))
const order=(a:Assembly3D)=>generateBuildOrder3D(a).tutorial!.steps.flatMap(s=>s.addedPieceIds)
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze)}return value}
function subset(a:Assembly3D,ids:string[]){const keep=new Set(ids);return {...a,pieces:a.pieces.filter(p=>keep.has(p.id)),connections:a.connections.filter(c=>keep.has(c.pieceA)&&keep.has(c.pieceB))}}
describe('bounded 3D build order V1',()=>{
 it('produces a deterministic right-angle Tutorial3D using saved poses without mutating even frozen input',()=>{
  const a=freeze(input(right)),first=generateBuildOrder3D(a),second=generateBuildOrder3D(a)
  expect(first).toEqual(second);expect(first.status).toBe('complete');expect(first.tutorial!.assembly).toEqual(a)
  expect(first.tutorial!.steps).toHaveLength(2);expect(first.estimates[0].groundContact).toBe(true)
  expect(validateTutorial3D(first.tutorial!).steps.every(s=>s.geometryValid&&s.connected)).toBe(true)
  expect(first.physicalStability).toBe('not-assessed');expect(first.buildabilityEstimate).toBe('review-required')
 })
 it('validates every cube prefix, not only the final six-face twelve-connection model',()=>{
  const a=input(cube),r=generateBuildOrder3D(a);expect(r.status).toBe('complete')
  expect(r.tutorial!.steps).toHaveLength(6);expect(r.tutorial!.steps.flatMap(s=>s.addedConnections)).toHaveLength(12)
  for(let i=0;i<6;i++){const prefix=stepAssembly(r.tutorial!,i);expect(prefix.pieces).toHaveLength(i+1);expect(validateAssembly3D(prefix,{requireConnected:true}).valid).toBe(true)}
  expect(r.stats.completeCandidates).toBeGreaterThan(1);expect(r.stats.cacheHits).toBeGreaterThan(0)
  expect(r.estimates.reduce((s,e)=>s+e.loopClosures,0)).toBe(12-6+1)
  expect(r.estimates.at(-1)!.newConnections).toBe(4);expect(r.diagnostics.some(d=>d.code==='CLOSURE_OR_SUPPORT_RISK')).toBe(true)
  expect(r.tutorial!.assembly).toEqual(a)
 })
 it('retains multiple graph cycles under an arbitrary rigid orientation and translation',()=>{
  const a=input(cube),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.713)
  a.pieces.forEach(p=>{p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(new Vector3(3,0,-2)).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()})
  const r=generateBuildOrder3D(a);expect(r.status).toBe('complete');expect(r.estimates.reduce((s,e)=>s+e.loopClosures,0)).toBe(7)
  expect(validateTutorial3D(r.tutorial!).steps.every(s=>s.geometryValid&&s.connected)).toBe(true)
 })
 it('uses actual geometry and graph constraints for a square-triangle spatial assembly',()=>{
  const original=input(mixed),a=subset(original,original.connections.flatMap(c=>[c.pieceA,c.pieceB]))
  const r=generateBuildOrder3D(a);expect(r.status).toBe('complete');expect(r.tutorial!.assembly).toEqual(a)
  expect(new Set(r.tutorial!.assembly.pieces.map(p=>p.profileId)).size).toBe(2)
 })
 it('keeps Profile versions, unequal dimensions, partial ports, colors and thickness unchanged',()=>{
  const a=input(right),snapshot=structuredClone(a.profiles[0]);snapshot.profile.version=2;snapshot.profile.vertices=snapshot.profile.vertices.map(([x,y])=>[x*2,y*2]);snapshot.thickness=.08;snapshot.ports=[{edgeId:'e0',ranges:[[0,.5]]}]
  a.profiles.push(snapshot);a.pieces[1].profileVersion=2;a.pieces[1].color='#123456'
  const solved=solveAssembly3D(a,[a.pieces[0].id]);expect(validateAssembly3D(solved).valid).toBe(true)
  const r=generateBuildOrder3D(solved);expect(r.status).toBe('complete');expect(r.tutorial!.assembly).toEqual(solved)
  expect(parseTutorial3D(serializeTutorial3D(r.tutorial!))).toEqual(r.tutorial)
 })
 it('is independent of array iteration order and does not rank by names, IDs or colors',()=>{
  const a=input(cube),b=structuredClone(a);b.pieces.reverse();b.connections.reverse();b.profiles.reverse()
  expect(order(b)).toEqual(order(a))
  const aliases=new Map(b.pieces.map((p,i)=>[p.id,`unrelated-${90-i}`]))
  b.pieces.forEach((p,i)=>{p.id=aliases.get(p.id)!;p.color=i%2?'#000000':'#ffffff'})
  b.connections.forEach(c=>{c.pieceA=aliases.get(c.pieceA)!;c.pieceB=aliases.get(c.pieceB)!})
  b.profiles.forEach(p=>p.profile.name='arbitrary descriptive label')
  const restore=new Map([...aliases].map(([a,b])=>[b,a]));expect(order(b).map(id=>restore.get(id))).toEqual(order(a))
 })
 it('is not height sorting: every non-root addition has an actual source connection to the prefix',()=>{
  const a=input(cube),r=generateBuildOrder3D(a),seen=new Set<string>()
  for(const s of r.tutorial!.steps){const id=s.addedPieceIds[0];if(seen.size)expect(a.connections.some(c=>c.pieceA===id&&seen.has(c.pieceB)||c.pieceB===id&&seen.has(c.pieceA))).toBe(true);seen.add(id)}
  const terms=r.estimates.flatMap(e=>Object.keys(e.terms));expect(terms).toContain('closure');expect(terms).toContain('base');expect(terms).toContain('support')
  expect(r.estimates[0].newConnections).toBe(0)
  // A hanging small plate is lower than its roof connector, but cannot be added before that connector.
  const chain=input(right),roof=structuredClone(chain.profiles[0]),small=structuredClone(chain.profiles[0])
  roof.profile.version=3;roof.ports=[{edgeId:'e2',ranges:[[.3,.7]]}]
  small.profile.version=2;small.profile.vertices=small.profile.vertices.map(([x,y])=>[x*.4,y*.4]);small.thickness=.03
  chain.profiles.push(roof,small)
  chain.pieces.push({...structuredClone(chain.pieces[0]),id:'bridge',profileVersion:3},{...structuredClone(chain.pieces[0]),id:'dependent',profileVersion:2})
  let solved:Assembly3D|undefined
  for(const angleA of [-90,90])for(const flipA of [false,true])for(const angleB of [-90,90])for(const flipB of [false,true]){
    const test=structuredClone(chain)
    test.connections.push({pieceA:'wall',portA:'e2-p0',pieceB:'bridge',portB:'e0-p0',dihedralDeg:angleA,flip:flipA},
      {pieceA:'bridge',portA:'e2-p0',pieceB:'dependent',portB:'e0-p0',dihedralDeg:angleB,flip:flipB})
    const candidate=solveAssembly3D(test,['base']),positions=new Map(candidate.pieces.map(p=>[p.id,p.pose.position[1]]))
    if(positions.get('bridge')!>positions.get('dependent')!+.1&&positions.get('dependent')!>.2&&validateAssembly3D(candidate).valid)solved=candidate
  }
  expect(solved).toBeDefined()
  const chained=generateBuildOrder3D(solved!);expect(chained.status).toBe('complete')
  const sequence=chained.tutorial!.steps.flatMap(s=>s.addedPieceIds)
  expect(sequence).toEqual(['base','wall','bridge','dependent'])
 })
 it('fails explicitly for disconnected but geometrically valid structures',()=>{
  const r=generateBuildOrder3D(input(mixed));expect(r.finalGeometryValid).toBe(true);expect(r.status).toBe('no-order');expect(r.tutorial).toBeNull()
  expect(r.diagnostics.some(d=>d.code==='DISCONNECTED_SOURCE')).toBe(true)
 })
 it('rejects collision, wrong edge angles and loop residuals without repairing the source',()=>{
  for(const change of [(a:Assembly3D)=>{a.pieces[1].pose=structuredClone(a.pieces[0].pose)},(a:Assembly3D)=>{a.connections[0].dihedralDeg=-37}]){
   const a=input(cube);change(a);const before=structuredClone(a),r=generateBuildOrder3D(a)
   expect(r.status).toBe('invalid-assembly');expect(r.tutorial).toBeNull();expect(r.finalGeometryValid).toBe(false);expect(a).toEqual(before)
   expect(r.diagnostics.some(d=>d.code?.includes('loop')||d.code==='intersection')).toBe(true)
  }
 })
 it('rejects structurally invalid ports rather than synthesizing geometry',()=>{
  const a=input(right);a.connections[0].portA='missing'
  const r=generateBuildOrder3D(a);expect(r.status).toBe('invalid-assembly');expect(r.stats.evaluations).toBe(0)
 })
 it('stops at an exact evaluation budget and returns only a checked incomplete draft',()=>{
  const r=generateBuildOrder3D(input(cube),{maxEvaluations:3})
  expect(r.status).toBe('budget-exhausted');expect(r.stats.evaluations).toBe(3);expect(r.stats.deepest).toBeLessThan(6)
  expect(r.tutorial!.steps.length).toBe(r.stats.deepest);expect(validateTutorial3D(r.tutorial!).issues.some(i=>i.code==='UNASSIGNED')).toBe(true)
  expect(r.connectedConstruction).toBe(false)
  expect(generateBuildOrder3D(input(cube),{maxEvaluations:0}).finalGeometryValid).toBeNull()
 })
 it('bounds cached and rejected candidate work separately from geometry calls',()=>{
  const r=generateBuildOrder3D(input(cube),{maxTransitions:2})
  expect(r.status).toBe('budget-exhausted');expect(r.stats.transitions).toBe(2);expect(r.stats.evaluations).toBeLessThanOrEqual(3)
  expect(r.stats.termination).toBe('TRANSITION_BUDGET')
 })
 it('reports a real no-order result under explicit extra constraints, without claiming physical impossibility',()=>{
  const a=input(right);a.pieces.forEach(p=>p.pose.position[1]+=5)
  expect(generateBuildOrder3D(a).status).toBe('complete')
  const strict=generateBuildOrder3D(a,{requireGroundedStart:true});expect(strict.status).toBe('no-order');expect(strict.stats.beamPruned).toBe(0)
  const corner=subset(input(cube),['bottom','front','left']);expect(validateAssembly3D(corner).valid).toBe(true)
  const r=generateBuildOrder3D(corner,{maxConnectionsPerStep:1,beamWidth:32});expect(r.status).toBe('no-order');expect(r.stats.beamPruned).toBe(0)
  expect(r.diagnostics.some(d=>d.code==='NO_ADMISSIBLE_ORDER')).toBe(true)
 })
 it('distinguishes beam-limited failure from proof of no admissible order',()=>{
  const r=generateBuildOrder3D(input(cube),{maxConnectionsPerStep:1,beamWidth:1})
  expect(r.status).toBe('search-limited');expect(r.stats.beamPruned).toBeGreaterThan(0);expect(r.stats.termination).toBe('BEAM_EXHAUSTED')
 })
 it('flags unsupported floating assemblies and narrow-base/cantilever estimates instead of claiming stability',()=>{
  const a=input(right);a.pieces.forEach(p=>p.pose.position[1]+=3)
  const r=generateBuildOrder3D(a);expect(r.status).toBe('complete');expect(r.estimates[0].warnings.join()).toContain('托持')
  expect(validateTutorial3D(r.tutorial!).verified).toBe(false)
  expect(r.physicalStability).toBe('not-assessed');expect(r.diagnostics.map(d=>d.code)).toContain('INSTALLATION_PATH_UNCHECKED')
 })
 it('keeps generated drafts editable, undoable, saveable and importable by the phase-four mechanisms',()=>{
  const t=generateBuildOrder3D(input(cube)).tutorial!,base=state.createInitialHistory(t)
  const h=state.updateStepAction(base,t.steps[0].id,{title:'人工审核后调整',description:'新说明'})
  expect(state.undo(h).current).toEqual(t);expect(h.current.assembly).toEqual(t.assembly)
  const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}}
  saveTutorial3D(storage,h.current,null);expect(loadTutorial3D(storage).tutorial).toEqual(h.current)
 })
 it('rejects unbounded options and oversized workloads observably',()=>{
  expect(generateBuildOrder3D(input(right),{beamWidth:0}).status).toBe('invalid-options')
  expect(generateBuildOrder3D(input(right),{maxEvaluations:Infinity}).status).toBe('invalid-options')
  const a=input(right);a.pieces=Array.from({length:65},(_,i)=>({...a.pieces[0],id:`p${i}`}))
  expect(generateBuildOrder3D(a).status).toBe('input-limit')
  const large=input(right);large.profiles[0].profile.vertices=Array.from({length:256},(_,i)=>[Math.cos(i*Math.PI/128),Math.sin(i*Math.PI/128)]);large.profiles[0].profile.connectableEdges=Array.from({length:256},(_,i)=>`e${i}`)
  large.pieces=Array.from({length:64},(_,i)=>({...large.pieces[0],id:`large-${i}`}));large.connections=[]
  const guarded=generateBuildOrder3D(large);expect(guarded.status).toBe('invalid-assembly');expect(guarded.stats.evaluations).toBe(0) // Registry already caps each Profile at 16 vertices.
 })
})

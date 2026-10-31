import {describe,it,expect} from 'vitest'
import {createTutorial3D,serializeTutorial3D,parseTutorial3D,stepAssembly,validateTutorial3D,tutorialMatchesAssembly,syncStepConnections} from '../../src/magnetic-tiles/three-d/tutorial.ts'
import * as actions from '../../src/magnetic-tiles/three-d/vendor/editor/tutorial-state.ts'
import {createOrchestratorState,reduce,tick,computeStepDuration,getEntranceOffset} from '../../src/magnetic-tiles/three-d/vendor/components/tutorial/orchestrator.ts'
import {easingFunctions} from '../../src/magnetic-tiles/three-d/vendor/components/tutorial/easing.ts'
import {loadTutorial3D,saveTutorial3D,TUTORIAL_3D_KEY} from '../../src/magnetic-tiles/three-d/tutorial-storage.ts'
import right from '../../src/magnetic-tiles/three-d/examples/right-angle.json' with {type:'json'}
import cube from '../../src/magnetic-tiles/three-d/examples/closed-cube.json' with {type:'json'}
import mixed from '../../src/magnetic-tiles/three-d/examples/mixed-profiles.json' with {type:'json'}
import {parseAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
function complete(data=right){const t=createTutorial3D(parseAssembly3D(JSON.stringify(data)));let h=actions.createInitialHistory(t)
 for(const p of t.assembly.pieces){const a=actions.addStepAction(h);h=actions.addPieceToStepAction(a.history,a.stepId,p.id)}return h}
describe('Tutorial3D snapshot and upstream step state',()=>{
 it('creates a complete independent snapshot and identifies source by content as well as version',()=>{
  const a=parseAssembly3D(JSON.stringify(right)),t=createTutorial3D(a);expect(t.assembly).toEqual(a);expect(t.assembly).not.toBe(a)
  expect(tutorialMatchesAssembly(t,a)).toBe(true);a.pieces[0].pose.position[0]+=3;expect(tutorialMatchesAssembly(t,a)).toBe(false)
  expect(t.assembly).toEqual(right);expect(tutorialMatchesAssembly(t,{...t.assembly,revision:999})).toBe(false)
 })
 it('keeps source geometry immutable for every edit and rejects a mutation through commit',()=>{
  const h=complete(),copy=structuredClone(h.current.assembly)
  expect(()=>actions.commit(h,p=>{p.assembly.pieces[0].pose.position[0]++;return p})).toThrow('immutable')
  expect(h.current.assembly).toEqual(copy)
  expect(()=>actions.updateCurrent(h,p=>{p.assembly.pieces[0].pose.position[0]++;return p})).toThrow('immutable')
 })
 it('assigns each piece to a step once, preserves stable IDs on reorder and derives connections',()=>{
  let h=complete();const ids=h.current.steps.map(s=>s.id),pid=h.current.assembly.pieces[0].id
  h=actions.moveStepAction(h,0,1);expect(h.current.steps.map(s=>s.id)).toEqual([...ids].reverse())
  expect(h.current.steps[1].addedConnections).toHaveLength(1)
  h=actions.addPieceToStepAction(h,h.current.steps[0].id,pid)
  expect(h.current.steps[1].addedPieceIds).toEqual([]);expect(h.current.steps[0].addedPieceIds).toHaveLength(2)
  expect(actions.undo(h).current.steps[1].addedPieceIds).toEqual([pid])
  expect(actions.redo(actions.undo(h)).current).toEqual(h.current)
 })
 it('removes a step without deleting geometry and reports unassigned pieces',()=>{
  const h=complete();const next=actions.deleteStepAction(h,h.current.steps[0].id)
  expect(next.current.assembly).toEqual(h.current.assembly);expect(validateTutorial3D(next.current).issues.some(i=>i.code==='UNASSIGNED')).toBe(true)
 })
 it('validates the right angle and all six cube stages using exact poses and 12 final constraints',()=>{
  for(const data of [right,cube]){const h=complete(data);const check=validateTutorial3D(h.current)
   expect(check.finalValid).toBe(true);expect(check.steps.every(s=>s.geometryValid)).toBe(true)
   expect(stepAssembly(h.current,0).pieces[0].pose).toEqual(h.current.assembly.pieces[0].pose)
   expect(stepAssembly(h.current,99)).toEqual(h.current.assembly)
  }
  const t=complete(cube).current;expect(t.steps.flatMap(s=>s.addedConnections)).toHaveLength(12)
 })
 it('separates geometry, connection, coverage and ground-contact diagnostics',()=>{
  const t=complete(mixed).current,d=validateTutorial3D(t)
  expect(d.finalValid).toBe(true);expect(d.steps.some(s=>!s.connected)).toBe(true);expect(d.verified).toBe(false)
  const floating=structuredClone(t);floating.assembly.pieces.forEach(p=>p.pose.position[1]+=10)
  expect(validateTutorial3D(floating).issues.some(i=>i.code==='NO_GROUND_CONTACT')).toBe(true)
 })
 it('retains invalid geometry Drafts, surfaces final and per-step errors, never solves on roundtrip',()=>{
  const t=complete().current;t.assembly.pieces[1].pose=structuredClone(t.assembly.pieces[0].pose)
  const d=validateTutorial3D(t);expect(d.finalValid).toBe(false);expect(d.verified).toBe(false);expect(d.steps[1].geometryValid).toBe(false)
  expect(parseTutorial3D(serializeTutorial3D(t))).toEqual(t)
 })
 it('roundtrips cameras, ProfileSnapshot, version, color, final pose and custom animation without playback state',()=>{
  let h=complete();h=actions.captureCurrentViewAsStepCameraAction(h,1,{position:[3,4,5],target:[0,0,0],zoom:90},1200)
  h=actions.patchPieceEntranceAction(h,1,h.current.steps[0].addedPieceIds[0],{type:'fade',durationMs:900})
  h=actions.updateStepAction(h,1,{title:'底座',description:'保存说明'})
  const raw=serializeTutorial3D(h.current);expect(parseTutorial3D(raw)).toEqual(h.current);expect(raw).not.toContain('currentStep')
  expect(h.current.assembly).toEqual(right)
 })
 it('rejects corrupt reference, altered source version, fake step connections and malformed camera',()=>{
  const t=complete().current
  for(const edit of [(p:typeof t)=>{p.source.assemblyRevision++},(p:typeof t)=>{p.steps[0].addedPieceIds=['unknown']},(p:typeof t)=>{p.steps[0].addedConnections=[p.assembly.connections[0]]},(p:typeof t)=>{p.steps[0].camera={position:[0,0,0],target:[0,0,0],zoom:0,transitionMs:-1}}]){
   const p=structuredClone(t);edit(p);expect(()=>parseTutorial3D(JSON.stringify(p))).toThrow()
  }
  expect(()=>parseTutorial3D(JSON.stringify({title:'汉'.repeat(700000)}))).toThrow('2 MB')
  const large=structuredClone(t);large.steps=Array.from({length:70},(_,i)=>({...structuredClone(t.steps[0]),id:i+1,addedPieceIds:[],addedConnections:[],description:'汉'.repeat(10000)}))
  expect(()=>serializeTutorial3D(large)).toThrow('2 MB')
 })
 it('detects duplicate assignments in imported Drafts instead of silently rewriting them',()=>{
  const t=complete().current;t.steps[1].addedPieceIds.push(t.steps[0].addedPieceIds[0]);syncStepConnections(t)
  const parsed=parseTutorial3D(serializeTutorial3D(t));expect(validateTutorial3D(parsed).issues.some(i=>i.code==='DUPLICATE_PIECE')).toBe(true)
 })
 it('uses independent storage with stale-tab, quota and malformed read protection',()=>{
  const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}}
  values.set('magnetic-tiles.assembly3d-draft.v1','unchanged');const t=complete().current
  const raw=saveTutorial3D(storage,t,null);expect(loadTutorial3D(storage).tutorial).toEqual(t)
  expect(()=>saveTutorial3D(storage,t,null)).toThrow('其他页面');expect(values.get('magnetic-tiles.assembly3d-draft.v1')).toBe('unchanged')
  expect(()=>saveTutorial3D({...storage,setItem:()=>{throw Error('quota')}},t,raw)).toThrow('quota');expect(storage.getItem(TUTORIAL_3D_KEY)).toBe(raw)
  expect(()=>loadTutorial3D({getItem:()=>'{'})).toThrow()
 })
})
describe('upstream tutorial animation regressions',()=>{
 it('keeps all upstream easing endpoints',()=>{for(const easing of Object.values(easingFunctions)){expect(easing(0)).toBeCloseTo(0);expect(easing(1)).toBeCloseTo(1)}})
 it('preserves pending/entering/highlight/done with zero movement during highlight',()=>{
  const step=complete().current.steps[0],pid=step.addedPieceIds[0];let state=reduce(createOrchestratorState(0,step),{type:'play'},2,step)
  state=tick(state,400,step,2);expect(state.pieceStates[pid].phase).toBe('entering');expect(getEntranceOffset(pid,state,step).positionOffset[1]).toBeGreaterThan(0)
  state=tick(state,450,step,2);expect(state.pieceStates[pid].phase).toBe('highlight');expect(getEntranceOffset(pid,state,step).positionOffset).toEqual([0,0,0])
  const paused=reduce(state,{type:'pause'},2,step);expect(tick(paused,500,step,2)).toBe(paused)
  expect(tick(state,3000,step,2).playState).toBe('idle')
 })
 it('respects camera duration and zero-duration camera cuts; highlights do not restart entrance',()=>{
  const step=complete().current.steps[0];step.camera={position:[1,2,3],target:[0,0,0],zoom:50,transitionMs:2400}
  expect(computeStepDuration(step)).toBeGreaterThanOrEqual(2400)
  let s=reduce(createOrchestratorState(0,step),{type:'replay-step'},2,step);expect(s.cameraTransitionProgress).toBe(0)
  expect(tick(s,600,step,2).cameraTransitionProgress).toBe(.25)
  step.camera.transitionMs=0;s=reduce(s,{type:'replay-step'},2,step);expect(tick(s,1,step,2).cameraTransitionProgress).toBe(1)
 })
 it('clamps navigation and respects reduced-motion without touching source',()=>{
  const t=complete().current,s=reduce(createOrchestratorState(0,t.steps[0],true),{type:'seek',stepIndex:99},2,t.steps[1])
  expect(s.currentStep).toBe(1);const next=tick(s,10,t.steps[1],2);expect(next.cameraTransitionProgress).toBe(1)
  expect(getEntranceOffset(t.steps[1].addedPieceIds[0],next,t.steps[1]).positionOffset).toEqual([0,0,0])
 })
})

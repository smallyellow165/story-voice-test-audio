import {describe,it,expect} from 'vitest'
import {Quaternion,Vector3} from 'three'
import {profiles} from '../../src/magnetic-tiles/profiles.ts'
import {canonicalProfileSnapshot} from '../../src/magnetic-tiles/three-d/canonical-geometry.ts'
import * as actions from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {createMoveObjectSearch,confirmMoveObjectSnap,confirmObjectMoveFallback} from '../../src/magnetic-tiles/three-d/move-object-snap.ts'
import type {MoveObject,MoveObjectSession} from '../../src/magnetic-tiles/three-d/move-object-snap.ts'
import type {Assembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {combineAssemblySnapshots,transformModule} from '../../src/magnetic-tiles/three-d/module-transform.ts'
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {serializeAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
const snapshot=canonicalProfileSnapshot(profiles.find(p=>p.id==='square'&&p.version===1)!)
const pose=(x:number,y=0,z=0)=>({position:[x,y,z] as [number,number,number],quaternion:[0,0,0,1] as [number,number,number,number]})
function one(id:string,x:number):Assembly3D{return {kind:'magnetic-assembly-3d',schemaVersion:1,id,revision:0,profiles:[snapshot],pieces:[{id,profileId:'square',profileVersion:1,pose:pose(x)}],connections:[]}}
function fixture(groupMoving=false,groupFixed=false){
 const a=one('fixed',groupFixed?0:20),b=one('moving',groupMoving?3:22)
 if(groupMoving){b.pieces.push({...structuredClone(b.pieces[0]),id:'member',pose:pose(4)});b.connections.push({pieceA:'moving',portA:'e1-p0',pieceB:'member',portB:'e3-p0',dihedralDeg:0,flip:true})}
 const parent=(id:string)=>({id,version:1,revision:0,hash:'a'.repeat(64),snapshotHash:'b'.repeat(64)})
 const base=combineAssemblySnapshots('objects',[{name:'fixed-group',parent:parent('pa'),assembly:a},{name:'moving-group',parent:parent('pb'),assembly:b}])
 let h=actions.createInitialHistory(base)
 if(!groupFixed)h=actions.commit(h,a=>{a.pieces.push({...structuredClone(a.pieces[0]),id:'free-fixed',pose:pose(0)});return a})
 if(!groupMoving)h=actions.commit(h,a=>{a.pieces.push({...structuredClone(a.pieces[0]),id:'free-moving',pose:pose(3)});return a})
 const moving:MoveObject=groupMoving?{kind:'group',groupId:'module-1'}:{kind:'tile',tileId:'free-moving'}
 const raw=groupMoving?transformModule(h.current,'module-1',{position:[-2.88,-1,0],quaternion:[0,0,0,1]}):structuredClone(h.current)
 if(!groupMoving)raw.pieces.find(p=>p.id==='free-moving')!.pose=pose(.12,-1)
 return {h,moving,raw,fixedId:groupFixed?base.modules![0].pieces[0].id:'free-fixed'}
}
function state(f:ReturnType<typeof fixture>,mode:'strict'|'less-strict'='strict'):MoveObjectSession{
 const search=createMoveObjectSearch(f.h.current,f.moving)(f.raw,mode)
 return {sourceRaw:serializeAssembly3D(f.h.current),moving:f.moving,raw:f.raw,dragged:f.raw,search,selectedKey:search.automaticKey,released:true}
}
describe('Move Object Snap uses existing Solver and both Snap executors',()=>{
 for(const groupMoving of [false,true])for(const groupFixed of [false,true])it(`${groupMoving?'Group':'Tile'} -> ${groupFixed?'Group member':'Free Tile'}; rigid motion, exact joint, one Undo`,()=>{
  const f=fixture(groupMoving,groupFixed),s=state(f),c=s.search.candidates.find(c=>c.request.fixed.tileId===f.fixedId&&c.request.fixed.portId==='e0-p0')!
  expect(c).toBeDefined();expect(c.error).toBeUndefined();expect(c.request.dihedralDeg).toBe(0);expect(c.request.flip).toBe(true);expect(s.selectedKey).toBe(c.key)
  const before=structuredClone(f.h.current),next=confirmMoveObjectSnap(f.h,s)
  expect(validateAssembly3D(next.current).valid).toBe(true);expect(next.current.connections).toHaveLength(before.connections.length+1);expect(next.current.connections.slice(0,before.connections.length)).toEqual(before.connections)
  const ids=groupMoving?new Set(before.modules![1].pieces.map(p=>p.id)):new Set(['free-moving'])
  expect(next.current.pieces.filter(p=>!ids.has(p.id))).toEqual(before.pieces.filter(p=>!ids.has(p.id)))
  expect(next.current.modules![0]).toEqual(before.modules![0]);expect(next.current.modules!.map(({frame,...m})=>m)).toEqual(before.modules!.map(({frame,...m})=>m))
  expect(actions.undo(next).current).toEqual(before);expect(actions.redo(actions.undo(next)).current).toEqual(next.current);expect(f.h.current).toEqual(before)
 })
 it('ambiguous shared targets require selection, never silently choose; no premature confirm / stale inputs',()=>{
  const f=fixture(),a=f.h.current;a.pieces.push({...structuredClone(a.pieces.find(p=>p.id==='free-fixed')!),id:'second-fixed',pose:pose(.03)})
  f.raw.pieces.push(structuredClone(a.pieces.at(-1)!));const s=state(f,'less-strict')
  expect(s.search.total).toBeGreaterThan(1);expect(s.selectedKey).toBeNull();expect(()=>confirmMoveObjectSnap(f.h,s)).toThrow(/不可确认/)
  const c=s.search.candidates.find(c=>!c.error)!;s.selectedKey=c.key
  expect(()=>confirmMoveObjectSnap(f.h,{...s,released:false})).toThrow(/不可确认/)
  expect(()=>confirmMoveObjectSnap(actions.setPieceColorAction(f.h,'free-moving','#ffffff'),s)).toThrow(/变化/)
 })
 it('Strict blocks collisions; Less Strict keeps real diagnostics and requires explicit released confirmation',()=>{
  const f=fixture();f.h.current.pieces.push({...structuredClone(f.h.current.pieces.find(p=>p.id==='free-moving')!),id:'obstacle',pose:pose(0,-1)});f.raw.pieces.push(structuredClone(f.h.current.pieces.at(-1)!))
  const strict=state(f),candidate=strict.search.candidates.find(c=>c.request.fixed.tileId===f.fixedId&&c.request.moving.portId==='e2-p0')!
  expect(candidate.error).toMatch(/Strict/);strict.selectedKey=candidate.key;expect(()=>confirmMoveObjectSnap(f.h,strict)).toThrow(/不可确认/)
  const less=state(f,'less-strict'),p=less.search.candidates.find(c=>c.request.fixed.tileId===f.fixedId&&c.request.moving.portId==='e2-p0')!;expect(p.error).toBeUndefined();expect(p.preview!.geometry.valid).toBe(false);less.selectedKey=p.key
  expect(validateAssembly3D(confirmMoveObjectSnap(f.h,less).current).valid).toBe(false)
 })
 it('no nearby compatible ports uses exact raw / Grid pose without a Connection; protects Fixed, Parent and old connections',()=>{
  const f=fixture();f.raw.pieces.find(p=>p.id==='free-moving')!.pose=pose(5.5,2.5,1)
  expect(state(f).search.total).toBe(0);const next=confirmObjectMoveFallback(f.h,serializeAssembly3D(f.h.current),f.raw,f.moving);expect(next.current.connections).toEqual(f.h.current.connections)
  const tampered=structuredClone(f.raw);tampered.pieces[0].pose.position[0]+=1;expect(()=>confirmObjectMoveFallback(f.h,serializeAssembly3D(f.h.current),tampered,f.moving)).toThrow(/Fixed/)
  expect(()=>createMoveObjectSearch(f.h.current,{kind:'tile',tileId:f.h.current.modules![0].pieces[0].id})).toThrow(/Parent/)
  f.h.current.connections.push({pieceA:f.fixedId,portA:'e0-p0',pieceB:'free-moving',portB:'e2-p0',dihedralDeg:0,flip:true})
  f.raw.connections=structuredClone(f.h.current.connections);expect(()=>confirmObjectMoveFallback(f.h,serializeAssembly3D(f.h.current),f.raw,f.moving)).toThrow(/破坏已有连接/)
 })
 it('translation-only candidate search respects actual orientation, supports non-right dihedrals, refuses distant / large rotations',()=>{
  const f=fixture(),p=f.raw.pieces.find(p=>p.id==='free-moving')!
  p.pose.quaternion=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/6).toArray();p.pose.position=[.08,-Math.cos(Math.PI/6),-Math.sin(Math.PI/6)]
  const search=state(f);expect(search.search.candidates.some(c=>Math.abs(c.request.dihedralDeg-30)<1e-6&&!c.error)).toBe(true)
  p.pose.quaternion=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/4).toArray();p.pose.position=[.08,-1,0];expect(state(f).search.total).toBe(0)
  p.pose.position=[20,20,20];expect(state(f).search.total).toBe(0)
 })
 it('object correction respects locked world / local axes and does not silently leave the Move constraint',()=>{
  const f=fixture(),search=createMoveObjectSearch(f.h.current,f.moving),origin=new Vector3(3,0,0),orientation=new Quaternion()
  const locked=search(f.raw,'less-strict',{axes:'X',origin,orientation}),c=locked.candidates.find(c=>c.request.fixed.tileId===f.fixedId&&c.request.moving.portId==='e2-p0')!
  expect(c.preview).toBeDefined();expect(c.error).toMatch(/轴约束/)
  expect(search(f.raw,'strict',{axes:'XY',origin,orientation}).candidates.find(p=>p.key===c.key.replace('less-strict','strict'))!.error).toBeUndefined()
  expect(search(f.raw,'strict',{axes:'X',origin,orientation:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/4)}).candidates.every(c=>!!c.error)).toBe(true)
 })
 it('Less Strict still rejects occupied port directions and never offers a duplicate pair',()=>{
  const f=fixture(),third={...structuredClone(f.h.current.pieces.find(p=>p.id==='free-moving')!),id:'third',pose:pose(0,-1)}
  f.h.current.pieces.push(third);f.raw.pieces.push(structuredClone(third))
  f.h.current.connections.push({pieceA:f.fixedId,portA:'e0-p0',pieceB:'third',portB:'e2-p0',dihedralDeg:0,flip:true});f.raw.connections=structuredClone(f.h.current.connections)
  const s=state(f,'less-strict'),c=s.search.candidates.find(c=>c.request.fixed.tileId===f.fixedId&&c.request.moving.portId==='e2-p0')!
  expect(c.error).toMatch(/占位|冲突/);s.selectedKey=c.key;expect(()=>confirmMoveObjectSnap(f.h,s)).toThrow(/不可确认/)
  f.h.current.connections.push({pieceA:f.fixedId,portA:'e0-p0',pieceB:'free-moving',portB:'e2-p0',dihedralDeg:0,flip:true});f.raw.connections=structuredClone(f.h.current.connections)
  expect(state(f,'less-strict').search.candidates.some(c=>c.request.fixed.tileId===f.fixedId&&c.request.fixed.portId==='e0-p0'&&c.request.moving.portId==='e2-p0')).toBe(false)
 })
})

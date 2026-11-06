import {describe,it,expect} from 'vitest'
import {Quaternion,Vector3} from 'three'
import {profiles} from '../../src/magnetic-tiles/profiles.ts'
import {canonicalProfileSnapshot} from '../../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {fromEnginePose} from '../../src/magnetic-tiles/three-d/assembly.ts'
import type {Assembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {edgeSnapTransform} from '../../src/magnetic-tiles/three-d/editor-snap.ts'
import {previewConnectionRotation,confirmConnectionRotation} from '../../src/magnetic-tiles/three-d/connection-rotate.ts'
import {createViewerModel} from '../../src/magnetic-tiles/three-d/viewer-model.ts'
import {computeAllConnectionResiduals,portWorldEndpoints} from '../../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
import * as actions from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
const profile=canonicalProfileSnapshot(profiles.find(p=>p.id==='square')!)
function pair(flip=true,global=false):Assembly3D{
 const q=global?new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),1.1):new Quaternion()
 const a:Assembly3D={kind:'magnetic-assembly-3d',schemaVersion:1,id:'rotate-world-axis',revision:0,profiles:[profile],pieces:[{id:'A',profileId:'square',profileVersion:1,pose:{position:global?[3,-2,4]:[0,0,0],quaternion:q.toArray()}},{id:'B',profileId:'square',profileVersion:1,pose:{position:[5,5,5],quaternion:[0,0,0,1]}}],connections:[]}
 const c={pieceA:'A',pieceB:'B',portA:'e1-p0',portB:'e3-p0',dihedralDeg:45,flip};a.pieces[1].pose=fromEnginePose(edgeSnapTransform(a,c));a.connections.push(c);return a
}
function context(a:Assembly3D){const models=createViewerModel(a);return{transforms:Object.fromEntries(models.map(m=>[m.id,m.transform])),getShape:(id:string)=>models.find(m=>m.id===id)?.shape}}
describe('single Tile rotation about an existing Connection',()=>{
 it('preserves both Port endpoints and fixed poses for either endpoint, Flip, signed/fractional/full turns and arbitrary world frames',()=>{
  for(const global of [false,true])for(const flip of [false,true])for(const moving of ['A','B'])for(const angle of [-225,-45,-30,-20,0,20,30,45,30.125,390]){
   const a=pair(flip,global),raw=JSON.stringify(a),p=previewConnectionRotation(a,moving,0,angle,'less-strict'),fixed=moving==='A'?'B':'A',before=context(a),after=context(p.assembly),c=a.connections[0]
   expect(JSON.stringify(a)).toBe(raw);expect(p.assembly.pieces.find(p=>p.id===fixed)).toEqual(a.pieces.find(p=>p.id===fixed))
   expect({...p.assembly.connections[0],dihedralDeg:c.dihedralDeg}).toEqual(c)
   const residual=computeAllConnectionResiduals(p.assembly.connections,after.transforms,after.getShape)[0]
   expect(residual.positionError).toBeLessThan(1e-10);expect(residual.directionDot).toBeGreaterThan(1-1e-10);expect(residual.dihedralError).toBeLessThan(1e-8)
   const fixedPort=moving==='A'?c.portB:c.portA,axisBefore=portWorldEndpoints(fixed,fixedPort,before.transforms,before.getShape)!,axisAfter=portWorldEndpoints(fixed,fixedPort,after.transforms,after.getShape)!
   expect(axisAfter.p0.distanceTo(axisBefore.p0)).toBeLessThan(1e-12);expect(axisAfter.p1.distanceTo(axisBefore.p1)).toBeLessThan(1e-12)
   const expected=c.dihedralDeg+(moving==='B'||flip?angle:-angle),error=(p.assembly.connections[0].dihedralDeg-expected)*Math.PI/180
   expect(Math.abs(Math.atan2(Math.sin(error),Math.cos(error)))).toBeLessThan(1e-10)
  }
 })
 it('commits only a freshly rechecked preview as one Undo / Redo transaction',()=>{
  const a=pair(),h=actions.createInitialHistory(a),p=previewConnectionRotation(a,'B',0,20,'less-strict')
  expect(p.canConfirm).toBe(true);const forged=structuredClone(p);forged.assembly.pieces[0].pose.position=[999,999,999];forged.geometry={valid:true,issues:[]}
  const next=confirmConnectionRotation(h,forged,'less-strict');expect(next.current).toEqual({...p.assembly,revision:1});expect(next.past.length).toBe(1)
  expect(actions.undo(next).current).toEqual(a);expect(actions.redo(actions.undo(next)).current).toEqual(next.current)
  expect(()=>confirmConnectionRotation(h,p,'strict')).toThrow(/模式/)
  expect(()=>confirmConnectionRotation(actions.setPieceColorAction(h,'A','#123456'),p,'less-strict')).toThrow(/过期/)
 })
 it('keeps every other connection intact and blocks a rotation which would break a second attachment, even in Less Strict',()=>{
  const a=pair();a.pieces=[{...a.pieces[0],id:'left',pose:{position:[-1,0,0],quaternion:[0,0,0,1]}},{...a.pieces[0],id:'right',pose:{position:[1,0,0],quaternion:[0,0,0,1]}},{...a.pieces[0],id:'moving',pose:{position:[0,0,0],quaternion:[0,0,0,1]}}]
  a.connections=[{pieceA:'left',portA:'e1-p0',pieceB:'moving',portB:'e3-p0',dihedralDeg:0,flip:true},{pieceA:'right',portA:'e3-p0',pieceB:'moving',portB:'e1-p0',dihedralDeg:0,flip:true}]
  expect(validateAssembly3D(a).valid).toBe(true);const p=previewConnectionRotation(a,'moving',0,30,'less-strict')
  expect(p.canConfirm).toBe(false);expect(p.assembly.connections[1]).toEqual(a.connections[1]);expect(p.geometry.issues.some(i=>i.code==='loop-position-error')).toBe(true)
  expect(p.assembly.pieces.slice(0,2)).toEqual(a.pieces.slice(0,2));expect(()=>confirmConnectionRotation(actions.createInitialHistory(a),p,'less-strict')).toThrow(/位置误差/)
 })
 it('blocks another joint whose endpoints remain coincident but whose dihedral would change',()=>{
  const a=pair();a.pieces.push({...structuredClone(a.pieces[0]),id:'C',pose:{position:[1,0,0],quaternion:[0,0,0,1]}})
  a.connections.push({pieceA:'C',portA:'e3-p0',pieceB:'B',portB:'e3-p0',dihedralDeg:-45,flip:false})
  expect(validateAssembly3D(a).valid).toBe(true)
  const p=previewConnectionRotation(a,'B',0,20,'less-strict'),ctx=context(p.assembly),rs=computeAllConnectionResiduals(p.assembly.connections,ctx.transforms,ctx.getShape)
  expect(rs.every(r=>r.positionError<1e-10)).toBe(true);expect(p.assembly.connections[1]).toEqual(a.connections[1]);expect(p.canConfirm).toBe(false)
  expect(p.geometry.issues.some(i=>i.code==='loop-dihedral-error')).toBe(true)
 })
 it('rejects invalid requests and an initially broken hinge instead of snapping or silently repairing it',()=>{
  const a=pair();expect(()=>previewConnectionRotation(a,'B',-1,30)).toThrow(/Connection/);expect(()=>previewConnectionRotation(a,'missing',0,30)).toThrow(/Connection/);expect(()=>previewConnectionRotation(a,'B',0,NaN)).toThrow(/有限/)
  a.pieces[1].pose.position[0]+=.02;expect(()=>previewConnectionRotation(a,'B',0,30,'less-strict')).toThrow(/未精确对齐/)
 })
})

import {describe,it,expect} from 'vitest'
import {profiles} from '../../src/magnetic-tiles/profiles.ts'
import {canonicalProfileSnapshot} from '../../src/magnetic-tiles/three-d/canonical-geometry.ts'
import {previewEdgeSnap,confirmEdgeSnap} from '../../src/magnetic-tiles/three-d/editor-snap.ts'
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {serializeAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import * as actions from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import type {Connection} from '../../src/magnetic-tiles/three-d/vendor/engine/types.ts'

function pair(){
 const square=canonicalProfileSnapshot(profiles.find(p=>p.id==='square')!)
 const a=actions.addPieceAction(actions.createInitialHistory(),square,'#123456'),b=actions.addPieceAction(a.history,square,'#abcdef',[5,5,5])
 return{h:b.history,square,c:{pieceA:a.pieceId,pieceB:b.pieceId,portA:'e0-p0',portB:'e0-p0',dihedralDeg:0,flip:false}}
}
describe('Tile Snap collision policy, independent of Validator / saved geometry',()=>{
 it('defaults to Strict; Less Strict previews and atomically commits collisions with the full unchanged report',()=>{
  const {h,c}=pair(),raw=serializeAssembly3D(h.current)
  expect(()=>previewEdgeSnap(h.current,c)).toThrow(/严格验证拒绝/)
  const p=previewEdgeSnap(h.current,c,'less-strict')
  expect(p.mode).toBe('less-strict');expect(p.geometry.valid).toBe(false)
  expect(p.geometry.issues.some(i=>i.code==='intersection'&&i.severity==='error')).toBe(true)
  expect(p.geometry).toEqual(validateAssembly3D(p.assembly));expect(serializeAssembly3D(h.current)).toBe(raw)
  expect(()=>confirmEdgeSnap(h,p)).toThrow(/模式已变化/)
  const next=confirmEdgeSnap(h,p,'less-strict')
  expect(next.current.connections).toEqual([c]);expect(next.current.pieces[0]).toEqual(h.current.pieces[0])
  expect(next.current.revision).toBe(h.current.revision+1);expect(next.past.length).toBe(h.past.length+1)
  expect(validateAssembly3D(next.current)).toEqual(p.geometry)
  expect(actions.undo(next).current).toEqual(h.current);expect(actions.redo(actions.undo(next)).current).toEqual(next.current)
 })
 it('still rejects missing / mismatched Ports, invalid angles / Flip, duplicate connections and spatial direction conflicts',()=>{
  const {h,c,square}=pair(),raw=serializeAssembly3D(h.current)
  expect(()=>previewEdgeSnap(h.current,{...c,portA:'missing'},'less-strict')).toThrow(/Port/)
  expect(()=>previewEdgeSnap(h.current,{...c,dihedralDeg:NaN},'less-strict')).toThrow(/无法/)
  expect(()=>previewEdgeSnap(h.current,{...c,dihedralDeg:181},'less-strict')).toThrow(/无法/)
  expect(()=>previewEdgeSnap(h.current,{...c,flip:'true'} as unknown as Connection,'less-strict')).toThrow(/Invalid/)
  const triangle=actions.addPieceAction(h,canonicalProfileSnapshot(profiles.find(p=>p.id==='right-triangle')!),'#000000',[10,10,10])
  expect(()=>previewEdgeSnap(triangle.history.current,{...c,pieceB:triangle.pieceId,portB:'e1-p0'},'less-strict')).toThrow(/边长不兼容/)
  const good={...c,dihedralDeg:90},linked=confirmEdgeSnap(h,previewEdgeSnap(h.current,good))
  expect(()=>previewEdgeSnap(linked.current,good,'less-strict')).toThrow(/重复连接/)
  const third=actions.addPieceAction(linked,square,'#654321',[12,12,12])
  expect(()=>previewEdgeSnap(third.history.current,{...good,pieceB:third.pieceId},'less-strict')).toThrow(/相同空间方向占位/)
  expect(serializeAssembly3D(h.current)).toBe(raw)
 })
 it('does not authorize an existing non-collision constraint error or move a source with prior connections',()=>{
  const {h,c,square}=pair(),good={...c,dihedralDeg:90},linked=confirmEdgeSnap(h,previewEdgeSnap(h.current,good))
  expect(()=>previewEdgeSnap(linked.current,{...c,portB:'e1-p0',dihedralDeg:45},'less-strict')).toThrow(/仍有连接/)
  const p=linked.current.pieces[1],bad=actions.setPieceTransformAction(linked,p.id,{...p.pose,position:[p.pose.position[0]+.02,p.pose.position[1],p.pose.position[2]]})
  const third=actions.addPieceAction(bad,square,'#333333',[10,10,10]),raw=serializeAssembly3D(third.history.current)
  expect(()=>previewEdgeSnap(third.history.current,{...good,portA:'e1-p0',pieceB:third.pieceId},'less-strict')).toThrow(/位置误差/)
  expect(serializeAssembly3D(third.history.current)).toBe(raw)
 })
 it('rechecks policy and source on confirmation, and never trusts a forged preview pose or Geometry Valid',()=>{
  const {h,c}=pair(),p=previewEdgeSnap(h.current,c,'less-strict')
  expect(()=>confirmEdgeSnap(h,p,'strict')).toThrow(/模式已变化/)
  expect(()=>confirmEdgeSnap(actions.setPieceColorAction(h,c.pieceA,'#654321'),p,'less-strict')).toThrow(/过期/)
  const forged=structuredClone(p);forged.geometry.valid=true;forged.geometry.issues=[];forged.assembly.pieces[0].pose.position=[999,999,999]
  const next=confirmEdgeSnap(h,forged,'less-strict')
  expect(next.current).toEqual({...p.assembly,revision:h.current.revision+1});expect(validateAssembly3D(next.current).valid).toBe(false)
 })
})

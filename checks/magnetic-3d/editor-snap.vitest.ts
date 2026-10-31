import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {previewEdgeSnap,confirmEdgeSnap,disconnectPieceForSnap} from '../../src/magnetic-tiles/three-d/editor-snap.ts';
import * as actions from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts';
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts';
import {executeVisible3D} from '../../src/magnetic-tiles/three-d/reconstruction/execute.ts';
import {serializeAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts';
import {profiles} from '../../src/magnetic-tiles/profiles.ts';
import type {VisibleInput3D,SpatialHypothesis3D} from '../../src/magnetic-tiles/three-d/reconstruction/contracts.ts';
function pair(){
 const snapshot={profile:profiles[0],thickness:.06};
 const a=actions.addPieceAction(actions.createInitialHistory(),snapshot,'#123456'),b=actions.addPieceAction(a.history,snapshot,'#b895cf',[2,0,0]);
 return {h:b.history,c:{pieceA:a.pieceId,pieceB:b.pieceId,portA:'e0-p0',portB:'e0-p0',dihedralDeg:90,flip:false}};
}
describe('shared 3D drag/click snap preview and atomic confirmation',()=>{
 it('previews without changing the Draft, confirms one exact pose/connection transaction, and undoes it',()=>{
  const {h,c}=pair(),before=serializeAssembly3D(h.current),preview=previewEdgeSnap(h.current,c);
  expect(serializeAssembly3D(h.current)).toBe(before);expect(preview.geometry.valid).toBe(true);
  const next=confirmEdgeSnap(h,preview);expect(next.current.connections).toEqual([c]);expect(next.past.length).toBe(h.past.length+1);expect(next.current.revision).toBe(h.current.revision+1);
  expect(next.current.pieces[0]).toEqual(h.current.pieces[0]);expect(next.current.pieces[1].pose).toEqual(preview.assembly.pieces[1].pose);
  expect(actions.undo(next).current).toEqual(h.current);expect(actions.redo(actions.undo(next)).current).toEqual(next.current);
 });
 it('rejects incompatible/occupied ports, new overlap and stale previews without half updates',()=>{
  const {h,c}=pair(),raw=serializeAssembly3D(h.current),preview=previewEdgeSnap(h.current,c);
  expect(()=>previewEdgeSnap(h.current,{...c,portA:'invented'})).toThrow(/Port/);
  expect(()=>previewEdgeSnap(h.current,{...c,dihedralDeg:720})).toThrow(/无法/);
  expect(()=>previewEdgeSnap(h.current,{...c,dihedralDeg:0})).toThrow(/严格验证拒绝/);
  expect(serializeAssembly3D(h.current)).toBe(raw);
  const next=confirmEdgeSnap(h,preview);expect(()=>previewEdgeSnap(next.current,c)).toThrow(/占用/);
  expect(()=>confirmEdgeSnap(actions.setPieceColorAction(h,c.pieceA,'#654321'),preview)).toThrow(/过期/);
 });
 it('keeps an unrelated piece and rejects collisions with it',()=>{
  const {h,c}=pair(),p=previewEdgeSnap(h.current,c),source=p.assembly.pieces[1];
  const withObstacle=actions.commit(h,a=>{a.pieces.push({...structuredClone(source),id:'obstacle'});return a});
  expect(()=>previewEdgeSnap(withObstacle.current,c)).toThrow(/严格验证拒绝/);
  const far=actions.commit(h,a=>{a.pieces.push({...structuredClone(source),id:'far',pose:{position:[20,20,20],quaternion:[0,0,0,1]}});return a});
  const next=confirmEdgeSnap(far,previewEdgeSnap(far.current,c));expect(next.current.pieces.find(p=>p.id==='far')).toEqual(far.current.pieces.find(p=>p.id==='far'));
 });
 it('does not treat unchanged SAT thickness depth as permission to increase existing parallel overlap',()=>{
  const {h,c}=pair(),target=previewEdgeSnap(h.current,c).assembly.pieces[1];
  const overlapping=actions.commit(h,a=>{
   a.pieces[1]=structuredClone(target);a.pieces[1].pose.position[0]+=.18;
   a.pieces.push({...structuredClone(target),id:'obstacle'});return a;
  });
  expect(validateAssembly3D(overlapping.current).valid).toBe(false);
  expect(()=>previewEdgeSnap(overlapping.current,c)).toThrow(/严格验证拒绝/);
 });
 it('allows explicit disconnect/reconnect of an Invalid orange closed graph without moving neighbours',()=>{
  const f=JSON.parse(readFileSync(new URL('./fixtures/orange-reviewed-geometry.json',import.meta.url),'utf8')) as {input:VisibleInput3D;plan:SpatialHypothesis3D};
  const full=executeVisible3D(f.plan,f.input).diagnosticCandidates![0].assembly,h=actions.createInitialHistory(full),connection=full.connections[0];
  const detached=actions.removeConnectionAction(h,0),before=structuredClone(detached.current),preview=previewEdgeSnap(detached.current,connection),restored=confirmEdgeSnap(detached,preview);
  expect(restored.current.connections).toHaveLength(7);expect(restored.current.pieces.filter(p=>p.id!==connection.pieceB)).toEqual(before.pieces.filter(p=>p.id!==connection.pieceB));
  expect(restored.current.pieces.find(p=>p.id===connection.pieceB)!.pose.position).toEqual(expect.arrayContaining(preview.assembly.pieces.find(p=>p.id===connection.pieceB)!.pose.position));
  expect(validateAssembly3D(restored.current).valid).toBe(false);
  const movedConnection={...connection,dihedralDeg:90};expect(()=>previewEdgeSnap(detached.current,movedConnection)).toThrow(/仍有连接/);
  const free=disconnectPieceForSnap(h,connection.pieceB);expect(free.current.pieces).toEqual(full.pieces);expect(free.current.connections.every(c=>c.pieceA!==connection.pieceB&&c.pieceB!==connection.pieceB)).toBe(true);expect(actions.undo(free).current).toEqual(full);
 });
});

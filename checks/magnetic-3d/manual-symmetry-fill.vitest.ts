import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {Euler,Quaternion,Vector3} from 'three'
import type {Assembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {createViewerModel,componentCount} from '../../src/magnetic-tiles/three-d/viewer-model.ts'
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {computeAllConnectionResiduals} from '../../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
import {previewSymmetryFill,referenceSymmetryPlane,proposeSymmetryPlane,reflectPoint,confirmSymmetryFill} from '../../src/magnetic-tiles/three-d/symmetry-fill.ts'
import {createInitialHistory,undo,redo} from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
const car=():Assembly3D=>JSON.parse(readFileSync(new URL('./fixtures/car-symmetry-eight.json',import.meta.url),'utf8'))
const blue='rear-side-left',reference='ramp-lower-left'
function preview(a=car(),ids=[blue],offset=.5){return previewSymmetryFill(a,{sourceIds:ids,plane:referenceSymmetryPlane(a,reference,'x',offset),planeMode:'reference'})}
describe('manual mirror in an incomplete, Human Accepted car: selected pieces only',()=>{
 it('reproduces the asymmetric scaffold and distinguishes reference-center from the actual midpoint',()=>{
  const a=car();expect(a.pieces).toHaveLength(8);expect(a.connections).toHaveLength(10)
  expect(()=>proposeSymmetryPlane(a,[blue])).toThrow(/框架/)
  const throughTile=preview(a,[blue],0),midpoint=preview(a)
  expect(throughTile.assembly.pieces.at(-1)!.pose.position[0]).toBeCloseTo(.5,12)
  expect(midpoint.assembly.pieces.at(-1)!.pose.position[0]).toBeCloseTo(1.5,12)
  expect(midpoint.request.plane).toEqual({normal:[1,0,0],offset:.5})
 })
 it('preserves all original poses, ten joints, Profile snapshots and the accepted collision exactly',()=>{
  const a=car(),raw=JSON.stringify(a),p=preview(a),added=p.assembly.pieces.at(-1)!
  expect(JSON.stringify(a)).toBe(raw);expect(p.assembly.pieces.slice(0,8)).toEqual(a.pieces);expect(p.assembly.connections).toEqual(a.connections)
  expect(p.assembly.profiles).toEqual(a.profiles);expect(p.addedConnections).toEqual([]);expect(p.scaffoldMap).toEqual({})
  expect(added.id).not.toBe(blue);expect(added.profileId).toBe('square');expect(added.profileVersion).toBe(1);expect(added.color).toBe(a.pieces.find(p=>p.id===blue)!.color)
  const original=validateAssembly3D(a).issues.filter(i=>i.code==='intersection');expect(original).toHaveLength(1)
  expect(p.geometry.issues).toEqual(expect.arrayContaining(original));expect(p.layers.solidCollision.valid).toBe(false)
  expect(p.layers.idealGeometry.valid).toBe(true);expect(p.canCommit).toBe(true);expect(componentCount(p.assembly)).toBe(2)
 })
 it('mirrors the real Canonical port endpoints with unchanged IDs and a proper unit rotation',()=>{
  const a=car(),p=preview(a),items=createViewerModel(p.assembly),old=items.find(x=>x.id===blue)!,added=items.find(x=>x.id===p.addedIds[0])!
  expect(Math.hypot(...added.piece.pose.quaternion)).toBeCloseTo(1,14)
  for(const port of old.shape.ports){const counterpart=added.shape.ports.find(p=>p.portId===port.portId)!
   for(const end of ['p0','p1'] as const){const point=new Vector3(port[end].x,port[end].y,0).applyQuaternion(old.transform.quaternion).add(old.transform.position),actual=new Vector3(counterpart[end].x,counterpart[end].y,0).applyQuaternion(added.transform.quaternion).add(added.transform.position);expect(actual.distanceTo(reflectPoint(point,p.request.plane))).toBeLessThan(1e-12)}
  }
  const normal=new Vector3(0,0,1).applyQuaternion(old.transform.quaternion),expected=normal.clone().addScaledVector(new Vector3(...p.request.plane.normal),-2*normal.dot(new Vector3(...p.request.plane.normal))).negate()
  expect(new Vector3(0,0,1).applyQuaternion(added.transform.quaternion).distanceTo(expected)).toBeLessThan(1e-12)
 })
 it('copies a selected patch and its internal joints only, without a symmetric scaffold or any new external attachment',()=>{
  const a=car(),ids=['rear-top-left','rear-top-right'],p=preview(a,ids,3)
  expect(p.addedIds).toHaveLength(2);expect(p.addedConnections).toHaveLength(1)
  expect(p.addedConnections.every(c=>p.addedIds.includes(c.pieceA)&&p.addedIds.includes(c.pieceB))).toBe(true)
  const items=createViewerModel(p.assembly),getShape=(id:string)=>items.find(p=>p.id===id)?.shape
  for(const r of computeAllConnectionResiduals(p.assembly.connections,Object.fromEntries(items.map(p=>[p.id,p.transform])),getShape)){expect(r.positionError).toBeLessThan(1e-12);expect(r.dihedralError).toBeLessThan(1e-9)}
  const full=preview(a,a.pieces.map(p=>p.id),4);expect(full.canCommit).toBe(true);expect(full.addedIds).toHaveLength(8);expect(full.addedConnections).toHaveLength(10)
 })
 it('still rejects exact duplicates, degenerate planes, invalid source poses and existing broken joints',()=>{
  const a=car();expect(()=>preview(a,['rear-top-left','rear-top-right'])).toThrow(/重复补全/)
  expect(()=>preview(preview(a).assembly)).toThrow(/重复补全/)
  expect(()=>previewSymmetryFill(a,{sourceIds:[blue],plane:{normal:[0,0,0],offset:0},planeMode:'reference'})).toThrow(/法向/)
  const invalid=car();invalid.pieces[0].pose.quaternion=[0,0,0,0];expect(()=>preview(invalid)).toThrow(/quaternion/)
  const broken=car();broken.connections[0].dihedralDeg=10;expect(()=>preview(broken)).toThrow(/原作品存在/)
 })
 it('is independent of names, world-up and root position, preserving internal angle and flip validation',()=>{
  const a=car(),original=preview(a,[blue,'rear-top-left','rear-top-right'],3),q=new Quaternion().setFromEuler(new Euler(.3,1.2,-.8)),t=new Vector3(8,-3,2)
  for(const p of a.pieces){p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(t).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()}
  const transformed=preview(a,[blue,'rear-top-left','rear-top-right'],3)
  for(let i=0;i<original.addedIds.length;i++){
   const expected=new Vector3(...original.assembly.pieces[8+i].pose.position).applyQuaternion(q).add(t)
   expect(new Vector3(...transformed.assembly.pieces[8+i].pose.position).distanceTo(expected)).toBeLessThan(1e-12)
  }
  expect(transformed.layers.idealGeometry.valid).toBe(true);expect(transformed.assembly.connections.slice(0,10)).toEqual(a.connections)
 })
 it('commits atomically, never trusts a modified preview and restores the exact original with Undo',()=>{
  const a=car(),p=preview(a),id=p.addedIds[0];p.assembly.pieces[0].pose.position[0]=200
  const next=confirmSymmetryFill(createInitialHistory(a),p)
  expect(next.current.pieces[0]).toEqual(a.pieces[0]);expect(next.current.pieces.at(-1)!.id).toBe(id)
  expect(undo(next).current).toEqual(a);expect(redo(undo(next)).current).toEqual(next.current)
 })
})

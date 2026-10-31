import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {Euler,Quaternion,Vector3} from 'three'
import {previewSymmetryFill,proposeSymmetryPlane,reflectPoint,reflectPose,referenceSymmetryPlane,confirmSymmetryFill} from '../../src/magnetic-tiles/three-d/symmetry-fill.ts'
import {createInitialHistory,undo,redo,setPieceColorAction} from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import {executeVisible3D} from '../../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {assemblyValidationLayers,validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import {createViewerModel,componentCount} from '../../src/magnetic-tiles/three-d/viewer-model.ts'
import {fromEnginePose} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {computeAllConnectionResiduals,computeTransformFromConnection} from '../../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
import type {Assembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
const fixture=JSON.parse(readFileSync(new URL('./fixtures/orange-reviewed-geometry.json',import.meta.url),'utf8'))
const orange=()=>executeVisible3D(fixture.plan,fixture.input).diagnosticCandidates![0].assembly
const sourceIds=['tile2','tile3','tile4']
function fill(a=orange(),ids=sourceIds){return previewSymmetryFill(a,{sourceIds:ids,plane:proposeSymmetryPlane(a,ids),confirmedPlane:true})}
function residuals(a:Assembly3D){const ps=createViewerModel(a);return computeAllConnectionResiduals(a.connections,Object.fromEntries(ps.map(p=>[p.id,p.transform])),id=>ps.find(p=>p.id===id)?.shape)}
describe('Symmetry Fill V1: explicit hypothesis, exact ports, no pose adjustment',()=>{
 it('previews 3 real mirrored triangles and 5 verified connections without changing the original 6/7',()=>{
  const a=orange(),before=JSON.stringify(a),p=fill(a)
  expect(JSON.stringify(a)).toBe(before);expect(p.assembly.pieces).toHaveLength(9);expect(p.assembly.connections).toHaveLength(12);expect(p.addedIds).toHaveLength(3);expect(p.canCommit).toBe(true);expect(p.scaffoldMap).toEqual({tile1:'tile1',tile5:'tile5',tile6:'tile6'})
  expect(p.assembly.pieces.slice(0,6)).toEqual(a.pieces);expect(p.assembly.connections.slice(0,7)).toEqual(a.connections);expect(p.assembly.profiles).toEqual(a.profiles)
  expect(componentCount(p.assembly)).toBe(1);expect(p.layers.idealGeometry.valid).toBe(true);expect(p.geometry.valid).toBe(false);expect(p.layers.solidCollision.issues).toHaveLength(8)
  for(const c of p.layers.solidCollision.issues)expect(c.penetrationDepth).toBeCloseTo(.015,10)
  for(const r of residuals(p.assembly)){expect(r.positionError).toBeLessThan(1e-12);expect(r.dihedralError).toBeLessThan(1e-10);expect(r.directionDot).toBeCloseTo(1,12)}
  expect(p.addedConnections.find(c=>c.pieceA==='tile1')?.portA).toBe('e2-p0');expect(p.addedConnections.find(c=>c.pieceA==='tile1')?.flip).toBe(false)
  for(const [i,id]of p.addedIds.entries()){const original=a.pieces.find(p=>p.id===sourceIds[i])!,added=p.assembly.pieces.find(p=>p.id===id)!;expect(added.profileId).toBe(original.profileId);expect(added.profileVersion).toBe(original.profileVersion);expect(added.color).toBe(original.color)}
 })
 it('requires explicit confirmation, rejects duplicate fill, invalid planes, nonexistent sources and unsupported counts',()=>{
  const a=orange(),plane=proposeSymmetryPlane(a,sourceIds)
  expect(()=>previewSymmetryFill(a,{sourceIds,plane,confirmedPlane:false})).toThrow(/确认/)
  expect(()=>previewSymmetryFill(a,{sourceIds,plane:{normal:[0,0,0],offset:0},confirmedPlane:true})).toThrow(/法向/)
  expect(()=>previewSymmetryFill(a,{sourceIds,plane:{normal:[1,0,0],offset:5},confirmedPlane:true})).toThrow(/框架/)
  expect(()=>previewSymmetryFill(fill(a).assembly,{sourceIds,plane,confirmedPlane:true})).toThrow(/重复/)
  expect(()=>fill(a,['missing'])).toThrow(/不存在/);expect(()=>fill(a,[])).toThrow(/V1/);expect(()=>fill(a,['tile2','tile2'])).toThrow(/不同来源/)
  expect(()=>proposeSymmetryPlane(a,['tile1','tile2'])).toThrow(/同一平面/)
 })
 it('is deterministic under selection order and commits one undoable revision; modified previews cannot inject geometry',()=>{
  const a=orange(),h=createInitialHistory(a),p=fill(a),permuted=fill(a,[...sourceIds].reverse());expect(p.assembly).toEqual(permuted.assembly)
  p.assembly.pieces[0].pose.position[0]=100;p.addedConnections=[]
  const next=confirmSymmetryFill(h,p);expect(next.current.pieces[0]).toEqual(a.pieces[0]);expect(next.current.connections).toHaveLength(12);expect(next.current.revision).toBe(a.revision+1);expect(next.past).toHaveLength(1)
  expect(undo(next).current).toEqual(a);expect(redo(undo(next)).current).toEqual(next.current)
  expect(()=>confirmSymmetryFill(setPieceColorAction(h,'tile1','#123456'),fill(a))).toThrow(/过期/)
 })
 it('uses actual geometry under arbitrary rigid roots, renamed instances and reordered pieces',()=>{
  for(const q of [new Quaternion().setFromEuler(new Euler(.7,-1.1,.3)),new Quaternion().setFromEuler(new Euler(-2,.4,1.2))]){
   const a=orange(),t=new Vector3(8,-4,2),names=new Map(a.pieces.map((p,i)=>[p.id,'part-'+(20-i)]))
   for(const p of a.pieces){p.pose={position:new Vector3(...p.pose.position).applyQuaternion(q).add(t).toArray(),quaternion:q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()};p.id=names.get(p.id)!}
   a.pieces.reverse();for(const c of a.connections){c.pieceA=names.get(c.pieceA)!;c.pieceB=names.get(c.pieceB)!}
   const p=fill(a,sourceIds.map(id=>names.get(id)!));expect(p.canCommit).toBe(true);expect(p.layers.idealGeometry.valid).toBe(true);expect(p.assembly.pieces.slice(0,6)).toEqual(a.pieces)
   for(const r of residuals(p.assembly)){expect(r.positionError).toBeLessThan(1e-11);expect(r.dihedralError).toBeLessThan(1e-9)}
  }
 })
 it('retains scaled/versioned profiles and different thicknesses; no family-name dimension matching',()=>{
  for(const scale of [.5,2.3])for(const thickness of [.02,.06,.1]){
   const a=orange();for(const s of a.profiles){s.scale=scale;s.thickness=thickness;s.profile.id+='-custom';s.profile.version=7}
   for(const p of a.pieces){p.profileId+='-custom';p.profileVersion=7;p.pose.position=p.pose.position.map(v=>v*scale) as [number,number,number]}
   const p=fill(a);expect(p.canCommit).toBe(true);expect(p.layers.idealGeometry.valid).toBe(true);expect(p.assembly.profiles).toEqual(a.profiles)
  }
 })
 it('mirrors all actual prism points with a proper unit quaternion, without requiring a symmetric local polygon',()=>{
  const pose={position:[2,-3,4] as [number,number,number],quaternion:new Quaternion().setFromEuler(new Euler(.4,-.2,1)).toArray()},plane={normal:[2,-3,1] as [number,number,number],offset:1.7},p=reflectPose(pose,plane)
  expect(Math.hypot(...p.quaternion)).toBeCloseTo(1,14)
  for(const v of [new Vector3(-.5,-.2,.08),new Vector3(.9,.1,-.08),new Vector3(-.1,.7,.08)]){
   const expected=reflectPoint(v.clone().applyQuaternion(new Quaternion(...pose.quaternion)).add(new Vector3(...pose.position)),plane)
   const actual=v.clone().setZ(-v.z).applyQuaternion(new Quaternion(...p.quaternion)).add(new Vector3(...p.position));expect(actual.distanceTo(expected)).toBeLessThan(1e-13)
  }
 })
 it('rejects missing mirrored ports and original structural errors; never invents or expands ports',()=>{
  const a=orange(),plane=proposeSymmetryPlane(a,sourceIds),square=a.profiles.find(s=>s.profile.id==='square')!
  square.ports=[{edgeId:'e2',ranges:[[0,.5]]}]
  expect(()=>previewSymmetryFill(a,{sourceIds,plane,confirmedPlane:true})).toThrow(/Port 无法唯一映射/)
  const bad=orange();bad.connections[0].dihedralDeg=20;expect(()=>fill(bad)).toThrow(/原作品存在/)
 })
 it('can use an explicitly chosen reference plane; no automatic bottom or disconnected copy is added',()=>{
  const a=orange(),plane=referenceSymmetryPlane(a,'tile1','y'),p=previewSymmetryFill(a,{sourceIds,plane,confirmedPlane:true})
  expect(p.canCommit).toBe(true);expect(p.addedIds).toHaveLength(sourceIds.length);expect(p.addedIds.every(id=>p.assembly.pieces.find(x=>x.id===id)?.profileId==='equilateral-triangle')).toBe(true)
  const disconnected=orange();disconnected.connections=[];expect(()=>previewSymmetryFill(disconnected,{sourceIds,plane,confirmedPlane:true})).toThrow(/连通/)
 })
 it('discovers additional exact port correspondences through the same solver checks, without altering the old graph',()=>{
  const a=orange();a.connections.shift();const p=fill(a);expect(p.canCommit).toBe(true);expect(p.addedConnections).toHaveLength(5);expect(p.assembly.connections.slice(0,6)).toEqual(a.connections)
  expect(assemblyValidationLayers(validateAssembly3D(p.assembly)).idealGeometry.valid).toBe(true)
 })
 it('fills the missing wall of a different Geometry Valid five-square box with four real edge connections',()=>{
  const cube=JSON.parse(readFileSync(new URL('../../src/magnetic-tiles/three-d/examples/closed-cube.json',import.meta.url),'utf8')) as Assembly3D
  const a=structuredClone(cube);a.pieces=a.pieces.filter(p=>p.id!=='back');a.connections=a.connections.filter(c=>c.pieceA!=='back'&&c.pieceB!=='back')
  const before=structuredClone(a),p=fill(a,['front']);expect(p.canCommit).toBe(true);expect(p.geometry.valid).toBe(true);expect(p.addedIds).toHaveLength(1);expect(p.addedConnections).toHaveLength(4);expect(p.assembly.connections).toHaveLength(12);expect(p.assembly.pieces.slice(0,5)).toEqual(before.pieces)
 })
 it('does not suggest a plane for a connected but asymmetric scaffold',()=>{
  const a=orange(),top=createViewerModel(a)[0],tf=computeTransformFromConnection(top.transform,top.shape,'e2-p0',top.shape,'e0-p0',90,true)!
  a.pieces.push({...structuredClone(top.piece),id:'appendage',pose:fromEnginePose(tf)});a.connections.push({pieceA:top.id,portA:'e2-p0',pieceB:'appendage',portB:'e0-p0',dihedralDeg:90,flip:true})
  expect(assemblyValidationLayers(validateAssembly3D(a)).idealGeometry.valid).toBe(true);expect(()=>proposeSymmetryPlane(a,sourceIds)).toThrow(/框架/)
 })

})

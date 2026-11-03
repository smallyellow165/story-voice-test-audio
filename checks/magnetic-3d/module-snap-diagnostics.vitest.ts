import {describe,it,expect} from 'vitest'
import {Vector3} from 'three'
import {parseAssembly3D,serializeAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import {combineAssemblySnapshots,previewModuleSnap} from '../../src/magnetic-tiles/three-d/module-transform.ts'
import {moduleSnapDiagnostics} from '../../src/magnetic-tiles/three-d/module-snap-diagnostics.ts'
import pair from '../../src/magnetic-tiles/three-d/examples/right-angle.json' with {type:'json'}
const parent=(id:string)=>({id,version:1,hash:'a'.repeat(64),snapshotHash:'b'.repeat(64),revision:0})
function fixture(){
 const one=parseAssembly3D(JSON.stringify(pair));one.pieces=one.pieces.slice(0,1);one.connections=[];one.pieces[0].pose={position:[0,0,0],quaternion:[0,0,0,1]}
 const a=combineAssemblySnapshots('snap-diagnostics',[{name:'A',parent:parent('a'),assembly:one},{name:'B',parent:parent('b'),assembly:one}])
 const c={pieceA:a.pieces[0].id,pieceB:a.pieces[1].id,portA:'e1-p0',portB:'e3-p0',dihedralDeg:0,flip:true}
 return {a,c,target:{groupId:'module-1',pieceId:c.pieceB,direction:'front' as const}}
}
describe('read-only Snap diagnostics; no new solver or candidates',()=>{
 it('separates exact port constraints, explicit face direction, bottom gap and strict Geometry Valid',()=>{
  const {a,c,target}=fixture(),raw=serializeAssembly3D(a),p=previewModuleSnap(a,'module-1','module-0',c),d=moduleSnapDiagnostics(a,p,'module-1','module-0',target)
  expect(d.geometryValid).toBe(true);expect(d.residual.positionError).toBeLessThan(1e-12);expect(d.residual.directionDot).toBeCloseTo(1,12);expect(d.residual.dihedralError).toBeLessThan(1e-12)
  expect(d.orientation?.angleDeg).toBeCloseTo(0,12);expect(d.bottomGap).toBeCloseTo(0,12);expect(d.connectionErrors).toEqual([]);expect(d.collisions.newCross).toBe(0)
  expect(moduleSnapDiagnostics(a,p,'module-1','module-0',target)).toEqual(d);expect(serializeAssembly3D(a)).toBe(raw)
 })
 it('derives a signed angle from the actual port axis without sampling, or rejects an unreachable axial direction',()=>{
  const {a,c,target}=fixture(),p=previewModuleSnap(a,'module-1','module-0',{...c,dihedralDeg:47}),d=moduleSnapDiagnostics(a,p,'module-1','module-0',target)
  expect(d.orientation!.angleDeg).toBeCloseTo(47,10);expect(d.orientation!.requiredDihedralDeg).toBeCloseTo(0,10)
  const q=previewModuleSnap(a,'module-1','module-0',{...c,dihedralDeg:d.orientation!.requiredDihedralDeg!})
  expect(moduleSnapDiagnostics(a,q,'module-1','module-0',target).orientation!.angleDeg).toBeCloseTo(0,10)
  // Fixed e1 tangent lies along Y: rotation about it cannot turn +Z into +Y.
  expect(moduleSnapDiagnostics(a,p,'module-1','module-0',{...target,direction:'up'}).orientation!.requiredDihedralDeg).toBeNull()
  expect(new Vector3(...d.orientation!.normal).length()).toBeCloseTo(1,12)
 })
 it('never guesses a goal from Snap Moving Tile, a saved pose, a different Group or a missing face',()=>{
  const {a,c,target}=fixture(),p=previewModuleSnap(a,'module-1','module-0',c)
  for(const t of [undefined,{...target,groupId:'module-0'},{...target,pieceId:'removed-face'}])expect(moduleSnapDiagnostics(a,p,'module-1','module-0',t).orientation).toBeUndefined()
 })
 it('tracks prior pairs separately from new/changed cross-group diagnostics without inheriting approval',()=>{
  const {a,c}=fixture(),p=previewModuleSnap(a,'module-1','module-0',c),issue={modelId:a.id,message:'existing strict intersection',severity:'error' as const,code:'intersection' as const,relatedPieceIds:[c.pieceA,c.pieceB] as [string,string],penetrationDepth:.1}
  // Report classification only: use supplied Validator reports, never a new
  // collision detector. Same pair with changed severity is explicitly retained.
  const before={valid:false,issues:[issue]},after={...p,geometry:{...p.geometry,valid:false,issues:[{...issue,penetrationDepth:.2}]}}
  const d=moduleSnapDiagnostics(a,after,'module-1','module-0',undefined,before)
  expect(d.collisions).toMatchObject({before:1,retained:1,newCross:0,changedCross:1});expect(d.geometryValid).toBe(false)
  const added=moduleSnapDiagnostics(a,after,'module-1','module-0',undefined,{valid:true,issues:[]})
  expect(added.collisions).toMatchObject({before:0,retained:0,newCross:1,newCrossMaxDepth:.2})
 })
})

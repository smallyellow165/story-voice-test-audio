import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {executeVisible3D} from '../../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {diagnosticHandoffCheck} from '../../src/magnetic-tiles/three-d/reconstruction/diagnostic-handoff.ts'
import {adoptReconstructionDraft,loadPhotoOrigin} from '../../src/magnetic-tiles/three-d/reconstruction/adopt-draft.ts'
import {saveDraft3D,loadDraft3D} from '../../src/magnetic-tiles/three-d/draft-storage.ts'
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import type {VisibleInput3D,SpatialHypothesis3D} from '../../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
function setup(){
 const f=JSON.parse(readFileSync(new URL('./fixtures/orange-reviewed-geometry.json',import.meta.url),'utf8')) as {input:VisibleInput3D;plan:SpatialHypothesis3D}
 const x=executeVisible3D(f.plan,f.input),diagnostic=x.diagnosticCandidates![0],a=structuredClone(diagnostic.assembly);a.id='diagnostic-draft'
 const origin={id:'test-origin',assembly:a,entryMode:'diagnostic-draft',diagnostic:{geometry:diagnostic.geometry}},values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}
 return {diagnostic,a,origin,storage,values}
}
describe('direct Diagnostic draft handoff',()=>{
 it('opens collision and connection-error Diagnostics without changing strict reports',()=>{
  const {diagnostic}=setup(),before=JSON.stringify(diagnostic)
  expect(diagnosticHandoffCheck(diagnostic).allowed).toBe(true);expect(JSON.stringify(diagnostic)).toBe(before)
  const wrong=structuredClone(diagnostic);wrong.assembly.connections[0].dihedralDeg=45
  const checked=diagnosticHandoffCheck(wrong)
  expect(checked.allowed).toBe(true);expect(checked.geometry.valid).toBe(false);expect(checked.validation.idealGeometry.valid).toBe(false)
 })
 it('saves/restores Invalid drafts and provenance without revalidation receipts',()=>{
  const {a,origin,storage}=setup(),geometry=validateAssembly3D(a)
  expect(geometry.valid).toBe(false)
  const adopted=adoptReconstructionDraft(storage,a,origin,null)
  expect(loadDraft3D(storage).assembly).toEqual(a);expect(loadPhotoOrigin(storage)?.origin).toEqual(origin)
  expect(loadPhotoOrigin(storage)?.geometryReview).toBeUndefined()
  expect(validateAssembly3D(loadDraft3D(storage).assembly!)).toEqual(geometry)
  const moved=structuredClone(a);moved.revision++;moved.pieces.forEach(p=>p.pose.position[0]+=2)
  saveDraft3D(storage,moved,adopted.raw);expect(loadDraft3D(storage).assembly).toEqual(moved)
 })
 it('preserves CAS and exact origin/geometry checks',()=>{
  const {a,origin,storage}=setup();adoptReconstructionDraft(storage,a,origin,null)
  expect(()=>adoptReconstructionDraft(storage,a,origin,null)).toThrow(/其他页面/)
  const wrong=structuredClone(a);wrong.pieces[0].pose.position[0]+=1
  expect(()=>adoptReconstructionDraft(storage,wrong,origin,storage.getItem('magnetic-tiles.assembly3d-draft.v1'))).toThrow(/不一致/)
 })
})

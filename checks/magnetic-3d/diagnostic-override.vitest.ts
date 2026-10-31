import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {executeVisible3D} from '../../src/magnetic-tiles/three-d/reconstruction/execute.ts';
import {diagnosticHandoffCheck} from '../../src/magnetic-tiles/three-d/reconstruction/diagnostic-handoff.ts';
import {adoptReconstructionDraft,loadPhotoOrigin,PHOTO_ORIGIN_3D_KEY,photoDraftGeometryGate,revalidatePhotoDraft,assertPhotoDraftReady} from '../../src/magnetic-tiles/three-d/reconstruction/adopt-draft.ts';
import {DRAFT_3D_KEY,saveDraft3D,loadDraft3D} from '../../src/magnetic-tiles/three-d/draft-storage.ts';
import {validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts';
import {contentHash} from '../../src/magnetic-tiles/build-plan.ts';
import type {VisibleInput3D,SpatialHypothesis3D} from '../../src/magnetic-tiles/three-d/reconstruction/contracts.ts';
function setup(){
 const f=JSON.parse(readFileSync(new URL('./fixtures/orange-reviewed-geometry.json',import.meta.url),'utf8')) as {input:VisibleInput3D;plan:SpatialHypothesis3D};
 const x=executeVisible3D(f.plan,f.input),diagnostic=x.diagnosticCandidates![0],a=structuredClone(diagnostic.assembly);a.id='repair-draft';
 const origin={id:'test-origin',assembly:a,entryMode:'diagnostic-override',diagnostic:{geometry:diagnostic.geometry}},values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}};
 const adopted=adoptReconstructionDraft(storage,a,origin,null);
 const repaired={...structuredClone(x.candidates[0].assembly),id:a.id,revision:1};
 return {x,diagnostic,a,origin,values,storage,adopted,repaired};
}
describe('Diagnostic entry authorization is distinct from Geometry Valid',()=>{
 it('allows only strict ideal-valid/collision-invalid diagnostics, without changing reports',()=>{
  const {diagnostic,x}=setup(),before=JSON.stringify(diagnostic);
  expect(diagnosticHandoffCheck(diagnostic).allowed).toBe(true);expect(JSON.stringify(diagnostic)).toBe(before);
  expect(diagnosticHandoffCheck(x.candidates[0]).allowed).toBe(false);
  const wrong=structuredClone(diagnostic);wrong.assembly.connections[0].dihedralDeg=45;
  expect(diagnosticHandoffCheck(wrong).validation.idealGeometry.valid).toBe(false);expect(diagnosticHandoffCheck(wrong).allowed).toBe(false);
 });
 it('saves and restores invalid repair drafts but the downstream data gate strictly rejects them',async()=>{
  const {a,storage,adopted,origin}=setup();expect(validateAssembly3D(a).valid).toBe(false);
  expect(loadDraft3D(storage).assembly).toEqual(a);expect(loadPhotoOrigin(storage)?.origin).toEqual(origin);
  expect(()=>assertPhotoDraftReady(storage,a)).toThrow(/Geometry Invalid/);
  const sidecar=await revalidatePhotoDraft(storage,a,adopted.raw);
  expect(sidecar.geometryReview?.geometry.valid).toBe(false);expect(storage.getItem(DRAFT_3D_KEY)).toBe(adopted.raw);
  expect(photoDraftGeometryGate(a,loadPhotoOrigin(storage)).current).toBe(true);expect(()=>assertPhotoDraftReady(storage,a)).toThrow(/Geometry Invalid/);
 });
 it('requires an exact current Revision/Hash receipt after repair, including same-revision pose changes',async()=>{
  const {a,storage,adopted,repaired}=setup();
  expect(validateAssembly3D(repaired).valid).toBe(true);const raw=saveDraft3D(storage,repaired,adopted.raw);
  expect(()=>assertPhotoDraftReady(storage,repaired)).toThrow(/验证已过期|尚未复验/);
  const checked=await revalidatePhotoDraft(storage,repaired,raw);
  expect(checked.geometryReview?.assemblyHash).toBe(await contentHash(repaired));expect(assertPhotoDraftReady(storage,repaired).ready).toBe(true);
  expect(checked.origin.diagnostic).toEqual(loadPhotoOrigin(storage)?.origin.diagnostic);expect(JSON.parse(checked.assemblyRaw)).toEqual(a);
  const moved=structuredClone(repaired);moved.pieces.forEach(p=>p.pose.position[0]+=2);
  expect(validateAssembly3D(moved).valid).toBe(true);expect(()=>assertPhotoDraftReady(storage,moved)).toThrow(/验证已过期/);
  expect(()=>assertPhotoDraftReady(storage,{...repaired,revision:2})).toThrow(/验证已过期/);
  const restored=loadDraft3D(storage).assembly!;expect(assertPhotoDraftReady(storage,restored).ready).toBe(true);
 });
 it('a forged valid flag never substitutes for fresh strict validation; CAS prevents stale receipt writes',async()=>{
  const {a,storage,adopted,values,repaired}=setup();
  const sidecar=loadPhotoOrigin(storage)!;sidecar.geometryReview={assemblyId:a.id,revision:a.revision,assemblyHash:'invented',assemblyRaw:adopted.raw,geometry:{valid:true,issues:[]}};storage.setItem(PHOTO_ORIGIN_3D_KEY,JSON.stringify(sidecar));
  expect(()=>assertPhotoDraftReady(storage,a)).toThrow(/Geometry Invalid/);
  const pending=revalidatePhotoDraft(storage,repaired,adopted.raw);values.set(DRAFT_3D_KEY,'another-tab');
  await expect(pending).rejects.toThrow(/其他页面/);expect(storage.getItem(DRAFT_3D_KEY)).toBe('another-tab');expect(loadPhotoOrigin(storage)?.geometryReview?.assemblyHash).toBe('invented');
 });
});

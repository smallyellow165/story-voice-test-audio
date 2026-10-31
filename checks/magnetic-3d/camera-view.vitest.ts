import {describe,it,expect} from 'vitest'
import {OrthographicCamera,Vector3} from 'three'
import {assertCameraView,captureCameraView,restoreCameraView,resizeSavedCamera} from '../../src/magnetic-tiles/three-d/camera-view.ts'
import {candidateCameraKey,loadCandidateCamera,saveCandidateCamera} from '../../src/magnetic-tiles/three-d/reconstruction/camera-view-storage.ts'
import {adoptReconstructionDraft,loadPhotoOrigin,PHOTO_ORIGIN_3D_KEY} from '../../src/magnetic-tiles/three-d/reconstruction/adopt-draft.ts'
import {DRAFT_3D_KEY} from '../../src/magnetic-tiles/three-d/draft-storage.ts'
import {parseAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import pair from '../../src/magnetic-tiles/three-d/examples/right-angle.json' with {type:'json'}
function setup(){const camera=new OrthographicCamera(-250,250,200,-200,.003,250);camera.position.set(5,4,3);camera.up.set(0,0,1);const controls={target:new Vector3(.3,-.2,.5),update:()=>{camera.lookAt(controls.target);camera.updateMatrixWorld(true)}};controls.update();camera.zoom=137;camera.updateProjectionMatrix();return {camera,controls}}
const ref={executionId:'execution-a',executionHash:'hash-a',candidateId:'candidate-1'}
function storage(){const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}}
describe('Candidate camera metadata',()=>{
 it('captures and restores complete orthographic state including non-Y up, quaternion, target, clipping and zoom',()=>{
  const {camera,controls}=setup(),saved=captureCameraView(camera,controls),target=setup();assertCameraView(saved)
  target.camera.position.set(-8,3,-4);target.camera.zoom=22;restoreCameraView(target.camera,target.controls,saved,{width:500,height:400})
  const restored=captureCameraView(target.camera,target.controls);expect(restored).toEqual(saved)
 })
 it('preserves vertical projected extent/rotation across editor aspect ratios and later resize, without refitting geometry',()=>{
  const {camera,controls}=setup(),saved=captureCameraView(camera,controls),probe=new Vector3(.2,.7,.4),before=probe.clone().project(camera),target=setup()
  restoreCameraView(target.camera,target.controls,saved,{width:1000,height:600});const after=probe.clone().project(target.camera)
  expect(after.y).toBeCloseTo(before.y,12);expect((target.camera.right-target.camera.left)/(target.camera.top-target.camera.bottom)).toBeCloseTo(1000/600,12)
  target.camera.zoom=155;resizeSavedCamera(target.camera,{width:640,height:800});expect(target.camera.zoom).toBe(155);expect(target.camera.position.toArray()).toEqual(saved.position);expect(target.controls.target.toArray()).toEqual(saved.target)
 })
 it('accepts pole-adjacent orbit views without inventing a new up axis',()=>{const {camera,controls}=setup();camera.position.copy(controls.target).add(new Vector3(0,0,5));camera.up.set(0,0,1);controls.update();expect(()=>assertCameraView(captureCameraView(camera,controls))).not.toThrow()})
 it('only explicit save writes; per-execution/candidate keys isolate views and repeated saves overwrite one entry',()=>{
  const s=storage(),{camera,controls}=setup(),saved=captureCameraView(camera,controls);expect(loadCandidateCamera(s,ref)).toBeNull();camera.zoom=151;expect(s.data.size).toBe(0)
  saveCandidateCamera(s,ref,saved);expect(loadCandidateCamera(s,{...ref,candidateId:'candidate-2'})).toBeNull();expect(loadCandidateCamera(s,{...ref,executionId:'execution-b'})).toBeNull()
  saveCandidateCamera(s,ref,{...saved,zoom:178});expect(s.data.size).toBe(1);expect(loadCandidateCamera(s,ref)!.zoom).toBe(178);expect(s.data.has(candidateCameraKey(ref))).toBe(true)
 })
 it('rejects stale references, malformed projections, invalid quaternions and inconsistent look directions',()=>{
  const s=storage(),{camera,controls}=setup(),saved=captureCameraView(camera,controls);saveCandidateCamera(s,ref,saved);expect(()=>loadCandidateCamera(s,{...ref,executionHash:'different'})).toThrow(/来源/)
  for(const change of [(v:typeof saved)=>v.zoom=0,(v:typeof saved)=>v.up=[0,0,0],(v:typeof saved)=>v.quaternion=[0,0,0,0],(v:typeof saved)=>v.frustum.far=-1,(v:typeof saved)=>v.target=v.position]){const v=structuredClone(saved);change(v);expect(()=>assertCameraView(v)).toThrow()}
 })
 it('adoption stores view outside unchanged origin/Assembly JSON and restores it independently of geometry',()=>{
  const s=storage(),assembly=parseAssembly3D(JSON.stringify(pair)),origin={id:'origin-1',assembly},raw=JSON.stringify(assembly),source=JSON.stringify(origin),{camera,controls}=setup(),view=captureCameraView(camera,controls)
  adoptReconstructionDraft(s,assembly,origin,null,view);expect(s.getItem(DRAFT_3D_KEY)).toBe(raw);expect(JSON.stringify(origin)).toBe(source);expect(loadPhotoOrigin(s)!.cameraView).toEqual(view)
  view.zoom=999;expect(loadPhotoOrigin(s)!.cameraView!.zoom).toBe(137)
 })
 it('legacy source metadata loads with default camera; a damaged view does not discard geometry or provenance',()=>{
  const s=storage(),assembly=parseAssembly3D(JSON.stringify(pair)),origin={id:'origin',assembly};adoptReconstructionDraft(s,assembly,origin,null);expect(loadPhotoOrigin(s)!.cameraView).toBeUndefined()
  const saved=JSON.parse(s.getItem(PHOTO_ORIGIN_3D_KEY)!);saved.cameraView={zoom:3};s.setItem(PHOTO_ORIGIN_3D_KEY,JSON.stringify(saved));expect(loadPhotoOrigin(s)!.origin).toEqual(origin);expect(loadPhotoOrigin(s)!.cameraView).toBeUndefined();expect(s.getItem(DRAFT_3D_KEY)).toBe(JSON.stringify(assembly))
 })
})

import {describe,it,expect} from 'vitest'
import {BoxGeometry,Group,Mesh,MeshBasicMaterial,OrthographicCamera,Quaternion,Raycaster,Vector2,Vector3} from 'three'
import {adaptProfile} from '../../src/magnetic-tiles/three-d/profile-adapter.ts'
import {normalizeModuleSnapSelection,validSnapPort,pickSnapPort,pickSnapTile,snapPortSegment} from '../../src/magnetic-tiles/three-d/module-snap-selection.ts'
import type {ProfileSnapshot3D} from '../../src/magnetic-tiles/three-d/profile-adapter.ts'
import {LineSegments2} from 'three/examples/jsm/lines/LineSegments2.js'
import {LineSegmentsGeometry} from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js'

const square:ProfileSnapshot3D={profile:{id:'segmented',version:1,name:'Segmented',vertices:[[0,0],[1,0],[1,1],[0,1]],connectableEdges:['e0','e1','e2','e3']},thickness:.06,ports:[{edgeId:'e0',ranges:[[0,.4],[.6,1]]}]}
function setup(){
 const camera=new OrthographicCamera(-2,2,2,-2,.01,50);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);camera.updateProjectionMatrix()
 const piece={id:'tile-a',shape:adaptProfile(square).shape,transform:{position:new Vector3(),quaternion:new Quaternion()}},solids=new Group(),owner=new Group();owner.userData.tileId=piece.id;owner.add(new Mesh(new BoxGeometry(1,1,.06),new MeshBasicMaterial()));solids.add(owner);solids.updateMatrixWorld(true)
 const point=(id:string,t=.5)=>{const s=snapPortSegment(piece,id,camera)!,p=s.p0.clone().lerp(s.p1,t).project(camera);return new Vector2((p.x+1)*200,(1-p.y)*200)}
 return {camera,piece,solids,point}
}
describe('shared Module Snap selection validation',()=>{
 it('retains actual segmented canonical IDs and clears a port absent from the new Tile',()=>{
  const triangle=structuredClone(square);triangle.profile={id:'triangle',version:1,name:'Triangle',vertices:[[0,0],[1,0],[0,1]],connectableEdges:['e0','e1','e2']};delete triangle.ports
  const models=[{id:'a',shape:adaptProfile(square).shape},{id:'b',shape:adaptProfile(triangle).shape}],state={fixedTile:'a',fixedPort:'e0-p1',movingPort:'e3-p0'},before=structuredClone(state)
  expect(validSnapPort(models,'a','e0-p1')).toBe('e0-p1');expect(validSnapPort(models,'b','e0-p1')).toBe('')
  expect(normalizeModuleSnapSelection(models,['b'],'b',state)).toEqual({fixedTile:'b',fixedPort:'',movingPort:''});expect(state).toEqual(before)
  expect(normalizeModuleSnapSelection(models,['a'],'a',state)).toEqual(state)
 })
})
describe('viewport canonical Port picking',()=>{
 it('distinguishes two segments on the same edge using their real IDs',()=>{
  const {camera,piece,solids,point}=setup()
  for(const id of ['e0-p0','e0-p1','e1-p0','e2-p0','e3-p0'])expect(pickSnapPort(piece,camera,{width:400,height:400},point(id),solids)).toEqual({portId:id,ambiguous:false})
 })
 it('rejects ambiguous shared endpoints and edge-on projections instead of choosing a nearest label',()=>{
  const {camera,piece,solids,point}=setup();expect(pickSnapPort(piece,camera,{width:400,height:400},point('e0-p0',0),solids)).toEqual({portId:null,ambiguous:true})
  camera.position.set(5,0,0);camera.lookAt(0,0,0);camera.updateMatrixWorld(true)
  expect(pickSnapPort(piece,camera,{width:400,height:400},new Vector2(200,200),solids)).toEqual({portId:null,ambiguous:true})
 })
 it('refuses an actual solid occluder, including a different Assembly, and allows geometry behind the edge',()=>{
  const {camera,piece,solids,point}=setup(),occluder=new Group();occluder.userData.tileId='other-assembly-tile';occluder.add(new Mesh(new BoxGeometry(2,2,.1),new MeshBasicMaterial()));occluder.position.z=1;solids.add(occluder);solids.updateMatrixWorld(true)
  expect(pickSnapPort(piece,camera,{width:400,height:400},point('e0-p1'),solids).portId).toBeNull()
  occluder.position.z=-1;solids.updateMatrixWorld(true);expect(pickSnapPort(piece,camera,{width:400,height:400},point('e0-p1'),solids).portId).toBe('e0-p1')
  occluder.position.z=0;solids.updateMatrixWorld(true);expect(pickSnapPort(piece,camera,{width:400,height:400},point('e0-p1'),solids).portId).toBeNull()
 })
 it('does not treat decorative LineSegments2 (which inherit Mesh) as a solid occluder',()=>{
  const {camera,piece,solids,point}=setup(),line=new LineSegments2(new LineSegmentsGeometry().setPositions([-.5,-.5,1,.5,-.5,1]),new LineMaterial({linewidth:8,resolution:new Vector2(400,400)}))
  line.userData.tileId='decorative-outline';solids.add(line);solids.updateMatrixWorld(true)
  expect(pickSnapPort(piece,camera,{width:400,height:400},point('e0-p1'),solids).portId).toBe('e0-p1')
 })
 it('uses a non-quadrilateral Profile and rotated/scaled real Port segments',()=>{
  const s:ProfileSnapshot3D={profile:{id:'pentagon',version:1,name:'Five edges',vertices:[[0,0],[2,0],[2.5,1],[1,2],[0,1]],connectableEdges:['e0','e1','e2','e3','e4']},thickness:.12,scale:1.7}
  const {camera}=setup(),piece={id:'pent',shape:adaptProfile(s).shape,transform:{position:new Vector3(.2,-.4,0),quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.6)}}
  const segment=snapPortSegment(piece,'e4-p0',camera)!,p=segment.p0.clone().lerp(segment.p1,.5).project(camera),pointer=new Vector2((p.x+1)*200,(1-p.y)*200)
  expect(segment.p0.distanceTo(segment.p1)).toBeCloseTo(1.7,12);expect(pickSnapPort(piece,camera,{width:400,height:400},pointer,new Group()).portId).toBe('e4-p0')
 })
})
describe('viewport Tile picking',()=>{
 it('restricts the nearest visible Tile to eligible Group membership and never clicks through another Group',()=>{
  const {camera,piece,solids}=setup(),ray=new Raycaster();ray.setFromCamera(new Vector2(),camera)
  expect(pickSnapTile(ray,solids,[piece.id])).toBe(piece.id);expect(pickSnapTile(ray,solids,['wrong'])).toBeNull()
  const front=new Group();front.userData.tileId='fixed-other';front.add(new Mesh(new BoxGeometry(1,1,.1),new MeshBasicMaterial()));front.position.z=1;solids.add(front);solids.updateMatrixWorld(true)
  expect(pickSnapTile(ray,solids,[piece.id])).toBeNull();expect(pickSnapTile(ray,solids,['fixed-other'])).toBe('fixed-other')
  front.position.z=0;front.scale.z=.6;solids.updateMatrixWorld(true);expect(pickSnapTile(ray,solids,[piece.id,'fixed-other'])).toBeNull()
 })
})

import {describe,it,expect} from 'vitest'
import {Matrix4,Quaternion,Vector3} from 'three'
import fixture from './fixtures/back-angle-hints.json'
import {adaptProfile} from '../../src/magnetic-tiles/three-d/profile-adapter.ts'
import type {ProfileSnapshot3D} from '../../src/magnetic-tiles/three-d/profile-adapter.ts'
import {profilePortMappings,mapConnectionConvention,mappedAngleDomains,anchoredPortMappings,portMappingLimits} from '../../src/magnetic-tiles/three-d/port-mapping.ts'
import type {LocalPortMapping,PortMappingAnchor} from '../../src/magnetic-tiles/three-d/port-mapping.ts'
import type {ConnectionHypothesis3D} from '../../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import {computeTransformFromConnection,computeAllConnectionResiduals} from '../../src/magnetic-tiles/three-d/vendor/engine/solver.ts'
const square=()=>structuredClone(fixture.origin.assembly.profiles[0]) as ProfileSnapshot3D
const triangle=()=>structuredClone(fixture.origin.assembly.profiles[1]) as ProfileSnapshot3D
const hint=(a='a',b='b',angle=37):ConnectionHypothesis3D=>({pieceA:a,pieceB:b,portA:'e0-p0',portB:'e0-p0',flip:true,intent:'uncertain',angles:[angle],angleRange:{min:angle-5,max:angle+5},evidenceRefs:[a,b],evidence:'explicit test edge correspondence',uncertainty:'not human confirmed'})
function rotation(m:LocalPortMapping){const [a,b,c,d]=m.matrix;return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(a,c,0),new Vector3(b,d,0),new Vector3(0,0,m.normalSign)))}
describe('deterministic anchored Profile Port coordinate correspondence',()=>{
 it('uses full geometry for cyclic reindexing, arbitrary rotations and reflected asymmetric Profiles',()=>{
  const h=square();h.profile.vertices=[[0,0],[1.7,0],[1.1,1],[.2,.7]]
  const c=structuredClone(h),angle=.37;c.profile.name='different display label';c.profile.id='different-test-label';c.profile.vertices=h.profile.vertices.map(([x,y])=>[Math.cos(angle)*x-Math.sin(angle)*y,Math.sin(angle)*x+Math.cos(angle)*y]);c.profile.vertices.push(c.profile.vertices.shift()!)
  expect(profilePortMappings(h,c)).toHaveLength(1);expect(profilePortMappings(h,c)[0].ports['e0-p0'].portId).toBe('e3-p0')
  const reflected=structuredClone(c);reflected.profile.vertices=reflected.profile.vertices.map(([x,y]):[number,number]=>[-x,y]).reverse()
  const mappings=profilePortMappings(h,reflected);expect(mappings).toHaveLength(1);expect(mappings[0].normalSign).toBe(-1)
 })
 it('recognizes square/triangle symmetries without guessing a unique instance frame',()=>{
  expect(profilePortMappings(square(),square())).toHaveLength(8);expect(profilePortMappings(triangle(),triangle())).toHaveLength(6)
 })
 it('maps actual segmented endpoints, including reversal of segment indices, and rejects missing segments',()=>{
  const h=square(),c=square();h.ports=h.profile.connectableEdges.map(edgeId=>({edgeId,ranges:[[0,.25],[.25,1]]}));c.ports=c.profile.connectableEdges.map(edgeId=>({edgeId,ranges:[[0,.75],[.75,1]]}))
  const maps=profilePortMappings(h,c),reversed=maps.find(m=>m.ports['e0-p0']?.portId==='e0-p1'&&m.ports['e0-p0'].reversed)!
  expect(reversed).toBeDefined();expect(reversed.normalSign).toBe(-1);expect(reversed.ports['e0-p1']).toEqual({portId:'e0-p0',reversed:true})
  expect(profilePortMappings(h,square())).toEqual([])
 })
 it('rejects incompatible outline, thickness, dimensions and connectable boundaries',()=>{
  expect(profilePortMappings(square(),triangle())).toEqual([])
  for(const modify of [(p:ProfileSnapshot3D)=>p.thickness*=2,(p:ProfileSnapshot3D)=>p.scale=1.2,(p:ProfileSnapshot3D)=>p.profile.connectableEdges=['e0']]){const c=square();modify(c);expect(profilePortMappings(square(),c)).toEqual([])}
 })
 it('converts Flip, directed axes and opposite normals consistently with the existing Solver at nonzero angles',()=>{
  const hs=adaptProfile(square()).shape,ht=adaptProfile(triangle()).shape,base={position:new Vector3(3,-2,5),quaternion:new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.8)},historical=hint()
  for(const flip of [false,true])for(const normalA of [1,-1])for(const normalB of [1,-1]){
   historical.flip=flip
   const a=profilePortMappings(square(),square()).find(m=>m.normalSign===normalA)!,b=profilePortMappings(triangle(),triangle()).find(m=>m.normalSign===normalB)!,attach=computeTransformFromConnection(base,hs,historical.portA!,ht,historical.portB!,37,flip)!
   const currentA={position:base.position.clone(),quaternion:base.quaternion.clone().multiply(rotation(a).invert())},currentB={position:attach.position.clone(),quaternion:attach.quaternion.clone().multiply(rotation(b).invert())}
   const converted=mapConnectionConvention(historical,a,b)[0],c={pieceA:'a',pieceB:'b',portA:converted.portA!,portB:converted.portB!,dihedralDeg:converted.angles[0],flip:converted.flip!}
   const r=computeAllConnectionResiduals([c],{a:currentA,b:currentB},id=>id==='a'?hs:ht)[0]
   expect(r.positionError).toBeLessThan(1e-10);expect(r.directionDot).toBeCloseTo(1,12);expect(r.dihedralError).toBeLessThan(1e-10)
  }
 })
 it('splits allowed angle ranges at ±180 without widening or losing the original interval',()=>{
  const d=mappedAngleDomains({angles:[0],angleRange:{min:-5,max:5}},{reversed:false,normalSign:1},{normalSign:-1})
  expect(d.map(d=>d.angleRange)).toEqual([{min:175,max:180},{min:-180,max:-175}]);expect(d.every(d=>d.angles.every(a=>a>=d.angleRange!.min&&a<=d.angleRange!.max))).toBe(true)
  expect(mappedAngleDomains({angles:[0],angleRange:{min:-180,max:180}},{reversed:false,normalSign:1},{normalSign:1})).toEqual([{angles:[0],angleRange:{min:-180,max:180}}])
  expect(mappedAngleDomains({angles:[0],angleRange:{min:5,max:-5}},{reversed:true,normalSign:1},{normalSign:1})).toEqual([])
  expect(mappedAngleDomains({angles:[37],angleRange:{min:32,max:42}},{reversed:true,normalSign:-1},{normalSign:-1})).toEqual([{angles:[-37],angleRange:{min:-42,max:-32}}])
 })
 const anchor=(a:string,b:string,flip=true):PortMappingAnchor=>({id:a+'-'+b,historical:{...hint(a,b,0),angleRange:{min:-180,max:180}},current:{pieceA:a,pieceB:b,portA:'e0-p0',portB:'e0-p0',dihedralDeg:0,flip},domain:{angles:[0],angleRange:{min:-180,max:180}}})
 it('retains a bounded set of genuinely anchored ambiguous mappings, deterministically',()=>{
  const domains=new Map(['a','b','x','y'].map(id=>[id,profilePortMappings(square(),square())])),anchors=[anchor('a','x'),anchor('b','y')],r=anchoredPortMappings(domains,anchors,'a','b')
  expect(r.status).toBe('ambiguous');expect(r.pairs).toHaveLength(4);expect(r.states).toBeLessThanOrEqual(portMappingLimits.maxStates);expect(r).toEqual(anchoredPortMappings(domains,anchors,'a','b'))
  expect(anchoredPortMappings(domains,[],'a','b')).toMatchObject({status:'unavailable',pairs:[]})
 })
 it('rejects globally inconsistent anchor loops even when arc consistency alone leaves alternatives',()=>{
  const domains=new Map(['a','b','x'].map(id=>[id,profilePortMappings(square(),square())])),r=anchoredPortMappings(domains,[anchor('a','x'),anchor('b','x'),anchor('a','b',false)],'a','b')
  expect(r.pairs).toEqual([]);expect(r.status).toBe('unavailable')
 })
})

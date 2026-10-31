import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {Quaternion,Vector3,Euler} from 'three'
import {executeVisible3D} from '../../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {inspectAssemblyCollisions,validateAssembly3D} from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import type {CollisionEvidence} from '../../src/magnetic-tiles/three-d/collision-visual.ts'
import {collisionVisual} from '../../src/magnetic-tiles/three-d/collision-visual.ts'
import {createShapeCatalog,profileKey3D} from '../../src/magnetic-tiles/three-d/profile-adapter.ts'
import type {Assembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
const fixture=JSON.parse(readFileSync(new URL('./fixtures/orange-reviewed-geometry.json',import.meta.url),'utf8'))
const orange=()=>executeVisible3D(fixture.plan,fixture.input).diagnosticCandidates![0].assembly

// Independent plane-triple oracle: no production intersection vertex enumerator
// and no QuickHull are used to derive the expected convex intersection vertices.
function planes(a:Assembly3D,id:string){
 const p=a.pieces.find(p=>p.id===id)!,s=createShapeCatalog(a.profiles).get(profileKey3D({id:p.profileId,version:p.profileVersion}))!.shape
 const q=new Quaternion(...p.pose.quaternion),t=new Vector3(...p.pose.position)
 const ps=s.vertices.map((v,i)=>{const w=s.vertices[(i+1)%s.vertices.length],n=new Vector3(w.y-v.y,v.x-w.x,0).normalize(),d=n.x*v.x+n.y*v.y;n.applyQuaternion(q);return {n,d:d+n.dot(t)}})
 for(const sign of [-1,1]){const n=new Vector3(0,0,sign).applyQuaternion(q);ps.push({n,d:s.thickness/2+n.dot(t)})}return ps
}
function independentVertices(a:Assembly3D,ids:string[]){
 const ps=ids.flatMap(id=>planes(a,id)),vs:Vector3[]=[]
 for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)for(let k=j+1;k<ps.length;k++){
  const A=ps[i],B=ps[j],C=ps[k],bc=B.n.clone().cross(C.n),det=A.n.dot(bc);if(Math.abs(det)<1e-10)continue
  const p=bc.multiplyScalar(A.d).add(C.n.clone().cross(A.n).multiplyScalar(B.d)).add(A.n.clone().cross(B.n).multiplyScalar(C.d)).divideScalar(det)
  if(ps.every(f=>f.n.dot(p)<=f.d+1e-9)&&!vs.some(v=>v.distanceTo(p)<1e-8))vs.push(p)
 }return {vs,ps}
}
describe('collision visualization: actual strict-prism evidence, no validation changes',()=>{
 it('matches the independent halfspace intersection for all four orange collisions',()=>{
  const a=orange(),before=JSON.stringify(a),report=validateAssembly3D(a),evidence=inspectAssemblyCollisions(a,report)
  expect(evidence).toHaveLength(4)
  for(const e of evidence){
   const v=collisionVisual(e,'snapshot'),oracle=independentVertices(a,e.pieceIds)
   expect(v.kind).toBe('volume');expect(v.volume).toBeCloseTo(7.79422863405994e-6,12);expect(v.volume).toBeGreaterThan(0)
   expect(v.vertices.length).toBe(oracle.vs.length)
   for(const p of v.vertices)expect(oracle.vs.some(w=>w.distanceTo(new Vector3(...p))<1e-8)).toBe(true)
   for(let i=0;i<v.positions.length;i+=3){const p=new Vector3(...v.positions.slice(i,i+3)).add(new Vector3(...v.origin));expect(oracle.ps.every(f=>f.n.dot(p)<=f.d+1e-9)).toBe(true)}
   expect(oracle.ps.every(f=>f.n.dot(new Vector3(...v.center!))<f.d-1e-7)).toBe(true)
   expect(e.penetrationDepth).toBeCloseTo(.015,10)
  }
  expect(JSON.stringify(a)).toBe(before);expect(validateAssembly3D(a)).toEqual(report);expect(report.valid).toBe(false)
 })
 it('locates large coincident and non-coplanar plate-interior overlap, not only junctions',()=>{
  const source=orange(),square=source.pieces[0]
  for(const crossing of [false,true]){
   const a={...structuredClone(source),connections:[],pieces:[structuredClone(square),{...structuredClone(square),id:'overlap'}]}
   if(crossing)a.pieces[1].pose.quaternion=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2).toArray()
   const e=inspectAssemblyCollisions(a)[0],v=collisionVisual(e,'overlap'),oracle=independentVertices(a,e.pieceIds)
   expect(v.kind).toBe('volume');expect(v.volume).toBeCloseTo(crossing?.0036:.06,10)
   expect(v.vertices.length).toBe(oracle.vs.length);expect(validateAssembly3D(a).valid).toBe(false)
  }
 })
 it('is rigid-transform invariant and keeps local mesh coordinates numerically small',()=>{
  const a=orange(),original=inspectAssemblyCollisions(a).map(e=>collisionVisual(e,'a'))
  const q=new Quaternion().setFromEuler(new Euler(.37,-.61,.29)),t=new Vector3(30,-20,40)
  a.pieces.forEach(p=>{p.pose.position=new Vector3(...p.pose.position).applyQuaternion(q).add(t).toArray();p.pose.quaternion=q.clone().multiply(new Quaternion(...p.pose.quaternion)).toArray()})
  const rotated=inspectAssemblyCollisions(a).map(e=>collisionVisual(e,'b'))
  rotated.forEach((v,i)=>{expect(v.volume).toBeCloseTo(original[i].volume,11);expect(new Vector3(...v.center!).distanceTo(new Vector3(...original[i].center!).applyQuaternion(q).add(t))).toBeLessThan(1e-8);expect(Math.max(...v.positions.map(Math.abs))).toBeLessThan(.1)})
 })
 it('does not fabricate volumes from missing or coplanar evidence; depth is not a marker radius',()=>{
  const e=inspectAssemblyCollisions(orange())[0],a=collisionVisual(e,'one'),b=collisionVisual({...e,penetrationDepth:100},'two')
  expect(a.positions).toEqual(b.positions);expect(a.bounds).toEqual(b.bounds);expect(a.volume).toBe(b.volume)
  const flat:CollisionEvidence={...e,intersectionVertices:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],region:{min:[0,0,0],max:[1,1,0]}}
  expect(collisionVisual(flat,'flat').kind).toBe('approximate');expect(collisionVisual(flat,'flat').positions).toEqual([])
  expect(collisionVisual({...e,intersectionVertices:[],region:null},'missing').kind).toBe('unavailable')
 })
 it('valid assemblies have no collision evidence to display',()=>{
  const a=JSON.parse(readFileSync(new URL('../../src/magnetic-tiles/three-d/examples/closed-cube.json',import.meta.url),'utf8'))
  expect(validateAssembly3D(a).valid).toBe(true);expect(inspectAssemblyCollisions(a)).toEqual([])
 })
})

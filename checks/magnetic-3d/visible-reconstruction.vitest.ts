import {describe,it,expect} from 'vitest'
import {adoptReconstructionDraft,PHOTO_ORIGIN_3D_KEY} from '../../src/magnetic-tiles/three-d/reconstruction/adopt-draft.ts'
import {DRAFT_3D_KEY} from '../../src/magnetic-tiles/three-d/draft-storage.ts'
import {readFileSync} from 'node:fs'
import {executeVisible3D} from '../../src/magnetic-tiles/three-d/reconstruction/execute.ts'
import {parseVisibleEvidence,parseSpatialHypothesis} from '../../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import type {VisibleInput3D,SpatialHypothesis3D} from '../../src/magnetic-tiles/three-d/reconstruction/contracts.ts'
import type {Assembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
function fixture(name='right-angle'){
 const a=JSON.parse(readFileSync(new URL('../../src/magnetic-tiles/three-d/examples/'+name+'.json',import.meta.url),'utf8')) as Assembly3D
 const evidence={version:1 as const,observations:a.pieces.map(p=>({id:p.id,color:p.color??'#55b8ac',bbox:[.1,.1,.9,.9] as [number,number,number,number],features:[],occlusion:'partly occluded',evidence:'visible portion only',uncertainty:'synthetic fixture',profileCandidates:[]})),unknowns:[]}
 const review={pieces:a.pieces.map(p=>({id:p.id,profileId:p.profileId,profileVersion:p.profileVersion,confirmed:true,excluded:false,color:p.color??'#55b8ac'})),constraints:[]}
 const input:VisibleInput3D={evidence,review,profiles:a.profiles}
 const plan:SpatialHypothesis3D={version:1,parts:review.pieces.map(p=>({id:p.id,profileId:p.profileId,profileVersion:p.profileVersion,orientationEvidence:'unknown'})),connections:a.connections.map(c=>({...c,angles:[c.dihedralDeg],angleRange:null,flip:c.flip??false,evidenceRefs:[c.pieceA,c.pieceB],evidence:'fixture',uncertainty:'',intent:'connect' as const})).map(({dihedralDeg:_,...c})=>c),alternatives:[],relations:[],unknowns:[]}
 return {a,input,plan}
}
describe('Visible 3D deterministic magnetic execution',()=>{
 it('adoption preserves authoritative draft and origin on CAS conflict or storage failure',()=>{
  const {a}=fixture(),values=new Map<string,string>([[DRAFT_3D_KEY,'newer-draft'],[PHOTO_ORIGIN_3D_KEY,'old-origin']])
  let failDraft=false
  const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{if(failDraft&&k===DRAFT_3D_KEY)throw Error('storage quota');values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}
  const origin={id:'origin',assembly:a}
  expect(()=>adoptReconstructionDraft(storage,a,origin,null)).toThrow(/其他页面/);expect(values.get(PHOTO_ORIGIN_3D_KEY)).toBe('old-origin')
  failDraft=true;expect(()=>adoptReconstructionDraft(storage,a,origin,'newer-draft')).toThrow(/quota/);expect(values.get(PHOTO_ORIGIN_3D_KEY)).toBe('old-origin');expect(values.get(DRAFT_3D_KEY)).toBe('newer-draft')
  failDraft=false;const adopted=adoptReconstructionDraft(storage,a,origin,'newer-draft');expect(values.get(DRAFT_3D_KEY)).toBe(adopted.raw);expect(JSON.parse(values.get(PHOTO_ORIGIN_3D_KEY)!).origin).toEqual(origin)
 })
 it('90 degree pair uses actual engine poses, immutable input, stable alternatives and no photo score',()=>{
  const {input,plan}=fixture(),before=JSON.stringify({input,plan})
  plan.connections[0].angles=[90,-90]; const withAlternatives=JSON.stringify({input,plan})
  const r=executeVisible3D(plan,input);expect(r.status).toBe('candidates_found');expect(r.candidates.length).toBe(2)
  for(const c of r.candidates){expect(c.geometry.valid).toBe(true);expect(c.coverage.reconstructed.length).toBe(2);expect(c.photoMatch).toEqual({status:'unverified',score:null})}
  expect(executeVisible3D(plan,input)).toEqual(r);expect(JSON.stringify({input,plan})).toBe(withAlternatives);expect(before).not.toBe(withAlternatives)
 })
 it('six faces, twelve connections and multiple closure loops use actual validator',()=>{
  const {input,plan}=fixture('closed-cube'),r=executeVisible3D(plan,input)
  expect(r.candidates.length).toBe(1);expect(r.candidates[0].assembly.connections.length).toBe(12);expect(r.candidates[0].geometry.valid).toBe(true);expect(r.candidates[0].assembly.pieces.length).toBe(6)
 })
 it('mixed profiles and free components produce explicit local partial results',()=>{
  const {input,plan}=fixture('mixed-profiles'),r=executeVisible3D(plan,input)
  expect(r.candidates.length).toBeGreaterThan(1);expect(r.diagnostics.join()).toContain('MULTIPLE_COMPONENTS')
  expect(r.candidates.every(c=>c.coverage.unresolved.length>0)).toBe(true)
  expect(r.candidates[0].assembly.profiles).toEqual(input.profiles)
 })
 it('three visible faces reconstruct a local spatial structure without requiring hidden cube panels',()=>{
  const {input,plan}=fixture('closed-cube'),ids=new Set(['bottom','front','right'])
  input.evidence.observations=input.evidence.observations.filter(o=>ids.has(o.id));input.review.pieces=input.review.pieces.filter(p=>ids.has(p.id));plan.parts=plan.parts.filter(p=>ids.has(p.id));plan.connections=plan.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB))
  const r=executeVisible3D(plan,input);expect(r.candidates[0].assembly.pieces.length).toBe(3);expect(r.candidates[0].geometry.valid).toBe(true);expect(r.candidates[0].coverage.unresolved).toEqual([])
 })
 it('a partial house-like visible floor, triangle and side panel can remain incomplete',()=>{
  const {input,plan}=fixture('mixed-profiles')
  input.evidence.observations=input.evidence.observations.filter(o=>o.id!=='free-triangle-v2');input.review.pieces=input.review.pieces.filter(p=>p.id!=='free-triangle-v2');plan.parts=plan.parts.filter(p=>p.id!=='free-triangle-v2')
  input.evidence.observations.push({...input.evidence.observations[0],id:'side'});input.review.pieces.push({...input.review.pieces[0],id:'side'});plan.parts.push({...plan.parts[0],id:'side'})
  plan.connections.push({...plan.connections[0],pieceB:'side',portA:'e1-p0',portB:'e0-p0',angles:[90],flip:true,evidenceRefs:['base','side']})
  const r=executeVisible3D(plan,input);expect(r.candidates[0].assembly.pieces.length).toBe(3);expect(r.candidates[0].geometry.valid).toBe(true);expect(r.candidates[0].assembly.pieces.some(p=>p.profileId==='right-triangle')).toBe(true)
 })
 it('wrong loop residual, illegal overlapping connection and invalid port cannot become valid candidates',()=>{
  const {input,plan}=fixture('closed-cube');plan.connections[11].angles=[45]
  const r=executeVisible3D(plan,input);expect(r.candidates).toEqual([]);expect(r.diagnostics.join()).toContain('GEOMETRY_REJECTED')
  const f=fixture();f.plan.connections[0].angles=[0];f.plan.connections[0].flip=false
  const overlap=executeVisible3D(f.plan,f.input);expect(overlap.candidates).toEqual([])
  f.plan.connections[0].portA='imagined-port';expect(()=>executeVisible3D(f.plan,f.input)).toThrow(/Port/)
 })
 it('Unknown profile/angle/port are unresolved without hidden pieces or default angles',()=>{
  for(const field of ['angle','port','profile']){
   const {input,plan}=fixture()
   if(field==='angle')plan.connections[0].angles=[]
   if(field==='port')plan.connections[0].portA=null
   if(field==='profile'){input.review.pieces[1].profileId=null;input.review.pieces[1].profileVersion=null;plan.parts[1].profileId=null;plan.parts[1].profileVersion=null;plan.connections=[]}
   const r=executeVisible3D(plan,input);expect(r.candidates.every(c=>c.coverage.unresolved.length>0)).toBe(true);expect(r.candidates.every(c=>c.assembly.connections.length===0)).toBe(true)
  }
 })
 it('finite budget exhaustion never exposes a partially searched result as accepted',()=>{
  const {input,plan}=fixture();plan.connections[0].angles=[90,-90]
  for(const options of [{maxAssignments:0},{maxGeometryChecks:0},{maxAssignments:1}]){
   const r=executeVisible3D(plan,input,options);expect(r.status).toBe('budget_exhausted');expect(r.completeSearch).toBe(false);expect(r.candidates).toEqual([])
  }
 })
 it('ranges/flip branches retain sampling limits, distinct sizes and versions are not names',()=>{
  const {input,plan}=fixture();input.profiles[0].profile.version=2;input.profiles[0].profile.vertices=input.profiles[0].profile.vertices.map(p=>[p[0]*2,p[1]*2]);input.profiles[0].thickness=.13
  input.review.pieces.forEach(p=>p.profileVersion=2);plan.parts.forEach(p=>p.profileVersion=2);plan.connections[0].angles=[];plan.connections[0].angleRange={min:60,max:120};plan.connections[0].flip=null
  const r=executeVisible3D(plan,input);expect(r.candidates.length).toBeGreaterThan(0);expect(r.candidates[0].assembly.profiles[0]).toEqual(input.profiles[0]);expect(r.candidates[0].unverifiedConstraints.join()).toContain('仅采样')
 })
 it('model cannot alter confirmed identities, profile, evidence or provide exact pose',()=>{
  const {input,plan}=fixture();expect(()=>parseSpatialHypothesis({...plan,pose:[1,2,3]},input)).toThrow();plan.parts.pop();expect(()=>parseSpatialHypothesis(plan,input)).toThrow(/丢失/)
  const e=structuredClone(input.evidence);e.observations[0].bbox=null;expect(()=>parseVisibleEvidence(e)).toThrow(/可见/)
 })
 it('human constraints override a contradictory model without changing either record',()=>{
  const {input,plan}=fixture();input.review.constraints=structuredClone(plan.connections);plan.connections[0].angles=[0];const before=JSON.stringify({input,plan})
  const r=executeVisible3D(plan,input);expect(r.candidates[0].assembly.connections[0].dihedralDeg).toBe(input.review.constraints[0].angles[0]);expect(JSON.stringify({input,plan})).toBe(before)
 })
})

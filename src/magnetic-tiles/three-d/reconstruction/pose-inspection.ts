import {Matrix3,Matrix4,Quaternion,Vector3} from 'three'
import type {Assembly3D} from '../assembly.ts'
import {createViewerModel} from '../viewer-model.ts'

/** Same ProfileSnapshot + saved Pose boundary as the Viewer; never solves. */
export function inspectPieceGeometry(assembly:Assembly3D){
 return createViewerModel(assembly).map(p=>{
  const normal=new Vector3(0,0,1).applyQuaternion(p.transform.quaternion).normalize()
  const vertices=p.shape.vertices.map(v=>new Vector3(v.x,v.y,0).applyQuaternion(p.transform.quaternion).add(p.transform.position))
  const solidVertices=vertices.flatMap(v=>[v.clone().addScaledVector(normal,p.shape.thickness/2),v.clone().addScaledVector(normal,-p.shape.thickness/2)])
  return {id:p.id,position:p.transform.position,normal,vertices,solidVertices,thickness:p.shape.thickness}
 })
}
export const planeAngleDeg=(a:Vector3,b:Vector3)=>Math.acos(Math.min(1,Math.abs(a.dot(b))))*180/Math.PI
function basis(a:Vector3,b:Vector3,c:Vector3){const x=b.clone().sub(a).normalize(),z=new Vector3().crossVectors(x,c.clone().sub(a)).normalize(),y=new Vector3().crossVectors(z,x);return new Matrix4().makeBasis(x,y,z)}
/** Exact-polygon registration diagnostic, not image/PnP fitting.
 * Enumerates the anchor polygon's cyclic/reversed corner correspondences, then
 * measures all corresponding piece solids. Every accepted transform has det +1.
 * det -1 fits are returned ONLY as a separate mirror diagnostic.
 */
export function compareAssemblyGeometry(source:Assembly3D,reference:Assembly3D,mapping:Record<string,string>,tolerance=1e-6,surface:'solid'|'midplane'='solid'){
 const sourceParts=inspectPieceGeometry(source),targetParts=inspectPieceGeometry(reference),ids=Object.keys(mapping).sort()
 if(!ids.length||ids.length!==sourceParts.length||new Set(Object.values(mapping)).size!==ids.length||ids.some(id=>!sourceParts.some(p=>p.id===id)||!targetParts.some(p=>p.id===mapping[id])))throw Error('Rigid comparison needs an explicit one-to-one Piece mapping')
 const anchor=sourceParts.find(p=>p.id===ids[0])!,target=targetParts.find(p=>p.id===mapping[ids[0]])!,n=anchor.vertices.length
 if(n!==target.vertices.length)throw Error('Anchor Profile vertex counts differ')
 const from=basis(...anchor.vertices.slice(0,3) as [Vector3,Vector3,Vector3]),best={proper:null as null|{maxError:number;rmsError:number;determinant:number;matrix:number[]},improper:null as null|{maxError:number;rmsError:number;determinant:number;matrix:number[]}}
 for(const direction of [1,-1])for(let offset=0;offset<n;offset++){
  const chosen=[0,1,2].map(i=>target.vertices[(offset+direction*i+n)%n]),to=basis(...chosen as [Vector3,Vector3,Vector3])
  for(const reflection of [false,true]){
   const rotation=to.clone().multiply(new Matrix4().makeScale(1,1,reflection?-1:1)).multiply(from.clone().invert())
   const translation=chosen[0].clone().sub(anchor.vertices[0].clone().applyMatrix4(rotation));rotation.setPosition(translation)
   const errors:number[]=[]
   for(const id of ids){const s=sourceParts.find(p=>p.id===id)!,t=targetParts.find(p=>p.id===mapping[id])!,moved=(surface==='solid'?s.solidVertices:s.vertices).map(v=>v.clone().applyMatrix4(rotation));for(const v of moved)errors.push(Math.min(...(surface==='solid'?t.solidVertices:t.vertices).map(w=>v.distanceTo(w))));for(const w of (surface==='solid'?t.solidVertices:t.vertices))errors.push(Math.min(...moved.map(v=>v.distanceTo(w))))}
   const candidate={maxError:Math.max(...errors),rmsError:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),determinant:new Matrix3().setFromMatrix4(rotation).determinant(),matrix:rotation.toArray()},key=reflection?'improper':'proper'
   if(!best[key]||candidate.maxError<best[key]!.maxError)best[key]=candidate
  }
 }
 const sourcePairs=source.connections.map(c=>[mapping[c.pieceA],mapping[c.pieceB]].sort().join('|')).sort(),targetPairs=reference.connections.filter(c=>Object.values(mapping).includes(c.pieceA)&&Object.values(mapping).includes(c.pieceB)).map(c=>[c.pieceA,c.pieceB].sort().join('|')).sort()
 return {method:'polygon-symmetry-rigid-registration' as const,tolerance,surface,mapping,topologyMatches:JSON.stringify(sourcePairs)===JSON.stringify(targetPairs),proper:best.proper!,improper:best.improper!,equivalentUnderProperRotation:best.proper!.maxError<=tolerance,mirrorOnly:best.proper!.maxError>tolerance&&best.improper!.maxError<=tolerance,
  normalPolarity:'unmarked-two-sided-panels; compare solids and labelled pieces, not arbitrary local +Z markings'}
}
/** Explicit viewing aid, not photo registration or a change to saved Pose. */
export function pieceViewPreset(assembly:Assembly3D,pieceId:string,kind:'face'|'up'){
 const parts=inspectPieceGeometry(assembly),p=parts.find(p=>p.id===pieceId);if(!p)throw Error('Select a reconstructed piece first')
 const center=parts.reduce((s,p)=>s.add(p.position),new Vector3()).multiplyScalar(1/parts.length)
 const outward=(part:typeof p)=>part.normal.clone().multiplyScalar(part.normal.dot(part.position.clone().sub(center))<0?-1:1)
 const n=outward(p),up=kind==='up'?n:new Vector3(0,1,0).applyQuaternion(new Quaternion(...assembly.pieces.find(p=>p.id===pieceId)!.pose.quaternion))
 let direction=kind==='face'?n:parts.reduce((s,part)=>s.add(outward(part)),new Vector3())
 if(direction.length()<1e-6)direction=n.clone().add(new Vector3(.7,.5,.4))
 if(Math.abs(direction.clone().normalize().dot(up))>.98)direction.add(p.vertices[1].clone().sub(p.vertices[0]).normalize())
 return {up:up.toArray() as [number,number,number],direction:direction.normalize().toArray() as [number,number,number]}
}

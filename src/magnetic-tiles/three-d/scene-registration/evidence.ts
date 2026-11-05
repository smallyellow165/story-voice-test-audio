import {Vector3} from 'three'
import {createViewerModel} from '../viewer-model.ts'
import type {VisibleEvidence3D,SpatialHypothesis3D} from '../reconstruction/contracts.ts'
import type {RegistrationImage,RegistrationMember,RegistrationPoint,RegistrationBox} from './contracts.ts'

/** Conservative V1 adapter. Future Analysis/Review can supply typed point
 * correspondences directly to the solver; this text adapter is not its API. */
export function registrationEvidence(member:RegistrationMember,image:RegistrationImage,evidence:VisibleEvidence3D,plan:SpatialHypothesis3D,map:{pieceId:string;observationId:string}[]){
 const points:RegistrationPoint[]=[],boxes:RegistrationBox[]=[],models=createViewerModel(member.assembly),seen=new Set<string>()
 for(const link of map){
  const p=models.find(p=>p.id===link.pieceId),o=evidence.observations.find(o=>o.id===link.observationId),e=o?.imageEvidence?.find(e=>e.imageId===image.id)
  if(!p||!o)throw Error('Observation → Tile 对应不存在；不能猜测映射')
  if(!e)continue
  const vertices=p.shape.vertices.map(x=>new Vector3(x.x,x.y,0).applyQuaternion(p.transform.quaternion).add(p.transform.position)),ref=member.ref.id
  if(e.bbox)boxes.push({memberId:ref,pieceId:p.id,local:vertices.map(v=>v.toArray()),pixel:e.bbox.map((x,i)=>x*(i%2?image.height:image.width)) as [number,number,number,number],evidenceRef:o.id})
  const orientation=plan.parts.find(x=>x.id===o.id)?.orientationEvidence??''
  const match=orientation.match(/top(?:\s+(?:rim|edge))?\s*(?:=|is|:)\s*(e\d+)|(e\d+)\s+(?:is\s+)?(?:the\s+)?(?:observed\s+)?top/i),edgeId=match?.[1]??match?.[2]
  if(!edgeId)continue
  const ei=Number(edgeId.slice(1)),edge=[vertices[ei],vertices[(ei+1)%vertices.length]]
  if(!edge[0]||!edge[1]||Math.max(...vertices.map(v=>v.y))-Math.min(...vertices.map(v=>v.y))<1e-5||edge.some(v=>Math.abs(v.y-Math.max(...vertices.map(p=>p.y)))>1e-5))continue
  const axis=Math.abs(edge[0].x-edge[1].x)>Math.abs(edge[0].z-edge[1].z)?'x':'z';edge.sort((a,b)=>a[axis]-b[axis])
  for(const f of e.features){
   if(f.points.length!==2||f.visibility!=='visible'||!/top/i.test(f.id+' '+f.note)||/portion|exposed|partial/i.test(f.id+' '+f.note))continue
   const pixels=f.points.map(([x,y])=>[x*image.width,y*image.height] as [number,number]).sort((a,b)=>a[0]-b[0]),key=JSON.stringify(pixels)
   if(seen.has(key))continue;seen.add(key)
   edge.forEach((local,i)=>points.push({memberId:ref,pieceId:p.id,local:local.toArray(),pixel:pixels[i],evidenceRef:o.id+':'+f.id,basis:`Plan orientationEvidence: ${edgeId} upper edge; left-to-right endpoint hypothesis in local upright frame`}))
  }
 }
 return {points,boxes}
}

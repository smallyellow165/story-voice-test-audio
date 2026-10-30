import {alignEdge,distance,edges,EPS,mirrorVariants,transform,validate,vertices,wrapAngle} from '../geometry.ts'
import type {Profile,Tile,Vec} from '../geometry.ts'
const variants=(v:Vec[])=>[v,[...v].reverse()].flatMap(a=>a.map((_,i)=>[...a.slice(i),...a.slice(0,i)]))
const center=(v:Vec[]):Vec=>[v.reduce((n,p)=>n+p[0],0)/v.length,v.reduce((n,p)=>n+p[1],0)/v.length]

// Relax the rest of the assembly: BOTH tiles can translate/rotate freely, but their
// enabled equal-length edges must coincide with opposed directions. For each edge
// and handedness, enumerate ALL cyclic/reversed contour correspondences and solve
// global 2D orthogonal Procrustes exactly. This is a lower bound, not a new solver:
// if each piece has RMS <= T, the vertex-weighted joint RMS must also be <= T.
export function fitConnectedPair(from:Tile,to:Tile,fromImage:Vec[],toImage:Vec[],profiles:readonly Profile[],mirroring=true){
 const aProfile=profiles.find(p=>p.id===from.profileId&&p.version===from.profileVersion)!,bProfile=profiles.find(p=>p.id===to.profileId&&p.version===to.profileVersion)!
 if(fromImage.length!==aProfile.vertices.length||toImage.length!==bProfile.vertices.length)throw Error('连接拟合需要与 Profile 对应的完整顶点')
 const poses=[]
 let fittedCorrespondences=0
 for(const aMirror of mirroring?mirrorVariants(aProfile):[false])for(const bMirror of mirroring?mirrorVariants(bProfile):[false]){
  const a:Tile={...from,pose:{x:0,y:0,angleRad:0,...(aMirror?{mirrored:true}:{})}},b:Tile={...to,pose:{x:0,y:0,angleRad:0,...(bMirror?{mirrored:true}:{})}}
  for(const own of edges(a,profiles).filter(e=>e.enabled))for(const target of edges(b,profiles).filter(e=>e.enabled)){
   if(Math.abs(own.length-target.length)>EPS)continue
   const linked=alignEdge(b,target,own,profiles),local=[...vertices(a,profiles),...vertices(linked,profiles)],lc=center(local)
   let best:{jointRms:number;tiles:Tile[];perPieceRms:{id:string;rms:number}[]}|undefined
   for(const va of variants(fromImage))for(const vb of variants(toImage)){
    fittedCorrespondences++
    const image=[...va,...vb],tc=center(image);let dot=0,cross=0
    local.forEach(([x,y],i)=>{const u=image[i][0]-tc[0],v=image[i][1]-tc[1];dot+=(x-lc[0])*u+(y-lc[1])*v;cross+=(x-lc[0])*v-(y-lc[1])*u})
    const angleRad=Math.atan2(cross,dot),c=Math.cos(angleRad),s=Math.sin(angleRad),pose={x:tc[0]-c*lc[0]+s*lc[1],y:tc[1]-s*lc[0]-c*lc[1],angleRad}
    const sums=local.map((p,i)=>distance(transform(p,pose),image[i])**2),jointRms=Math.sqrt(sums.reduce((n,e)=>n+e,0)/sums.length)
    if(!best||jointRms<best.jointRms-1e-12){
     const tiles=[a,linked].map(t=>{const [x,y]=transform([t.pose.x,t.pose.y],pose);return {...t,pose:{...t.pose,x,y,angleRad:wrapAngle(t.pose.angleRad+angleRad)}}})
     best={jointRms,tiles,perPieceRms:[{id:from.id,rms:Math.sqrt(sums.slice(0,va.length).reduce((n,e)=>n+e,0)/va.length)},{id:to.id,rms:Math.sqrt(sums.slice(va.length).reduce((n,e)=>n+e,0)/vb.length)}]}
    }
   }
   poses.push({ownEdgeId:own.id,targetEdgeId:target.id,fromMirrored:aMirror,toMirrored:bMirror,...best!,validator:validate(best!.tiles,profiles)})
  }
 }
 poses.sort((a,b)=>a.jointRms-b.jointRms||a.ownEdgeId.localeCompare(b.ownEdgeId)||a.targetEdgeId.localeCompare(b.targetEdgeId)||Number(a.fromMirrored)-Number(b.fromMirrored)||Number(a.toMirrored)-Number(b.toMirrored))
 return {connectionModel:'whole-edge-v1' as const,provenance:'computed-free-pair-relaxation' as const,adoptable:false as const,fittedCorrespondences,poses}
}

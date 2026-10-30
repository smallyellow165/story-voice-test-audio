import {distance,edgeContact,edges,EPS,opposingEdges,sub,vertices} from '../geometry.ts'
import type {Edge,Profile,Tile,Vec} from '../geometry.ts'
import type {Evidence} from './contracts.ts'
const cross=(a:Vec,b:Vec)=>a[0]*b[1]-a[1]*b[0]
export const polygonArea=(v:Vec[])=>Math.abs(v.reduce((s,p,i)=>s+cross(p,v[(i+1)%v.length]),0)/2)
const ccw=(v:Vec[])=>v.reduce((s,p,i)=>s+cross(p,v[(i+1)%v.length]),0)<0?[...v].reverse():v
// Diagnostic convex clipping only. validate() continues to use its unchanged SAT/EPS.
export function intersectionPolygon(a:Vec[],b:Vec[]):Vec[]{
 let out=ccw(a)
 const clip=ccw(b)
 for(let i=0;i<clip.length&&out.length;i++){
  const start=clip[i],direction=sub(clip[(i+1)%clip.length],start),input=out;out=[]
  for(let j=0;j<input.length;j++){
   const p=input[j],q=input[(j+1)%input.length],dp=cross(direction,sub(p,start)),dq=cross(direction,sub(q,start)),pin=dp>=0,qin=dq>=0
   if(pin)out.push(p)
   if(pin!==qin){const t=dp/(dp-dq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])])}
  }
 }
 return out
}
export function edgeMeasurement(a:Edge,b:Edge){
 const u=sub(a.b,a.a).map(x=>x/a.length) as Vec,v=sub(b.b,b.a).map(x=>x/b.length) as Vec,projection=(p:Vec)=>{const d=sub(p,a.a);return d[0]*u[0]+d[1]*u[1]},x=projection(b.a),y=projection(b.b)
 const lineError=Math.max(...[b.a,b.b].map(p=>Math.abs(cross(u,sub(p,a.a)))),...[a.a,a.b].map(p=>Math.abs(cross(v,sub(p,b.a)))))
 return {aEdgeId:a.id,bEdgeId:b.id,aLength:a.length,bLength:b.length,lineError,opposing:opposingEdges(a,b),eligibleGeometry:!!edgeContact(a,b)&&opposingEdges(a,b)&&a.enabled&&b.enabled,projectedOverlap:Math.max(0,Math.min(a.length,Math.max(x,y))-Math.max(0,Math.min(x,y))),strictContact:edgeContact(a,b)}
}
export function segmentAudit(evidence:Evidence,width:number,height:number,profiles:readonly Profile[],seeds:{tile:Tile;rms:number}[],scale:number){
 const measurementWindow=.1 // display-only proximity window, NEVER used for acceptance.
 function inspect(items:{id:string;polygon:Vec[];edges:Edge[]}[]){
  const pairs=[]
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
   const a=items[i],b=items[j],overlap=intersectionPolygon(a.polygon,b.polygon),overlapArea=polygonArea(overlap)
   const contacts=a.edges.flatMap(x=>b.edges.map(y=>edgeMeasurement(x,y))).filter(c=>c.projectedOverlap>EPS&&c.lineError<=measurementWindow)
   if(overlapArea>EPS||contacts.length)pairs.push({a:a.id,b:b.id,overlapArea,overlapPolygon:overlap,measurements:contacts})
  }
  return {pairs}
 }
 const observations=evidence.observations.filter(o=>!o.excluded).map(o=>{
  const polygon=o.outline.map(([x,y]):Vec=>[x*width/scale,-y*height/scale]),clockwise=polygon.reduce((s,p,i)=>s+cross(p,polygon[(i+1)%polygon.length]),0)<0
  return {id:o.id,polygon,edges:polygon.map((p,i)=>{const q=polygon[(i+1)%polygon.length];return {tileId:o.id,id:'contour-e'+i,a:clockwise?q:p,b:clockwise?p:q,length:distance(p,q),enabled:true}})}
 })
 return {version:'segmented-contact-audit-v1',connectionModel:'segmented-edge-v1',provenance:'deterministic-input-measurement-not-search-attempt',scalePixelsPerUnit:scale,eps:EPS,measurementWindow,measurementNote:'The proximity window only selects displayed measurements. A connection still requires EPS collinearity, positive length, enabled edges and opposite interiors; area overlap is forbidden. contour-e IDs refer to Review contour order, not Profile edges.',reviewContours:inspect(observations),independentFits:inspect(seeds.map(s=>({id:s.tile.id,polygon:vertices(s.tile,profiles),edges:edges(s.tile,profiles)}))),interpretation:'Observed/estimated contours and fitted Profiles can overlap. This measures input conflict; it does not establish physical layering or silently repair hidden boundaries.'}
}

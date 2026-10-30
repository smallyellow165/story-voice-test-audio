import {vertices} from '../geometry.ts'
import type {Profile,Tile,Vec} from '../geometry.ts'
export type TranslationRegistration={method:'shared-translation-disc-intersection-v1';translation:Vec;feasible:boolean;beforeMaxRms:number;afterMaxRms:number;beforeLayoutRms:number;afterLayoutRms:number;limitingTileIds:string[]}
const center=(v:readonly Vec[]):Vec=>[v.reduce((s,p)=>s+p[0],0)/v.length,v.reduce((s,p)=>s+p[1],0)/v.length]
const square=(v:Vec)=>v[0]*v[0]+v[1]*v[1]
const variants=(v:Vec[])=>[v,[...v].reverse()].flatMap(a=>a.map((_,i)=>[...a.slice(i),...a.slice(0,i)]))
// For a fixed orientation, RMS_i(d)^2 = q_i + |d - c_i|^2.
// Thus one common translation is admissible iff the per-piece discs intersect.
// No geometry tolerance or outline threshold is enlarged here.
export function createOutlineRegistration(image:ReadonlyMap<string,Vec[]>,profiles:readonly Profile[]){
 const targets=new Map([...image].map(([id,v])=>{const c=center(v);return [id,{center:c,originalVariants:variants(v),variants:variants(v.map(p=>[p[0]-c[0],p[1]-c[1]] as Vec))}]})),cache=new Map<string,{q:number;center:Vec}>()
 function metric(t:Tile){
  const k=JSON.stringify([t.id,t.profileId,t.profileVersion,t.pose.angleRad,!!t.pose.mirrored])
  let shape=cache.get(k)
  const target=targets.get(t.id)!
  if(!shape){
   const local=vertices({...t,pose:{...t.pose,x:0,y:0}},profiles),c=center(local),centered=local.map(p=>[p[0]-c[0],p[1]-c[1]] as Vec)
   shape={q:Math.min(...target.variants.map(v=>centered.reduce((s,p,i)=>s+(p[0]-v[i][0])**2+(p[1]-v[i][1])**2,0)/v.length)),center:c}
   if(cache.size>=20000)cache.clear();cache.set(k,shape)
  }
  const c:Vec=[target.center[0]-t.pose.x-shape.center[0],target.center[1]-t.pose.y-shape.center[1]]
  return {id:t.id,q:shape.q,c,rms:Math.sqrt(shape.q+square(c))}
 }
 function exactError(t:Tile){
  const actual=vertices(t,profiles)
  return Math.sqrt(Math.min(...targets.get(t.id)!.originalVariants.map(v=>actual.reduce((sum,p,i)=>sum+(p[0]-v[i][0])**2+(p[1]-v[i][1])**2,0)/v.length)))
 }
 function register(tiles:readonly Tile[],limit:number){
  if(!tiles.length||!Number.isFinite(limit)||limit<0)throw Error('配准需要非空布局及有限非负 RMS 上限')
  const m=tiles.map(metric),limit2=limit*limit,mean=center(m.map(v=>v.c)),before=m.map(v=>v.rms)
  const value=(d:Vec)=>m.map(v=>v.q+(d[0]-v.c[0])**2+(d[1]-v.c[1])**2)
  const legal=(d:Vec)=>tiles.every(t=>{const moved={...t,pose:{...t.pose,x:t.pose.x+d[0],y:t.pose.y+d[1]}},rms=metric(moved).rms;return rms<limit-1e-10||(rms<=limit+1e-10&&exactError(moved)<=limit)})
  let shift:Vec=[0,0],feasible=false
  if(legal(mean)){shift=mean;feasible=true}
  else if(m.every(v=>v.q<=limit2+Number.EPSILON*64)){
   const discs=m.map(v=>({c:v.c,r:Math.sqrt(Math.max(0,limit2-v.q))})),candidates:Vec[]=[[0,0]]
   // Projection of the least-squares mean onto a convex disc intersection is
   // either the mean, on one circle toward the mean, or at two circle boundaries.
   for(const {c,r}of discs){const d:Vec=[mean[0]-c[0],mean[1]-c[1]],l=Math.hypot(...d);candidates.push(c,l?[c[0]+d[0]*r/l,c[1]+d[1]*r/l]:c)}
   let possible=true
   for(let i=0;i<discs.length;i++)for(let j=i+1;j<discs.length;j++){
    const a=discs[i],b=discs[j],dx=b.c[0]-a.c[0],dy=b.c[1]-a.c[1],l=Math.hypot(dx,dy)
    if(l>a.r+b.r+1e-12){possible=false;continue}
    if(l===0||l<Math.abs(a.r-b.r)-1e-12||l>a.r+b.r+1e-12)continue
    const x=(a.r*a.r-b.r*b.r+l*l)/(2*l),h=Math.sqrt(Math.max(0,a.r*a.r-x*x)),cx=a.c[0]+dx*x/l,cy=a.c[1]+dy*x/l
    candidates.push([cx,cy],[cx-dy*h/l,cy+dx*h/l],[cx+dy*h/l,cy-dx*h/l])
   }
   if(possible){const near=candidates.filter(d=>value(d).every(q=>q<=limit2+Number.EPSILON*16));if(near.length)candidates.push(center(near));const choices=candidates.filter(legal).sort((a,b)=>square([a[0]-mean[0],a[1]-mean[1]])-square([b[0]-mean[0],b[1]-mean[1]])||a[0]-b[0]||a[1]-b[1]);if(choices.length){shift=choices[0];feasible=true}}
  }
  if(!feasible){const a=Math.max(...value(mean)),b=Math.max(...value([0,0]));if(a<b)shift=mean}
  const moved=tiles.map(t=>({...t,pose:{...t.pose,x:t.pose.x+shift[0],y:t.pose.y+shift[1]}})),after=moved.map(exactError)
  // Final admission uses the actual translated Poses and the original threshold.
  feasible=after.every(r=>r<=limit)
  const afterMaxRms=Math.max(...after),registration:TranslationRegistration={method:'shared-translation-disc-intersection-v1',translation:shift,feasible,beforeMaxRms:Math.max(...before),afterMaxRms,beforeLayoutRms:Math.sqrt(before.reduce((s,r)=>s+r*r,0)/before.length),afterLayoutRms:Math.sqrt(after.reduce((s,r)=>s+r*r,0)/after.length),limitingTileIds:m.filter((_,i)=>after[i]>limit||Math.abs(after[i]-afterMaxRms)<1e-12).map(v=>v.id)}
  return {tiles:moved,registration}
 }
 return {metric,error:exactError,register}
}

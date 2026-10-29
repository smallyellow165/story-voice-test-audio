import type { Profile, Vec } from '../geometry.ts'
import type { Observation } from './contracts.ts'
export type ProfileMatch = {profileId:string;profileVersion:number;rank:number;similarityScore:number;vertexDifference:number;outlineRms:number|null;edgeRatioRms:number|null;angleRmsDegrees:number|null;mirrored:boolean;explanation:string}
export type MatchResult = {status:'scored'|'invalid';reason:string;candidates:ProfileMatch[]}
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length
const rms=(a:number[])=>Math.sqrt(mean(a.map(x=>x*x)))
const length=(a:Vec,b:Vec)=>Math.hypot(a[0]-b[0],a[1]-b[1])
function normalize(v:Vec[]):Vec[]{const x=mean(v.map(p=>p[0])),y=mean(v.map(p=>p[1])),s=Math.sqrt(mean(v.map(p=>(p[0]-x)**2+(p[1]-y)**2)));return v.map(p=>[(p[0]-x)/s,(p[1]-y)/s])}
function features(v:Vec[]){const sides=v.map((p,i)=>length(p,v[(i+1)%v.length])),scale=mean(sides);return {sides:sides.map(x=>x/scale),angles:v.map((p,i)=>{const a=v[(i+v.length-1)%v.length],b=v[(i+1)%v.length];return Math.acos(Math.max(-1,Math.min(1,((a[0]-p[0])*(b[0]-p[0])+(a[1]-p[1])*(b[1]-p[1]))/(length(a,p)*length(b,p)))))*180/Math.PI})}}
// Visual comparison only. No geometry.ts EPS or Assembly validation is changed.
// Each error has an explicit half-score reference: 10% RMS radius, 10% mean-edge
// ratio, or 10 degrees. The worst metric determines score (no weighted average).
export function matchOutline(outline:readonly Vec[],width:number,height:number,profiles:readonly Profile[]):MatchResult{
 const invalid=(reason:string):MatchResult=>({status:'invalid',reason,candidates:[]})
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||outline.length<3||outline.length>16||outline.some(p=>p.length!==2||p.some(x=>!Number.isFinite(x)||x<0||x>1)))return invalid('缺少有效图片尺寸或完整轮廓坐标')
 const raw=outline.map(([x,y]):Vec=>[x*width,-y*height]),radius=Math.sqrt(mean(raw.map(p=>(p[0]-mean(raw.map(v=>v[0])))**2+(p[1]-mean(raw.map(v=>v[1])))**2)))
 if(radius===0)return invalid('轮廓退化为点')
 const a=normalize(raw),n=a.length
 if(a.some((p,i)=>length(p,a[(i+1)%n])<.02))return invalid('存在重复或过近角点，无法可靠评分')
 // Require a strictly convex cyclic perimeter, not only consistent local turns.
 const crosses=a.flatMap((p,i)=>a.filter((_,j)=>j!==i&&j!==(i+1)%n).map(q=>{const b=a[(i+1)%n];return (b[0]-p[0])*(q[1]-p[1])-(b[1]-p[1])*(q[0]-p[0])}))
 if(!(crosses.every(x=>x>1e-6)||crosses.every(x=>x< -1e-6)))return invalid('轮廓非严格凸、角点次序错误或已退化；请先修正轮廓')
 const af=features(a)
 if(Math.min(...af.angles)<3)return invalid('轮廓过于退化，最小角不足 3°，无法可靠评分')
 const candidates=profiles.map(p=>{
  const base={profileId:p.id,profileVersion:p.version,rank:0,vertexDifference:Math.abs(n-p.vertices.length)}
  if(n!==p.vertices.length)return {...base,similarityScore:0,outlineRms:null,edgeRatioRms:null,angleRmsDegrees:null,mirrored:false,explanation:`顶点数 ${n} ≠ ${p.vertices.length}，V1 不自动删角或补角`}
  let best:ProfileMatch|undefined
  const original=normalize(p.vertices)
  for(const mirrored of [false,true])for(const reversed of [false,true])for(let start=0;start<n;start++){
   const v=original.map(([x,y]):Vec=>[mirrored?-x:x,y]),order=reversed?[...v].reverse():v,b=order.map((_,i)=>order[(start+i)%n])
   const dot=mean(a.map((q,i)=>b[i][0]*q[0]+b[i][1]*q[1])),cross=mean(a.map((q,i)=>b[i][0]*q[1]-b[i][1]*q[0])),angle=Math.atan2(cross,dot),c=Math.cos(angle),s=Math.sin(angle)
   const outlineRms=rms(a.map((q,i)=>length(q,[b[i][0]*c-b[i][1]*s,b[i][0]*s+b[i][1]*c]))),bf=features(b)
   const edgeRatioRms=rms(af.sides.map((x,i)=>x-bf.sides[i])),angleRmsDegrees=rms(af.angles.map((x,i)=>x-bf.angles[i]))
   const error=Math.max(outlineRms/.1,edgeRatioRms/.1,angleRmsDegrees/10),similarityScore=error<1e-10?100:100*2**(-error*error)
   const candidate={...base,similarityScore,outlineRms,edgeRatioRms,angleRmsDegrees,mirrored,explanation:similarityScore>=80?'轮廓高度相似；仍需核实尺寸与证据':similarityScore>=50?'存在可见几何偏差，请检查比例与角度':'几何差异明显，不建议仅凭此轮廓应用'}
   if(!best||candidate.similarityScore>best.similarityScore)best=candidate
  }
  return best!
 }).sort((a,b)=>b.similarityScore-a.similarityScore||a.profileId.localeCompare(b.profileId)||a.profileVersion-b.profileVersion).map((c,i)=>({...c,rank:i+1}))
 return {status:'scored',reason:'仅比较当前轮廓的形状；统一尺度归一化不验证实物尺寸、遮挡真实性或整幅重建。',candidates}
}
export function needsOutlineConfirmation(o:Observation){return !!o.uncertainty.trim()||o.confidence<.7}

export const outlineEvidenceKey=(o:Observation,sourceId:string)=>JSON.stringify([sourceId,o.id,o.outline,o.confidence,o.uncertainty,o.evidence])

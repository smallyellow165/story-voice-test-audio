import {adaptProfile} from './profile-adapter.ts'
import type {ProfileSnapshot3D} from './profile-adapter.ts'
import type {Connection} from './vendor/engine/types.ts'
import type {ConnectionHypothesis3D} from './reconstruction/contracts.ts'

// Coordinate correspondence accuracy only. Not a Solver / Validator tolerance.
const EPS=1e-7
export const portMappingLimits=Object.freeze({maxStates:256,maxResults:8})
export type LocalPortMapping={id:string;matrix:[number,number,number,number];normalSign:1|-1;ports:Record<string,{portId:string;reversed:boolean}>}
export type AngleDomain={angles:number[];angleRange:{min:number;max:number}|null}
export type PortMappingAnchor={id:string;historical:ConnectionHypothesis3D;current:Connection;domain:AngleDomain}
export type PortMappingResult={status:'mapped'|'ambiguous'|'unavailable'|'budget-exhausted';pairs:{a:LocalPortMapping;b:LocalPortMapping}[];anchors:string[];states:number;reason:string}
const wrap=(n:number)=>{const x=((n+180)%360+360)%360-180;return Math.abs(x)<1e-10?0:x}
const point=(p:{x:number;y:number},m:LocalPortMapping['matrix'])=>({x:m[0]*p.x+m[1]*p.y,y:m[2]*p.x+m[3]*p.y})
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)
/** A centroid-relative planar isometry extended to a proper 3D rotation by
 * z' = det(M) z. Symmetric extrusion and every actual Port segment must match.
 * Neither names nor edge/Port indices are geometric correspondence evidence. */
export function profilePortMappings(historical:ProfileSnapshot3D,current:ProfileSnapshot3D):LocalPortMapping[]{
 const a=adaptProfile(historical).shape,b=adaptProfile(current).shape,tol=EPS*Math.max(a.defaultSize,b.defaultSize),out:LocalPortMapping[]=[]
 if(Math.abs(a.thickness-b.thickness)>tol||a.vertices.length!==b.vertices.length||a.ports.length!==b.ports.length)return []
 const start=a.vertices[0],end=a.vertices[1],length=distance(start,end),u={x:(end.x-start.x)/length,y:(end.y-start.y)/length}
 for(let i=0;i<b.vertices.length;i++)for(const sign of [1,-1] as const){
  const p=b.vertices[i],q=b.vertices[(i+sign+b.vertices.length)%b.vertices.length],len=distance(p,q)
  if(Math.abs(len-length)>tol)continue
  const v={x:(q.x-p.x)/len,y:(q.y-p.y)/len},matrix:LocalPortMapping['matrix']=[v.x*u.x+sign*v.y*u.y,v.x*u.y-sign*v.y*u.x,v.y*u.x-sign*v.x*u.y,v.y*u.y+sign*v.x*u.x]
  const matches=a.vertices.map(p=>b.vertices.map((q,i)=>distance(point(p,matrix),q)<=tol?i:-1).filter(i=>i>=0))
  if(matches.some(m=>m.length!==1)||new Set(matches.flat()).size!==b.vertices.length)continue
  const ports:LocalPortMapping['ports']={},used=new Set<string>()
  for(const p of a.ports){
   const p0=point(p.p0,matrix),p1=point(p.p1,matrix),found=b.ports.flatMap(q=>{
    if(Math.abs(p.length-q.length)>tol)return []
    return [...(distance(p0,q.p0)<=tol&&distance(p1,q.p1)<=tol?[{portId:q.portId,reversed:false}]:[]),...(distance(p0,q.p1)<=tol&&distance(p1,q.p0)<=tol?[{portId:q.portId,reversed:true}]:[])]
   })
   if(found.length!==1||used.has(found[0].portId))break
   ports[p.portId]=found[0];used.add(found[0].portId)
  }
  if(used.size!==b.ports.length)continue
  if(out.some(m=>m.matrix.every((v,i)=>Math.abs(v-matrix[i])<EPS)))continue
  out.push({id:`frame-${out.length+1}`,matrix,normalSign:sign,ports})
 }
 return out
}
function intervals(d:AngleDomain){return d.angleRange?[d.angleRange]:d.angles.map(a=>({min:a,max:a}))}
/** Transform signed normal rotation about A's ORIGINAL directed Port axis.
 * If normals reverse on exactly one piece, the offset is 180 degrees. */
export function mappedAngleDomains(h:AngleDomain,a:{reversed:boolean;normalSign:number},b:{normalSign:number}):AngleDomain[]{
 if(!h.angles.length||h.angles.some(v=>!Number.isFinite(v)||Math.abs(v)>180)||h.angleRange&&(!Number.isFinite(h.angleRange.min)||!Number.isFinite(h.angleRange.max)||h.angleRange.min>h.angleRange.max||h.angleRange.min< -180||h.angleRange.max>180))return []
 const sign=a.reversed?-1:1,offset=a.normalSign*b.normalSign<0?180:0,angle=(n:number)=>wrap(sign*(n+offset))
 if(!h.angleRange)return [{angles:[...new Set(h.angles.map(angle))],angleRange:null}]
 const x=sign*(h.angleRange.min+offset),y=sign*(h.angleRange.max+offset),lo=Math.min(x,y),hi=Math.max(x,y),out:AngleDomain[]=[]
 // Intersect the unwrapped interval with [-180,180] shifted by full turns.
 for(let turn=-2;turn<=2;turn++){
  const min=Math.max(-180,lo-360*turn),max=Math.min(180,hi-360*turn);if(min>max+1e-10||max-min<=1e-10&&hi-lo>1e-10)continue // periodic boundary point is already in the adjacent nonzero interval
  const preferred=h.angles.flatMap(v=>[angle(v),angle(v)+360,angle(v)-360]).filter(v=>v>=min-1e-10&&v<=max+1e-10)
  // A split wrap interval can have its preferred angle in the other segment.
  // Its boundary remains in the original allowed domain, not an inferred angle.
  out.push({angles:[...new Set(preferred.length?preferred:[Math.abs(min)<Math.abs(max)?min:max])],angleRange:{min,max}})
 }
 return out
}
export function mapConnectionConvention(h:ConnectionHypothesis3D,a:LocalPortMapping,b:LocalPortMapping):ConnectionHypothesis3D[]{
 const pa=h.portA&&a.ports[h.portA],pb=h.portB&&b.ports[h.portB]
 if(!pa||!pb||typeof h.flip!=='boolean')return []
 const flip=Boolean(Number(h.flip)^Number(pa.reversed)^Number(pb.reversed))
 return mappedAngleDomains(h,{...pa,normalSign:a.normalSign},b).map(d=>({...h,...d,portA:pa.portId,portB:pb.portId,flip}))
}
function overlap(a:AngleDomain,b:AngleDomain){return intervals(a).some(x=>intervals(b).some(y=>[-360,0,360].some(t=>Math.max(x.min,y.min+t)<=Math.min(x.max,y.max+t)+EPS)))}
/** Finite frame correspondence constraints, NOT a geometric Pose solver.
 * Every emitted pair extends to a consistent assignment of all linked anchors.
 * Unknown/ambiguous frames never fall back to unchanged historical Port names. */
export function anchoredPortMappings(domains:Map<string,LocalPortMapping[]>,anchors:PortMappingAnchor[],pieceA:string,pieceB:string):PortMappingResult{
 const result:PortMappingResult={status:'unavailable',pairs:[],anchors:[],states:0,reason:''},relevant=new Set([pieceA,pieceB])
 for(let changed=true;changed;){changed=false;for(const h of anchors)if(relevant.has(h.current.pieceA)||relevant.has(h.current.pieceB))for(const id of [h.current.pieceA,h.current.pieceB])if(!relevant.has(id)){relevant.add(id);changed=true}}
 const linked=anchors.filter(h=>relevant.has(h.current.pieceA)&&relevant.has(h.current.pieceB));result.anchors=linked.map(a=>a.id)
 if([pieceA,pieceB].some(id=>!linked.some(h=>[h.current.pieceA,h.current.pieceB].includes(id)))){result.reason='缺少两端实例的已有连接锚点，无法验证历史局部坐标；未沿用历史编号';return result}
 const choices=new Map([...relevant].map(id=>[id,[...(domains.get(id)??[])]]))
 if(linked.some(h=>h.historical.pieceA!==h.current.pieceA||h.historical.pieceB!==h.current.pieceB)){result.reason='锚点实例身份或声明方向未归一化，无法映射';return result}
 for(const anchor of linked){
  const h=anchor.historical,c=anchor.current
  for(const [id,port,expected] of [[h.pieceA,h.portA,c.portA],[h.pieceB,h.portB,c.portB]] as const)choices.set(id,choices.get(id)!.filter(m=>port!==null&&m.ports[port]?.portId===expected))
 }
 const compatible=(h:PortMappingAnchor,a:LocalPortMapping,b:LocalPortMapping)=>mapConnectionConvention(h.historical,a,b).some(c=>c.flip===(h.current.flip??false)&&overlap(c,h.domain))
 // Arc consistency removes impossible frame conventions before bounded DFS.
 for(let changed=true;changed;){changed=false;for(const h of linked)for(const side of [true,false]){
  const id=side?h.historical.pieceA:h.historical.pieceB,other=side?h.historical.pieceB:h.historical.pieceA,old=choices.get(id)!,next=old.filter(a=>choices.get(other)!.some(b=>side?compatible(h,a,b):compatible(h,b,a)))
  if(next.length!==old.length){choices.set(id,next);changed=true}
 }}
 if([...choices.values()].some(v=>!v.length)){result.reason='Profile 几何、Port 分段或锚点的端点 / 法向 / 角度约定不兼容';return result}
 let truncated=false
 const assigned=new Map<string,LocalPortMapping>(),seen=new Set<string>()
 const visit=():boolean=>{
  if(result.states>=portMappingLimits.maxStates||result.pairs.length>=portMappingLimits.maxResults){truncated=true;return false}result.states++
  if(assigned.size===choices.size){const a=assigned.get(pieceA)!,b=assigned.get(pieceB)!,key=a.id+'|'+b.id;if(!seen.has(key)){seen.add(key);result.pairs.push({a,b})}return true}
  const id=[...choices.keys()].filter(id=>!assigned.has(id)).sort((a,b)=>Number(![pieceA,pieceB].includes(a))-Number(![pieceA,pieceB].includes(b))||choices.get(a)!.length-choices.get(b)!.length||a.localeCompare(b))[0]
  let found=false
  for(const m of choices.get(id)!){assigned.set(id,m);if(linked.every(h=>!assigned.has(h.historical.pieceA)||!assigned.has(h.historical.pieceB)||compatible(h,assigned.get(h.historical.pieceA)!,assigned.get(h.historical.pieceB)!))){const ok=visit();found=ok||found
    // Once A/B are fixed, one satisfying completion suffices for that pair.
    if(ok&&assigned.has(pieceA)&&assigned.has(pieceB)&&id!==pieceA&&id!==pieceB){assigned.delete(id);return true}
   }assigned.delete(id);if(truncated)break}
  return found
 }
 visit();result.status=truncated?'budget-exhausted':result.pairs.length>1?'ambiguous':result.pairs.length?'mapped':'unavailable'
 result.reason=truncated?'局部坐标映射达到有限枚举上限，仅保留已由全部锚点验证的候选':result.pairs.length>1?'锚点允许多个几何等价映射；候选分别验证，未猜定唯一编号':result.pairs.length?'历史局部坐标已通过完整几何与连接锚点校验':'历史局部坐标锚点相互冲突，无法可靠映射'
 return result
}

import {fitConnectedPair} from './connection-fit.ts'
import {alignEdge,distance,edges,matched,validate,vertices,segmentAlignments,edgeContact,opposingEdges} from '../geometry.ts'
import type {Profile,Tile,Vec} from '../geometry.ts'
import type {Reconstruction} from './contracts.ts'
const variants=<T,>(v:T[])=>[v,[...v].reverse()].flatMap(a=>a.map((_,i)=>[...a.slice(i),...a.slice(0,i)]))
const center=(v:Vec[]):Vec=>[v.reduce((n,a)=>n+a[0],0)/v.length,v.reduce((n,a)=>n+a[1],0)/v.length]
export function contourResidual(tile:Tile,target:Vec[],catalog:readonly Profile[]){
 const world=vertices(tile,catalog)
 let best:ReturnType<typeof result>|undefined
 function result(order:{point:Vec;index:number}[]){const pairs=world.map((point,i)=>({profileVertex:i,observationVertex:order[i].index,world:point,observed:order[i].point,delta:[point[0]-order[i].point[0],point[1]-order[i].point[1]],distance:distance(point,order[i].point)}));return {rms:Math.sqrt(pairs.reduce((n,p)=>n+p.distance**2,0)/pairs.length),pairs}}
 for(const order of variants(target.map((point,index)=>({point,index})))){const r=result(order);if(!best||r.rms<best.rms)best=r}
 return best!
}
export function independentFit(tile:Tile,target:Vec[],catalog:readonly Profile[],mirrored:boolean){
 const profile=catalog.find(p=>p.id===tile.profileId&&p.version===tile.profileVersion)!,local=profile.vertices.map(([x,y]):Vec=>[mirrored?-x:x,y]),lc=center(local)
 let best:{tile:Tile;residual:ReturnType<typeof contourResidual>}|undefined
 for(const order of variants(target)){const tc=center(order);let dot=0,cross=0;local.forEach(([x,y],i)=>{const u=order[i][0]-tc[0],v=order[i][1]-tc[1];dot+=(x-lc[0])*u+(y-lc[1])*v;cross+=(x-lc[0])*v-(y-lc[1])*u});const angleRad=Math.atan2(cross,dot),c=Math.cos(angleRad),s=Math.sin(angleRad),t={...tile,pose:{x:tc[0]-c*lc[0]+s*lc[1],y:tc[1]-s*lc[0]-c*lc[1],angleRad,...(mirrored?{mirrored:true}:{})}},residual=contourResidual(t,target,catalog);if(!best||residual.rms<best.residual.rms)best={tile:t,residual}}
 return best!
}
// Counterfactual inspection of ONE frozen attempt. Never inserted into Diagnostic Top 10.
export function alignmentInspection(record:Reconstruction,diagnosticId:string){
 const diagnostic=record.diagnosticCandidates?.find(d=>d.id===diagnosticId),trace=record.trace,connection=diagnostic?.attemptedConnection,scale=trace?.planning.scalePixelsPerUnit
 if(!diagnostic||!trace||!connection||!scale)return {available:false as const,reason:'缺少已保存的尝试 Pose、边引用或执行尺度；不能构造对齐对比。'}
 const catalog=trace.input.profiles,from=diagnostic.tiles.find(t=>t.id===connection.from)!,to=diagnostic.tiles.find(t=>t.id===connection.to)!,input=trace.input.evidence
 const image=(id:string):Vec[]=>input.observations.find(o=>o.id===id)!.outline.map(([x,y])=>[x*trace.input.width/scale,-y*trace.input.height/scale])
 if(!from||!to||[from,to].some(t=>!catalog.some(p=>p.id===t.profileId&&p.version===t.profileVersion)||input.observations.find(o=>o.id===t.id)?.outline.length!==catalog.find(p=>p.id===t.profileId&&p.version===t.profileVersion)?.vertices.length))return {available:false as const,reason:'已保存尝试缺少对应零件、Profile 或完整顶点数据。'}
 const observedFrom=image(from.id),observedTo=image(to.id),own=edges(from,catalog).find(e=>e.id===connection.ownEdgeId)!,edge=edges(to,catalog).find(e=>e.id===connection.targetEdgeId)!
 const observedLengths=observedFrom.map((p,i)=>distance(p,observedFrom[(i+1)%observedFrom.length]))
 const actual={kind:'saved-attempt',tile:from,target:to,connection,edges:{own,target:edge,opposed:opposingEdges(own,edge),wholeEdgeMatched:matched(own,edge),contact:edgeContact(own,edge),endpointErrors:[distance(own.a,edge.b),distance(own.b,edge.a)],directions:[Math.atan2(own.b[1]-own.a[1],own.b[0]-own.a[0]),Math.atan2(edge.b[1]-edge.a[1],edge.b[0]-edge.a[0])]},residual:contourResidual(from,observedFrom,catalog),targetResidual:contourResidual(to,observedTo,catalog),pairValidator:validate([from,to],catalog),contextValidator:validate(diagnostic.tiles,catalog)}
 const alternatives=[]
 for(const mirrored of [false,true]){const raw={...from,pose:{...from.pose,mirrored}};for(const a of edges(raw,catalog))for(const b of edges(to,catalog)){
  if(!a.enabled||!b.enabled||Math.abs(a.length-b.length)>trace.search.parameters.eps)continue
  const tile=alignEdge(raw,a,b,catalog),residual=contourResidual(tile,observedFrom,catalog),tiles=diagnostic.tiles.map(t=>t.id===from.id?tile:t),pairValidator=validate([tile,to],catalog),contextValidator=validate(tiles,catalog)
  alternatives.push({id:`${mirrored?'mirror':'rigid'}-${a.id}-${b.id}`,kind:'computed-what-if',mirrored,tile,ownEdgeId:a.id,targetEdgeId:b.id,opposed:matched(edges(tile,catalog).find(e=>e.id===a.id)!,b),residual,pairValidator,contextValidator,withinRms:residual.rms<=trace.search.parameters.maxOutlineRms,adoptable:false as const})
 }}
 if(trace.search.parameters.connectionModel==='segmented-edge-v1')for(const mirrored of [false,true]){
  const raw={...from,pose:{...from.pose,mirrored}}
  for(const a of edges(raw,catalog))for(const b of edges(to,catalog))for(const [i,p] of segmentAlignments(raw,a,b,catalog,observedFrom,diagnostic.tiles.flatMap(t=>vertices(t,catalog))).entries()){
   const tile=p.tile,residual=contourResidual(tile,observedFrom,catalog),tiles=diagnostic.tiles.map(t=>t.id===from.id?tile:t)
   alternatives.push({id:`segment-${mirrored?'mirror':'rigid'}-${a.id}-${b.id}-${i}`,kind:'computed-what-if',mirrored,tile,ownEdgeId:a.id,targetEdgeId:b.id,opposed:true,residual,pairValidator:validate([tile,to],catalog),contextValidator:validate(tiles,catalog),withinRms:residual.rms<=trace.search.parameters.maxOutlineRms,adoptable:false as const})
  }
 }
 const freePair=record.mode==='flat-mosaic'?{provenance:'computed-free-pair-relaxation',adoptable:false,fittedCorrespondences:0,poses:[]}:fitConnectedPair(from,to,observedFrom,observedTo,catalog,trace.search.parameters.mirroring)
 alternatives.sort((a,b)=>a.residual.rms-b.residual.rms||a.id.localeCompare(b.id))
 return {available:true as const,version:'edge-alignment-inspection-v1',provenance:'computed inspection of a frozen search attempt; alternatives were NOT historical search attempts',references:{...trace.references,reconstructionId:record.id,reconstructionHash:record.hash,diagnosticId,attemptIndex:diagnostic.attemptIndex,stateIndex:diagnostic.stateIndex},frame:'standard units; image top-left origin; +x right/+y up; reflect local X before rotating',savedSearchMirroring:trace.search.parameters.mirroring,scalePixelsPerUnit:scale,threshold:trace.search.parameters.maxOutlineRms,observed:{fromId:from.id,toId:to.id,from:observedFrom,to:observedTo,fromEdgeLengths:observedLengths},catalog,actual,freePair,independent:{rigid:independentFit(from,observedFrom,catalog,false),mirrored:independentFit(from,observedFrom,catalog,true)},alternatives}
}

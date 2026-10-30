import {edges,EPS,validate} from '../geometry.ts'
import type {Profile,Tile,Vec} from '../geometry.ts'
import type {Evidence} from './contracts.ts'
import {fitConnectedPair} from './connection-fit.ts'

// Read-only, bounded diagnostics after a failed Connected search. A graph of pairs
// NOT ruled out by a necessary condition; an included edge does not assert validity.
// No change to candidate domains, thresholds, ordering, budgets, or Flat Mosaic.
export function connectivityAudit(evidence:Evidence,width:number,height:number,profiles:readonly Profile[],seeds:{tile:Tile;rms:number}[],scale:number,threshold:number,mirroring:boolean){
 const image=(id:string):Vec[]=>evidence.observations.find(o=>o.id===id)!.outline.map(([x,y])=>[x*width/scale,-y*height/scale])
 const pairs:{from:string;to:string;connectionOptions:number;fittedCorrespondences:number;lowerBound:number;excluded:boolean;best:ReturnType<typeof fitConnectedPair>['poses'][number]}[]=[];let fittedCorrespondences=0
 for(let i=0;i<seeds.length;i++)for(let j=i+1;j<seeds.length;j++){
  const a=seeds[i].tile,b=seeds[j].tile
  if(!edges(a,profiles).some(x=>x.enabled&&edges(b,profiles).some(y=>y.enabled&&Math.abs(x.length-y.length)<=EPS)))continue
  const fit=fitConnectedPair(a,b,image(a.id),image(b.id),profiles,mirroring),best=fit.poses[0]
  fittedCorrespondences+=fit.fittedCorrespondences
  pairs.push({from:a.id,to:b.id,connectionOptions:fit.poses.length,fittedCorrespondences:fit.fittedCorrespondences,lowerBound:best.jointRms,excluded:best.jointRms>threshold+10*EPS,best})
 }
 const parts=seeds.map(({tile})=>{const matches=pairs.filter(p=>p.from===tile.id||p.to===tile.id),other=(p:typeof pairs[number])=>p.from===tile.id?p.to:p.from
  return {id:tile.id,edgeLengths:edges(tile,profiles).filter(e=>e.enabled).map(e=>({id:e.id,length:e.length})),equalLengthNeighborIds:matches.map(other),notRuledOutNeighborIds:matches.filter(p=>!p.excluded).map(other),bounds:matches.map(p=>({other:other(p),lowerBound:p.lowerBound,excluded:p.excluded,connectionOptions:p.connectionOptions,fittedCorrespondences:p.fittedCorrespondences}))}
 })
 const unseen=new Set(parts.map(p=>p.id)),components:string[][]=[]
 while(unseen.size){const ids=[unseen.values().next().value!];unseen.delete(ids[0]);for(const id of ids)for(const neighbor of parts.find(p=>p.id===id)!.notRuledOutNeighborIds)if(unseen.delete(neighbor))ids.push(neighbor);components.push(ids.sort())}
 const isolatedIds=parts.filter(p=>!p.notRuledOutNeighborIds.length&&parts.length>1).map(p=>p.id)
 return {version:'outline-connectivity-audit-v1',provenance:'deterministic-computation-from-execution-input',persistedBy:'reconstruction-trace',adoptable:false,method:'All enabled equal-length edge pairs and distinct mirror domains; all cyclic/reversed correspondences; exact free 2D pair Procrustes. Joint RMS is a necessary lower bound; not-ruled-out is NOT a feasible connection. Disconnected relaxed graph proves incompatible Connected input at this fixed scale.',frame:'same image/world frame and scale as execution; no other tile is fixed in pair fitting',threshold,numericalSlack:10*EPS,scalePixelsPerUnit:scale,mirroring,statistics:{equalLengthPairs:pairs.length,fittedCorrespondences},parts,relaxedComponents:components,isolatedIds,incompatible:components.length>1,
  // Cap geometric witnesses independently from the existing true-search Top 10.
  witnesses:pairs.filter(p=>isolatedIds.includes(p.from)||isolatedIds.includes(p.to)).sort((a,b)=>a.lowerBound-b.lowerBound||a.from.localeCompare(b.from)||a.to.localeCompare(b.to)).slice(0,10),
  independentLayout:{provenance:'independent-contour-fits-not-a-search-attempt',tiles:seeds.map(s=>s.tile),perPieceRms:seeds.map(s=>({id:s.tile.id,rms:s.rms})),validator:validate(seeds.map(s=>s.tile),profiles)}}
}

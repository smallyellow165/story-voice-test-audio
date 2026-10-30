import { vertices } from '../geometry.ts'
import type { Profile, Tile, Report, WorkMode } from '../geometry.ts'
import type { Evidence, Relation } from './contracts.ts'
import { matchOutline } from './profile-match.ts'
import { estimateRelativeScale, matchRelativeProfiles } from './relative-size.ts'

export function spatialEvidence(evidence:Evidence,width:number,height:number,profiles:readonly Profile[]){
 const centers=new Map(evidence.observations.map(o=>[o.id,[o.outline.reduce((n,v)=>n+v[0]*width,0)/o.outline.length,o.outline.reduce((n,v)=>n+v[1]*height,0)/o.outline.length]]))
 return {kind:'deterministic-review-input' as const,modelGenerated:false,
  note:'没有独立 Spatial Planning 模型或编辑器。位置与边方向由 Review 轮廓确定性推导；关系是 Review 意图，不是已验证连接。',
  imageFrame:'pixels: +x right, +y down; arithmetic vertex centroids, not measured physical centers',
  executionFrame:'standard square edge=1; +x right, +y up; pixel coordinates divided by execution scale',
  mirrorSupport:'Shape Matching tests reflected hypotheses; Geometry Execution Pose supports translation/rotation only, no flip domain',
  observations:evidence.observations.map(o=>{
   const p=profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion)
   const scale=estimateRelativeScale(evidence.observations,o.id,width,height,profiles)
   return {id:o.id,profileId:o.profileId,profileVersion:o.profileVersion,excluded:o.excluded,origin:o.origin,evidence:o.evidence,uncertainty:o.uncertainty,
    centroidPixels:centers.get(o.id),edgeDirectionsRadians:o.outline.map(([x,y],i)=>{const b=o.outline[(i+1)%o.outline.length];return Math.atan2(-(b[1]-y)*height,(b[0]-x)*width)}),
    mirrorHypothesis:p?matchOutline(o.outline,width,height,[p]).candidates[0]??null:null,
    matching:matchRelativeProfiles(o,width,height,profiles,scale)}
  }),
  matchingScope:'Recomputed from this evidence and saved confidence; transient human scale-reference confirmations are not saved in Review and are not assumed here',
  relations:evidence.relations.map(r=>{const a=centers.get(r.from)!,b=centers.get(r.to)!;return {...r,deltaPixels:[b[0]-a[0],b[1]-a[1]],source:'review-relation',verifiedConnection:false}})}
}
export type AttemptedConnection={from:string;ownEdgeId:string;to:string;targetEdgeId:string;intent:Relation['intent']|null}
export type FailedAttempt={tiles:Tile[];phase:'edge-alignment'|'component-combination';failureStage:'outline'|'geometry'|'relation';reason:string;attemptIndex:number;stateIndex:number;attemptedConnection?:AttemptedConnection;attemptedTileRms:number|null;solverValidator?:Report;domainBlocked?:boolean}
export type DiagnosticCandidate=Omit<FailedAttempt,'solverValidator'>&{id:string;rank:number;kind:'diagnostic';provenance:'observed-search-attempt';layout:'partial'|'complete';placedIds:string[];unplacedIds:string[];layoutRms:number;perPieceRms:{id:string;rms:number}[];validator:{checkedBy:'search'|'diagnostic-recheck';report:Report};relations:(Relation&{connected:boolean|null})[]}
export type ExecutionTrace={schemaVersion:1;phase:'admission'|'fitting'|'search';input:{evidence:Evidence;width:number;height:number;profiles:readonly Profile[];mode:WorkMode};references?:{sourceId:string;sourceHash:string;analysisId:string;analysisHash:string;reviewId:string;reviewHash:string;profileHash:string;reconstructionId:string};planning:ReturnType<typeof spatialEvidence>&{scalePixelsPerUnit?:number;fittedSeeds?:{tile:Tile;rms:number}[];searchGroups?:string[][]};search:{parameters:{stateLimit:number;trialLimit:number;maxOutlineRms:number;eps:number;maxSolutionsPerGroup:number;maxCandidates:number;anchorDistanceLimit:number;mirroring:false};ranking:string;stats?:{explored:number;trials:number;truncated:boolean;rejected:{outline:number;geometry:number;relation:number};recordedFailures:number}}}

// Bounded online capture only. Geometry keys collapse symmetric or repeated placements.
// One best representative per pair/stage is shown before alternative placements.
export function diagnosticCollector(profiles:readonly Profile[]){
 const kept=new Map<string,FailedAttempt>(),limit=10
 let recordedFailures=0
 const key=(a:FailedAttempt)=>a.tiles.map(t=>t.id+':'+vertices(t,profiles).map(([x,y])=>x.toFixed(7)+','+y.toFixed(7)).sort().join(';')).sort().join('|')
 const bucket=(a:FailedAttempt)=>a.failureStage+':'+(a.attemptedConnection?[a.attemptedConnection.from,a.attemptedConnection.to].sort().join('/'):a.phase)
 const compare=(a:FailedAttempt,b:FailedAttempt)=>Number(!!b.domainBlocked)-Number(!!a.domainBlocked)||b.tiles.length-a.tiles.length||(a.attemptedTileRms??Infinity)-(b.attemptedTileRms??Infinity)||a.attemptIndex-b.attemptIndex||key(a).localeCompare(key(b))
 function ranked(){const sorted=[...kept.entries()].sort((a,b)=>compare(a[1],b[1])),seen=new Set<string>(),first:typeof sorted=[],rest:typeof sorted=[];for(const pair of sorted){const group=bucket(pair[1]);if(seen.has(group))rest.push(pair);else{seen.add(group);first.push(pair)}}return [...first,...rest]}
 return {offer(a:FailedAttempt){if(!a.domainBlocked)recordedFailures++;const k=key(a),old=kept.get(k);if(!old||compare(a,old)<0)kept.set(k,a);for(const [drop] of ranked().slice(limit))kept.delete(drop)},get count(){return recordedFailures},
  finish(ids:string[],relations:Relation[],error:(t:Tile)=>number,validate:(tiles:Tile[])=>Report):DiagnosticCandidate[]{
   return ranked().map(([,a],i)=>{const report=a.solverValidator??validate(a.tiles),placedIds=a.tiles.map(t=>t.id),perPieceRms=a.tiles.map(t=>({id:t.id,rms:error(t)}));const {solverValidator:_,...data}=a
    return {...structuredClone(data),id:'diagnostic-'+(i+1),rank:i+1,kind:'diagnostic',provenance:'observed-search-attempt',layout:placedIds.length===ids.length?'complete':'partial',placedIds,unplacedIds:ids.filter(id=>!placedIds.includes(id)),layoutRms:Math.sqrt(perPieceRms.reduce((n,e)=>n+e.rms**2,0)/perPieceRms.length),perPieceRms,
     validator:{checkedBy:a.solverValidator?'search':'diagnostic-recheck',report},relations:relations.map(r=>({...r,connected:placedIds.includes(r.from)&&placedIds.includes(r.to)?report.connections.some(c=>[c.a.tileId,c.b.tileId].includes(r.from)&&[c.a.tileId,c.b.tileId].includes(r.to)):null}))}
   })
  }}
}

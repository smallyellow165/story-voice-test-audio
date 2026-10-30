import {connectionModel,connectionSegment,edgeContact,edges,EPS,opposingEdges,validate,vertices} from '../geometry.ts'
import type {Profile,Tile,Vec} from '../geometry.ts'
import type {Reconstruction} from './contracts.ts'
import {intersectionPolygon,polygonArea} from './segment-audit.ts'
import {canonical} from '../build-plan.ts'

const pairKey=(ids:string[])=>[...ids].sort().join('/')
const at=(a:Vec,b:Vec,t:number):Vec=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]

// This function deliberately has NO Review/observation input. All geometry drawn
// by the full Candidate Viewer is derived only from these actual tiles/profiles.
export function inspectLayoutConflicts(tiles:readonly Tile[],profiles:readonly Profile[]){
 const report=validate(tiles,profiles)
 const structural=report.issues.filter(i=>!['OVERLAP','EDGE_OCCUPIED','EDGE_CONTACT','DISCONNECTED'].includes(i.code))
 if(structural.length)return {report,overlaps:[],occupancy:[],edgeContacts:[],byPair:[],structuralIssues:structural}
 const overlaps=report.issues.filter(i=>i.code==='OVERLAP').map((i,index)=>{
  const polygon=intersectionPolygon(vertices(tiles.find(t=>t.id===i.tileIds[0])!,profiles),vertices(tiles.find(t=>t.id===i.tileIds[1])!,profiles))
  return {id:'overlap-'+index,code:'OVERLAP',tileIds:i.tileIds,area:polygonArea(polygon),polygon,areaUnit:'standard-square-units',bounds:{min:polygon.reduce((v,p):Vec=>[Math.min(v[0],p[0]),Math.min(v[1],p[1])],[Infinity,Infinity]),max:polygon.reduce((v,p):Vec=>[Math.max(v[0],p[0]),Math.max(v[1],p[1])],[-Infinity,-Infinity])}}
 })
 type Occupant={other:{tileId:string;edgeId:string};range:Vec}
 const occupied=new Map<string,{edge:ReturnType<typeof edges>[number];owners:Occupant[]}>()
 for(const c of report.connections){
  const contact=connectionSegment(c,tiles,profiles)
  for(const [own,other,range] of [[c.a,c.b,contact.aRange],[c.b,c.a,contact.bRange]] as const){
   const key=own.tileId+'.'+own.edgeId,entry=occupied.get(key)??{edge:edges(tiles.find(t=>t.id===own.tileId)!,profiles).find(e=>e.id===own.edgeId)!,owners:[]}
   entry.owners.push({other,range});occupied.set(key,entry)
  }
 }
 const occupancy=[]
 for(const {edge,owners} of occupied.values())for(let i=0;i<owners.length;i++)for(let j=i+1;j<owners.length;j++){
  const range:Vec=[Math.max(owners[i].range[0],owners[j].range[0]),Math.min(owners[i].range[1],owners[j].range[1])],length=(range[1]-range[0])*edge.length
  if(length<=EPS)continue // Identical EPS as Validator interval occupancy, including endpoint-only joins.
  occupancy.push({id:'occupied-'+occupancy.length,code:'EDGE_OCCUPIED',tileIds:[...new Set([edge.tileId,owners[i].other.tileId,owners[j].other.tileId])],sharedEdge:{tileId:edge.tileId,edgeId:edge.id},range,length,start:at(edge.a,edge.b,range[0]),end:at(edge.a,edge.b,range[1]),owners:[owners[i],owners[j]]})
 }
 const edgeContacts=[]
 for(const issue of report.issues.filter(i=>i.code==='EDGE_CONTACT')){
  for(const a of edges(tiles.find(t=>t.id===issue.tileIds[0])!,profiles))for(const b of edges(tiles.find(t=>t.id===issue.tileIds[1])!,profiles)){
   const contact=edgeContact(a,b)
   if(!contact||a.enabled&&b.enabled&&opposingEdges(a,b))continue
   edgeContacts.push({id:'edge-contact-'+edgeContacts.length,code:'EDGE_CONTACT',tileIds:issue.tileIds,a:{tileId:a.tileId,edgeId:a.id,enabled:a.enabled},b:{tileId:b.tileId,edgeId:b.id,enabled:b.enabled},contact,opposing:opposingEdges(a,b),reason:!a.enabled||!b.enabled?'disabled-edge':'same-side-interiors',directionRadians:[Math.atan2(a.b[1]-a.a[1],a.b[0]-a.a[0]),Math.atan2(b.b[1]-b.a[1],b.b[0]-b.a[0])]})
  }
 }
 const byPair=[...new Set(report.issues.filter(i=>i.tileIds.length===2).map(i=>pairKey(i.tileIds)))].map(key=>({pair:key,validatorErrors:report.issues.filter(i=>pairKey(i.tileIds)===key),overlapArea:overlaps.find(o=>pairKey(o.tileIds)===key)?.area??0}))
 return {report,overlaps,occupancy,edgeContacts,byPair,structuralIssues:structural}
}
export type LayoutConflicts=ReturnType<typeof inspectLayoutConflicts>
export function inspectDiagnosticConflicts(record:Reconstruction,diagnosticId:string){
 const diagnostic=record.diagnosticCandidates?.find(d=>d.id===diagnosticId),trace=record.trace
 if(!diagnostic||!trace)return {available:false as const,reason:'该记录缺少已保存 Diagnostic Pose 或执行 Profile 快照，不能可靠重建冲突。'}
 const actual=inspectLayoutConflicts(diagnostic.tiles,trace.input.profiles),actualPairs=new Set(actual.overlaps.map(o=>pairKey(o.tileIds)))
 // Separate contextual comparison. It is never passed into inspectLayoutConflicts
 // for the Candidate overlay, and cannot provide any red polygon there.
 const seeds=trace.planning.fittedSeeds,independent=seeds?validate(seeds.map(s=>s.tile),trace.input.profiles):null
 const independentPairs=independent?.issues.filter(i=>i.code==='OVERLAP').map(i=>pairKey(i.tileIds))??[]
 const ids=new Set(diagnostic.tiles.map(t=>t.id)),relations=trace.input.evidence.relations.filter(r=>ids.has(r.from)&&ids.has(r.to)).map(r=>{
  const connected=actual.report.connections.some(c=>[c.a.tileId,c.b.tileId].includes(r.from)&&[c.a.tileId,c.b.tileId].includes(r.to))
  return {...r,connected,satisfied:r.intent==='uncertain'||(r.intent==='connect'?connected:!connected)}
 })
 return {available:true as const,version:'diagnostic-conflicts-v1',provenance:'read-only-recheck-of-saved-diagnostic-poses',persisted:false,adoptable:false,
  references:{...trace.references,reconstructionId:record.id,reconstructionHash:record.hash,diagnosticId,attemptIndex:diagnostic.attemptIndex,stateIndex:diagnostic.stateIndex},
  geometryInputs:{poses:'diagnosticCandidates[id].tiles',profiles:'trace.input.profiles',usesReviewContourForOverlay:false,tileCount:diagnostic.tiles.length,tilePoses:diagnostic.tiles.map(t=>({id:t.id,profileId:t.profileId,profileVersion:t.profileVersion,pose:t.pose}))},
  historical:{connectionModel:trace.search.parameters.connectionModel??'whole-edge-v1',validator:diagnostic.validator,reason:diagnostic.reason,failureStage:diagnostic.failureStage},
  current:{connectionModel,eps:EPS,savedReportMatchesCurrent:canonical(diagnostic.validator.report)===canonical(actual.report),...actual,relations,relationViolations:relations.filter(r=>!r.satisfied),relationNote:diagnostic.failureStage==='geometry'?'Relations below are a separate recheck; the saved execution stopped at geometry before relation acceptance.':'Review intent checks are separate from Geometry Validator.'},
  independentReviewFit:{scope:'separate-input-context-not-current-diagnostic',available:!!independent,overlapPairs:independentPairs,overlapCount:independentPairs.length,onlyInIndependentFit:independentPairs.filter(p=>!actualPairs.has(p)),note:'These independently fitted poses are NOT used for the Candidate overlay or its conflict list.'}}
}
export type DiagnosticConflicts=ReturnType<typeof inspectDiagnosticConflicts>

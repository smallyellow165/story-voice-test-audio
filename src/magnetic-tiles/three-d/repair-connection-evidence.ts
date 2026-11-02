import {canonical} from '../build-plan.ts'
import type {Assembly3D} from './assembly.ts'
import type {AngleHintSource} from './assembly-angle-hints.ts'
import type {ConnectionHypothesis3D} from './reconstruction/contracts.ts'
import type {VisualConnection3D} from './reconstruction/spatial-understanding.ts'
import type {Connection} from './vendor/engine/types.ts'
import {portPairKey} from './vendor/engine/port-compatibility.ts'
import {edgeSnapTransform} from './editor-snap.ts'

export type RepairConnectionEvidence={recordId:string;hash?:string;variant:number;authority:'human'|'current-plan'|'historical-plan'|'execution-hypothesis';intent:ConnectionHypothesis3D['intent'];evidence:string;uncertainty:string;evidenceRefs:string[]}
export type RepairConnectionProposal={id:string;connection:Connection;angles:number[];range:ConnectionHypothesis3D['angleRange'];evidence:RepairConnectionEvidence[]}
export type RepairConnectionInputs={analysisRelations?:VisualConnection3D[];proposals:RepairConnectionProposal[];skipped:{pair:string;reason:string}[];unavailable:string[]}
/** Only structured, explicitly port-mapped evidence is executable. Adjacency,
 * occlusion, prose, collision and proximity never supply missing Port/Flip data.
 * Historical variants propose ONE edge; they cannot replace the current graph. */
export function repairConnectionInputs(a:Assembly3D,s:AngleHintSource):RepairConnectionInputs{
 const out:RepairConnectionInputs={proposals:[],skipped:[],unavailable:[...(s.connectionEvidenceError?[s.connectionEvidenceError]:[]),...(s.connectionEvidence?.unavailable??[]).map(x=>`${x.id}: ${x.reason}`)]}
 const mapped=(id:string)=>s.mapping.get(id)??id,pair=(a:string,b:string)=>[a,b].sort().join(' / '),samePair=(h:ConnectionHypothesis3D,x:string,y:string)=>pair(mapped(h.pieceA),mapped(h.pieceB))===pair(x,y)
 const add=(h:ConnectionHypothesis3D,parts:AngleHintSource['plan']['parts'],profiles:Assembly3D['profiles'],proof:RepairConnectionEvidence)=>{
  const x=mapped(h.pieceA),y=mapped(h.pieceB),p=a.pieces.find(p=>p.id===x),q=a.pieces.find(p=>p.id===y)
  if(!p||!q||x===y||h.intent==='separate'||a.connections.some(c=>pair(c.pieceA,c.pieceB)===pair(x,y)))return
  const skip=(reason:string)=>out.skipped.push({pair:pair(x,y),reason})
  if(proof.authority!=='human'&&(!h.evidence.trim()||!h.evidenceRefs.length))return skip('连接缺少明确证据或来源引用；不执行吸附')
  if(s.reviewInput?.review.constraints.some(c=>samePair(c,x,y)&&c.intent==='separate'))return skip('当前人工约束明确分离')
  for(const [id,piece] of [[h.pieceA,p],[h.pieceB,q]] as const){
   const planned=parts.find(p=>p.id===id),profile=profiles.find(p=>p.profile.id===piece.profileId&&p.profile.version===piece.profileVersion),current=a.profiles.find(p=>p.profile.id===piece.profileId&&p.profile.version===piece.profileVersion)
   if(!planned||planned.profileId!==piece.profileId||planned.profileVersion!==piece.profileVersion||!profile||canonical(profile)!==canonical(current))return skip('Profile / 厚度快照不同；旧 Port 映射不可复用')
  }
  if(!h.portA||!h.portB||h.flip===null||!h.angles.length||!h.angles.every(Number.isFinite))return skip('证据未确定 Port、Flip 或角度；不按距离猜测')
  const range=h.angleRange
  if(range&&(!Number.isFinite(range.min)||!Number.isFinite(range.max)||range.min>range.max||range.min< -180||range.max>180))return skip('角度范围无效')
  const hard=s.reviewInput?.review.constraints.filter(c=>samePair(c,x,y)&&c.intent==='connect')??[]
  if(hard.some(c=>{
   const forward=mapped(c.pieceA)===x
   return c.portA!==null&&c.portA!==(forward?h.portA:h.portB)||c.portB!==null&&c.portB!==(forward?h.portB:h.portA)||c.flip!==null&&c.flip!==h.flip
  }))return skip('与当前人工 Port / Flip 硬约束不同')
  const values=[...h.angles,...(range?Array.from({length:9},(_,i)=>range.min+(range.max-range.min)*i/8):[])].filter(v=>v>= -180&&v<=180&&(!range||v>=range.min&&v<=range.max)&&hard.every(c=>{const angle=mapped(c.pieceA)!==x&&!h.flip?-v:v;return c.angleRange?angle>=c.angleRange.min&&angle<=c.angleRange.max:!c.angles.length||c.angles.includes(angle)}))
  const angles=[...new Set(values)].sort((a,b)=>Math.min(...h.angles.map(v=>Math.abs(v-a)))-Math.min(...h.angles.map(v=>Math.abs(v-b)))||a-b)
  if(!angles.length)return skip('建议角度不在允许范围内')
  const c={pieceA:x,pieceB:y,portA:h.portA,portB:h.portB,dihedralDeg:angles[0],flip:h.flip}
  try{edgeSnapTransform(a,c)}catch(e){return skip(String(e).replace(/^Error: /,''))}
  const existing=out.proposals.find(p=>portPairKey(p.connection)===portPairKey(c)&&p.connection.pieceA===c.pieceA&&p.connection.flip===c.flip&&canonical(p.angles)===canonical(angles))
  if(existing){existing.evidence.push(proof);return}
  out.proposals.push({id:`joint-${out.proposals.length+1}`,connection:c,angles,range,evidence:[proof]})
 }
 const input=s.reviewInput
 for(const h of input?.review.constraints??[])add(h,s.plan.parts,input!.profiles,{recordId:s.originId,variant:0,authority:'human',intent:h.intent,evidence:h.evidence,uncertainty:h.uncertainty,evidenceRefs:h.evidenceRefs})
 const records=s.connectionEvidence?.plans??[]
 // The executed source is always available, including projects without history.
 const current=records.find(p=>p.record.id===s.planId)
 for(const [i,v] of [{connections:s.plan.connections},...s.plan.alternatives].entries())for(const h of v.connections)add(h,s.plan.parts,current?.profiles??s.original.profiles,{recordId:s.planId,hash:current?.record.hash,variant:i,authority:'current-plan',intent:h.intent,evidence:h.evidence,uncertainty:h.uncertainty,evidenceRefs:h.evidenceRefs})
 for(const {record,profiles} of records.filter(p=>p.record.id!==s.planId))for(const [i,v] of [{connections:record.plan.connections},...record.plan.alternatives].entries())for(const h of v.connections)add(h,record.plan.parts,profiles,{recordId:record.id,hash:record.hash,variant:i,authority:'historical-plan',intent:h.intent,evidence:h.evidence,uncertainty:h.uncertainty,evidenceRefs:h.evidenceRefs})
 // Execution omissions are preserved structured hypotheses, never new facts.
 if(s.executionId)for(const h of s.omittedConnections??[])add(h,s.plan.parts,s.original.profiles,{recordId:s.executionId,hash:s.executionHash,variant:s.executedVariant??0,authority:'execution-hypothesis',intent:h.intent,evidence:h.evidence,uncertainty:h.uncertainty,evidenceRefs:h.evidenceRefs})
 const ids=new Set(a.pieces.map(p=>p.id))
 out.analysisRelations=(input?.evidence.spatialInterpretation?.connections??[]).filter(c=>ids.has(mapped(c.pieceA))&&ids.has(mapped(c.pieceB))&&!a.connections.some(x=>pair(x.pieceA,x.pieceB)===pair(mapped(c.pieceA),mapped(c.pieceB))))
 for(const c of out.analysisRelations)if(['shared_edge','uncertain'].includes(c.relationship)&&!out.proposals.some(p=>pair(p.connection.pieceA,p.connection.pieceB)===pair(mapped(c.pieceA),mapped(c.pieceB))))out.skipped.push({pair:pair(mapped(c.pieceA),mapped(c.pieceB)),reason:'Analysis 图片 Feature 未建立确定 Profile Port / Flip 映射；仅保留证据，不自动吸附'})
 return out
}

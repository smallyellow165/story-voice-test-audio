import {profilePortMappings,anchoredPortMappings,mapConnectionConvention} from './port-mapping.ts'
import type {PortMappingAnchor,LocalPortMapping,AngleDomain,PortMappingResult} from './port-mapping.ts'
import {assemblyAngleHintRows} from './assembly-angle-hints.ts'
import {canonical} from '../build-plan.ts'
import type {Assembly3D} from './assembly.ts'
import type {AngleHintSource} from './assembly-angle-hints.ts'
import type {ConnectionHypothesis3D} from './reconstruction/contracts.ts'
import type {VisualConnection3D} from './reconstruction/spatial-understanding.ts'
import type {Connection} from './vendor/engine/types.ts'
import {portPairKey} from './vendor/engine/port-compatibility.ts'
import {edgeSnapTransform} from './editor-snap.ts'

export type RepairConnectionEvidence={recordId:string;hash?:string;variant:number;authority:'human'|'current-plan'|'historical-plan'|'execution-hypothesis';intent:ConnectionHypothesis3D['intent'];evidence:string;uncertainty:string;evidenceRefs:string[];portMapping?:{sourcePorts:[string,string];targetPorts:[string,string];normalSigns:[number,number];reversed:[boolean,boolean];anchors:string[];status:PortMappingResult['status']}}
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
   if(!planned||planned.profileId!==piece.profileId||planned.profileVersion!==piece.profileVersion||!profile||!current||(proof.portMapping?profilePortMappings(profile,current).length===0:canonical(profile)!==canonical(current)))return skip('Profile / 厚度快照不同；旧 Port 映射不可复用')
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
 // A historical instance can use a different symmetry-equivalent local frame
 // even when its Profile ID and Port strings are identical. Infer correspondence
 // ONLY from full geometry + unchanged original handoff connection anchors.
 const currentRows=assemblyAngleHintRows(a,s,s.executedVariant??0),reverse=(d:AngleDomain):AngleDomain=>({angles:d.angles.map(v=>-v),angleRange:d.angleRange?{min:-d.angleRange.max,max:-d.angleRange.min}:null})
 for(const {record,profiles} of records.filter(p=>p.record.id!==s.planId)){
  if(s.connectionEvidence?.originId!==s.originId||s.connectionEvidence.planId!==s.planId){out.unavailable.push('历史连接证据来源不一致，未使用');continue}
  const domains=new Map<string,LocalPortMapping[]>()
  for(const part of record.plan.parts){
   const piece=a.pieces.find(p=>p.id===mapped(part.id)),snapshot=profiles.find(p=>p.profile.id===part.profileId&&p.profile.version===part.profileVersion),current=piece&&a.profiles.find(p=>p.profile.id===piece.profileId&&p.profile.version===piece.profileVersion)
   if(piece&&snapshot&&current&&part.profileId===piece.profileId&&part.profileVersion===piece.profileVersion)domains.set(piece.id,profilePortMappings(snapshot,current))
  }
  for(const [i,v] of [{connections:record.plan.connections},...record.plan.alternatives].entries()){
   const anchors:PortMappingAnchor[]=[]
   for(const h of v.connections){
    if(h.intent==='separate'||h.portA===null||h.portB===null||h.flip===null||!h.angles.length)continue
    const x=mapped(h.pieceA),y=mapped(h.pieceB),hs=v.connections.filter(q=>samePair(q,x,y)&&q.intent!=='separate'),cs=a.connections.filter(c=>pair(c.pieceA,c.pieceB)===pair(x,y))
    if(hs.length!==1||cs.length!==1)continue
    const c=cs[0],index=a.connections.indexOf(c),forward=c.pieceA===x
    if(!s.original.connections.some(old=>portPairKey(old)===portPairKey(c)&&(old.flip??false)===(c.flip??false)))continue
    if([c.pieceA,c.pieceB].some(id=>{
     const piece=a.pieces.find(p=>p.id===id)!,snap=a.profiles.find(p=>p.profile.id===piece.profileId&&p.profile.version===piece.profileVersion)
     return canonical(snap)!==canonical(s.original.profiles.find(p=>p.profile.id===piece.profileId&&p.profile.version===piece.profileVersion))
    }))continue
    const row=currentRows.find(r=>r.connectionIndex===index),hint=row?.hint,comparable=hint&&!['not-comparable','no-hint','no-angle'].includes(row!.comparison)
    let domain:AngleDomain=comparable?{angles:hint.angles,angleRange:hint.angleRange}:{angles:[c.dihedralDeg],angleRange:null}
    if(comparable&&mapped(hint.pieceA)!==c.pieceA&&!c.flip)domain=reverse(domain)
    if(!forward&&!c.flip)domain=reverse(domain)
    anchors.push({id:`${x}↔${y} / #${index}`,historical:{...h,pieceA:x,pieceB:y},current:{...c,pieceA:x,pieceB:y,portA:forward?c.portA:c.portB,portB:forward?c.portB:c.portA},domain})
   }
   for(const h of v.connections){
    const x=mapped(h.pieceA),y=mapped(h.pieceB)
    if(!a.pieces.some(p=>p.id===x)||!a.pieces.some(p=>p.id===y)||h.intent==='separate'||a.connections.some(c=>pair(c.pieceA,c.pieceB)===pair(x,y)))continue
    if(!h.portA||!h.portB||h.flip===null||!h.angles.length){out.skipped.push({pair:pair(x,y),reason:'历史证据未确定 Port、Flip 或角度，无法转换'});continue}
    const mapping=anchoredPortMappings(domains,anchors,x,y)
    if(!mapping.pairs.length){out.skipped.push({pair:pair(x,y),reason:mapping.reason});continue}
    if(mapping.status!=='mapped')out.unavailable.push(`${record.id.slice(0,8)} · ${pair(x,y)} · ${mapping.reason}`)
    for(const frames of mapping.pairs)for(const converted of mapConnectionConvention(h,frames.a,frames.b))add(converted,record.plan.parts,profiles,{
     recordId:record.id,hash:record.hash,variant:i,authority:'historical-plan',intent:h.intent,evidence:h.evidence,uncertainty:h.uncertainty,evidenceRefs:h.evidenceRefs,
     portMapping:{sourcePorts:[h.portA,h.portB],targetPorts:[converted.portA!,converted.portB!],normalSigns:[frames.a.normalSign,frames.b.normalSign],reversed:[frames.a.ports[h.portA].reversed,frames.b.ports[h.portB].reversed],anchors:mapping.anchors,status:mapping.status}
    })
   }
  }
 }
 // Execution omissions are preserved structured hypotheses, never new facts.
 if(s.executionId)for(const h of s.omittedConnections??[])add(h,s.plan.parts,s.original.profiles,{recordId:s.executionId,hash:s.executionHash,variant:s.executedVariant??0,authority:'execution-hypothesis',intent:h.intent,evidence:h.evidence,uncertainty:h.uncertainty,evidenceRefs:h.evidenceRefs})
 const ids=new Set(a.pieces.map(p=>p.id))
 out.analysisRelations=(input?.evidence.spatialInterpretation?.connections??[]).filter(c=>ids.has(mapped(c.pieceA))&&ids.has(mapped(c.pieceB))&&!a.connections.some(x=>pair(x.pieceA,x.pieceB)===pair(mapped(c.pieceA),mapped(c.pieceB))))
 for(const c of out.analysisRelations)if(['shared_edge','uncertain'].includes(c.relationship)&&!out.proposals.some(p=>pair(p.connection.pieceA,p.connection.pieceB)===pair(mapped(c.pieceA),mapped(c.pieceB))))out.skipped.push({pair:pair(mapped(c.pieceA),mapped(c.pieceB)),reason:'Analysis 图片 Feature 未建立确定 Profile Port / Flip 映射；仅保留证据，不自动吸附'})
 return out
}

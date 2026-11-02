import {repairConnectionInputs} from './repair-connection-evidence.ts'
import type {RepairConnectionInputs,RepairConnectionProposal} from './repair-connection-evidence.ts'
import {edgeSnapTransform} from './editor-snap.ts'
import {nonRepairableKeys} from './non-repairable.ts'
import {canonical} from '../build-plan.ts'
import {serializeAssembly3D,toEnginePose} from './assembly.ts'
import type {Assembly3D} from './assembly.ts'
import {solveAssembly3D,validateAssembly3D,inspectAssemblyCollisions} from './engine-adapter.ts'
import {createViewerModel} from './viewer-model.ts'
import {computeAllConnectionResiduals,portWorldEndpoints} from './vendor/engine/solver.ts'
import {collisionPairKey,collisionVisual} from './collision-visual.ts'
import {assemblyAngleHintRows} from './assembly-angle-hints.ts'
import type {AngleHintSource} from './assembly-angle-hints.ts'
import {classifyAssemblyConstraints,cycleBlocks} from './constraint-classification.ts'
import {inspectSpatialConsistency} from './reconstruction/spatial-consistency.ts'
import {commit} from './vendor/editor/state.ts'
import type {EditorHistory} from './vendor/editor/state.ts'
import type {ValidationResult} from './vendor/engine/types.ts'

export type RepairCollision={key:string;pieceIds:string[];depth:number;volume:number|null}
export type RepairOptions={maxChecks?:number;maxNodes?:number;maxMs?:number;referencePieceId?:string;nonRepairableKeys?:readonly string[]}
export type RepairCandidate={id:string;assembly:Assembly3D;geometry:ValidationResult;collisions:RepairCollision[];angles:{index:number;from:number;to:number}[];deviation:number;planDeviation:number;residuals:ReturnType<typeof connectionResiduals>;controls:number[];proposedConnection?:{proposalId:string;connection:RepairConnectionProposal['connection'];evidence:RepairConnectionProposal['evidence']};alignmentCost?:number;referencePieces?:string[]}
export type RepairResult={sourceRaw:string;sourceSignature:string;targetKeys:string[];nonRepairableKeys:string[];referencePieceId:string;referencePieces:string[];baseline:RepairCollision[];candidates:RepairCandidate[];groups:{indices:number[];minDelta:number;maxDelta:number}[];status:'complete'|'budget-exhausted'|'blocked';reason:string;checks:number;nodes:number;rejected:Record<string,number>;elapsedMs:number;connectionInputs?:RepairConnectionInputs;connectionAttempts?:{proposalId:string;checks:number;accepted:number;errors:Record<string,number>;bestIssues?:ValidationResult['issues'];bestResiduals?:ReturnType<typeof connectionResiduals>}[]}
export const repairLimits=Object.freeze({maxChecks:128,maxNodes:512,maxMs:2500,maxCandidates:5,maxConnectionProposals:8})
// Numerical comparisons between two evaluations only; never a Validator tolerance.
const EPS=1e-9
const signature=(s:AngleHintSource)=>canonical({planId:s.planId,originId:s.originId,variant:s.executedVariant,plan:s.plan,input:s.reviewInput,mapping:[...s.mapping],original:s.original,executionId:s.executionId,executionHash:s.executionHash,omittedConnections:s.omittedConnections})
function components(a:Assembly3D,allow:(i:number)=>boolean){
 const left=new Set(a.pieces.map(p=>p.id)),groups:string[][]=[]
 while(left.size){const ids=[...left].sort().slice(0,1);left.delete(ids[0]);for(let j=0;j<ids.length;j++)a.connections.forEach((c,i)=>{if(!allow(i))return;const other=c.pieceA===ids[j]?c.pieceB:c.pieceB===ids[j]?c.pieceA:undefined;if(other&&left.delete(other))ids.push(other)});groups.push(ids.sort())}return groups
}
/** The existing biconnected blocks form a block-cut forest. Keep all edges
 * of a relevant loop together, but never search a dangling unrelated branch. */
export function repairAffectedConnections(a:Assembly3D,pairs:readonly (readonly string[])[],reference?:string){
 const blocks=cycleBlocks(a),covered=new Set(blocks.flat()),groups=components(a,()=>true)
 a.connections.forEach((_,i)=>{if(!covered.has(i))blocks.push([i])})
 const graph=new Map<string,string[]>()
 const link=(a:string,b:string)=>{graph.set(a,[...(graph.get(a)??[]),b]);graph.set(b,[...(graph.get(b)??[]),a])}
 blocks.forEach((edges,i)=>{for(const id of new Set(edges.flatMap(e=>[a.connections[e].pieceA,a.connections[e].pieceB])))link('piece:'+id,'block:'+i)})
 const relevant=new Set<number>()
 const path=(a:string,b:string)=>{
  const start='piece:'+a,end='piece:'+b,queue=[start],parent=new Map<string,string|null>([[start,null]])
  for(let i=0;i<queue.length&&!parent.has(end);i++)for(const next of graph.get(queue[i])??[])if(!parent.has(next)){parent.set(next,queue[i]);queue.push(next)}
  if(!parent.has(end))return
  for(let node:string|null=end;node!==null;node=parent.get(node)??null)if(node.startsWith('block:'))for(const e of blocks[Number(node.slice(6))])relevant.add(e)
 }
 for(const [x,y] of pairs){
  const gx=groups.find(g=>g.includes(x)),gy=groups.find(g=>g.includes(y));if(!gx||!gy)continue
  if(gx===gy)path(x,y)
  else for(const [id,g] of [[x,gx],[y,gy]] as const)path(id,reference&&g.includes(reference)?reference:g[0])
 }
 return relevant
}
export function repairCollisions(a:Assembly3D,report=validateAssembly3D(a)):RepairCollision[]{
 return report.issues.filter(i=>i.code==='intersection'&&i.severity==='error').map(issue=>{
  if(!issue.relatedPieceIds||issue.relatedPieceIds.length!==2||!Number.isFinite(issue.penetrationDepth))throw Error('碰撞缺少可靠零件对或穿透深度，不能自动修复')
  const evidence=inspectAssemblyCollisions(a,{...report,issues:[issue]})[0],visual=evidence?collisionVisual(evidence,'repair-metrics'):null
  return {key:collisionPairKey(issue.relatedPieceIds),pieceIds:[...issue.relatedPieceIds],depth:issue.penetrationDepth!,volume:visual?.kind==='volume'?visual.volume:null}
 }).sort((a,b)=>a.key.localeCompare(b.key))
}
function connectionResiduals(a:Assembly3D){
 const pieces=createViewerModel(a),shapes=new Map(pieces.map(p=>[p.id,p.shape])),residuals=computeAllConnectionResiduals(a.connections,Object.fromEntries(a.pieces.map(p=>[p.id,toEnginePose(p.pose)])),id=>shapes.get(id))
 return {maxPositionError:Math.max(0,...residuals.map(r=>r.positionError)),maxDihedralError:Math.max(0,...residuals.map(r=>r.dihedralError)),minDirectionDot:Math.min(1,...residuals.map(r=>r.directionDot))}
}
function sameRelativePair(a:Assembly3D,b:Assembly3D,ids:string[]){
 const [a0,a1]=ids.map(id=>toEnginePose(a.pieces.find(p=>p.id===id)!.pose)),[b0,b1]=ids.map(id=>toEnginePose(b.pieces.find(p=>p.id===id)!.pose)),qa=a0.quaternion.clone().invert(),qb=b0.quaternion.clone().invert()
 const ra=qa.clone().multiply(a1.quaternion),rb=qb.clone().multiply(b1.quaternion),sign=ra.dot(rb)<0?-1:1
 return a1.position.clone().sub(a0.position).applyQuaternion(qa).distanceTo(b1.position.clone().sub(b0.position).applyQuaternion(qb))<=EPS&&ra.toArray().every((v,i)=>Math.abs(v-sign*rb.toArray()[i])<=EPS)
}
type Member={index:number;sign:number;min:number;max:number;preferred:number[]}
type Control={members:Member[];min:number;max:number;domain:number[]}
type Problem={a:Assembly3D;source:AngleHintSource;baseline:RepairCollision[];targets:Set<string>;excluded:Set<string>;controls:Control[];roots:string[];fixed:Set<string>;referencePieceId:string;connectionInputs:RepairConnectionInputs;proposals:RepairConnectionProposal[]}
function prepare(a:Assembly3D,source:AngleHintSource,targets:readonly string[]|undefined,options:RepairOptions,report=validateAssembly3D(a),baseline=repairCollisions(a,report),connectionInputs=repairConnectionInputs(a,source)):Problem{
 if(source.original.id!==a.id||source.executedVariant===null||!source.reviewInput)throw Error('缺少已校验的执行方案或 Review 硬约束，不能搜索')
 if(report.issues.some(i=>i.severity==='error'&&i.code!=='intersection'))throw Error('当前存在连接、Port、闭环或其他结构错误；V1 只修复连接有效的碰撞结构')
 const excluded=new Set(nonRepairableKeys(a,options.nonRepairableKeys??[])),chosen=new Set((targets??baseline.map(c=>c.key)).filter(k=>!excluded.has(k)))
 if(!chosen.size&&baseline.some(c=>excluded.has(c.key)))throw Error('所选碰撞均标记为不可修复；请选择其他修复目标')
 if(!chosen.size||[...chosen].some(k=>!baseline.some(c=>c.key===k)))throw Error('修复目标为空或不属于当前碰撞快照')
 if(inspectSpatialConsistency(a,source.reviewInput,[...source.mapping].map(([observationId,pieceId])=>({observationId,pieceId}))).status==='contradicted')throw Error('当前结构与人工空间约束矛盾，请先核对，不能自动改写硬约束')
 const rows=assemblyAngleHintRows(a,source,source.executedVariant),classes=classifyAssemblyConstraints(a,rows,report),targetIds=new Set(baseline.filter(c=>chosen.has(c.key)).flatMap(c=>c.pieceIds)),connected=components(a,()=>true),affected=new Set(connected.filter(ids=>ids.some(id=>targetIds.has(id))).flat())
 const proposals=connectionInputs.proposals.filter(p=>!excluded.has(collisionPairKey([p.connection.pieceA,p.connection.pieceB]))&&[p.connection.pieceA,p.connection.pieceB].some(id=>targetIds.has(id)))
 const relevant=repairAffectedConnections(a,[...baseline.filter(c=>chosen.has(c.key)).map(c=>c.pieceIds),...proposals.map(p=>[p.connection.pieceA,p.connection.pieceB])],options.referencePieceId)
 const hard=source.reviewInput.review.constraints, mapped=(id:string)=>source.mapping.get(id)??id,pair=(a:string,b:string)=>[a,b].sort().join('|')
 const permitted=rows.filter(r=>r.current&&r.connectionIndex!==undefined&&relevant.has(r.connectionIndex)&&affected.has(r.pieceA)&&classes.get(r.key)?.kind==='adjustable-fold'&&!hard.some(h=>pair(mapped(h.pieceA),mapped(h.pieceB))===pair(r.pieceA,r.pieceB)))
 const indices=new Set(permitted.map(r=>r.connectionIndex!)),fixedBlocks=components(a,i=>!indices.has(i)),block=new Map(fixedBlocks.flatMap((ids,i)=>ids.map(id=>[id,i] as const)))
 const models=createViewerModel(a),shapes=new Map(models.map(p=>[p.id,p.shape])),transforms=Object.fromEntries(a.pieces.map(p=>[p.id,toEnginePose(p.pose)]))
 const grouped:{control:Control;blocks:string;axis:NonNullable<ReturnType<typeof portWorldEndpoints>>}[]=[]
 for(const r of permitted){
  const c=r.current!,range=r.hint!.angleRange!,ga=block.get(c.pieceA)!,gb=block.get(c.pieceB)!
  if(ga===gb)continue // A fixed alternate path makes this candidate angle locked.
  const reversed=c.pieceA!==(source.mapping.get(r.hint!.pieceA)??r.hint!.pieceA),invert=reversed&&!c.flip
  const min=invert?-range.max:range.min,max=invert?-range.min:range.max,preferred=r.hint!.angles.map(v=>invert?-v:v)
  const axis=portWorldEndpoints(c.pieceA,c.portA,transforms,id=>shapes.get(id));if(!axis)throw Error('可调连接缺少实际 Port 空间坐标')
  const groupKey=[ga,gb].sort((x,y)=>x-y).join('|')
  const existing=grouped.find(g=>g.blocks===groupKey&&Math.abs(g.axis.dir.dot(axis.dir))>1-1e-9&&axis.p0.clone().sub(g.axis.p0).cross(g.axis.dir).length()<1e-7)
  const orientation=ga<gb?1:-1
  if(existing){
   const sign=orientation*(existing.axis.dir.dot(axis.dir)>0?1:-1),d0=(min-c.dihedralDeg)/sign,d1=(max-c.dihedralDeg)/sign
   existing.control.members.push({index:r.connectionIndex!,sign,min,max,preferred});existing.control.min=Math.max(existing.control.min,Math.min(d0,d1));existing.control.max=Math.min(existing.control.max,Math.max(d0,d1))
  }else{
   const d0=(min-c.dihedralDeg)/orientation,d1=(max-c.dihedralDeg)/orientation
   grouped.push({blocks:groupKey,axis,control:{members:[{index:r.connectionIndex!,sign:orientation,min,max,preferred}],min:Math.min(d0,d1),max:Math.max(d0,d1),domain:[]}})
  }
 }
 const controls=grouped.map(g=>g.control)
 if(!controls.length&&!proposals.length)throw Error('没有获准的可调折角自由度：缺少明确范围、已被人工约束固定，或闭环其余连接将角度锁定')
 for(const g of controls){
  if(g.min>g.max)throw Error('共轴闭环连接的允许调整范围没有交集，不能保持全部连接')
  const values=[...Array.from({length:9},(_,i)=>g.min+(g.max-g.min)*i/8),...(g.min<=0&&g.max>=0?[0]:[])]
  g.domain=[...new Map(values.map(v=>[v.toPrecision(12),v])).values()].sort((a,b)=>Math.abs(a)-Math.abs(b)||a-b)
 }
 if(controls.length&&!proposals.length&&controls.every(g=>Math.abs(g.max-g.min)<=EPS&&Math.abs(g.min)<=EPS))throw Error('协调后的允许范围仅包含当前角度；无可调自由度')
 const adjustable=new Set(controls.flatMap(g=>g.members.map(m=>m.index))),roots:string[]=[],fixed=new Set<string>()
 const referencePieceId=options.referencePieceId??[...a.pieces.map(p=>p.id)].sort()[0]
 if(!a.pieces.some(p=>p.id===referencePieceId))throw Error('固定参考零件不存在')
 for(const ids of connected){
  const root=ids.includes(referencePieceId)?referencePieceId:ids[0];roots.push(root)
  const active=a.connections.some((c,i)=>ids.includes(c.pieceA)&&adjustable.has(i))
  for(const id of active?fixedBlocks.find(group=>group.includes(root))!:ids)fixed.add(id)
 }
 if(!proposals.length&&baseline.filter(c=>chosen.has(c.key)).every(c=>block.get(c.pieceIds[0])===block.get(c.pieceIds[1])))throw Error('目标碰撞均在同一个固定子结构内部；获准折角无法改变这些相对几何关系')
 return {a,source,baseline,targets:chosen,excluded,controls,roots,fixed,referencePieceId,connectionInputs,proposals}
}
function evaluate(p:Problem,controls:number[],joint?:{proposal:RepairConnectionProposal;angle:number},inspected?:(geometry:ValidationResult,residuals:ReturnType<typeof connectionResiduals>)=>void):RepairCandidate{
 if(controls.length!==p.controls.length)throw Error('CONTROL_DOMAIN')
 let planDeviation=0
 const changed=structuredClone(p.a),angles:RepairCandidate['angles']=[]
 p.controls.forEach((g,k)=>g.members.forEach(m=>{
  const c=changed.connections[m.index],to=c.dihedralDeg+controls[k]*m.sign
  if(!Number.isFinite(to)||to<m.min-EPS||to>m.max+EPS)throw Error('ANGLE_DOMAIN')
  if(Math.abs(to-c.dihedralDeg)>EPS)angles.push({index:m.index,from:c.dihedralDeg,to})
  c.dihedralDeg=Math.max(m.min,Math.min(m.max,to));planDeviation+=Math.min(...m.preferred.map(v=>Math.abs(Math.atan2(Math.sin((to-v)*Math.PI/180),Math.cos((to-v)*Math.PI/180))*180/Math.PI)))
 }))
 if(!angles.length&&!joint)throw Error('UNCHANGED')
 let fixed=p.fixed,roots=p.roots
 if(joint){
  if(!joint.proposal.angles.includes(joint.angle))throw Error('JOINT_ANGLE_DOMAIN')
  const connection={...joint.proposal.connection,dihedralDeg:joint.angle}
  // Same exact Port/length/duplicate checks and alignment target as manual Snap.
  // Linked pieces are propagated by the EXISTING whole-graph Solver, never by
  // independently overwriting the new edge's B Pose.
  edgeSnapTransform(changed,connection);changed.connections.push(connection)
  const before=components(p.a,()=>true),joined=components(changed,()=>true),anchor=before.find(ids=>ids.includes(p.referencePieceId))!
  roots=joined.map(ids=>ids.includes(p.referencePieceId)?p.referencePieceId:p.roots.find(id=>ids.includes(id))??ids[0])
  fixed=new Set([...p.fixed].filter(id=>{
   const merged=joined.find(ids=>ids.includes(id))!
   const originalComponents=before.filter(ids=>ids.some(id=>merged.includes(id)))
   return originalComponents.length===1||anchor.includes(id)||!merged.includes(p.referencePieceId)&&before.find(ids=>ids.includes(roots[joined.indexOf(merged)]))!.includes(id)
  }))
 }
 const solved=solveAssembly3D(changed,roots)
 // The reference fixed component stays byte-exact, as do uninvolved components.
 for(const piece of solved.pieces)if(fixed.has(piece.id))piece.pose=structuredClone(p.a.pieces.find(x=>x.id===piece.id)!.pose)
 const geometry=validateAssembly3D(solved)
 inspected?.(geometry,connectionResiduals(solved))
 if(geometry.issues.some(i=>i.severity==='error'&&i.code!=='intersection'))throw Error('STRUCTURAL_OR_LOOP')
 if(inspectSpatialConsistency(solved,p.source.reviewInput!,[...p.source.mapping].map(([observationId,pieceId])=>({observationId,pieceId}))).status==='contradicted')throw Error('REVIEW_CONSTRAINT')
 const collisions=repairCollisions(solved,geometry)
 for(const c of collisions){
  const old=p.baseline.find(b=>b.key===c.key)
  if(!old)throw Error('NEW_COLLISION')
  if(c.depth>old.depth+EPS)throw Error('WORSE_DEPTH')
  if(c.volume!==null&&old.volume!==null){if(c.volume>old.volume+Math.max(1e-14,old.volume*1e-8))throw Error('WORSE_VOLUME')}
  else if(!sameRelativePair(p.a,solved,c.pieceIds))throw Error('UNVERIFIED_COLLISION_CHANGE')
 }
 const before=p.baseline.filter(c=>p.targets.has(c.key)),after=collisions.filter(c=>p.targets.has(c.key)),sum=(cs:RepairCollision[],field:'depth'|'volume')=>cs.reduce((v,c)=>v+(c[field]??0),0)
 if(!joint&&!(after.length<before.length||sum(after,'depth')<sum(before,'depth')-EPS||before.every(c=>c.volume!==null)&&after.every(c=>c.volume!==null)&&sum(after,'volume')<sum(before,'volume')-1e-14))throw Error('NO_TARGET_IMPROVEMENT')
 return {id:'',assembly:solved,geometry,collisions,angles,deviation:angles.reduce((v,a)=>v+Math.abs(a.to-a.from),0),planDeviation,residuals:connectionResiduals(solved),controls,...(joint?{proposedConnection:{proposalId:joint.proposal.id,connection:structuredClone(solved.connections.at(-1)!),evidence:joint.proposal.evidence}}:{}),alignmentCost:alignmentCost(solved,p.proposals),referencePieces:[...fixed].sort()}
}
function alignmentCost(a:Assembly3D,proposals:RepairConnectionProposal[]){
 if(!proposals.length)return 0
 return proposals.reduce((sum,p)=>sum+Math.min(...p.angles.map(angle=>{
  // Ignore the newly-added declaration only for computing its geometric target.
  const copy={...a,connections:a.connections.filter(c=>!(c.pieceA===p.connection.pieceA&&c.pieceB===p.connection.pieceB&&c.portA===p.connection.portA&&c.portB===p.connection.portB))}
  const tf=edgeSnapTransform(copy,{...p.connection,dihedralDeg:angle}),piece=a.pieces.find(x=>x.id===p.connection.pieceB)!,q=toEnginePose(piece.pose)
  return tf.position.distanceTo(q.position)+2*Math.acos(Math.min(1,Math.abs(tf.quaternion.dot(q.quaternion))))/Math.PI
 })),0)
}
/** Excluded collisions contribute NOTHING, including the full-validity bonus.
 * Full Validator results remain attached for truthful display and workflow gates. */
export function repairCandidateScore(c:RepairCandidate,targets:ReadonlySet<string>,excluded:ReadonlySet<string>=new Set()):number[]{
 const counted=c.collisions.filter(x=>!excluded.has(x.key)),selected=counted.filter(x=>targets.has(x.key))
 // Prefer exact closure over a merely tolerance-admissible new joint. These
 // residuals contain no solid-collision metric or Non-repairable scoring gain.
 return [counted.length?1:0,c.proposedConnection?0:1,c.proposedConnection?Math.min(...c.proposedConnection.evidence.map(e=>(e.authority==='human'?0:1)+(e.intent==='uncertain'?.25:0)+(e.evidenceRefs.length?0:.25))):0,c.residuals.maxPositionError,c.residuals.maxDihedralError,1-c.residuals.minDirectionDot,selected.length,selected.reduce((s,x)=>s+x.depth,0),counted.length,counted.reduce((s,x)=>s+x.depth,0),c.alignmentCost??0,selected.reduce((s,x)=>s+(x.volume??0),0),counted.reduce((s,x)=>s+(x.volume??0),0),c.deviation,c.planDeviation,...c.controls]
}
function compare(a:RepairCandidate,b:RepairCandidate,targets:Set<string>,excluded:Set<string>){
 const x=repairCandidateScore(a,targets,excluded),y=repairCandidateScore(b,targets,excluded);for(let i=0;i<x.length;i++)if(Math.abs(x[i]-y[i])>1e-12)return x[i]-y[i];return 0
}
/** Bounded deterministic best-first Cartesian grid, with exact coaxial grouped
 * deltas first. Other closed-loop combinations are admitted ONLY by the existing
 * Solver + full strict Validator. Completion means sampled grid, not proof over
 * the continuous domain. Run off the UI thread. No model or execution API. */
export function findConstraintRepairs(a:Assembly3D,source:AngleHintSource,targets?:string[],options:RepairOptions={},progress?:(checks:number,nodes:number)=>void):RepairResult{
 const start=performance.now(),result:RepairResult={sourceRaw:serializeAssembly3D(a),sourceSignature:signature(source),targetKeys:[],nonRepairableKeys:[],referencePieceId:options.referencePieceId??'',referencePieces:[],baseline:[],candidates:[],groups:[],status:'blocked',reason:'',checks:0,nodes:0,rejected:{},elapsedMs:0}
 try{
  const report=validateAssembly3D(a);result.checks=1;result.baseline=repairCollisions(a,report)
  result.connectionInputs=repairConnectionInputs(a,source)
  const p=prepare(a,source,targets,options,report,result.baseline,result.connectionInputs);result.targetKeys=[...p.targets].sort();result.nonRepairableKeys=[...p.excluded].sort();result.referencePieceId=p.referencePieceId;result.referencePieces=[...p.fixed].sort();result.groups=p.controls.map(g=>({indices:g.members.map(m=>m.index),minDelta:g.min,maxDelta:g.max}))
  const cap=(n:number|undefined,fallback:number)=>Number.isFinite(n)?Math.max(1,Math.min(fallback,Math.floor(n!))):fallback,maxChecks=cap(options.maxChecks,repairLimits.maxChecks),maxNodes=cap(options.maxNodes,repairLimits.maxNodes),maxMs=cap(options.maxMs,repairLimits.maxMs)
  result.connectionInputs=p.connectionInputs
  result.connectionAttempts=p.proposals.map(proposal=>({proposalId:proposal.id,checks:0,accepted:0,errors:{}}))
  const attempted=p.proposals.slice(0,repairLimits.maxConnectionProposals)
  const branches=[undefined,...attempted].map(proposal=>({proposal,domains:[...p.controls.map(c=>c.domain),...(proposal?[proposal.angles]:[])],queue:[Array(p.controls.length+(proposal?1:0)).fill(0) as number[]],seen:new Set<string>()}))
  for(const branch of branches)branch.seen.add(branch.queue[0].join(','))
  let truncated=p.proposals.length>attempted.length,turn=0,totalNodes=branches.length
  result.status='complete'
  while(branches.some(b=>b.queue.length)){
   if(result.checks>=maxChecks||result.nodes>=maxNodes||performance.now()-start>=maxMs){result.status='budget-exhausted';break}
   const branch=branches[turn++%branches.length];if(!branch.queue.length)continue
   branch.queue.sort((a,b)=>a.reduce((s,x)=>s+x,0)-b.reduce((s,x)=>s+x,0)||a.join(',').localeCompare(b.join(',')))
   const indices=branch.queue.shift()!;result.nodes++
   for(let i=0;i<indices.length;i++){const next=[...indices];next[i]++;const key=next.join(',');if(next[i]<branch.domains[i].length&&!branch.seen.has(key)){if(totalNodes<maxNodes){branch.seen.add(key);branch.queue.push(next);totalNodes++}else truncated=true}}
   const values=indices.map((i,k)=>branch.domains[k][i]),controls=values.slice(0,p.controls.length)
   if(!branch.proposal&&controls.every(v=>Math.abs(v)<=EPS))continue
   const attempt=result.connectionAttempts.find(x=>x.proposalId===branch.proposal?.id)
   result.checks++;if(attempt)attempt.checks++
   try{
    const candidate=evaluate(p,controls,branch.proposal?{proposal:branch.proposal,angle:values.at(-1)!}:undefined,(geometry,residuals)=>{
     if(attempt&&(!attempt.bestResiduals||residuals.maxPositionError<attempt.bestResiduals.maxPositionError)){attempt.bestResiduals=residuals;attempt.bestIssues=geometry.issues.filter(i=>i.severity==='error'&&i.code!=='intersection')}
     if(attempt)for(const issue of geometry.issues.filter(i=>i.severity==='error'&&i.code!=='intersection'))attempt.errors[issue.code??'unknown']=(attempt.errors[issue.code??'unknown']??0)+1
    })
    if(attempt)attempt.accepted++
    result.candidates.push(candidate);result.candidates.sort((a,b)=>compare(a,b,p.targets,p.excluded));result.candidates=result.candidates.slice(0,repairLimits.maxCandidates)
   }catch(e){const key=String(e).replace(/^Error: /,'');result.rejected[key]=(result.rejected[key]??0)+1;if(attempt)attempt.errors[key]=(attempt.errors[key]??0)+1}
   if(result.checks%8===0)progress?.(result.checks,result.nodes)
  }
  if(truncated)result.status='budget-exhausted'
  result.candidates.forEach((c,i)=>{c.id=`repair-${i+1}`})
  result.reason=result.candidates.length?(result.candidates[0].geometry.valid?'找到严格 Geometry Valid 的修复候选':'仅找到部分改善：Geometry Invalid；未新增或加重现有碰撞'):'在已采样范围与预算内没有保持全部连接的改善方案；不证明连续角度域无解'
 }catch(e){result.reason=String(e).replace(/^Error: /,'')}
 result.elapsedMs=performance.now()-start;return result
}
/** Recompute permissions, propagation, metrics and full validation at apply time.
 * A worker preview is never itself an authoring command or approval. */
export function confirmConstraintRepair(history:EditorHistory,source:AngleHintSource,result:RepairResult,candidate:RepairCandidate,currentNonRepairable:readonly string[]=[]):EditorHistory{
 if(serializeAssembly3D(history.current)!==result.sourceRaw||signature(source)!==result.sourceSignature)throw Error('修复预览已过期，当前 Draft / 来源已变化；未应用')
 const keys=nonRepairableKeys(history.current,currentNonRepairable)
 if(canonical(keys)!==canonical(result.nonRepairableKeys??[]))throw Error('不可修复标记已变化，修复预览已过期；未应用')
 const p=prepare(history.current,source,result.targetKeys,{referencePieceId:result.referencePieceId,nonRepairableKeys:keys}),proposal=candidate.proposedConnection?p.proposals.find(p=>p.id===candidate.proposedConnection!.proposalId):undefined
 if(candidate.proposedConnection&&!proposal)throw Error('新增连接证据已过期；未应用')
 const checked=evaluate(p,candidate.controls,proposal?{proposal,angle:candidate.proposedConnection!.connection.dihedralDeg}:undefined)
 if(canonical(checked.assembly)!==canonical(candidate.assembly))throw Error('修复候选快照不一致；未应用')
 return commit(history,()=>checked.assembly)
}

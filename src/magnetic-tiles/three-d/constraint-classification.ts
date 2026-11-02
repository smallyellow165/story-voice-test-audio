import type {Assembly3D} from './assembly.ts'
import type {AngleHintRow} from './assembly-angle-hints.ts'
import type {ValidationResult} from './vendor/engine/types.ts'

export type ConstraintKind='preserve-coplanar'|'adjustable-fold'|'undetermined'
export type ConstraintClassification={
 kind:ConstraintKind
 reasons:string[]
 topology:{inCycle:boolean;coplanarGroups:string[][];coupledConnections:number[];coordination:'none'|'cycle-constrained'|'coordinated'}
}
/** V1 selection heuristics in degrees, NOT Validator tolerances or physical DOF.
 * A future repair may use these candidates but must still satisfy every constraint. */
export const constraintClassificationPolicy=Object.freeze({version:1,nearZero:5,coplanarHalfRange:10,maxCoplanarWidth:20,minFold:15,minAdjustableWidth:15})

/** Biconnected edge blocks in the current connection multigraph. Connections in
 * one cycle block may require coordinated solving, even without a shared Tile. */
export function cycleBlocks(assembly:Assembly3D):number[][]{
 const adj=new Map(assembly.pieces.map(p=>[p.id,[] as {to:string;edge:number}[]]))
 assembly.connections.forEach((c,edge)=>{adj.get(c.pieceA)?.push({to:c.pieceB,edge});adj.get(c.pieceB)?.push({to:c.pieceA,edge})})
 const discovery=new Map<string,number>(),low=new Map<string,number>(),stack:number[]=[],blocks:number[][]=[];let tick=0
 function visit(id:string,parentEdge=-1){
  discovery.set(id,++tick);low.set(id,tick)
  for(const {to,edge} of adj.get(id)??[]){
   if(edge===parentEdge)continue
   if(!discovery.has(to)){
    stack.push(edge);visit(to,edge);low.set(id,Math.min(low.get(id)!,low.get(to)!))
    if(low.get(to)!>=discovery.get(id)!){const block:number[]=[];let last:number;do{last=stack.pop()!;block.push(last)}while(last!==edge);if(block.length>1)blocks.push(block.sort((a,b)=>a-b))}
   }else if(discovery.get(to)!<discovery.get(id)!){stack.push(edge);low.set(id,Math.min(low.get(id)!,discovery.get(to)!))}
  }
 }
 for(const id of adj.keys())if(!discovery.has(id))visit(id)
 return blocks
}
function reachable(assembly:Assembly3D,start:string,allowed:(index:number)=>boolean){
 const seen=new Set([start]),queue=[start]
 for(let i=0;i<queue.length;i++)assembly.connections.forEach((c,index)=>{
  if(!allowed(index))return
  const other=c.pieceA===queue[i]?c.pieceB:c.pieceB===queue[i]?c.pieceA:undefined
  if(other&&!seen.has(other)){seen.add(other);queue.push(other)}
 })
 return seen
}
const normalize=(n:number)=>((n+180)%360+360)%360-180

/** Pure, read-only classification of the current graph + source-bound hints.
 * Reuses the CURRENT strict report; collision errors remain visible and never
 * become a permission to repair/approve. No Solver or Validator is invoked here.
 * Results are snapshot-local, never persisted as Assembly geometry or approval. */
export function classifyAssemblyConstraints(assembly:Assembly3D,rows:readonly AngleHintRow[],report:ValidationResult):Map<string,ConstraintClassification>{
 const policy=constraintClassificationPolicy,blocks=cycleBlocks(assembly),result=new Map<string,ConstraintClassification>()
 const byIndex=new Map(rows.filter(r=>r.connectionIndex!==undefined).map(r=>[r.connectionIndex!,r]))
 const components=new Map(assembly.pieces.map(p=>[p.id,reachable(assembly,p.id,()=>true)]))
 function uncertain(r:AngleHintRow,reason:string){result.set(r.key,{kind:'undetermined',reasons:[reason],topology:{inCycle:blocks.some(b=>b.includes(r.connectionIndex??-1)),coplanarGroups:[],coupledConnections:[],coordination:'none'}})}
 function narrow(r:AngleHintRow){
  const h=r.hint!,range=h.angleRange!,angle=r.angleInPlanDirection
  return h.angles.length>0&&h.angles.every(a=>Math.abs(normalize(a))<=policy.nearZero)&&range.min>=-policy.coplanarHalfRange&&range.max<=policy.coplanarHalfRange&&range.max-range.min<=policy.maxCoplanarWidth&&angle!==undefined&&Math.abs(normalize(angle))<=policy.coplanarHalfRange&&r.comparison==='in-range'
 }
 // An uncertain near-coplanar seam needs an alternate path of evidenced,
 // narrow-range connect hypotheses, not merely an arbitrary cycle elsewhere.
 const planarSupport=new Set<number>()
 const eligible:AngleHintRow[]=[]
 for(const r of rows){
  const c=r.current,h=r.hint
  if(!c||r.connectionIndex===undefined){uncertain(r,'尚未建立 Connection，不识别为已有约束');continue}
  if(!h||['not-comparable','no-hint','no-angle','unconnected'].includes(r.comparison)){uncertain(r,r.reason??'缺少可直接比较的 Plan 角度建议');continue}
  if(h.intent==='separate'||h.flip===null||h.portA===null||h.portB===null){uncertain(r,'接合关系、Port 或 Flip 尚未明确');continue}
  if(!h.evidence.trim()||!h.evidenceRefs.length){uncertain(r,'缺少连接证据或证据引用');continue}
  const range=h.angleRange
  if(!range||!Number.isFinite(range.min)||!Number.isFinite(range.max)||range.min>range.max||!h.angles.length||h.angles.some(a=>!Number.isFinite(a)||a<range.min||a>range.max)){
   uncertain(r,'建议范围缺失、无效或与建议值矛盾');continue
  }
  const component=components.get(c.pieceA)
  if(!component||!component.has(c.pieceB)){uncertain(r,'Connection 引用不完整，无法分析连接组件');continue}
  const structural=report.issues.find(i=>i.severity==='error'&&i.code!=='intersection'&&(
   i.connectionIndex!==undefined?component.has(assembly.connections[i.connectionIndex]?.pieceA):
   i.relatedPieceIds?.length?i.relatedPieceIds.some(id=>component.has(id)):
   i.pieceId?component.has(i.pieceId):true))
  if(structural){uncertain(r,`连接组件存在结构错误：${structural.code??'unknown'}；需先核对`);continue}
  eligible.push(r)
  if(h.intent==='connect'&&narrow(r))planarSupport.add(r.connectionIndex)
 }
 for(const r of eligible){
  const h=r.hint!,range=h.angleRange!,index=r.connectionIndex!,inCycle=blocks.some(b=>b.includes(index)),topology:ConstraintClassification['topology']={inCycle,coplanarGroups:[],coupledConnections:[],coordination:inCycle?'cycle-constrained':'none'}
  if(narrow(r)){
   if(h.intent==='uncertain'&&!reachable(assembly,r.pieceA,i=>planarSupport.has(i)).has(r.pieceB)){uncertain(r,'共面建议的接合关系不确定，缺少可印证的共面闭环');continue}
   result.set(r.key,{kind:'preserve-coplanar',topology,reasons:[`建议接近 0°、范围宽 ${range.max-range.min}°，当前约束在范围内；优先保持当前角度`,inCycle?'位于闭环；调整需检查闭环一致性':'非闭环连接；保持仅为规划优先级',...(h.intent==='uncertain'?['接合仍为 AI 不确定假设；由其余共面路径支持此候选分类，未升级为人工确认']:[])]})
  }else if(h.intent==='connect'&&range.max-range.min>=policy.minAdjustableWidth&&
   (range.min>=policy.minFold||range.max<=-policy.minFold)&&h.angles.every(a=>Math.abs(normalize(a))>=policy.minFold)){
   result.set(r.key,{kind:'adjustable-fold',topology,reasons:[`有明确接合证据及非零折角范围（宽 ${range.max-range.min}°）；仅列为后续调整变量候选`,...(r.comparison==='out-of-range'?['当前约束超出建议范围，仍需单独核对']:[])]})
  }else uncertain(r,h.intent==='uncertain'?'接合关系仍不确定；宽角度范围不能证明存在可调整接合':'建议不能明确区分共面保持与可调折角，保留待判断')
 }
 const planar=new Set(rows.filter(r=>result.get(r.key)?.kind==='preserve-coplanar').map(r=>r.connectionIndex!))
 for(const r of rows){
  const item=result.get(r.key)!
  if(item.kind==='undetermined')continue
  const a=[...reachable(assembly,r.pieceA,i=>planar.has(i))].sort(),b=[...reachable(assembly,r.pieceB,i=>planar.has(i))].sort()
  item.topology.coplanarGroups=a.includes(r.pieceB)?[a]:[a,b]
  if(item.kind==='adjustable-fold'){
   const block=blocks.find(b=>b.includes(r.connectionIndex!))??[]
   item.topology.coupledConnections=block.filter(i=>i!==r.connectionIndex&&result.get(byIndex.get(i)?.key??'')?.kind==='adjustable-fold')
   if(item.topology.coupledConnections.length){item.topology.coordination='coordinated';item.reasons.push(`同一闭环块中还包含可调候选 #${item.topology.coupledConnections.join('、#')}，必须协调求解，不能逐条独立改角度`)}
   else if(item.topology.inCycle)item.reasons.push('位于闭环；并非独立自由度，现有其余约束可能使其无法调整')
   else item.reasons.push('桥接关系；仍需检查整个子结构和其他几何约束，不代表物理铰链')
  }
 }
 return result
}

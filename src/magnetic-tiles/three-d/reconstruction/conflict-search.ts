import {hypothesisPortConflicts} from './port-constraints.ts'
import type {Assembly3D} from '../assembly.ts'
import type {Connection} from '../vendor/engine/types.ts'
import {solveAssembly3D,validateAssembly3D,assemblyValidationLayers,inspectAssemblyCollisions} from '../engine-adapter.ts'
import {candidateObservationMap,inspectSpatialConsistency} from './spatial-consistency.ts'
import type {ConnectionHypothesis3D,SpatialHypothesis3D,VisibleInput3D} from './contracts.ts'
import type {VisibleCandidate3D,VisibleExecution3D,VisibleExecutionOptions} from './execute.ts'

type Report=ReturnType<typeof validateAssembly3D>
type Context={variantIndex:number;combinationIndex:number;componentPieceIds:string[];hypotheses:ConnectionHypothesis3D[];connections:Connection[];notes:string[];label:string}
type Parent={assembly:Assembly3D;geometry:Report;context:Context}
const pair=(c:{pieceA:string;pieceB:string})=>[c.pieceA,c.pieceB].sort().join('|')
function effective(plan:SpatialHypothesis3D,input:VisibleInput3D){
 const overrides=input.review.constraints,pairs=new Set(overrides.map(pair))
 return [{label:'primary',connections:plan.connections},...plan.alternatives].map(v=>({...v,connections:[...v.connections.filter(c=>!pairs.has(pair(c))),...overrides]}))
}
function groups(ids:string[],connections:Connection[]){
 const rest=new Set(ids),out:string[][]=[]
 while(rest.size){const group=[rest.values().next().value!];rest.delete(group[0]);for(let i=0;i<group.length;i++)for(const c of connections){const next=c.pieceA===group[i]?c.pieceB:c.pieceB===group[i]?c.pieceA:null;if(next&&rest.has(next)){rest.delete(next);group.push(next)}}out.push(group.sort())}return out
}
/** This path is only applicable when EVERY supplied full interpretation has a
 * proved mandatory directional conflict. No angle/flip can repair that topology. Keep
 * its nominal poses visible, then search induced, fixed-pose local structures.
 * This is explicitly NOT an exhaustive search of angle ranges or photo poses. */
export function executeConflictedComponents(plan:SpatialHypothesis3D,input:VisibleInput3D,options:VisibleExecutionOptions,key:(a:Assembly3D)=>string):VisibleExecution3D|null{
 const variants=effective(plan,input),conflicts=variants.map(v=>hypothesisPortConflicts(v.connections.filter(c=>c.intent==='connect'),input).conflicts)
 if(!conflicts.every(c=>c.length))return null
 const maxAssignments=options.maxAssignments??128,maxGeometryChecks=options.maxGeometryChecks??256,topK=options.topK??5,maxSubsets=options.maxLocalSubsets??1024,parentLimit=options.maxLocalParents??32,maxDiagnostics=options.maxDiagnosticCandidates??8
 for(const [value,min,max]of [[maxAssignments,0,2048],[maxGeometryChecks,0,4096],[topK,1,20],[maxSubsets,0,8192],[parentLimit,1,64],[maxDiagnostics,1,20]])if(!Number.isSafeInteger(value)||value<min||value>max)throw Error('Geometry Execution 搜索预算无效')
 const known=input.review.pieces.filter(p=>p.confirmed&&!p.excluded&&p.profileId),confirmed=input.review.pieces.filter(p=>p.confirmed&&!p.excluded),excluded=input.review.pieces.filter(p=>p.excluded).map(p=>p.id)
 const valid=new Map<string,VisibleCandidate3D>(),failed=new Map<string,Parent>(),cache=new Set<string>(),diagnostics=new Set<string>()
 const local={considered:0,geometryChecks:0,deduplicated:0,maxSubsets,parents:0,parentLimit,parentsTruncated:false,complete:true,proofPruned:0,componentSplits:0}
 const componentSearch={scope:'nominal-fixed-pose-component-subgraphs' as const,fullHypothesisSearchComplete:false as const,fullGraphsProvenInvalid:true as const,cacheHits:0,mandatoryPortConflicts:conflicts.map((ports,variantIndex)=>({variantIndex,ports}))}
 const search={assignments:0,geometryChecks:0,maxAssignments,maxGeometryChecks,localSearch:local,componentSearch}
 let exhausted=false
 diagnostics.add('FULL_GRAPH_PORT_CONFLICT: 每个完整解释都存在已证明的 Port 方向冲突；角度枚举无法修复，原假设保留。')
 diagnostics.add('SEARCH_SCOPE: 已终止被证明非法的完整图搜索；仅检查模型明确角度/区间中点的名义组件与继承 Pose 的连通局部子图。未穷尽角度、flip 或照片空间解释。completeSearch 只对应此有限局部搜索范围。')
 if(input.review.constraints.length)diagnostics.add('REVIEW_CONSTRAINTS: 人工同对约束优先；合法局部候选仍须包含所有人工 connect 约束。')
 const notes=(hypotheses:ConnectionHypothesis3D[],uncertain:boolean)=>hypotheses.flatMap(c=>c.intent==='separate'?[`${pair(c)}: separate 的空间距离未标定`]:!c.portA||!c.portB||!c.angles.length&&!c.angleRange?[`${pair(c)}: Unknown Port/二面角，未执行连接`]:c.intent==='uncertain'&&!uncertain?[`${pair(c)}: uncertain 连接在此名义解释中未采用`]:c.angleRange||c.angles.length>1||c.flip===null?[`${pair(c)}: 名义角度/flip 仅为搜索种子；其他候选和连续区间未穷尽`]:[])
 function candidate(assembly:Assembly3D,geometry:Report,context:Context,kind:'candidate'|'diagnostic',source:'component'|'local-subgraph'):VisibleCandidate3D{
  const ids=assembly.pieces.map(p=>p.id),set=new Set(ids),omitted=context.hypotheses.filter(c=>c.intent!=='separate'&&(!set.has(c.pieceA)||!set.has(c.pieceB)||!assembly.connections.some(x=>pair(x)===pair(c))))
  return {id:'pending',kind,assembly:structuredClone(assembly),geometry,validation:assemblyValidationLayers(geometry),observationMap:candidateObservationMap(assembly,input),spatialConsistency:inspectSpatialConsistency(assembly,input),coverage:{reconstructed:ids,unresolved:input.review.pieces.filter(p=>!p.excluded&&!set.has(p.id)).map(p=>p.id),excluded,totalConfirmed:confirmed.length},photoMatch:{status:'unverified',score:null},rank:0,frame:'component-local-unregistered',interpretation:context.label,
   construction:{variantIndex:context.variantIndex,combinationIndex:context.combinationIndex,componentPieceIds:context.componentPieceIds,source,omittedHypotheses:structuredClone(omitted),parentConnections:structuredClone(context.connections)},
   unverifiedConstraints:[...context.notes,...plan.unknowns,...plan.relations.map(r=>`${r.from}/${r.to}: ${r.kind} 图片关系未作重投影验证`),'SEARCH_SCOPE: 名义固定 Pose 的局部结构，未穷尽角度范围或整体空间布局。','绝对位置、相机、世界朝向、照片匹配与物理稳定性未验证。',...input.profiles.filter(s=>s.profile.sizeEvidence?.status==='estimated').map(s=>`Profile ${s.profile.id}@${s.profile.version} 的尺寸来源为 estimated，几何合法不证明实物尺寸`),...(ids.length<confirmed.length?['PARTIAL: 未解决实例未生成；不可把局部候选当作完整作品。']:[]),...(omitted.length?[`CONSTRAINT_COVERAGE: ${omitted.length} 条原连接假设未实现。`]:[]),...(kind==='diagnostic'?['DIAGNOSTIC_ONLY: 严格 Validator 未通过，禁止普通采用。']:[])]}
 }
 function keep(assembly:Assembly3D,geometry:Report,context:Context,source:'component'|'local-subgraph'){
  const c=candidate(assembly,geometry,context,'candidate',source)
  const manual=input.review.constraints.filter(c=>c.intent==='connect')
  if(manual.some(c=>!assembly.connections.some(x=>pair(x)===pair(c)))){diagnostics.add('REVIEW_REQUIRED: 局部结构缺少人工 connect 约束，不提供可采用 Candidate。');return}
  if((input.review.spatialChecks??[]).some(check=>(check.relation==='plane-angle'||check.relation==='shared-edge')&&![check.pieceA,check.pieceB].every(id=>assembly.pieces.some(p=>p.id===id)))){diagnostics.add('REVIEW_REQUIRED: 局部结构缺少已审核相对空间检查的实例。');return}
  if(c.spatialConsistency?.status==='contradicted'){diagnostics.add('SPATIAL_REJECTED: '+JSON.stringify(c.spatialConsistency));return}
  valid.set(key(assembly),c)
 }
 for(const [variantIndex,variant]of variants.entries())for(const uncertain of [true,false]){
  if(search.assignments>=maxAssignments){exhausted=true;break}
  search.assignments++
  const connections:Connection[]=variant.connections.filter(c=>c.intent==='connect'||uncertain&&c.intent==='uncertain').filter(c=>c.portA&&c.portB&&(c.angles.length||c.angleRange)).map(c=>({pieceA:c.pieceA,pieceB:c.pieceB,portA:c.portA!,portB:c.portB!,dihedralDeg:c.angles[0]??(c.angleRange!.min+c.angleRange!.max)/2,flip:c.flip??false}))
  const components=groups(known.map(p=>p.id),connections)
  if(components.length>1)diagnostics.add('MULTIPLE_COMPONENTS: 组件间深度/位置未知，分别输出局部候选，不伪造整体空间布局。')
  for(const ids of components){
   const set=new Set(ids),cs=connections.filter(c=>set.has(c.pieceA)&&set.has(c.pieceB)),cacheKey=JSON.stringify([ids,cs])
   if(cache.has(cacheKey)){componentSearch.cacheHits++;continue}
   if(search.geometryChecks>=maxGeometryChecks){exhausted=true;break}cache.add(cacheKey);search.geometryChecks++
   const context:Context={variantIndex,combinationIndex:search.assignments,componentPieceIds:ids,hypotheses:variant.connections,connections,notes:notes(variant.connections,uncertain),label:variant.label+(uncertain?' · nominal uncertain-on':' · nominal uncertain-off')}
   const a:Assembly3D={kind:'magnetic-assembly-3d',schemaVersion:1,id:'visible-candidate',revision:0,profiles:structuredClone(input.profiles),pieces:known.filter(p=>set.has(p.id)).map(p=>({id:p.id,profileId:p.profileId!,profileVersion:p.profileVersion!,color:p.color,pose:{position:[0,0,0],quaternion:[0,0,0,1]}})),connections:cs}
   try{const assembly=solveAssembly3D(a),geometry=validateAssembly3D(assembly);if(geometry.valid)keep(assembly,geometry,context,'component');else{diagnostics.add('GEOMETRY_REJECTED: '+JSON.stringify(geometry));const k=key(assembly);if(!failed.has(k))failed.set(k,{assembly,geometry,context})}}
   catch(e){diagnostics.add('SOLVER_REJECTED: '+String(e))}
  }
  if(exhausted)break
 }
 const parentOrder=[...failed.values()].sort((a,b)=>b.assembly.pieces.length-a.assembly.pieces.length||b.assembly.connections.length-a.assembly.connections.length||key(a.assembly).localeCompare(key(b.assembly))),parents=parentOrder.slice(0,parentLimit)
 local.parents=parents.length;local.parentsTruncated=maxSubsets>0&&parents.length<parentOrder.length
 // Invalidity witnesses are exact for induced subsets with unchanged poses:
 // collision pair, residual edge, or both edges occupying the same port.
 function witness(parent:Parent,ids:Set<string>):string[]|undefined{
  for(const issue of parent.geometry.issues.filter(i=>i.severity==='error')){
   let members:string[]=[]
   if(issue.code==='intersection')members=issue.relatedPieceIds??[]
   else if(issue.code==='port-reuse'&&issue.relatedPieceIds?.length)members=[...new Set([issue.pieceId!,...issue.relatedPieceIds])]
   else if(issue.code==='port-reuse'&&issue.portId&&issue.pieceId){const cs=parent.assembly.connections.filter(c=>c.pieceA===issue.pieceId&&c.portA===issue.portId||c.pieceB===issue.pieceId&&c.portB===issue.portId).slice(0,2);if(cs.length===2)members=[...new Set(cs.flatMap(c=>[c.pieceA,c.pieceB]))]}
   else if(issue.connectionIndex!==undefined){const c=parent.assembly.connections[issue.connectionIndex];if(c)members=[c.pieceA,c.pieceB]}
   if(members.length&&members.every(id=>ids.has(id)))return members
  }
 }
 type Node={parent:Parent;ids:string[]}
 const queue:Node[]=[],seen=new Set<string>()
 function enqueue(parent:Parent,ids:string[]){if(!ids.length)return;const set=new Set(ids),a={...parent.assembly,pieces:parent.assembly.pieces.filter(p=>set.has(p.id)),connections:parent.assembly.connections.filter(c=>set.has(c.pieceA)&&set.has(c.pieceB))},k=key(a);if(seen.has(k)){local.deduplicated++;return}seen.add(k);queue.push({parent,ids})}
 if(maxSubsets>0&&!exhausted)for(const parent of parents)enqueue(parent,parent.assembly.pieces.map(p=>p.id).sort())
 while(queue.length&&!exhausted){
  if(local.considered>=maxSubsets){local.complete=false;break}
  queue.sort((a,b)=>b.ids.length-a.ids.length||a.parent.context.variantIndex-b.parent.context.variantIndex||a.ids.join('|').localeCompare(b.ids.join('|')))
  const {parent,ids}=queue.shift()!;local.considered++
  const set=new Set(ids),connections=parent.assembly.connections.filter(c=>set.has(c.pieceA)&&set.has(c.pieceB)),components=groups(ids,connections)
  if(components.length>1){local.componentSplits++;for(const group of components)enqueue(parent,group);continue}
  let conflict=witness(parent,set)
  if(conflict)local.proofPruned++
  else{
   if(search.geometryChecks>=maxGeometryChecks){local.complete=false;exhausted=true;break}
   const assembly={...structuredClone(parent.assembly),pieces:structuredClone(parent.assembly.pieces.filter(p=>set.has(p.id))),connections:structuredClone(connections)}
   search.geometryChecks++;local.geometryChecks++;const geometry=validateAssembly3D(assembly)
   if(geometry.valid){keep(assembly,geometry,parent.context,'local-subgraph');continue}
   conflict=witness({assembly,geometry,context:parent.context},set)??ids
   diagnostics.add('LOCAL_GEOMETRY_REJECTED: '+JSON.stringify({pieces:ids,geometry}))
  }
  for(const id of conflict)enqueue(parent,ids.filter(p=>p!==id))
 }
 if(local.parentsTruncated||exhausted)local.complete=false
 const completeSearch=!exhausted&&local.complete
 if(!completeSearch)diagnostics.add('BUDGET_EXHAUSTED: 有限局部搜索范围未完成；保留 Diagnostic，不提供可采用 Candidate。')
 if(!local.complete)diagnostics.add('LOCAL_BUDGET_EXHAUSTED: 局部队列或父结构预算未完成。')
 const candidates=completeSearch?[...valid.values()].sort((a,b)=>b.coverage.reconstructed.length-a.coverage.reconstructed.length||a.unverifiedConstraints.length-b.unverifiedConstraints.length||key(a.assembly).localeCompare(key(b.assembly))).slice(0,topK):[]
 candidates.forEach((c,i)=>{c.id=`candidate-${i+1}`;c.rank=i+1;c.assembly.id=`visible-${i+1}`})
 const diagnosticCandidates=parentOrder.slice(0,maxDiagnostics).map((p,i)=>{const c=candidate(p.assembly,p.geometry,p.context,'diagnostic','component');c.id=`diagnostic-${i+1}`;c.rank=i+1;c.assembly.id=c.id;c.collisions=inspectAssemblyCollisions(p.assembly,p.geometry);return c})
 return {version:4,status:!completeSearch?'budget_exhausted':candidates.length?'candidates_found':'no_valid_candidate',completeSearch,search,candidates,diagnosticCandidates,diagnostics:[...diagnostics].slice(0,50)}
}

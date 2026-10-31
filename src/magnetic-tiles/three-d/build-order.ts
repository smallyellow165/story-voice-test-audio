import { Box3, OrthographicCamera, Vector3 } from 'three'
import type { Assembly3D } from './assembly.ts'
import { assertAssembly3D } from './assembly.ts'
import { validateAssembly3D } from './engine-adapter.ts'
import { createViewerModel, componentCount } from './viewer-model.ts'
import { pieceWorldVertices, computeFitCamera } from './vendor/components/magnet3d/cameraUtils.ts'
import { assertTutorial3D, syncStepConnections, assertCamera } from './tutorial.ts'
import type { Tutorial3D } from './tutorial.ts'
import { canonical } from '../build-plan.ts'

export const BUILD_ORDER_VERSION = 'geometry-beam-v1'
export type BuildOrderOptions = {
  maxEvaluations?: number; maxTransitions?: number; beamWidth?: number
  requireGroundedStart?: boolean; maxConnectionsPerStep?: number
}
export const DEFAULT_BUILD_ORDER_OPTIONS = {
  maxEvaluations: 2000, maxTransitions: 12000, beamWidth: 12,
  requireGroundedStart: false, maxConnectionsPerStep: 64,
}
export type BuildOrderStatus = 'complete' | 'budget-exhausted' | 'search-limited' | 'no-order' | 'invalid-assembly' | 'input-limit' | 'invalid-options'
export type BuildOrderDiagnostic = { code: string; severity: 'warning' | 'error'; message: string; stepId?: number; pieceId?: string }
export type StepEstimate = {
  stepId: number; pieceId: string; geometryValid: boolean; connected: boolean; groundContact: boolean
  newConnections: number; loopClosures: number; supportBelow: boolean; overhang: number
  score: number; terms: Record<string, number>; warnings: string[]
}
export type BuildOrderResult = {
  version: typeof BUILD_ORDER_VERSION; status: BuildOrderStatus; tutorial: Tutorial3D | null
  finalGeometryValid: boolean | null; connectedConstruction: boolean
  buildabilityEstimate: 'review-required' | 'incomplete' | 'not-assessed'; physicalStability: 'not-assessed'
  diagnostics: BuildOrderDiagnostic[]; estimates: StepEstimate[]
  stats: { evaluations: number; transitions: number; cacheHits: number; rejectedGeometry: number; rejectedConstraints: number
    beamPruned: number; mergedSubsets: number; completeCandidates: number; deepest: number; bestScore: number | null
    termination: string; options: Required<BuildOrderOptions> }
}
const compare = (a: string,b: string) => a < b ? -1 : a > b ? 1 : 0
const round = (n: number) => Number(n.toFixed(9))
const groundTolerance = .02 // Same world-unit contact hint as Phase 4, not a stability threshold.
const optionsValid = (o: Required<BuildOrderOptions>) => [
  [o.maxEvaluations,0,10000], [o.maxTransitions,0,100000], [o.beamWidth,1,32], [o.maxConnectionsPerStep,1,512],
].every(([n,lo,hi])=>Number.isSafeInteger(n)&&n>=lo&&n<=hi) && typeof o.requireGroundedStart==='boolean'
// Stable document identity, not a security hash. Source matching still compares the full snapshot.
function identity(text: string) {
  let a=2166136261,b=0x9e3779b9
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),2246822519)}
  return `${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}`
}
/** Bounded, deterministic beam/DP search. No solver, input mutation or installation-path simulation. */
export function generateBuildOrder3D(input: Assembly3D, options: BuildOrderOptions = {}): BuildOrderResult {
  const config={...DEFAULT_BUILD_ORDER_OPTIONS,...options}
  const result: BuildOrderResult={version:BUILD_ORDER_VERSION,status:'no-order',tutorial:null,finalGeometryValid:null,
    connectedConstruction:false,buildabilityEstimate:'not-assessed',physicalStability:'not-assessed',diagnostics:[],estimates:[],
    stats:{evaluations:0,transitions:0,cacheHits:0,rejectedGeometry:0,rejectedConstraints:0,beamPruned:0,mergedSubsets:0,completeCandidates:0,deepest:0,bestScore:null,termination:'',options:config}}
  const diagnostic=(code:string,message:string,severity:'warning'|'error'='warning')=>result.diagnostics.push({code,message,severity})
  const stop=(status:BuildOrderStatus,code:string,message:string)=>{result.status=status;result.stats.termination=code;diagnostic(code,message,'error');return result}
  if(!optionsValid(config))return stop('invalid-options','INVALID_OPTIONS','预算、束宽或连接上限超出 V1 支持范围。')
  // Limit work before invoking an O(n²) geometry check. These are planner limits, not Engine restrictions.
  if(!input || !Array.isArray(input.pieces)||!Array.isArray(input.profiles)||!Array.isArray(input.connections))return stop('invalid-assembly','INVALID_DOCUMENT','缺少 Assembly3D 数据。')
  if(input.pieces.length>64||input.connections.length>512||input.profiles.reduce((s,p)=>s+(p?.profile?.vertices?.length??0),0)>4096)
    return stop('input-limit','INPUT_LIMIT','V1 上限：64 片、512 条连接、Profile 顶点合计 4096。请拆分作品或手动编排。')
  try{assertAssembly3D(input)}catch(e){return stop('invalid-assembly','INVALID_DOCUMENT',String(e))}
  if(!input.pieces.length)return stop('invalid-assembly','EMPTY_ASSEMBLY','空作品不能生成搭建顺序。')
  const vertexCount=input.pieces.reduce((sum,p)=>sum+2*input.profiles.find(s=>s.profile.id===p.profileId&&s.profile.version===p.profileVersion)!.profile.vertices.length,0)
  if(vertexCount>16384)return stop('input-limit','OUTLINE_LIMIT','实例世界轮廓超过 16384 顶点，未启动几何搜索。')
  if(config.maxEvaluations===0)return stop('budget-exhausted','EVALUATION_BUDGET','几何检查预算为 0，尚未检查来源作品。')
  const pieces=createViewerModel(input).map(piece=>{
    const vertices=pieceWorldVertices(piece.shape,piece.transform.position,piece.transform.quaternion)
    const bounds=new Box3().setFromPoints(vertices),normal=new Vector3(0,0,1).applyQuaternion(piece.transform.quaternion)
    const contact=vertices.filter(v=>Math.abs(v.y)<=groundTolerance)
    const key=canonical(vertices.map(v=>v.toArray().map(round)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]))
    return {...piece,vertices,bounds,normal,contact,key,ground:contact.length>0,
      footprint:contact.length>0?piece.shape.area*Math.abs(normal.y):0}
  }).sort((a,b)=>compare(a.key,b.key)||compare(a.id,b.id))
  if(pieces.some(p=>p.vertices.some(v=>!v.toArray().every(Number.isFinite)))||pieces.reduce((s,p)=>s+p.vertices.length,0)>16384)
    return stop('input-limit','OUTLINE_LIMIT','世界轮廓超出 V1 有限顶点预算。')
  const n=pieces.length,all=(1n<<BigInt(n))-1n,index=new Map(pieces.map((p,i)=>[p.id,i]))
  const bit=(i:number)=>1n<<BigInt(i),has=(mask:bigint,i:number)=>(mask&bit(i))!==0n
  const edgeLengths=pieces.flatMap(p=>p.shape.ports.map(port=>port.length)).sort((a,b)=>a-b)
  const length=Math.max(edgeLengths[Math.floor(edgeLengths.length/2)]??Math.sqrt(pieces[0].shape.area),1e-9)
  if(!Number.isFinite(length)||pieces.some(p=>p.vertices.some(v=>v.toArray().some(x=>Math.abs(x)>1e6))))
    return stop('input-limit','COORDINATE_LIMIT','V1 不处理绝对世界坐标超过 10⁶ 的结构。')
  const finalCheck=validateAssembly3D(input,{checkGround:true});result.stats.evaluations++
  const geometryOK=(check:ReturnType<typeof validateAssembly3D>)=>!check.issues.some(i=>i.severity==='error'&&i.code!=='ground')
  result.finalGeometryValid=geometryOK(finalCheck)
  if(!result.finalGeometryValid){
    for(const i of finalCheck.issues)result.diagnostics.push({code:i.code??'FINAL_GEOMETRY',message:i.message,severity:i.severity,pieceId:i.pieceId})
    return stop('invalid-assembly','FINAL_GEOMETRY_INVALID','最终 Assembly Geometry Invalid；未生成教程。')
  }
  const components=componentCount(input)
  if(components!==1)return stop('no-order','DISCONNECTED_SOURCE',`最终几何合法，但有 ${components} 个组件；V1 要求从单片开始并保持累计结构连通，无法覆盖全部零件。`)
  const graph=pieces.map(()=>[] as {other:number; midY:number; angle:number}[])
  // Sort arithmetic inputs too, so connection-array order has no effect on floating-point accumulation.
  const connections=[...input.connections].sort((a,b)=>compare(canonical(a),canonical(b)))
  for(const c of connections){
    const a=index.get(c.pieceA)!,b=index.get(c.pieceB)!,p=pieces[a],port=p.shape.ports.find(port=>port.portId===c.portA)!
    const mid=new Vector3((port.p0.x+port.p1.x)/2,(port.p0.y+port.p1.y)/2,0).applyQuaternion(p.transform.quaternion).add(p.transform.position)
    graph[a].push({other:b,midY:mid.y,angle:Math.abs(c.dihedralDeg)})
    graph[b].push({other:a,midY:mid.y,angle:Math.abs(c.dihedralDeg)})
  }
  type Checked = { valid:boolean; validationWarnings:string[] }
  const cache=new Map<bigint,Checked>([[all,{valid:true,validationWarnings:finalCheck.issues.filter(i=>i.code==='ground'||i.severity==='warning').map(i=>i.message)}]])
  const rejected:BuildOrderDiagnostic[]=[]
  let exhausted=''
  function check(mask:bigint):Checked|null{
    const saved=cache.get(mask);if(saved){result.stats.cacheHits++;return saved}
    if(result.stats.evaluations>=config.maxEvaluations){exhausted='EVALUATION_BUDGET';return null}
    const ids=new Set(pieces.filter((_,i)=>has(mask,i)).map(p=>p.id))
    const check=validateAssembly3D({...input,pieces:input.pieces.filter(p=>ids.has(p.id)),connections:input.connections.filter(c=>ids.has(c.pieceA)&&ids.has(c.pieceB))},{checkGround:true,requireConnected:true})
    result.stats.evaluations++
    const value={valid:geometryOK(check),validationWarnings:check.issues.filter(i=>i.code==='ground'||i.severity==='warning').map(i=>i.message)}
    cache.set(mask,value);if(!value.valid){result.stats.rejectedGeometry++;if(rejected.length<3){const issue=check.issues.find(i=>i.severity==='error'&&i.code!=='ground');if(issue)rejected.push({code:issue.code??'REJECTED_PREFIX',severity:'warning',message:`候选前缀被拒绝：${issue.message}`,pieceId:issue.pieceId})}}
    return value
  }
  type State={mask:bigint;order:number[];score:number;estimates:StepEstimate[]}
  const stateKey=(s:State)=>s.order.map(i=>String(i).padStart(2,'0')).join('.')
  const compareState=(a:State,b:State)=>a.score-b.score||compare(stateKey(a),stateKey(b))
  let beam:State[]=[{mask:0n,order:[],score:0,estimates:[]}],best=beam[0],complete:State|null=null
  for(let depth=0;depth<n;depth++){
    const next=new Map<bigint,State>()
    for(const state of beam){for(let i=0;i<n;i++){
      if(has(state.mask,i))continue
      if(result.stats.transitions>=config.maxTransitions){exhausted='TRANSITION_BUDGET';break}
      result.stats.transitions++
      const p=pieces[i],links=graph[i].filter(e=>has(state.mask,e.other))
      if((depth>0&&!links.length)||(depth===0&&config.requireGroundedStart&&!p.ground)||links.length>config.maxConnectionsPerStep){result.stats.rejectedConstraints++;continue}
      const mask=state.mask|bit(i),checked=check(mask);if(!checked)break;if(!checked.valid)continue
      const supportBelow=links.some(e=>e.midY<p.transform.position.y-length*.1)
      const groundVertices=pieces.filter((_,j)=>has(mask,j)).flatMap(p=>p.contact)
      const footprint=new Box3().setFromPoints(groundVertices),center=p.transform.position
      const overhang=groundVertices.length?Math.hypot(Math.max(footprint.min.x-center.x,0,center.x-footprint.max.x),Math.max(footprint.min.z-center.z,0,center.z-footprint.max.z))/length:0
      const closures=Math.max(0,links.length-1),progress=depth/Math.max(1,n-1)
      // Soft access estimate: defer a horizontal cover while unplaced pieces remain below its footprint.
      // This is geometric lookahead, not an installation-path collision test or a special-case lid rule.
      const coveredUnplaced=Math.abs(p.normal.y)>.7?pieces.filter((other,j)=>j!==i&&!has(mask,j)&&
        other.transform.position.y<center.y-length*.1&&
        Math.min(other.bounds.max.x,p.bounds.max.x)-Math.max(other.bounds.min.x,p.bounds.min.x)>length*.001&&
        Math.min(other.bounds.max.z,p.bounds.max.z)-Math.max(other.bounds.min.z,p.bounds.min.z)>length*.001).length:0
      const terms={
        base:depth===0?(p.ground?0:24)+(1-Math.abs(p.normal.y))*6-Math.min(8,p.footprint/(length*length)*4):0,
        height:Math.max(0,p.bounds.min.y)/length*.3+Math.max(0,center.y)/length*.2,
        support:depth>0&&!p.ground?(supportBelow?1:3):0,
        overhang:overhang*3,
        closure:closures*(4+(1-progress)*6),
        access:coveredUnplaced*Math.abs(p.normal.y)*3,
        connection:-Math.min(links.length,2)*.6,
      }
      const cost=round(Object.values(terms).reduce((sum,v)=>sum+v,0)),warnings:string[]=[]
      if(depth===0&&!p.ground)warnings.push('基础片未接触地面，需要外部托持。')
      if(depth===0&&p.ground&&p.footprint<length*length*.05)warnings.push('基础仅窄边接地；站立稳定性未验证。')
      if(depth>0&&!p.ground)warnings.push(supportBelow?'下方存在连接，但承重与磁力仍需人工确认。':'依靠侧边/上方连接或托持；存在悬空、悬臂风险。')
      if(links.length===1&&!p.ground)warnings.push('仅一条连接承接新片，安装时可能需要扶持。')
      if(overhang>.05)warnings.push('零件中心超出当前地面接触包围范围，存在支撑风险。')
      if(closures)warnings.push(`本步同时形成 ${links.length} 条连接、闭合 ${closures} 个图环；安装路径与操作空间尚未验证。`)
      if(coveredUnplaced)warnings.push(`其下方投影范围仍有 ${coveredUnplaced} 片未安装，可能遮挡后续操作空间。`)
      warnings.push(...checked.validationWarnings)
      const estimate:StepEstimate={stepId:depth+1,pieceId:p.id,geometryValid:true,connected:true,groundContact:p.ground,newConnections:links.length,loopClosures:closures,supportBelow,overhang:round(overhang),score:cost,terms,warnings}
      const candidate:State={mask,order:[...state.order,i],score:round(state.score+cost),estimates:[...state.estimates,estimate]}
      if(candidate.order.length>best.order.length||candidate.order.length===best.order.length&&compareState(candidate,best)<0)best=candidate
      if(mask===all){result.stats.completeCandidates++;if(!complete||compareState(candidate,complete)<0)complete=candidate}
      const old=next.get(mask)
      if(old)result.stats.mergedSubsets++
      if(!old||compareState(candidate,old)<0)next.set(mask,candidate)
    }if(exhausted)break}
    const ranked=[...next.values()].sort(compareState)
    result.stats.beamPruned+=Math.max(0,ranked.length-config.beamWidth)
    beam=ranked.slice(0,config.beamWidth)
    if(exhausted||!beam.length)break
  }
  const chosen=complete??best
  result.stats.deepest=chosen.order.length;result.stats.bestScore=chosen.order.length?chosen.score:null
  result.estimates=chosen.estimates
  result.status=complete?'complete':exhausted?'budget-exhausted':result.stats.beamPruned?'search-limited':'no-order'
  result.stats.termination=complete?(exhausted||'COMPLETE'):exhausted|| (result.stats.beamPruned?'BEAM_EXHAUSTED':'NO_ADMISSIBLE_ORDER')
  result.connectedConstruction=!!complete
  result.buildabilityEstimate=complete?'review-required':chosen.order.length?'incomplete':'not-assessed'
  if(!complete)result.diagnostics.push(...rejected)
  if(!complete)diagnostic(result.stats.termination,exhausted?'搜索预算耗尽；未找到完整顺序。候选仅为已检查的部分 Draft。':result.stats.beamPruned?'受束宽裁剪限制，未找到完整顺序；不能据此断言不存在其他顺序。':'在当前单片、连通、接地/新增连接上限约束下，无可行顺序。','error')
  if(result.stats.beamPruned||exhausted&&complete)diagnostic('SEARCH_TRUNCATED','搜索经过预算或束宽裁剪，结果不是全局最优性证明。')
  diagnostic('PHYSICAL_STABILITY_UNKNOWN','Physical Stability 未评估：不包含磁力、重量、摩擦或承重模拟。')
  diagnostic('INSTALLATION_PATH_UNCHECKED','Buildability Estimate 仅为启发式审核建议；没有验证连续安装路径、手部空间或真实折叠。')
  for(const e of chosen.estimates)for(const warning of e.warnings)result.diagnostics.push({code:e.loopClosures?'CLOSURE_OR_SUPPORT_RISK':'SUPPORT_RISK',severity:'warning',message:warning,stepId:e.stepId,pieceId:e.pieceId})
  if(!chosen.order.length)return result
  const source=structuredClone(input)
  const tutorial:Tutorial3D={kind:'magnetic-tutorial-3d',schemaVersion:1,id:`auto3d-${identity(canonical({source,config,order:chosen.order.map(i=>pieces[i].id)}))}`,
    revision:0,title:'自动 3D 搭建顺序 · 待审核',source:{assemblyId:source.id,assemblyRevision:source.revision},assembly:source,steps:[]}
  const visible:typeof pieces=[]
  for(const [stepIndex,i] of chosen.order.entries()){
    const p=pieces[i],e=chosen.estimates[stepIndex];visible.push(p)
    const step:Tutorial3D['steps'][number]={id:stepIndex+1,title:stepIndex===0?'放置基础片':`连接第 ${stepIndex+1} 片`,
      description:`${p.id} · ${p.shape.id}：${stepIndex===0?'按保存位姿放置基础片':`按保存位姿接上 ${e.newConnections} 条来源连接`}${e.loopClosures?`，其中闭合 ${e.loopClosures} 个图环`:''}。`,
      parentGuide:stepIndex===0?`${BUILD_ORDER_VERSION} 原始规划记录：${result.status}；${result.stats.evaluations}/${config.maxEvaluations} 次几何检查，${result.stats.transitions}/${config.maxTransitions} 次候选展开，束宽 ${config.beamWidth}，评分 ${chosen.score}。修改步骤后原评分不再代表当前顺序。物理稳定性和安装路径未验证。`:'',
      addedPieceIds:[p.id],addedConnections:[],hint:`自动规划时的建议（修改后以实时 Diagnostic 为准）：${e.warnings.join('；')||'按保存位置连接；实际托持与操作便利性仍需人工确认。'}`,
      focusPoints:[`原始增量评分 ${e.score}：${Object.entries(e.terms).map(([k,v])=>`${k}=${round(v)}`).join('，')}`],
      entrance:{[p.id]:{type:'fade',delayMs:0,durationMs:800,easing:'easeOutCubic'}}}
    const fit=computeFitCamera({worldVertices:visible.flatMap(p=>p.vertices),camera:new OrthographicCamera(-450,450,325,-325,.001,100),size:{width:900,height:650},preferredView:'threeQuarter'})
    if(fit){
      const camera={position:fit.position.toArray(),target:fit.target.toArray(),zoom:Math.max(.01,Math.min(100000,fit.zoom)),transitionMs:800}
      try{assertCamera(camera);step.camera=camera}catch{diagnostic('CAMERA_UNAVAILABLE',`步骤 ${step.id} 未能生成可靠观察镜头，请手动设置。`)}
    }
    tutorial.steps.push(step)
  }
  syncStepConnections(tutorial)
  try{assertTutorial3D(tutorial);result.tutorial=tutorial}catch(e){return stop('input-limit','TUTORIAL_LIMIT',`候选不能保存为现有 Tutorial3D：${String(e)}`)}
  return result
}

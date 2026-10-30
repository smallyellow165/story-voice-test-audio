import { diagnosticCollector, spatialEvidence } from './execution-trace.ts'
import type { ExecutionTrace, FailedAttempt, AttemptedConnection } from './execution-trace.ts'
// Image-space fitting is approximate. All committed connections still use geometry.ts EPS.
import { alignEdge, distance, edges, validate, vertices, EPS } from '../geometry.ts'
import type { Profile, Tile, Vec, WorkMode } from '../geometry.ts'
import { parseEvidence } from './contracts.ts'
import type { Candidate, Evidence, Observation } from './contracts.ts'
export const reconstructionVersion = 'planar-outline-v2'
const MAX_STATES = 6000, MAX_TRIALS = 100000, MAX_ERROR = .30
const mean = (v: Vec[]): Vec => [v.reduce((s,p)=>s+p[0],0)/v.length,v.reduce((s,p)=>s+p[1],0)/v.length]
const variants = (v: Vec[]) => [v,[...v].reverse()].flatMap(a=>a.map((_,i)=>[...a.slice(i),...a.slice(0,i)]))
const rms = (a: Vec[],b: Vec[]) => Math.sqrt(a.reduce((s,p,i)=>s+distance(p,b[i])**2,0)/a.length)
export function reconstruct(input: Evidence, width: number, height: number, profiles: readonly Profile[], assemblyId: string, mode: WorkMode = 'connected-construction', limits: {states?:number;trials?:number} = {}) {
  const stateLimit=Math.min(MAX_STATES,limits.states??MAX_STATES), trialLimit=Math.min(MAX_TRIALS,limits.trials??MAX_TRIALS)
  if(!Number.isInteger(stateLimit)||stateLimit<1||!Number.isInteger(trialLimit)||trialLimit<1)throw Error('搜索预算无效')
  const evidence = parseEvidence(input), diagnostics: string[] = [], observations = evidence.observations.filter(o=>!o.excluded)
  const trace:ExecutionTrace={schemaVersion:1,phase:'admission',input:{evidence:structuredClone(evidence),width,height,profiles:structuredClone(profiles),mode},planning:spatialEvidence(evidence,width,height,profiles),search:{parameters:{stateLimit,trialLimit,maxOutlineRms:MAX_ERROR,eps:EPS,maxSolutionsPerGroup:3,maxCandidates:3,anchorDistanceLimit:3,mirroring:false},ranking:'Bounded representative Top 10 of observed failures, not global optimization: blocked required domains first; one pair/stage representative before alternatives; then placed count descending, attempted RMS ascending, trial index, geometric key. Diagnostic rechecks never affect search.'}}
  const collector=diagnosticCollector(profiles)
  const empty = () => ({ diagnosticCandidates:[],trace,candidates: [] as Candidate[], diagnostics, explored: 0, trials: 0, truncated: false, outcome: 'failed' as const })
  const unknown=observations.filter(o=>o.profileId==='unknown')
  if(unknown.length)diagnostics.push('未解决的 Unknown：'+unknown.map(o=>o.id).join('、')+'。证据已保留；请匹配经过核实的 Profile，或明确排除后仅重建子集。')
  if (evidence.sourceKind === 'unsupported') diagnostics.push('输入审核未完成：当前 Review 的「输入类别」仍为 unsupported，尚未进入几何搜索。Known 只表示已选择 Profile；请在识别审核中确认采用部分是「二维平铺照片」或「平面示意图」，保存新 Review 后再生成。若存在三维、堆叠或无法确定的遮挡，请保留不支持状态。')
  if(unknown.length||evidence.sourceKind==='unsupported')return empty()
  if (!observations.length || observations.length > 25) {
    diagnostics.push('V1 只重建 1–25 块；请修正误检、漏检或拆分输入。')
    const unresolved=observations.filter(o=>!evidence.relations.some(r=>r.intent==='connect'&&(r.from===o.id||r.to===o.id)))
    if(observations.length>1&&unresolved.length)diagnostics.push('这些零件没有明确整边连接证据：'+unresolved.map(o=>o.id).join('、')+'；点接触不构成磁吸整边连接。')
    return empty()
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw Error('图片尺寸无效')
  trace.phase='fitting'
  const image = new Map<string,Vec[]>(), ratios: number[] = []
  for (const o of observations) {
    const p = profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion)
    if (!p) { diagnostics.push(o.id+'：缺少可用 Profile，不能猜测替换。'); continue }
    if (o.outline.length !== p.vertices.length) { diagnostics.push(o.id+'：外轮廓顶点数与 Profile 不一致，请修正外边界；不要描内部磁条。'); continue }
    const pts = o.outline.map(([x,y]):Vec=>[x*width,-y*height]); image.set(o.id,pts)
    const a = pts.map((v,i)=>distance(v,pts[(i+1)%pts.length])).sort((x,y)=>x-y)
    const b = p.vertices.map((v,i)=>distance(v,p.vertices[(i+1)%p.vertices.length])).sort((x,y)=>x-y)
    a.forEach((l,i)=>ratios.push(l/b[i]))
  }
  if (diagnostics.length) return empty()
  ratios.sort((a,b)=>a-b)
  const scale = ratios[Math.floor(ratios.length/2)]
  if (scale < 2) { diagnostics.push('外轮廓退化或像素尺度太小。'); return empty() }
  for (const [id,pts] of image) image.set(id,pts.map(([x,y])=>[x/scale,y/scale]))
  const error = (t: Tile) => Math.min(...variants(image.get(t.id)!).map(v=>rms(vertices(t,profiles),v)))
  function fitted(o: Observation): Tile {
    const p = profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion)!, local = p.vertices, lc = mean(local)
    let best: Tile | null = null, score = Infinity
    for (const target of variants(image.get(o.id)!)) {
      const tc=mean(target); let dot=0,cross=0
      local.forEach((v,i)=>{const x=v[0]-lc[0],y=v[1]-lc[1],u=target[i][0]-tc[0],w=target[i][1]-tc[1];dot+=x*u+y*w;cross+=x*w-y*u})
      const angleRad=Math.atan2(cross,dot),c=Math.cos(angleRad),s=Math.sin(angleRad)
      const t: Tile={id:o.id,profileId:p.id,profileVersion:p.version,color:o.color,pose:{x:tc[0]-c*lc[0]+s*lc[1],y:tc[1]-s*lc[0]-c*lc[1],angleRad}}
      const e=error(t);if(e<score-1e-10){best=t;score=e}
    }
    return best!
  }
  const approx = observations.map(fitted).sort((a,b)=>a.id<b.id?-1:1)
  trace.planning.scalePixelsPerUnit=scale;trace.planning.fittedSeeds=approx.map(tile=>({tile,rms:error(tile)}))
  const poorFits=approx.filter(t=>error(t)>MAX_ERROR)
  if (poorFits.length) { diagnostics.push('轮廓拟合未通过，尚未进入几何搜索：统一尺度 '+scale.toFixed(2)+' px/标准单位；'+poorFits.map(t=>`${t.id} (${t.profileId}@${t.profileVersion}) RMS ${error(t).toFixed(3)}`).join('；')+'，超过上限 '+MAX_ERROR.toFixed(3)+' 标准单位。请检查 Profile 尺寸、轮廓角点、透视或遮挡；不会缩放 Profile 来强行匹配。'); return empty() }
  const required=evidence.relations.filter(r=>observations.some(o=>o.id===r.from)&&observations.some(o=>o.id===r.to))
  const links = required.filter(r=>r.intent==='connect')
  const linked = (a:string,b:string) => links.some(r=>(r.from===a&&r.to===b)||(r.from===b&&r.to===a))
  const groups: Tile[][]=[]
  const remaining=new Set(approx.map(t=>t.id))
  while(remaining.size){
    const ids=[remaining.values().next().value!];remaining.delete(ids[0])
    for(let i=0;i<ids.length;i++)for(const id of [...remaining])if(linked(ids[i],id)){remaining.delete(id);ids.push(id)}
    groups.push(approx.filter(t=>ids.includes(t.id)))
  }
  const searchGroups=mode==='flat-mosaic'?groups:[approx]
  trace.phase='search';trace.planning.searchGroups=searchGroups.map(g=>g.map(t=>t.id))
  const rejected={outline:0,geometry:0,relation:0}
  const blocked=new Set<string>()
  // Diagnostics only: these measurements never change domains, ordering or thresholds.
  const blockedDomains=new Map<string,{anchors:Set<string>;equalEdges:number;bestError:number}>()
  let explored=0,trials=0,truncated=false
  const budget=()=>{if(explored>=stateLimit||trials>=trialLimit){truncated=true;return false}return true}
  const key=(tiles:Tile[])=>[...tiles].sort((a,b)=>a.id.localeCompare(b.id)).map(t=>t.id+':'+vertices(t,profiles).map(([x,y])=>[x.toFixed(7),y.toFixed(7)].join(',')).sort().join(';')).join('|')
  function acceptable(tiles:Tile[], connected:boolean, attemptedConnection?:AttemptedConnection){
    const report=validate(tiles,profiles)
    if(!report.draftValid||(connected&&!report.valid)){rejected.geometry++;collector.offer({tiles,phase:attemptedConnection?'edge-alignment':'component-combination',failureStage:'geometry',reason:report.issues.map(i=>i.code+': '+i.message).join('; '),attemptIndex:trials,stateIndex:explored,attemptedConnection,attemptedTileRms:attemptedConnection?error(tiles.at(-1)!):null,solverValidator:report});return false}
    const ids=new Set(tiles.map(t=>t.id))
    return required.every(r=>{
      if(!ids.has(r.from)||!ids.has(r.to)||r.intent==='uncertain')return true
      const contact=report.connections.some(c=>[c.a.tileId,c.b.tileId].includes(r.from)&&[c.a.tileId,c.b.tileId].includes(r.to))
      const ok=r.intent==='connect'?contact:!contact
      if(!ok){rejected.relation++;collector.offer({tiles,phase:attemptedConnection?'edge-alignment':'component-combination',failureStage:'relation',reason:`${r.from} / ${r.to}: ${r.intent} contradicts actual connection`,attemptIndex:trials,stateIndex:explored,attemptedConnection,attemptedTileRms:attemptedConnection?error(tiles.at(-1)!):null,solverValidator:report})}
      return ok
    })
  }
  function solve(group:Tile[]){
    const solutions:Tile[][]=[],seen=new Set<string>()
    const root=[...group].sort((a,b)=>Number(b.profileId==='square')-Number(a.profileId==='square')||error(a)-error(b)||a.id.localeCompare(b.id))[0]
    function visit(placed:Tile[]){
      if(!budget()||solutions.length>=3)return
      explored++
      const state=key(placed);if(seen.has(state))return;seen.add(state)
      if(placed.length===group.length){solutions.push(placed);return}
      const pending=group.filter(t=>!placed.some(p=>p.id===t.id))
      const frontier=pending.filter(t=>placed.some(p=>linked(t.id,p.id)))
      const domains:{id:string;options:{tile:Tile;score:number}[]}[]=[]
      for(const raw of frontier.length?frontier:pending){
        const options:{tile:Tile;score:number}[]=[],duplicates=new Set<string>()
        const anchors=placed.filter(t=>!frontier.length||linked(raw.id,t.id))
        let equalEdges=0,bestError=Infinity,nearestFailure:FailedAttempt|undefined
        for(const target of anchors){
          // A legal whole-edge alignment cannot place the centers arbitrarily far apart.
          if(distance(mean(vertices(raw,profiles)),mean(vertices(target,profiles)))>3)continue
          for(const own of edges(raw,profiles))for(const edge of edges(target,profiles)){
            if(!budget())return
            trials++
            if(Math.abs(own.length-edge.length)>EPS)continue
            const candidate=alignEdge(raw,own,edge,profiles),score=error(candidate)
            equalEdges++;bestError=Math.min(bestError,score)
            const attemptedConnection:AttemptedConnection={from:raw.id,ownEdgeId:own.id,to:target.id,targetEdgeId:edge.id,intent:required.find(r=>[r.from,r.to].includes(raw.id)&&[r.from,r.to].includes(target.id))?.intent??null}
            if(score>MAX_ERROR){rejected.outline++;const failure:FailedAttempt={tiles:[...placed,candidate],phase:'edge-alignment',failureStage:'outline',reason:`Aligned tile RMS ${score} > ${MAX_ERROR} standard units`,attemptIndex:trials,stateIndex:explored,attemptedConnection,attemptedTileRms:score};collector.offer(failure);if(!nearestFailure||score<nearestFailure.attemptedTileRms!)nearestFailure=failure;continue}
            const poseKey=key([candidate]);if(duplicates.has(poseKey))continue;duplicates.add(poseKey)
            if(acceptable([...placed,candidate],true,attemptedConnection))options.push({tile:candidate,score})
          }
        }
        // A required neighbor already placed fixes this domain: later pieces cannot repair it.
        if(frontier.length&&!options.length){
          if(nearestFailure)collector.offer({...nearestFailure,domainBlocked:true})
          blocked.add(raw.id)
          const previous=blockedDomains.get(raw.id)
          blockedDomains.set(raw.id,{anchors:new Set([...(previous?.anchors??[]),...anchors.map(t=>t.id)]),equalEdges:(previous?.equalEdges??0)+equalEdges,bestError:Math.min(previous?.bestError??Infinity,bestError)})
          return
        }
        if(options.length)domains.push({id:raw.id,options:options.sort((a,b)=>a.score-b.score)})
      }
      domains.sort((a,b)=>a.options.length-b.options.length||a.options[0].score-b.options[0].score||a.id.localeCompare(b.id))
      for(const option of domains[0]?.options??[]){visit([...placed,option.tile]);if(!budget()||solutions.length>=3)break}
    }
    visit([root]);return solutions
  }
  const local=searchGroups.map(solve)
  const solutions:{tiles:Tile[];score:number}[]=[]
  function combine(index:number,tiles:Tile[]){
    if(!budget()||solutions.length>=3)return
    explored++
    if(index===local.length){solutions.push({tiles,score:Math.sqrt(tiles.reduce((s,t)=>s+error(t)**2,0)/tiles.length)});return}
    for(const group of local[index])if(acceptable([...tiles,...group],mode==='connected-construction'))combine(index+1,[...tiles,...group])
  }
  if(local.every(g=>g.length))combine(0,[])
  solutions.sort((a,b)=>a.score-b.score)
  const candidates:Candidate[]=solutions.map((s,index)=>{
    const x=Math.min(...s.tiles.flatMap(t=>vertices(t,profiles).map(v=>v[0]))),y=Math.min(...s.tiles.flatMap(t=>vertices(t,profiles).map(v=>v[1])))
    const tiles=s.tiles.map(t=>({...t,pose:{...t.pose,x:t.pose.x-x,y:t.pose.y-y}})).sort((a,b)=>a.id.localeCompare(b.id))
    const report=validate(tiles,profiles)
    if(!report.draftValid||(mode==='connected-construction'&&!report.valid))throw Error('规范化结果未通过几何复核')
    const common={id:assemblyId+'-'+index,revision:0,name:'图片磁力片作品',instances:tiles}
    return {id:'candidate-'+(index+1),assembly:mode==='flat-mosaic'?{...common,schemaVersion:2,mode}:{...common,schemaVersion:1},imageError:s.score,fidelity:s.score<=.12?'close':'needs_review',connections:report.connections.length,components:report.components}
  })
  const outcome=truncated?'budget_exhausted':candidates.length?'success':'failed'
  if(evidence.observations.some(o=>o.excluded))diagnostics.push('部分作品：已按 Review 明确排除 '+evidence.observations.filter(o=>o.excluded).map(o=>o.id).join('、')+'；候选仅代表采用的子集，不代表完整原图。')
  if(candidates.length)diagnostics.push('候选几何合法；轮廓偏差仅用于比较，不代表识别或实物连接已经正确。')
  else if(!truncated)diagnostics.push(local.some(g=>!g.length)?'没有找到合法候选：连接关系、轮廓拟合或碰撞/闭环约束冲突。请检查审核证据与 Profile；不代表所有几何解均不存在。':'各局部组件可重建，但组合后出现碰撞、部分边接触或连接意图矛盾；请检查组件间的位置证据。')
  if(!candidates.length){
    if(blocked.size)diagnostics.push('没有可行放置域的零件：'+[...blocked].sort().join('、'))
    for(const [id,d] of [...blockedDomains].sort(([a],[b])=>a.localeCompare(b)))diagnostics.push(`${id} 对明确连接邻居 ${[...d.anchors].sort().join('、')}：本次搜索尝试 ${d.equalEdges} 个等长边对齐${Number.isFinite(d.bestError)?`，最小轮廓 RMS ${d.bestError.toFixed(3)}（上限 ${MAX_ERROR.toFixed(3)} 标准单位）`:''}。${d.equalEdges===0?'请检查可用边长及邻居位置。':d.bestError>MAX_ERROR?'等长边存在，但对齐后偏离原图轮廓；请复核连接意图、边界或 Profile 尺寸。':'有对齐满足轮廓阈值，但未通过几何或连接意图检查。'}`)
    diagnostics.push(`候选剪枝：图片轮廓偏差 ${rejected.outline} 次；碰撞/局部几何 ${rejected.geometry} 次；明确连接意图冲突 ${rejected.relation} 次。这些是搜索诊断，不是对识别错误的自动定论。`)
    const overlaps=validate(approx,profiles).issues.filter(i=>i.code==='OVERLAP')
    if(overlaps.length)diagnostics.push('按原图独立拟合的位置存在内部重叠：'+overlaps.slice(0,8).map(i=>i.tileIds.join(' / ')).join('；')+`（共 ${overlaps.length} 对）。这仅是原图近似位置诊断，不是搜索已接受的布局；相邻边界误差也会造成细微重叠。平面拼图也不允许重叠，请检查遮挡、堆叠或轮廓。`)
    diagnostics.push(`统一拟合尺度 ${scale.toFixed(2)} px/标准单位；搜索仅保留轮廓 RMS ≤ ${MAX_ERROR.toFixed(3)} 的刚体放置。Profile 尺寸、严格整边连接和碰撞规则未放宽。`)
  }
  if(truncated)diagnostics.push(`搜索预算耗尽（最多 ${stateLimit} 状态 / ${trialLimit} 对齐尝试），搜索未完成；请修正不确定连接或缩小输入范围后重建。`)
  if(observations.some(o=>o.confidence<.7||o.uncertainty))diagnostics.push('含低置信度或不确定识别项，请对照原图。')
  const diagnosticCandidates=collector.finish(observations.map(o=>o.id),required,error,tiles=>validate(tiles,profiles))
  trace.search.stats={explored,trials,truncated,rejected,recordedFailures:collector.count}
  return {candidates,diagnosticCandidates,trace,diagnostics,explored,trials,truncated,outcome}
}

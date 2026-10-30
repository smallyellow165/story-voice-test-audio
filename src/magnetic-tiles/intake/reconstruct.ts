import {createOutlineRegistration} from './global-registration.ts'
import type {TranslationRegistration} from './global-registration.ts'
import {segmentAudit} from './segment-audit.ts'
import {connectivityAudit} from './connectivity-audit.ts'
import { diagnosticCollector, spatialEvidence } from './execution-trace.ts'
import type { ExecutionTrace, FailedAttempt, AttemptedConnection } from './execution-trace.ts'
// Image-space fitting is approximate. All committed connections still use geometry.ts EPS.
import { alignEdge, distance, edges, validate, vertices, EPS, mirrorVariants, segmentAlignments, connectionModel } from '../geometry.ts'
import type { Profile, Tile, Vec, WorkMode } from '../geometry.ts'
import { parseEvidence } from './contracts.ts'
import type { Candidate, Evidence, Observation } from './contracts.ts'
export const reconstructionVersion = 'planar-outline-v5'
const MAX_STATES = 6000, MAX_TRIALS = 100000, MAX_ERROR = .30
const mean = (v: Vec[]): Vec => [v.reduce((s,p)=>s+p[0],0)/v.length,v.reduce((s,p)=>s+p[1],0)/v.length]
const variants = (v: Vec[]) => [v,[...v].reverse()].flatMap(a=>a.map((_,i)=>[...a.slice(i),...a.slice(0,i)]))
const rms = (a: Vec[],b: Vec[]) => Math.sqrt(a.reduce((s,p,i)=>s+distance(p,b[i])**2,0)/a.length)
export function reconstruct(input: Evidence, width: number, height: number, profiles: readonly Profile[], assemblyId: string, mode: WorkMode = 'connected-construction', limits: {states?:number;trials?:number;mirroring?:boolean} = {}) {
  const stateLimit=Math.min(MAX_STATES,limits.states??MAX_STATES), trialLimit=Math.min(MAX_TRIALS,limits.trials??MAX_TRIALS)
  if(!Number.isInteger(stateLimit)||stateLimit<1||!Number.isInteger(trialLimit)||trialLimit<1)throw Error('搜索预算无效')
  const mirroring=limits.mirroring??true,parities=new Map(profiles.map(p=>[p.id+'@'+p.version,mirroring?mirrorVariants(p):[false]]))
  const evidence = parseEvidence(input, profiles), diagnostics: string[] = [], observations = evidence.observations.filter(o=>!o.excluded)
  const trace:ExecutionTrace={schemaVersion:1,phase:'admission',input:{evidence:structuredClone(evidence),width,height,profiles:structuredClone(profiles),mode},planning:spatialEvidence(evidence,width,height,profiles),search:{parameters:{stateLimit,trialLimit,maxOutlineRms:MAX_ERROR,eps:EPS,maxSolutionsPerGroup:3,maxCandidates:3,...(mode==='flat-mosaic'?{anchorDistanceLimit:3}:{}),mirroring,connectionModel,...(mode==='connected-construction'?{globalRegistration:'shared-translation-disc-intersection-v1',trialAccounting:'unique-placement-before-rms-and-validator-v1',anchorDistanceStrategy:'profile-radius-plus-two-centroid-errors'}:{}),alignmentStrategy:mode==='connected-construction'?'bounded-segment-offsets-v1':'whole-edge-offset-v1'},ranking:'Bounded representative Top 10 of observed failures, not global optimization: '+(mode==='connected-construction'?'exhausted connection domains':'blocked required domains')+' first; one pair/stage representative before alternatives; then placed count descending, '+(mode==='connected-construction'?'registered maximum per-piece RMS':'attempted RMS')+' ascending, trial index, geometric key. Diagnostic rechecks never affect search.'}}
  const collector=diagnosticCollector(profiles)
  const empty = () => ({ diagnosticCandidates:[],trace,candidates: [] as Candidate[], diagnostics, explored: 0, trials: 0, truncated: false, outcome: 'failed' as const })
  const unknown=observations.filter(o=>o.profileId==='unknown')
  if(unknown.length)diagnostics.push('未解决的 Unknown：'+unknown.map(o=>o.id).join('、')+'。证据已保留；请匹配经过核实的 Profile，或明确排除后仅重建子集。')
  if (evidence.sourceKind === 'unsupported') diagnostics.push('输入审核未完成：当前 Review 的「输入类别」仍为 unsupported，尚未进入几何搜索。Known 只表示已选择 Profile；请在识别审核中确认采用部分是「二维平铺照片」或「平面示意图」，保存新 Review 后再生成。若存在三维、堆叠或无法确定的遮挡，请保留不支持状态。')
  if(unknown.length||evidence.sourceKind==='unsupported')return empty()
  if (!observations.length || observations.length > 25) {
    diagnostics.push('V1 只重建 1–25 块；请修正误检、漏检或拆分输入。')
    const unresolved=observations.filter(o=>!evidence.relations.some(r=>r.intent==='connect'&&(r.from===o.id||r.to===o.id)))
    if(observations.length>1&&unresolved.length)diagnostics.push('这些零件没有明确边连接证据：'+unresolved.map(o=>o.id).join('、')+'；点接触不构成边吸附连接。')
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
  const registrationEngine=createOutlineRegistration(image,profiles)
  const error = (t: Tile) => mode==='connected-construction'?registrationEngine.error(t): Math.min(...variants(image.get(t.id)!).map(v=>rms(vertices(t,profiles),v)))
  function fitted(o: Observation): Tile {
    const p = profiles.find(p=>p.id===o.profileId&&p.version===o.profileVersion)!
    let best: Tile | null = null, score = Infinity
    for (const mirrored of parities.get(p.id+'@'+p.version)!) {
    const local=p.vertices.map(([x,y]):Vec=>[mirrored?-x:x,y]),lc=mean(local)
    for (const target of variants(image.get(o.id)!)) {
      const tc=mean(target); let dot=0,cross=0
      local.forEach((v,i)=>{const x=v[0]-lc[0],y=v[1]-lc[1],u=target[i][0]-tc[0],w=target[i][1]-tc[1];dot+=x*u+y*w;cross+=x*w-y*u})
      const angleRad=Math.atan2(cross,dot),c=Math.cos(angleRad),s=Math.sin(angleRad)
      const t: Tile={id:o.id,profileId:p.id,profileVersion:p.version,color:o.color,pose:{x:tc[0]-c*lc[0]+s*lc[1],y:tc[1]-s*lc[0]-c*lc[1],angleRad,...(mirrored?{mirrored:true}:{})}}
      const e=error(t);if(e<score-1e-10){best=t;score=e}
    }
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
  const blockedDomains=new Map<string,{anchors:Set<string>;equalEdges:number;bestError:number;required?:boolean}>()
  const efficiency={generatedProposals:0,duplicatePosesSkipped:0,duplicateStatesSkipped:0,orientationFamiliesRejected:0,anchorPairsRejected:0,domainEnumerations:0,maxExpandedPieces:0,maxAcceptedProposalPieces:0,registrationCalls:0,registrationApplied:0,registrationRescued:0,perPiece:Object.fromEntries(observations.map(o=>[o.id,{uniqueAlignments:0,duplicatesSkipped:0,orientationFamiliesRejected:0}]))}
  let explored=0,trials=0,truncated=false,recentFailure:FailedAttempt|undefined
  const budget=()=>{if(explored>=stateLimit||trials>=trialLimit){truncated=true;return false}return true}
  const key=(tiles:Tile[])=>[...tiles].sort((a,b)=>a.id.localeCompare(b.id)).map(t=>t.id+':'+vertices(t,profiles).map(([x,y])=>[x.toFixed(7),y.toFixed(7)].join(',')).sort().join(';')).join('|')
  function acceptable(tiles:Tile[], connected:boolean, attemptedConnection?:AttemptedConnection,registration?:TranslationRegistration){
    recentFailure=undefined
    const report=validate(tiles,profiles)
    if(!report.draftValid||(connected&&!report.valid)){rejected.geometry++;collector.offer(recentFailure={tiles,...(registration?{registration}:{}),phase:attemptedConnection?'edge-alignment':'component-combination',failureStage:'geometry',reason:report.issues.map(i=>i.code+': '+i.message).join('; '),attemptIndex:trials,stateIndex:explored,attemptedConnection,attemptedTileRms:attemptedConnection?error(tiles.at(-1)!):null,solverValidator:report});return false}
    const ids=new Set(tiles.map(t=>t.id))
    return required.every(r=>{
      if(!ids.has(r.from)||!ids.has(r.to)||r.intent==='uncertain')return true
      const contact=report.connections.some(c=>[c.a.tileId,c.b.tileId].includes(r.from)&&[c.a.tileId,c.b.tileId].includes(r.to))
      const ok=r.intent==='connect'?contact:!contact
      if(!ok){rejected.relation++;collector.offer(recentFailure={tiles,...(registration?{registration}:{}),phase:attemptedConnection?'edge-alignment':'component-combination',failureStage:'relation',reason:`${r.from} / ${r.to}: ${r.intent} contradicts actual connection`,attemptIndex:trials,stateIndex:explored,attemptedConnection,attemptedTileRms:attemptedConnection?error(tiles.at(-1)!):null,solverValidator:report})}
      return ok
    })
  }
  function solve(group:Tile[]){
    const solutions:Tile[][]=[],seen=new Set<string>(),connected=mode==='connected-construction'
    const root=[...group].sort((a,b)=>Number(b.profileId==='square')-Number(a.profileId==='square')||error(a)-error(b)||a.id.localeCompare(b.id))[0]
    const centers=new Map(group.map(t=>[t.id,mean(image.get(t.id)!)])),radii=new Map(group.map(t=>{const v=vertices(t,profiles),c=mean(v);return [t.id,Math.max(...v.map(p=>distance(p,c)))]}))
    function geometryKey(tiles:Tile[],relative=false){
      const ordered=[...tiles].sort((a,b)=>a.id.localeCompare(b.id)),origin=relative?mean(vertices(ordered[0],profiles)):[0,0]
      const point=(p:Vec)=>[Number((p[0]-origin[0]).toFixed(10)),Number((p[1]-origin[1]).toFixed(10))].join(',')
      return ordered.map(t=>JSON.stringify([t.id,t.profileId,t.profileVersion,vertices(t,profiles).map(point).sort(),edges(t,profiles).filter(e=>e.enabled).map(e=>[point(e.a),point(e.b)].sort().join('/')).sort()])).join('|')
    }
    function visit(placed:Tile[]){
      if(!budget()||solutions.length>=3)return
      const state=connected?geometryKey(placed,true):key(placed)
      if(!connected)explored++
      if(seen.has(state)){efficiency.duplicateStatesSkipped++;return}seen.add(state);if(connected)explored++
      efficiency.maxExpandedPieces=Math.max(efficiency.maxExpandedPieces,placed.length)
      if(placed.length===group.length){solutions.push(placed);return}
      const pending=group.filter(t=>!placed.some(p=>p.id===t.id)),frontier=pending.filter(t=>placed.some(p=>linked(t.id,p.id)))
      const evidenceRank=(a:string,b:string)=>linked(a,b)?0:required.some(r=>r.intent==='uncertain'&&[r.from,r.to].includes(a)&&[r.from,r.to].includes(b))?1:2
      const priority=(t:Tile)=>Math.min(...placed.map(p=>evidenceRank(t.id,p.id)*100+distance(centers.get(t.id)!,centers.get(p.id)!)))
      const work=connected?[...(frontier.length?frontier:pending)].sort((a,b)=>priority(a)-priority(b)||a.id.localeCompare(b.id)):(frontier.length?frontier:pending)
      const domains:{id:string;options:{tiles:Tile[];score:number}[]}[]=[],emptyDomains:{id:string;anchors:Tile[];equalEdges:number;bestError:number;nearestFailure?:FailedAttempt}[]=[]
      for(const raw of work){
        efficiency.domainEnumerations++
        const options:{tiles:Tile[];score:number}[]=[],duplicates=new Set<string>(),pieceStats=efficiency.perPiece[raw.id]
        const anchors=placed.filter(t=>!frontier.length||linked(raw.id,t.id))
        if(connected)anchors.sort((a,b)=>evidenceRank(raw.id,a.id)-evidenceRank(raw.id,b.id)||distance(centers.get(raw.id)!,centers.get(a.id)!)-distance(centers.get(raw.id)!,centers.get(b.id)!)||a.id.localeCompare(b.id))
        const triedAnchors:Tile[]=[]
        let equalEdges=0,bestError=Infinity,nearestFailure:FailedAttempt|undefined
        for(const target of anchors){
          // Necessary centroid bound: each outline RMS bounds its centroid error.
          // Unlike a fixed distance cutoff, this remains valid for custom large Profiles.
          if(connected?distance(centers.get(raw.id)!,centers.get(target.id)!)>radii.get(raw.id)!+radii.get(target.id)!+2*MAX_ERROR+1e-12:distance(mean(vertices(raw,profiles)),mean(vertices(target,profiles)))>3){efficiency.anchorPairsRejected++;continue}
          triedAnchors.push(target)
          for(const mirrored of parities.get(raw.profileId+'@'+raw.profileVersion)!){
          const {mirrored:previousParity,...rigidPose}=raw.pose
          const oriented:Tile={...raw,pose:{...rigidPose,...(mirrored?{mirrored:true}:{})}};void previousParity
          for(const own of edges(oriented,profiles))for(const edge of edges(target,profiles)){
            if(!budget())return
            if(!connected)trials++
            if(!own.enabled||!edge.enabled)continue
            if(connected){
              const aligned=alignEdge(oriented,own,edge,profiles)
              // Centered residual cannot be repaired by ANY shared translation or offset.
              if(registrationEngine.metric(aligned).q>MAX_ERROR*MAX_ERROR+Number.EPSILON*64){efficiency.orientationFamiliesRejected++;pieceStats.orientationFamiliesRejected++;continue}
            }
            const proposals=connected?segmentAlignments(oriented,own,edge,profiles,image.get(raw.id)!,placed.flatMap(t=>vertices(t,profiles))):Math.abs(own.length-edge.length)<=EPS?[{tile:alignEdge(oriented,own,edge,profiles),offset:edge.length,contact:undefined}]:[]
            for(const proposal of proposals){
            efficiency.generatedProposals++
            const candidate=proposal.tile,poseKey=connected?geometryKey([candidate]):key([candidate])
            if(duplicates.has(poseKey)){efficiency.duplicatePosesSkipped++;pieceStats.duplicatesSkipped++;continue}duplicates.add(poseKey)
            if(!budget())return
            if(connected)trials++
            pieceStats.uniqueAlignments++;equalEdges++
            let tiles=[...placed,candidate],registration:TranslationRegistration|undefined
            if(connected){
              efficiency.registrationCalls++
              const fitted=registrationEngine.register(tiles,MAX_ERROR);tiles=fitted.tiles;registration=fitted.registration
              if(Math.hypot(...registration.translation)>1e-12)efficiency.registrationApplied++
              if(registration.feasible&&registration.beforeMaxRms>MAX_ERROR)efficiency.registrationRescued++
            }
            const score=registration?registration.afterMaxRms:error(candidate)
            bestError=Math.min(bestError,score)
            const delta=registration?.translation??[0,0]
            const contact=proposal.contact?{...proposal.contact,start:[proposal.contact.start[0]+delta[0],proposal.contact.start[1]+delta[1]] as Vec,end:[proposal.contact.end[0]+delta[0],proposal.contact.end[1]+delta[1]] as Vec}:undefined
            const attemptedConnection:AttemptedConnection={from:raw.id,ownEdgeId:own.id,to:target.id,targetEdgeId:edge.id,intent:required.find(r=>[r.from,r.to].includes(raw.id)&&[r.from,r.to].includes(target.id))?.intent??null,...(connected?{offset:proposal.offset,contact,connectionModel}:{})}
            if(registration?!registration.feasible:score>MAX_ERROR){
              rejected.outline++
              const failure:FailedAttempt={tiles,phase:'edge-alignment',failureStage:'outline',reason:registration?`Shared translation cannot satisfy all tile RMS <= ${MAX_ERROR}; max ${score}; limiting: ${registration.limitingTileIds.join(', ')}`:`Aligned tile RMS ${score} > ${MAX_ERROR} standard units`,attemptIndex:trials,stateIndex:explored,attemptedConnection,attemptedTileRms:registrationEngine.error(tiles.at(-1)!),...(registration?{registration}:{})}
              collector.offer(failure);if(!nearestFailure||score<(nearestFailure.registration?.afterMaxRms??nearestFailure.attemptedTileRms!))nearestFailure=failure;continue
            }
            if(acceptable(tiles,true,attemptedConnection,registration)){
              efficiency.maxAcceptedProposalPieces=Math.max(efficiency.maxAcceptedProposalPieces,tiles.length)
              options.push({tiles,score:registration?.afterLayoutRms??score})
              if(registration&&registration.beforeMaxRms>MAX_ERROR&&(!trace.search.registrationWitness||tiles.length>trace.search.registrationWitness.tiles.length))trace.search.registrationWitness={provenance:'accepted-search-proposal',tiles:structuredClone(tiles),registration,attemptIndex:trials,stateIndex:explored,attemptedConnection,validator:validate(tiles,profiles)}
            }else if(recentFailure){
              if(!nearestFailure||score<(nearestFailure.registration?.afterMaxRms??nearestFailure.attemptedTileRms!))nearestFailure=recentFailure
            }
            }
          }
          }
        }
        if(frontier.length&&!options.length){
          if(nearestFailure)collector.offer({...nearestFailure,domainBlocked:true})
          blocked.add(raw.id);const previous=blockedDomains.get(raw.id)
          blockedDomains.set(raw.id,{anchors:new Set([...(previous?.anchors??[]),...anchors.map(t=>t.id)]),equalEdges:(previous?.equalEdges??0)+equalEdges,bestError:Math.min(previous?.bestError??Infinity,bestError)})
          return
        }
        if(!options.length)emptyDomains.push({id:raw.id,anchors:triedAnchors,equalEdges,bestError,nearestFailure})
        if(options.length){
          options.sort((a,b)=>a.score-b.score)
          if(connected){
            for(const option of options){visit(option.tiles);if(!budget()||solutions.length>=3)return}
            // Required domains choose one variable; optional contacts may gain new
            // anchors later, so exhausted orders can defer this piece and try another.
            if(frontier.length)return
          }else domains.push({id:raw.id,options})
        }
      }
      if(connected&&!frontier.length)for(const d of emptyDomains){
        if(d.nearestFailure)collector.offer({...d.nearestFailure,domainBlocked:true})
        blocked.add(d.id);const previous=blockedDomains.get(d.id);blockedDomains.set(d.id,{anchors:new Set([...(previous?.anchors??[]),...d.anchors.map(t=>t.id)]),equalEdges:(previous?.equalEdges??0)+d.equalEdges,bestError:Math.min(previous?.bestError??Infinity,d.bestError),required:false})
      }
      if(!connected){domains.sort((a,b)=>a.options.length-b.options.length||a.options[0].score-b.options[0].score||a.id.localeCompare(b.id));for(const option of domains[0]?.options??[]){visit(option.tiles);if(!budget()||solutions.length>=3)break}}
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
  if(mode==='connected-construction')trace.search.acceptedCandidates=solutions.map((s,index)=>({candidateId:'candidate-'+(index+1),tiles:structuredClone(s.tiles),perPieceRms:s.tiles.map(t=>({id:t.id,rms:registrationEngine.error(t)}))}))
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
  else if(!truncated)diagnostics.push(local.some(g=>!g.length)?'没有找到合法候选：连接关系、轮廓拟合或碰撞/闭环约束冲突。请检查审核证据与 Profile；不代表所有几何解均不存在。':'各局部组件可重建，但组合后出现面积碰撞、区间占用或连接意图矛盾；请检查组件间的位置证据。')
  if(!candidates.length){
    if(blocked.size)diagnostics.push('没有可行放置域的零件：'+[...blocked].sort().join('、'))
    for(const [id,d] of [...blockedDomains].sort(([a],[b])=>a.localeCompare(b)))diagnostics.push(`${id} 对${d.required===false?'已尝试连接邻居':'明确连接邻居'} ${[...d.anchors].sort().join('、')}：本次搜索尝试 ${d.equalEdges} 个边接触对齐${Number.isFinite(d.bestError)?`，最小轮廓 RMS ${d.bestError.toFixed(3)}（上限 ${MAX_ERROR.toFixed(3)} 标准单位）`:''}。${d.equalEdges===0?'未生成可评分的接触 Pose；请检查连接边、邻居位置及方向下界预筛统计。':d.bestError>MAX_ERROR?'接触边存在，但对齐后偏离原图轮廓；请复核连接意图、边界或 Profile 尺寸。':'有对齐满足轮廓阈值，但未通过几何或连接意图检查。'}`)
    diagnostics.push(`候选剪枝：图片轮廓偏差 ${rejected.outline} 次；碰撞/局部几何 ${rejected.geometry} 次；明确连接意图冲突 ${rejected.relation} 次。这些是搜索诊断，不是对识别错误的自动定论。`)
    const overlaps=validate(approx,profiles).issues.filter(i=>i.code==='OVERLAP')
    if(overlaps.length)diagnostics.push('按原图独立拟合的位置存在内部重叠：'+overlaps.slice(0,8).map(i=>i.tileIds.join(' / ')).join('；')+`（共 ${overlaps.length} 对）。这仅是原图近似位置诊断，不是搜索已接受的布局；相邻边界误差也会造成细微重叠。平面拼图也不允许重叠，请检查遮挡、堆叠或轮廓。`)
    diagnostics.push(`统一拟合尺度 ${scale.toFixed(2)} px/标准单位；搜索仅保留轮廓 RMS ≤ ${MAX_ERROR.toFixed(3)} 的等距放置（平移、旋转及启用时的镜像）。Profile 尺寸、共线/相反侧正长度连接与碰撞标准保持严格。`)
  }
  if(mode==='connected-construction')diagnostics.push(`整体平移配准参与每次准入；${efficiency.generatedProposals} 个原始提案，${efficiency.duplicatePosesSkipped} 个等价 Pose 在预算前去重，${efficiency.orientationFamiliesRejected} 个方向族被不可修复的中心化 RMS 下界排除；${efficiency.registrationRescued} 次配准使全部单块 RMS 回到 ${MAX_ERROR.toFixed(3)} 内（仍需完整 Validator 检查）。详见 Trace search.stats.efficiency、registrationWitness 和 acceptedCandidates。`)
  if(truncated)diagnostics.push(`搜索预算耗尽（最多 ${stateLimit} 状态 / ${trialLimit} 对齐尝试），搜索未完成；请修正不确定连接或缩小输入范围后重建。`)
  if(observations.some(o=>o.confidence<.7||o.uncertainty))diagnostics.push('含低置信度或不确定识别项，请对照原图。')
  if(mode==='connected-construction'){
    trace.search.segmentAudit=segmentAudit(evidence,width,height,profiles,trace.planning.fittedSeeds!,scale)
  }
  if(mode==='connected-construction'&&!candidates.length&&!truncated){
    const audit=connectivityAudit(evidence,width,height,profiles,trace.planning.fittedSeeds!,scale,MAX_ERROR,mirroring);trace.search.connectivityAudit=audit
    if(audit.incompatible)diagnostics.push('旧等长整边模型下的输入连接与轮廓不相容（不适用于当前分段连接结论）：放开双方 Pose 后的等长整边连接联合 RMS 下界仍使可能连接图断开；'+audit.isolatedIds.map(id=>{const p=audit.parts.find(p=>p.id===id)!;return id+'：'+(p.bounds.length?p.bounds.map(b=>b.other+' ≥ '+b.lowerBound.toFixed(6)).join('，'):'没有等长可连接边邻居')}).join('；')+'。若每块 RMS ≤ '+MAX_ERROR.toFixed(3)+'，联合 RMS 必须也 ≤ 该阈值。请核查轮廓、Profile 和遮挡证据；该结论仅适用于旧整边规则；当前分段连接请查看真实搜索的碰撞与区间诊断。详见 Trace 的 connectivityAudit。')
  }
  const diagnosticCandidates=collector.finish(observations.map(o=>o.id),required,error,tiles=>validate(tiles,profiles))
  trace.search.stats={explored,trials,truncated,rejected,recordedFailures:collector.count,...(mode==='connected-construction'?{efficiency}:{})}
  return {candidates,diagnosticCandidates,trace,diagnostics,explored,trials,truncated,outcome}
}

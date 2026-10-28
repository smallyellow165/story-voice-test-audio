import {executionSymmetry,remapValidGeometry} from './symmetry.mjs'
import {rankLayout,compareLayouts,finishRanking} from './ranking.mjs'
import {pruneDomains,spatialRelation} from './prune.mjs'
import { validatePlan, assessConversion } from '../spatial-planning/plan.mjs'
import { assessRelations } from '../geometry-solver/solver.mjs'

const EPS = 1e-7
const same = (a,b) => Math.abs(a-b) < EPS
const inside = (v,r) => r && v >= r.min-EPS && v <= r.max+EPS

// A bounded adapter over the shared geometry engine, not another geometry library.
export function executePlan(plan, input, rules, { maxCombinations = 10000, topK = 5, maxOrientationExpansions = 100000, symmetryProofs = [] } = {}) {
  if (!Number.isSafeInteger(maxCombinations) || maxCombinations < 1 || maxCombinations > 100000) throw new Error('maxCombinations must be 1..100000')
  if(!Number.isSafeInteger(maxOrientationExpansions)||maxOrientationExpansions<1||maxOrientationExpansions>100000)throw Error('maxOrientationExpansions must be 1..100000')
  if (![5,10].includes(topK)) throw new Error('topK must be 5 or 10')
  const result = {version:'geometry-execution-v1',status:'invalid_input',completeSearch:false,
    policy:{validation:'final-assembly-connectivity-v1',gridLdu:{x:rules.STUD_LDU/2,y:1,z:rules.STUD_LDU/2},maxCombinations,topK,maxOrientationExpansions,budgetUnit:'actual full physical validations; separate bounded exact-yaw expansion',
      constraints:'All numeric intervals, yaw choices, definite mating intents and executable spatial relations are hard constraints. No rounding, repair or build order.',
      selection:'Exhaust bounded filtered domain; rank by physical validity, failed intents/ranges/hard relations, relative interval midpoint distance and input yaw order. No image similarity claim.'},
    diagnostics:[],domains:[],attempts:[],candidates:[],diagnosticCandidates:[],validLayoutCount:0,groups:[]}
  const validation=validatePlan(plan,input)
  if (!validation.valid) return {...result,diagnostics:validation.issues}
  const observations=new Map(input.observations.map(o=>[o.id,o]))
  if (observations.size!==input.observations.length) return {...result,diagnostics:['Duplicate input identities']}
  for(const o of observations.values()) {
    const capability=rules.geometrySupport(o.part)
    if (!capability.supported) return {...result,diagnostics:['Unsupported geometry profile: '+o.id]}
    if (!/^(0|[1-9]\d*)$/.test(o.color)) return {...result,diagnostics:['Invalid LDraw color code: '+o.id]}
    if (JSON.stringify(capability.geometry)!==JSON.stringify(o.geometry)) return {...result,diagnostics:['Saved/current geometry mismatch: '+o.id+'; no silent migration']}
  }
  const actual=new Map(), stock=new Map()
  for(const o of observations.values())actual.set(o.part+':'+o.color,(actual.get(o.part+':'+o.color)||0)+1)
  for(const row of input.inventory || []) {
    const k=row.part+':'+row.color
    if(stock.has(k)||!Number.isInteger(row.quantity)||row.quantity<1)return {...result,diagnostics:['Invalid inventory']}
    stock.set(k,row.quantity)
  }
  if(actual.size!==stock.size || [...actual].some(([k,n])=>stock.get(k)!==n))return {...result,diagnostics:['Inventory/instance count mismatch']}
  const conversion=assessConversion(plan,input)
  for(const p of plan.parts) {
    const world=conversion.candidates.find(c=>c.id===p.id).worldOffsetLdu
    if(p.pose.upright!==true || !p.pose.yawCandidates.length || Object.values(world).some(r=>!r))return {...result,status:'insufficient_information',diagnostics:['Unbounded position or unsupported/unknown orientation: '+p.id]}
    const axes={}
    for(const axis of ['x','y','z']) {
      const step=result.policy.gridLdu[axis], r=world[axis]
      const first=Math.ceil((r.min-EPS)/step),last=Math.floor((r.max+EPS)/step)
      if(last-first+1>200000)return {...result,status:'budget_exceeded',diagnostics:[{code:'PREPROCESSING_BUDGET',reason:'候选轴超过预处理内存上限；未开始完整搜索',id:p.id,axis,count:last-first+1,limit:200000}]}
      axes[axis]=Array.from({length:Math.max(0,last-first+1)},(_,i)=>(first+i)*step)
    }
    const yaw=p.pose.yawCandidates.filter(y=>rules.geometrySupport(observations.get(p.id).part).geometry.rotations.includes(y))
    result.domains.push({id:p.id,worldIntervals:world,axes,yaw,count:axes.x.length*axes.y.length*axes.z.length*yaw.length})
  }
  const originalCount=result.domains.reduce((n,d)=>n*d.count,1)
  result.originalCombinationCount=originalCount
  result.combinationCount=originalCount
  if(!originalCount)return {...result,status:'no_solution',completeSearch:true,diagnostics:['No legal grid point in one or more original intervals']}
  const pruning=pruneDomains(plan,result.domains,observations,rules)
  result.pruning=pruning.stats
  result.combinationCount=pruning.stats.remainingCombinationCount
  const diagnosticMode=!!pruning.conflict
  const searchPoses=diagnosticMode?pruning.diagnosticPoses:pruning.poses
  const searchCount=searchPoses?[...searchPoses.values()].reduce((n,p)=>n*p.length,1):diagnosticMode?0:result.combinationCount
  result.search={kind:diagnosticMode?'diagnostic':'strict',combinationCount:searchCount,complete:false,topK,rankingScope:'not searched'}
  if(pruning.conflict){
    result.status='no_solution';result.completeSearch=true
    result.proof='Necessary binary constraints have an empty domain; no full assembly can satisfy them'
    result.diagnostics.push(pruning.conflict)
  }
  const symmetry=executionSymmetry(plan,observations,symmetryProofs)
  const physicalCount=searchPoses?[...searchPoses.values()].reduce((n,ps)=>n*new Set(ps.map(symmetry.poseKey)).size,1):searchCount
  result.search.symmetry={version:1,instances:symmetry.records,physicalClassCount:physicalCount,physicalValidations:0,cacheHits:0,pairValidations:0,pairCacheHits:0,orientationExpansions:0}
  if(!searchPoses||physicalCount>maxCombinations||searchCount>maxOrientationExpansions){
    result.diagnostics.push({code:searchPoses?(searchCount>maxOrientationExpansions?'ORIENTATION_EXPANSION_BUDGET':'SEARCH_BUDGET'):diagnosticMode?'NO_DIAGNOSTIC_DOMAIN':'PREPROCESSING_BUDGET',reason:searchPoses?'物理验证或朝向展开域超过预算；未枚举完整布局，不能声称全局 Top-K':diagnosticMode?'连接/相对区间过滤已无解；没有满足这些必要条件的诊断候选':'预处理预算不足，未建立完整候选域；未证明无解',remainingCombinationCount:searchCount,physicalClassCount:physicalCount,maxCombinations,maxOrientationExpansions,skipped:pruning.stats.skipped})
    if(!diagnosticMode)result.status='budget_exceeded'
    return result
  }
  const pById=new Map(plan.parts.map(p=>[p.id,p]))
  const rankedDiagnostics=[], physicalCache=new Map(), pairCache=new Map()
  const stats=result.search.symmetry
  let exhausted=false
  const evaluate=positions=>{
    const shiftY=-Math.min(...positions.map(b=>b.y))
    const bricks=positions.map(b=>({id:b.id,part:observations.get(b.id).part,color:observations.get(b.id).color,
      x:b.x/rules.STUD_LDU,z:b.z/rules.STUD_LDU,layer:(b.y+shiftY)/rules.BODY_LDU,rotation:b.rotation}))
    const byId=new Map(bricks.map(b=>[b.id,b])), raw=new Map(positions.map(b=>[b.id,b]))
    const ranges=positions.map(b=>{
      const p=pById.get(b.id), parent=p.pose.relativeTo===null?{x:0,y:0,z:0}:raw.get(p.pose.relativeTo)
      const delta=Object.fromEntries(['x','y','z'].map(a=>[a,b[a]-parent[a]]))
      return {id:b.id,relativeTo:p.pose.relativeTo,deltaLdu:delta,satisfied:Object.entries(delta).every(([a,v])=>inside(v,p.pose.offsetLdu[a]))}
    })
    const attempt={index:result.attempts.length+1,positions,groundTranslationLdu:shiftY,ranges,accepted:false}
    const physicalKey=JSON.stringify(positions.map(symmetry.poseKey))
    let geometry
    if(physicalCache.has(physicalKey)){geometry=remapValidGeometry(physicalCache.get(physicalKey),bricks,rules);stats.cacheHits++}
    else {
      if(stats.physicalValidations>=maxCombinations){exhausted=true;return}
      stats.physicalValidations++;geometry=rules.validateFinalAssembly(bricks)
      if(geometry.valid)physicalCache.set(physicalKey,geometry)
    }
    stats.orientationExpansions++
    attempt.geometry=geometry
    // Shared validator checks all body/stud collision envelopes before support/connectivity.
    attempt.collision={status:geometry.code==='COLLISION'?'collision':geometry.valid||['UNSUPPORTED','DISCONNECTED'].includes(geometry.code)?'clear':'not_established',reason:geometry.reason,brickIds:geometry.brickIds}
    const relations=plan.relations.map(r=>{
      const satisfied=spatialRelation(r,byId.get(r.from),byId.get(r.to),rules)
      return {...r,satisfied,interpretation:satisfied===null?'Requires camera projection; retained, not certified':'world-axis body relation'}
    })
    const intents=plan.parts.flatMap(p=>p.connections.map(c=>{
      if(c.intent!=='mates')return {id:p.id,...c,satisfied:null,reason:'Non-mating contact/uncertain intent is retained, not converted to a hidden connection'}
      if(!['top','bottom'].includes(c.ownSurface)||!['top','bottom'].includes(c.otherSurface)||c.ownSurface===c.otherSurface)return {id:p.id,...c,satisfied:false,reason:'Mating intent requires opposite top/bottom surfaces'}
      const a=byId.get(p.id),b=byId.get(c.other)
      const lower=c.ownSurface==='top'?a:b,upper=c.ownSurface==='bottom'?a:b
      const pairKey=JSON.stringify([symmetry.poseKey(raw.get(lower.id)),symmetry.poseKey(raw.get(upper.id))])
      let shared=pairCache.get(pairKey)
      if(shared)stats.pairCacheHits++
      else {shared=assessRelations(bricks,[{from:lower.id,to:upper.id,relation:'supports',confidence:1,status:'inferred'}],rules)[0];pairCache.set(pairKey,shared);stats.pairValidations++}
      // Compatibility is already decided by the shared engine; map its matched
      // world points back to exact indices in the original connector arrays.
      const own=rules.connectors(a,c.ownSurface),other=rules.connectors(b,c.otherSurface)
      const connection=geometry.connections.find(g=>g.lowerId===lower.id&&g.upperId===upper.id)
      const pairs=[]
      if(shared.satisfied && connection)for(const [i,u] of own.entries())for(const [j,v] of other.entries()) {
        if((c.ownConnector===null||c.ownConnector===i)&&(c.otherConnector===null||c.otherConnector===j)
          &&same(u.x,v.x)&&same(u.y,v.y)&&same(u.z,v.z)
          &&connection.points.some(pt=>same(pt.x*rules.STUD_LDU,u.x)&&same(pt.z*rules.STUD_LDU,u.z)))pairs.push({ownIndex:i,otherIndex:j,worldLdu:{x:u.x,y:u.y,z:u.z}})
      }
      return {id:p.id,...c,satisfied:pairs.length>0,pairs,reason:shared.interpretation}
    }))
    Object.assign(attempt,{relations,intents})
    if(!geometry.valid)attempt.failure=geometry.code
    else if(ranges.some(r=>!r.satisfied))attempt.failure='RELATIVE_INTERVAL'
    else if(relations.some(r=>r.satisfied===false))attempt.failure='SPATIAL_RELATION'
    else if(intents.some(c=>c.satisfied===false))attempt.failure='CONNECTION_INTENT'
    else attempt.accepted=true
    const candidate={kind:attempt.accepted?'valid':'diagnostic',assembly:{name:'Spatial Plan reconstruction',bricks},geometry,
      collision:attempt.collision,ranges,relations,intents,groundTranslationLdu:shiftY,attemptIndex:attempt.index,
      unverifiedConstraints:[...relations.filter(r=>r.satisfied===null),...intents.filter(c=>c.satisfied===null)]}
    candidate.ranking=rankLayout(candidate,plan,positions)
    if(attempt.accepted){result.validLayoutCount++;result.candidates.push(candidate);result.candidates.sort(compareLayouts);result.candidates.splice(topK)}
    else {rankedDiagnostics.push(candidate);rankedDiagnostics.sort(compareLayouts);rankedDiagnostics.splice(topK)}
    result.attempts.push(attempt)
  }
  function enumerate(i,positions) {
    if(i===result.domains.length)return evaluate(positions)
    const d=result.domains[i]
    for(const pose of searchPoses.get(d.id)){if(exhausted)return;enumerate(i+1,[...positions,pose])}
  }
  enumerate(0,[])
  if(exhausted)return {...result,status:'budget_exceeded',completeSearch:false,candidates:[],diagnosticCandidates:[],diagnostics:[...result.diagnostics,{code:'SEARCH_BUDGET',reason:'实际物理验证预算耗尽；未完成搜索，不提供部分 Top-K',maxCombinations}]}
  result.candidates=finishRanking(result.candidates,'candidate')
  if(!result.candidates.length)result.diagnosticCandidates=finishRanking(rankedDiagnostics,'diagnostic')
  result.search.complete=true;result.search.rankingScope='complete filtered domain under saved constraints; no image-similarity score'
  // Group for navigation only. Keep all yaw variants and exact interface indices;
  // equal positions alone do NOT prove mesh/connector symmetry.
  const groups=new Map()
  for(const c of result.candidates) {
    const key=JSON.stringify(c.assembly.bricks.map(({rotation,...b})=>b))
    if(!groups.has(key))groups.set(key,{id:'layout-'+(groups.size+1),candidateIds:[],note:'Same translations; all rotation variants retained, no mesh-equivalence claim'})
    const group=groups.get(key);group.candidateIds.push(c.id);c.layoutId=group.id
  }
  result.groups=[...groups.values()]
  const failures=new Map()
  for(const a of result.attempts.filter(a=>!a.accepted)) {
    if(!failures.has(a.failure))failures.set(a.failure,{code:a.failure,count:0,example:{attemptIndex:a.index,
      geometry:a.geometry,failedRanges:a.ranges.filter(r=>!r.satisfied),
      failedRelations:a.relations?.filter(r=>r.satisfied===false),failedIntents:a.intents?.filter(c=>c.satisfied===false)}})
    failures.get(a.failure).count++
  }
  result.rejectionSummary=[...failures.values()]
  if(!result.candidates.length){
    result.diagnostics.push(...result.rejectionSummary)
    const best=result.diagnosticCandidates[0]
    if(best)result.diagnosticAssembly={bricks:best.assembly.bricks,geometry:best.geometry,note:'Top-ranked diagnostic from connection/relative filtered domain; NOT a valid layout',candidateId:best.id}
  }
  result.completeSearch=true
  result.status=result.candidates.length ? result.candidates.some(c=>c.unverifiedConstraints.length)?'candidates_with_unverified_constraints':'candidates_found' : 'no_solution'
  return result
}

// Revalidate one saved choice against the original constraints and current shared profiles.
export function revalidateChoice(plan,input,candidate,rules){
 const fixed=structuredClone(plan),bs=candidate.assembly.bricks,byId=new Map(bs.map(b=>[b.id,b]))
 if(bs.length!==input.observations.length||byId.size!==bs.length)throw Error('候选实例身份不完整')
 for(const o of input.observations){const b=byId.get(o.id);if(!b||b.part!==o.part||b.color!==o.color)throw Error('候选身份与输入不匹配')}
 for(const p of fixed.parts){const b=byId.get(p.id),parent=p.pose.relativeTo?byId.get(p.pose.relativeTo):null
  if(!p.pose.yawCandidates.includes(b.rotation))throw Error('候选朝向不在计划中')
  const delta={x:(b.x-(parent?.x||0))*rules.STUD_LDU,z:(b.z-(parent?.z||0))*rules.STUD_LDU,y:parent?(b.layer-parent.layer)*rules.BODY_LDU:b.layer*rules.BODY_LDU-candidate.groundTranslationLdu}
  for(const a of ['x','y','z']){if(!Number.isFinite(delta[a])||!inside(delta[a],p.pose.offsetLdu[a]))throw Error('候选超出原始相对区间');p.pose.offsetLdu[a]={min:delta[a],max:delta[a]}}
  p.pose.yawCandidates=[b.rotation]
 }
 const result=executePlan(fixed,input,rules)
 if(result.candidates.length!==1)throw Error('候选未通过当前完整约束复核')
 return result.candidates[0]
}

import { validatePlan, assessConversion } from '../spatial-planning/plan.mjs'
import { assessRelations } from '../geometry-solver/solver.mjs'

const EPS = 1e-7
const same = (a,b) => Math.abs(a-b) < EPS
const inside = (v,r) => r && v >= r.min-EPS && v <= r.max+EPS
const centre = (b,rules) => ({x:b.x*rules.STUD_LDU,y:b.layer*rules.BODY_LDU,z:b.z*rules.STUD_LDU})

// A bounded adapter over the shared geometry engine, not another geometry library.
export function executePlan(plan, input, rules, { maxCombinations = 10000 } = {}) {
  if (!Number.isSafeInteger(maxCombinations) || maxCombinations < 1 || maxCombinations > 100000) throw new Error('maxCombinations must be 1..100000')
  const result = {version:'geometry-execution-v1',status:'invalid_input',completeSearch:false,
    policy:{validation:'final-assembly-connectivity-v1',gridLdu:{x:rules.STUD_LDU/2,y:1,z:rules.STUD_LDU/2},maxCombinations,
      constraints:'All numeric intervals, yaw choices, definite mating intents and executable spatial relations are hard constraints. No rounding, repair or build order.',
      selection:'Keep all accepted candidates in deterministic input/grid/yaw order; first is display default, not a best-photo claim.'},
    diagnostics:[],domains:[],attempts:[],candidates:[],groups:[]}
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
      if(last-first+1>maxCombinations)return {...result,status:'budget_exceeded',diagnostics:['Axis domain exceeds budget: '+p.id+'.'+axis]}
      axes[axis]=Array.from({length:Math.max(0,last-first+1)},(_,i)=>(first+i)*step)
    }
    const yaw=p.pose.yawCandidates.filter(y=>rules.geometrySupport(observations.get(p.id).part).geometry.rotations.includes(y))
    result.domains.push({id:p.id,worldIntervals:world,axes,yaw,count:axes.x.length*axes.y.length*axes.z.length*yaw.length})
  }
  const count=result.domains.reduce((n,d)=>n*d.count,1)
  result.combinationCount=count
  if (!count)return {...result,status:'no_solution',completeSearch:true,diagnostics:['No legal grid point in one or more original intervals']}
  if(count>maxCombinations){
    // A failed necessary mating condition proves unsatisfiability without
    // materializing every full assembly. A possible pair is NOT a valid assembly.
    const domainGround=-Math.min(...result.domains.flatMap(d=>d.axes.y))
    const poses=d=>d.axes.x.flatMap(x=>d.axes.y.flatMap(y=>d.axes.z.flatMap(z=>d.yaw.map(rotation=>({id:d.id,part:observations.get(d.id).part,color:observations.get(d.id).color,x:x/rules.STUD_LDU,layer:(y+domainGround)/rules.BODY_LDU,z:z/rules.STUD_LDU,rotation})))))
    result.pairChecks=[]
    for(const p of plan.parts)for(const c of p.connections.filter(c=>c.intent==='mates')){
      const a=result.domains.find(d=>d.id===p.id),b=result.domains.find(d=>d.id===c.other)
      if(a.count*b.count>maxCombinations)continue
      const certificate={id:p.id,...c,pairCount:a.count*b.count,possible:false,ownPoints:[],otherPoints:[]}
      if(['top','bottom'].includes(c.ownSurface)&&['top','bottom'].includes(c.otherSurface)&&c.ownSurface!==c.otherSurface){
        const points=(d,s,index)=>poses(d).flatMap(brick=>rules.connectors(brick,s).filter((_,i)=>index===null||i===index))
        const own=points(a,c.ownSurface,c.ownConnector),other=points(b,c.otherSurface,c.otherConnector)
        certificate.ownPoints=own;certificate.otherPoints=other
        certificate.possible=own.some(u=>other.some(v=>same(u.x,v.x)&&same(u.y,v.y)&&same(u.z,v.z)))
      }
      result.pairChecks.push(certificate)
    }
    const conflicts=result.pairChecks.filter(c=>!c.possible)
    if(conflicts.length){
      const positions=result.domains.map(d=>({id:d.id,x:d.axes.x[0],y:d.axes.y[0],z:d.axes.z[0],rotation:d.yaw[0]}))
      const shift=-Math.min(...positions.map(b=>b.y))
      const bricks=positions.map(b=>({id:b.id,part:observations.get(b.id).part,color:observations.get(b.id).color,x:b.x/rules.STUD_LDU,z:b.z/rules.STUD_LDU,layer:(b.y+shift)/rules.BODY_LDU,rotation:b.rotation}))
      result.diagnosticAssembly={bricks,geometry:rules.validateFinalAssembly(bricks),note:'First allowed poses for failure inspection only; not a candidate or a repaired assembly'}
      return {...result,status:'no_solution',completeSearch:true,proof:'Necessary hard mating condition impossible across the full endpoint domains',diagnostics:conflicts.map(c=>({code:'IMPOSSIBLE_MATING',id:c.id,other:c.other,reason:'原始位置区间及朝向内，指定连接器无任何重合点',pairCount:c.pairCount}))}
    }
    return {...result,status:'budget_exceeded',diagnostics:['Cartesian domain exceeds budget; no no-solution claim']}
  }
  const pById=new Map(plan.parts.map(p=>[p.id,p]))
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
    if(ranges.some(r=>!r.satisfied)){attempt.failure='RELATIVE_INTERVAL';result.attempts.push(attempt);return}
    const geometry=rules.validateFinalAssembly(bricks)
    attempt.geometry=geometry
    // Shared validator checks all body/stud collision envelopes before support/connectivity.
    attempt.collision={status:geometry.code==='COLLISION'?'collision':geometry.valid||['UNSUPPORTED','DISCONNECTED'].includes(geometry.code)?'clear':'not_established',reason:geometry.reason,brickIds:geometry.brickIds}
    const relations=plan.relations.map(r=>{
      const a=byId.get(r.from),b=byId.get(r.to),pa=centre(a,rules),pb=centre(b,rules)
      let satisfied=null
      if(r.kind==='above')satisfied=pa.y>=pb.y+rules.geometrySupport(b.part).geometry.bodySizeLdu.y-EPS
      if(r.kind==='left')satisfied=pa.x<pb.x-EPS
      if(r.kind==='front')satisfied=pa.z>pb.z+EPS
      if(r.kind==='separated') {
        const da=rules.dimensions(a.part,a.rotation),db=rules.dimensions(b.part,b.rotation)
        satisfied=Math.abs(pa.x-pb.x)>(da.width+db.width)*rules.STUD_LDU/2+EPS
          ||Math.abs(pa.z-pb.z)>(da.depth+db.depth)*rules.STUD_LDU/2+EPS
          ||pa.y>pb.y+rules.geometrySupport(b.part).geometry.bodySizeLdu.y+EPS
          ||pb.y>pa.y+rules.geometrySupport(a.part).geometry.bodySizeLdu.y+EPS
      }
      return {...r,satisfied,interpretation:satisfied===null?'Requires camera projection; retained, not certified':'world-axis body relation'}
    })
    const intents=plan.parts.flatMap(p=>p.connections.map(c=>{
      if(c.intent!=='mates')return {id:p.id,...c,satisfied:null,reason:'Non-mating contact/uncertain intent is retained, not converted to a hidden connection'}
      if(!['top','bottom'].includes(c.ownSurface)||!['top','bottom'].includes(c.otherSurface)||c.ownSurface===c.otherSurface)return {id:p.id,...c,satisfied:false,reason:'Mating intent requires opposite top/bottom surfaces'}
      const a=byId.get(p.id),b=byId.get(c.other)
      const lower=c.ownSurface==='top'?a:b,upper=c.ownSurface==='bottom'?a:b
      const shared=assessRelations(bricks,[{from:lower.id,to:upper.id,relation:'supports',confidence:1,status:'inferred'}],rules)[0]
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
    else if(relations.some(r=>r.satisfied===false))attempt.failure='SPATIAL_RELATION'
    else if(intents.some(c=>c.satisfied===false))attempt.failure='CONNECTION_INTENT'
    else {
      attempt.accepted=true
      const candidate={id:'candidate-'+(result.candidates.length+1),assembly:{name:'Spatial Plan reconstruction',bricks},geometry,
        collision:attempt.collision,ranges,relations,intents,groundTranslationLdu:shiftY,attemptIndex:attempt.index,
        unverifiedConstraints:[...relations.filter(r=>r.satisfied===null),...intents.filter(c=>c.satisfied===null)]}
      result.candidates.push(candidate)
    }
    result.attempts.push(attempt)
  }
  function enumerate(i,positions) {
    if(i===result.domains.length)return evaluate(positions)
    const d=result.domains[i]
    for(const x of d.axes.x)for(const y of d.axes.y)for(const z of d.axes.z)for(const rotation of d.yaw)enumerate(i+1,[...positions,{id:d.id,x,y,z,rotation}])
  }
  enumerate(0,[])
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
  if(!result.candidates.length)result.diagnostics.push(...result.rejectionSummary)
  result.completeSearch=true
  result.status=result.candidates.length ? result.candidates.some(c=>c.unverifiedConstraints.length)?'candidates_with_unverified_constraints':'candidates_found' : 'no_solution'
  return result
}

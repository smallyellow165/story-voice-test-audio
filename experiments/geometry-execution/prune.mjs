// Necessary binary constraints only. Full collision/connectivity validation remains mandatory.
const EPS=1e-7
export function spatialRelation(r,a,b,rules){
 const pa={x:a.x*rules.STUD_LDU,y:a.layer*rules.BODY_LDU,z:a.z*rules.STUD_LDU},pb={x:b.x*rules.STUD_LDU,y:b.layer*rules.BODY_LDU,z:b.z*rules.STUD_LDU}
 if(r.kind==='above')return pa.y>=pb.y+rules.geometrySupport(b.part).geometry.bodySizeLdu.y-EPS
 if(r.kind==='left')return pa.x<pb.x-EPS
 if(r.kind==='front')return pa.z>pb.z+EPS
 if(r.kind==='separated'){
  const da=rules.dimensions(a.part,a.rotation),db=rules.dimensions(b.part,b.rotation)
  return Math.abs(pa.x-pb.x)>(da.width+db.width)*rules.STUD_LDU/2+EPS||Math.abs(pa.z-pb.z)>(da.depth+db.depth)*rules.STUD_LDU/2+EPS||pa.y>pb.y+rules.geometrySupport(b.part).geometry.bodySizeLdu.y+EPS||pb.y>pa.y+rules.geometrySupport(a.part).geometry.bodySizeLdu.y+EPS
 }
 return null // Projection/occlusion requires camera evidence, not origin inequalities.
}
export function pruneDomains(plan,domains,observations,rules,{maxPairChecks=200000}={}){
 const stats={originalCombinationCount:domains.reduce((n,d)=>n*d.count,1),remainingCombinationCount:0,maxPairChecks,pairEvaluations:0,stages:[],constraints:[],removals:[],skipped:[]}
 // Bound preprocessing as well as final search. Skipping pruning never approves a pose.
 if(domains.some(d=>d.count>maxPairChecks))return {stats:{...stats,remainingCombinationCount:stats.originalCombinationCount,skipped:['Individual pose domain exceeds preprocessing budget']},poses:null,conflict:null}
 const ground=-Math.min(...domains.flatMap(d=>d.axes.y)),values=new Map(domains.map(d=>[d.id,d.axes.x.flatMap(x=>d.axes.y.flatMap(y=>d.axes.z.flatMap(z=>d.yaw.map(rotation=>({id:d.id,x,y,z,rotation})))))]))
 const brick=p=>({id:p.id,part:observations.get(p.id).part,color:observations.get(p.id).color,x:p.x/rules.STUD_LDU,z:p.z/rules.STUD_LDU,layer:(p.y+ground)/rules.BODY_LDU,rotation:p.rotation})
 const active=new Map([...values].map(([id,ps])=>[id,new Set(ps.map((_,i)=>i))])),constraints=[]
 const product=()=>[...active.values()].reduce((n,s)=>n*s.size,1)
 function add(a,b,kind,evidence,test){
  const av=values.get(a),bv=values.get(b),cost=av.length*bv.length
  if(stats.pairEvaluations+cost>maxPairChecks){stats.skipped.push({a,b,kind,reason:'Pair preprocessing budget exceeded',cost});return}
  const supports=av.map(()=>new Set()),reverse=bv.map(()=>new Set())
  for(let i=0;i<av.length;i++)for(let j=0;j<bv.length;j++)if(test(av[i],bv[j])){supports[i].add(j);reverse[j].add(i)}
  stats.pairEvaluations+=cost
  const summary={id:constraints.length,a,b,kind,evidence,pairs:cost,compatiblePairs:supports.reduce((n,s)=>n+s.size,0)}
  stats.constraints.push(summary);constraints.push({...summary,supports,reverse})
 }
 function propagate(stage){
  let changed=true
  while(changed){changed=false;for(const c of constraints)for(const [id,other,support]of[[c.a,c.b,c.supports],[c.b,c.a,c.reverse]]){
   const removed=[];for(const i of active.get(id))if(![...support[i]].some(j=>active.get(other).has(j)))removed.push(i)
   if(removed.length){removed.forEach(i=>active.get(id).delete(i));changed=true;stats.removals.push({stage,constraintId:c.id,id,other,removedIndices:removed,remaining:active.get(id).size})}
   if(!active.get(id).size){stats.stages.push({stage,combinationCount:0});return {code:'CONSTRAINT_DOMAIN_EMPTY',id,other,kind:c.kind,constraintId:c.id,reason:`${id} ↔ ${other}: ${c.kind} 与已传播的连接/相对区间/硬关系无法同时满足`,evidence:c.evidence}}
  }}stats.stages.push({stage,combinationCount:product()});return null
 }
 for(const p of plan.parts){
  if(p.pose.relativeTo)add(p.id,p.pose.relativeTo,'relative_interval',p.pose.offsetLdu,(a,b)=>['x','y','z'].every(k=>a[k]-b[k]>=p.pose.offsetLdu[k].min-EPS&&a[k]-b[k]<=p.pose.offsetLdu[k].max+EPS))
  for(const c of p.connections.filter(c=>c.intent==='mates'))add(p.id,c.other,'mates',c,(a,b)=>{
   if(!['top','bottom'].includes(c.ownSurface)||!['top','bottom'].includes(c.otherSurface)||c.ownSurface===c.otherSurface)return false
   const own=rules.connectors(brick(a),c.ownSurface),other=rules.connectors(brick(b),c.otherSurface)
   return own.some((u,i)=>(c.ownConnector===null||i===c.ownConnector)&&other.some((v,j)=>(c.otherConnector===null||j===c.otherConnector)&&u.type===v.type&&u.direction!==v.direction&&['x','y','z'].every(k=>Math.abs(u[k]-v[k])<EPS)))
  })
 }
 let conflict=propagate('connections_and_relative_intervals')
 if(!conflict){for(const r of plan.relations.filter(r=>['above','left','front','separated'].includes(r.kind)))add(r.from,r.to,r.kind,r,(a,b)=>spatialRelation(r,brick(a),brick(b),rules));conflict=propagate('hard_spatial_relations')}
 stats.remainingCombinationCount=conflict?0:product();stats.domains=[...active].map(([id,s])=>({id,originalCount:values.get(id).length,remainingCount:s.size}))
 return {stats,conflict,poses:new Map([...active].map(([id,s])=>[id,[...s].map(i=>values.get(id)[i])]))}
}

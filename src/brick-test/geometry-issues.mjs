// Presentation adapter only: do not re-run geometry or interpret failed/short-circuited
// connection checks as proof that a physical connection is impossible.
export function geometryIssuesForDisplay(report,refinement){
 const issues=new Map()
 const add=(ids,type,scope,raw)=>{
  if(!Array.isArray(ids)||ids.length!==2||ids.some(id=>typeof id!=='string')||ids[0]===ids[1])return
  ids=[...ids].sort();const key=JSON.stringify([ids,type,scope]);const old=issues.get(key)
  if(old){old.details.push(raw);return}
  issues.set(key,{key,ids,type,scope,details:[raw]})
 }
 for(const d of report?.selectedLayout?[]:report?.diagnostics||[])if(d?.code==='CONSTRAINT_DOMAIN_EMPTY')add([d.id,d.other],'Constraint Conflict','domain',d)
 const c=report?.selectedLayout
 for(const r of c?.relations||[])if(r.satisfied===false)add([r.from,r.to],'Spatial Relation','layout',{...r,reason:`${r.from} ${r.kind} ${r.to}：当前姿态不满足硬空间关系`})
 for(const r of c?.intents||[])if(r.satisfied===false)add([r.id,r.other],'Missing Connection','layout',r)
 for(const r of c?.ranges||[])if(!r.satisfied&&r.relativeTo)add([r.id,r.relativeTo],'Position Mismatch','layout',r)
 const g=c?.geometry||report?.diagnosticAssembly?.geometry
 if(g?.code==='COLLISION')add(g.brickIds,'Collision','layout',g)
 // These diagnostics describe the recorded bounded search, not the current pose.
 for(const d of refinement?.diagnostics||[]){
  if(d?.code==='IMPOSSIBLE_MATING_IN_DOMAIN')add([d.id,d.other],'Impossible Mating','domain',d)
  else if(d?.code==='EMPTY_CONSTRAINT_DOMAIN')add([d.id,d.other],'Position Mismatch','domain',d)
 }
 return [...issues.values()]
}
export function expectedConnections(plan,ids){
 return (plan?.parts||[]).filter(p=>ids.includes(p.id)).flatMap(p=>(p.connections||[]).filter(c=>ids.includes(c.other)).map(c=>({id:p.id,...c})))
}

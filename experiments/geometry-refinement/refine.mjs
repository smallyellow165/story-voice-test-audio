import {validatePlan,assessConversion} from '../spatial-planning/plan.mjs'
import {executePlan} from '../geometry-execution/execute.mjs'

const EPS=1e-7,axes=['x','y','z']
const inside=(v,r)=>v>=r.min-EPS&&v<=r.max+EPS
const same=(a,b)=>Math.abs(a-b)<EPS
const angle=(a,b)=>Math.min((a-b+360)%360,(b-a+360)%360)
const point=b=>({x:b.x*40,y:b.layer*48,z:b.z*40})

// This adapter proposes poses. Only the existing strict executor grants validity.
export function planAtPoses(original,poses){
 const result=structuredClone(original),byId=new Map(poses.map(p=>[p.id,p]))
 for(const p of result.parts){const b=byId.get(p.id),parent=p.pose.relativeTo===null?{x:0,y:0,z:0}:byId.get(p.pose.relativeTo)
  p.pose.offsetLdu=Object.fromEntries(axes.map(a=>[a,{min:b[a]-parent[a],max:b[a]-parent[a]}]))
  p.pose.yawCandidates=[b.rotation]
 }
 return result
}

export function refineGeometry(plan,input,rules,{radiusLdu=20,maxNodes=20000,maxProposals=6}={}){
 if(![20,40].includes(radiusLdu)||!Number.isInteger(maxNodes)||maxNodes<1||maxNodes>50000||!Number.isInteger(maxProposals)||maxProposals<1||maxProposals>8)throw new Error('Invalid bounded refinement policy')
 const result={version:'geometry-refinement-v1',status:'invalid_input',policy:{radiusLdu:{x:radiusLdu,y:0,z:0},maxNodes,maxProposals,
  anchor:'Original anchor stays fixed; upright and original yaw candidates only.',
  preserved:'Original height/depth intervals, all original nonzero horizontal ordering, explicit world relations, definite mating indices and rectangular side-touch contacts.',
  ranking:'Strictly valid proposals first; then smallest total L1 translation, maximum per-part translation, rotation change. Retain different asymmetric orientations for review.',
  limitations:'Single-view occlusion/projection and photo-facing curved direction require human review. No vertical/depth expansion, automatic approval, collision relaxation or build order.'},
  diagnostics:[],proposals:[],stats:{nodes:0,leaves:0,collisionPruned:0,constraintPruned:0},completeSearch:false}
 const validation=validatePlan(plan,input)
 if(!validation.valid)return {...result,diagnostics:validation.issues}
 const original=executePlan(plan,input,rules)
 result.originalExecution={status:original.status,completeSearch:original.completeSearch,diagnostics:original.diagnostics,proof:original.proof}
 if(original.candidates.length)return {...result,status:'unchanged_valid',completeSearch:true,diagnostics:['Original plan already has strictly valid candidates; no refinement or revision created.']}
 if(['invalid_input','insufficient_information'].includes(original.status))return {...result,diagnostics:original.diagnostics}
 const conversion=assessConversion(plan,input),observations=new Map(input.observations.map(o=>[o.id,o])),parts=new Map(plan.parts.map(p=>[p.id,p]))
 const base=conversion.candidates.map(c=>({id:c.id,...Object.fromEntries(axes.map(a=>[a,(c.worldOffsetLdu[a].min+c.worldOffsetLdu[a].max)/2])),rotation:c.yawCandidates[0]}))
 const baseById=new Map(base.map(p=>[p.id,p]))
 const ground=-Math.min(...conversion.candidates.map(c=>c.worldOffsetLdu.y.min))
 const brick=p=>({id:p.id,part:observations.get(p.id).part,color:observations.get(p.id).color,x:p.x/rules.STUD_LDU,z:p.z/rules.STUD_LDU,layer:(p.y+ground)/rules.BODY_LDU,rotation:p.rotation})
 const domains=new Map()
 for(const c of conversion.candidates){
  const p=parts.get(c.id),domainAxes={}
  for(const a of axes){const r=c.worldOffsetLdu[a],expand=a==='x'&&p.pose.relativeTo!==null?radiusLdu:0,step=a==='y'?1:rules.STUD_LDU/2
   const first=Math.ceil((r.min-expand-EPS)/step),last=Math.floor((r.max+expand+EPS)/step)
   if(last-first+1>128)return {...result,status:'unresolved',diagnostics:['Position interval too broad for bounded refinement: '+c.id+'.'+a]}
   domainAxes[a]=Array.from({length:Math.max(0,last-first+1)},(_,i)=>(i+first)*step)
  }
  const poses=domainAxes.x.flatMap(x=>domainAxes.y.flatMap(y=>domainAxes.z.flatMap(z=>c.yawCandidates.map(rotation=>({id:c.id,x,y,z,rotation})))))
  if(!poses.length||poses.length>256)return {...result,status:'unresolved',diagnostics:['Empty or excessive pose domain: '+c.id]}
  const b=baseById.get(c.id)
  poses.sort((u,v)=>axes.reduce((s,a)=>s+Math.abs(u[a]-b[a])-Math.abs(v[a]-b[a]),0)||angle(u.rotation,b.rotation)-angle(v.rotation,b.rotation)||u.x-v.x||u.rotation-v.rotation)
  domains.set(c.id,poses.map((pose,i)=>{const b=brick(pose);return {pose,brick:b,index:i,top:rules.connectors(b,'top'),bottom:rules.connectors(b,'bottom')}}))
 }
 result.domains=[...domains].map(([id,d])=>({id,poses:d.map(p=>p.pose)}))
 result.originalPoses=base
 result.originalAssembly=base.every(p=>rules.validPosition(brick(p)))?{bricks:base.map(brick)}:null
 const allIntents=plan.parts.flatMap(p=>p.connections.map(c=>({id:p.id,...c})))
 const mating=(a,b,c)=>{
  if(!['top','bottom'].includes(c.ownSurface)||!['top','bottom'].includes(c.otherSurface)||c.ownSurface===c.otherSurface)return false
  return a[c.ownSurface].some((u,i)=>(c.ownConnector===null||c.ownConnector===i)&&b[c.otherSurface].some((v,j)=>{
   const top=c.ownSurface==='top'?u:v,bottom=c.ownSurface==='bottom'?u:v
   return (c.otherConnector===null||c.otherConnector===j)&&axes.every(k=>same(u[k],v[k]))&&top.type===bottom.type&&top.direction==='up'&&bottom.direction==='down'&&top.radiusLdu<=bottom.radiusLdu&&top.depthLdu<=bottom.depthLdu
  }))
 }
 function sideContact(a,b){
  const ga=rules.geometrySupport(a.brick.part).geometry,gb=rules.geometrySupport(b.brick.part).geometry
  if(ga.family!=='rectangular-duplo'||gb.family!=='rectangular-duplo')return null
  const da=rules.dimensions(a.brick.part,a.pose.rotation),db=rules.dimensions(b.brick.part,b.pose.rotation)
  const dx=Math.abs(a.pose.x-b.pose.x),dz=Math.abs(a.pose.z-b.pose.z),sx=(da.width+db.width)*20,sz=(da.depth+db.depth)*20
  return Math.min(a.pose.y+ga.bodySizeLdu.y,b.pose.y+gb.bodySizeLdu.y)>Math.max(a.pose.y,b.pose.y)+EPS&&((same(dx,sx)&&dz<sz-EPS)||(same(dz,sz)&&dx<sx-EPS))
 }
 const memo=new Map()
 function pair(a,b){
  const key=a.pose.id+':'+a.index+'/'+b.pose.id+':'+b.index
  if(memo.has(key))return memo.get(key)
  let reason=null
  const ba=baseById.get(a.pose.id),bb=baseById.get(b.pose.id)
  // Preserve ordering for every interval pair whose X order is unambiguous.
  const wa=conversion.candidates.find(c=>c.id===a.pose.id).worldOffsetLdu.x,wb=conversion.candidates.find(c=>c.id===b.pose.id).worldOffsetLdu.x
  if(wa.max<wb.min-EPS&&a.pose.x>=b.pose.x-EPS||wb.max<wa.min-EPS&&b.pose.x>=a.pose.x-EPS)reason='HORIZONTAL_ORDER'
  for(const c of allIntents){
   const own=c.id===a.pose.id&&c.other===b.pose.id?a:c.id===b.pose.id&&c.other===a.pose.id?b:null
   if(!own)continue;const other=own===a?b:a
   if(c.intent==='mates'&&!mating(own,other,c))reason='MATING_INTENT'
   if(c.intent==='touches'&&c.ownSurface==='side'&&c.otherSurface==='side'&&sideContact(own,other)===false)reason='SIDE_CONTACT'
  }
  for(const r of plan.relations){
   const own=r.from===a.pose.id&&r.to===b.pose.id?a:r.from===b.pose.id&&r.to===a.pose.id?b:null
   if(!own)continue;const other=own===a?b:a
   if(r.kind==='left'&&own.pose.x>=other.pose.x-EPS||r.kind==='front'&&own.pose.z<=other.pose.z+EPS||r.kind==='above'&&own.pose.y<other.pose.y+rules.geometrySupport(other.brick.part).geometry.bodySizeLdu.y-EPS)reason='VISUAL_RELATION'
  }
  if(!reason&&rules.validateAssembly([a.brick,b.brick]).code==='COLLISION')reason='COLLISION'
  memo.set(key,reason);return reason
 }
 // Arc consistency preserves every solution in the bounded domain. No guesses
 // about part names, repaired connector indices or hidden support are made.
 let changed=true
 while(changed){changed=false
  for(const [id,domain] of domains)for(const [other,otherDomain] of domains){
   if(id===other)continue
   const keep=domains.get(id).filter(a=>otherDomain.some(b=>pair(a,b)===null))
   if(keep.length<domains.get(id).length){domains.set(id,keep);changed=true}
   if(!keep.length)return {...result,status:'no_solution_in_bounds',completeSearch:true,diagnostics:[{code:'EMPTY_CONSTRAINT_DOMAIN',id,other,reason:'No pose pair satisfies preserved contacts, order and collision envelopes within the stated bounds.'}]}
  }
 }
 result.prunedDomains=[...domains].map(([id,d])=>({id,count:d.length}))
 const retained=new Map(),failures=new Map()
 const compare=(a,b)=>(b.geometry.valid-a.geometry.valid)||a.score.totalTranslationLdu-b.score.totalTranslationLdu||a.score.maxTranslationLdu-b.score.maxTranslationLdu||a.score.rotationDegrees-b.score.rotationDegrees||JSON.stringify(a.poses).localeCompare(JSON.stringify(b.poses))
 function assess(selected){
  result.stats.leaves++
  const poses=plan.parts.map(p=>selected.get(p.id).pose),refinedPlan=planAtPoses(plan,poses),execution=executePlan(refinedPlan,input,rules)
  const attempt=execution.attempts[0],geometry=attempt?.geometry
  if(!geometry){failures.set(execution.status,(failures.get(execution.status)||0)+1);return}
  if(attempt.relations?.some(r=>r.satisfied===false)){failures.set('VISUAL_RELATION',(failures.get('VISUAL_RELATION')||0)+1);return}
  if(!geometry.valid)failures.set(geometry.code,(failures.get(geometry.code)||0)+1)
  const diffs=poses.map(p=>{const original=baseById.get(p.id),relativeTo=parts.get(p.id).pose.relativeTo,relative=refinedPlan.parts.find(b=>b.id===p.id).pose.offsetLdu
   return {id:p.id,original:{x:original.x,y:original.y,z:original.z,rotation:original.rotation},proposed:{x:p.x,y:p.y,z:p.z,rotation:p.rotation},deltaLdu:Object.fromEntries(axes.map(a=>[a,p[a]-original[a]])),rotationDeltaDegrees:angle(p.rotation,original.rotation),relativeTo,
    originalIntervals:parts.get(p.id).pose.offsetLdu,proposedRelativeOffsetLdu:Object.fromEntries(axes.map(a=>[a,relative[a].min])),outsideOriginalIntervals:axes.filter(a=>!inside(relative[a].min,parts.get(p.id).pose.offsetLdu[a]))}
  })
  const camera=plan.relations.filter(r=>['occludes','overlaps_projection'].includes(r.kind))
  const contacts=allIntents.filter(c=>c.intent!=='mates').map(c=>({...c,satisfied:c.intent==='touches'&&c.ownSurface==='side'&&c.otherSurface==='side'?sideContact(selected.get(c.id),selected.get(c.other)):null}))
  const outside=diffs.filter(d=>d.outsideOriginalIntervals.length)
  const classification=outside.length||camera.length||contacts.some(c=>c.satisfied===null)?'requires_review':'within_evidence'
  const score={totalTranslationLdu:diffs.reduce((s,d)=>s+axes.reduce((n,a)=>n+Math.abs(d.deltaLdu[a]),0),0),maxTranslationLdu:Math.max(...diffs.map(d=>axes.reduce((n,a)=>n+Math.abs(d.deltaLdu[a]),0))),rotationDegrees:diffs.reduce((s,d)=>s+d.rotationDeltaDegrees,0)}
  const proposal={poses,refinedPlan,assembly:{bricks:poses.map(brick)},geometry,strictExecution:execution,classification,approved:false,score,diffs,
   constraints:{mating:allIntents.filter(c=>c.intent==='mates').map(c=>({...c,aligned:mating(selected.get(c.id),selected.get(c.other),c),scope:'Necessary interface alignment; not whole-assembly validity'})),contacts,relations:attempt.relations,cameraReview:camera,preservedHorizontalOrder:true},
   reviewReasons:[...(outside.length?['Original relative intervals exceeded: '+outside.map(d=>d.id).join(', ')]:[]),...(camera.length?['Occlusion/projection cannot be certified without camera calibration']:[]),...(!geometry.valid?['Strict Geometry remains Invalid: '+geometry.reason]:[])]}
  // Collapse only display-equivalent yaw choices of reviewed rectangular parts.
  // Every evaluated proposal still obeys the original indexed mating intents.
  const layout=JSON.stringify(poses.map(p=>({...p,rotation:rules.geometrySupport(observations.get(p.id).part).geometry.family==='rectangular-duplo'?p.rotation%180===0?0:rules.geometrySupport(observations.get(p.id).part).geometry.bodySizeLdu.x===rules.geometrySupport(observations.get(p.id).part).geometry.bodySizeLdu.z?0:90:p.rotation})))
  if(!retained.has(layout)||compare(proposal,retained.get(layout))<0)retained.set(layout,proposal)
  if(retained.size>maxProposals*4){const best=[...retained].sort((a,b)=>compare(a[1],b[1])).slice(0,maxProposals*2);retained.clear();best.forEach(([k,v])=>retained.set(k,v))}
 }
 let exhausted=false
 function search(selected,remaining){
  if(result.stats.nodes>=maxNodes){exhausted=true;return}
  result.stats.nodes++
  if(!remaining.length){assess(selected);return}
  const choices=remaining.map(id=>({id,domain:domains.get(id).filter(a=>[...selected.values()].every(b=>{const reason=pair(a,b);if(reason){if(reason==='COLLISION')result.stats.collisionPruned++;else result.stats.constraintPruned++;return false}return true}))})).sort((a,b)=>a.domain.length-b.domain.length||a.id.localeCompare(b.id))
  const next=choices[0];if(!next.domain.length)return
  for(const p of next.domain){selected.set(next.id,p);search(selected,remaining.filter(id=>id!==next.id));selected.delete(next.id);if(exhausted)break}
 }
 search(new Map(),plan.parts.map(p=>p.id))
 result.completeSearch=!exhausted
 result.proposals=[...retained.values()].sort(compare).slice(0,maxProposals).map((p,i)=>({...p,id:'proposal-'+(i+1)}))
 result.rejectionSummary=[...failures].map(([code,count])=>({code,count}))
 result.status=result.proposals.some(p=>p.geometry.valid)?'proposals_found':result.proposals.length?'unresolved':exhausted?'budget_exceeded':'no_solution_in_bounds'
 result.diagnostics.push(...result.rejectionSummary)
 if(exhausted)result.diagnostics.push('Search budget reached; suggestions are best explored, not a global minimum or no-solution proof.')
 if(result.proposals.length&&!result.proposals.some(p=>p.geometry.valid))result.diagnostics.push('Connector alignment can be improved, but no explored proposal passes strict Geometry. Approval saves a reviewed layout only; it cannot grant Geometry Valid.')
 return result
}

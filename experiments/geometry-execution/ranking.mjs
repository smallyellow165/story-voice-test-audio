// Deterministic preference only: physical errors can never be offset by visual scores.
export function rankLayout(c,plan,positions){
 const raw=new Map(positions.map(p=>[p.id,p]))
 let midpointDistanceLdu=0,yawPreference=0
 for(const p of plan.parts){const v=raw.get(p.id),parent=p.pose.relativeTo?raw.get(p.pose.relativeTo):{x:0,y:0,z:0}
  for(const a of ['x','y','z']){const r=p.pose.offsetLdu[a];midpointDistanceLdu+=Math.abs(v[a]-parent[a]-(r.min+r.max)/2)}
  yawPreference+=p.pose.yawCandidates.indexOf(v.rotation)
 }
 const physicalTier=c.geometry.valid?0:c.geometry.code==='DISCONNECTED'?1:c.geometry.code==='COLLISION'?3:2
 const failedIntents=c.intents.filter(i=>i.satisfied===false).length,failedRanges=c.ranges.filter(r=>!r.satisfied).length,failedRelations=c.relations.filter(r=>r.satisfied===false).length
 return {physicalTier,failedIntents,failedRanges,failedRelations,midpointDistanceLdu,yawPreference,
  vector:[physicalTier,failedIntents,failedRanges,failedRelations,midpointDistanceLdu,yawPreference],
  explanation:'按物理状态→连接意图→相对区间→硬空间关系→区间中心偏差→yaw 输入顺序排序；yaw 顺序仅作平局偏好。未评分照片相似度、未经校准的遮挡或额外 Part Explorer 证据。'}
}
const key=c=>JSON.stringify(c.assembly.bricks.map(b=>[b.id,b.x,b.layer,b.z,b.rotation]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))
export function compareLayouts(a,b){for(let i=0;i<a.ranking.vector.length;i++){const delta=a.ranking.vector[i]-b.ranking.vector[i];if(delta)return delta}return key(a).localeCompare(key(b))}
export function finishRanking(items,prefix){
 const seen=new Set(),out=[]
 for(const c of items){const k=key(c);if(seen.has(k))continue;seen.add(k);out.push({...c,id:prefix+'-'+(out.length+1),rank:out.length+1})}
 const first=out[0]
 for(const c of out)c.differences=first?c.assembly.bricks.filter(b=>{const a=first.assembly.bricks.find(a=>a.id===b.id);return a.x!==b.x||a.layer!==b.layer||a.z!==b.z||a.rotation!==b.rotation}).map(b=>({id:b.id,first:first.assembly.bricks.find(a=>a.id===b.id),selected:b})):[]
 return out
}

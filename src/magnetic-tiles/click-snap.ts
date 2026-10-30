import {distance,edges,EPS,findSnapCandidates,rankSnapCandidates,validate,vertices} from './geometry.ts'
import type {Assembly,Profile,Snap,Tile} from './geometry.ts'
export type ClickSnapResult={status:'snapped'|'unchanged'|'unavailable'|'ambiguous';assembly:Assembly;message:string}
// UI confidence only, in the existing normalized Snap score. Not a geometric
// tolerance, capture-radius change or new candidate-generation algorithm.
const AMBIGUITY_SCORE_BAND=.10
function samePlacement(a:Tile,b:Tile,profiles:readonly Profile[]){
 const av=vertices(a,profiles),bv=vertices(b,profiles)
 if(!av.every(v=>bv.some(q=>distance(v,q)<=EPS)))return false
 const enabled=(t:Tile)=>edges(t,profiles).filter(e=>e.enabled)
 return enabled(a).every(e=>enabled(b).some(q=>(distance(e.a,q.a)<=EPS&&distance(e.b,q.b)<=EPS)||(distance(e.a,q.b)<=EPS&&distance(e.b,q.a)<=EPS)))
}
const connectionKey=(c:ReturnType<typeof validate>['connections'][number])=>[JSON.stringify([c.a.tileId,c.a.edgeId]),JSON.stringify([c.b.tileId,c.b.edgeId])].sort().join('/')
export function clickSnap(assembly:Assembly,id:string,profiles:readonly Profile[],captureDistance:number):ClickSnapResult{
 const unchanged=(status:ClickSnapResult['status'],message:string):ClickSnapResult=>({status,assembly,message})
 const tile=assembly.instances.find(t=>t.id===id)
 if(!tile)return unchanged('unavailable','无法安全吸附：选中零件已不存在。')
 const before=validate(assembly.instances,profiles)
 if(!before.draftValid)return unchanged('unavailable','无法安全吸附：请先处理当前作品的几何冲突。')
 // V1 deliberately leaves every already-connected tile untouched. This protects
 // even partial contacts and cyclic connections without moving whole components.
 if(before.connections.some(c=>c.a.tileId===id||c.b.tileId===id))return unchanged('unchanged','无需调整：零件已有合法连接，保持原位。')
 const others=assembly.instances.filter(t=>t.id!==id),ranked=rankSnapCandidates(findSnapCandidates(tile,others,profiles,captureDistance))
 if(!ranked.length)return unchanged('unavailable','无法安全吸附：附近没有合适的合法连接位置。')
 const best=ranked[0],comparable=(c:Snap)=>c.coverageCount===best.coverageCount&&c.contactCount===best.contactCount&&Math.abs(c.contactLength-best.contactLength)<=EPS&&c.score<=best.score+AMBIGUITY_SCORE_BAND
 if(ranked.some(c=>comparable(c)&&!samePlacement(c.tile,best.tile,profiles)))return unchanged('ambiguous','无法安全吸附：有多个相近候选，请切回拖动吸附选择位置。')
 if(samePlacement(tile,best.tile,profiles))return unchanged('unchanged','无需调整：当前已处于合理的吸附位置。')
 const next={...assembly,instances:assembly.instances.map(t=>t.id===id?best.tile:t)},after=validate(next.instances,profiles),keys=new Set(after.connections.map(connectionKey))
 const newContact=after.connections.some(c=>c.a.tileId===id||c.b.tileId===id)
 if(!after.draftValid||!newContact||after.components.length>=before.components.length||(before.valid&&!after.valid)||before.connections.some(c=>!keys.has(connectionKey(c))))return unchanged('unavailable','无法安全吸附：调整会影响现有连接或几何合法性，保持原位。')
 return {status:'snapped',assembly:next,message:'已单击吸附：仅调整选中零件，可撤销。'}
}

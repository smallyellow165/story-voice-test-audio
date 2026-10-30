import type {LayoutConflicts,DiagnosticConflicts} from './candidate-conflicts.ts'
import {vertices} from '../geometry.ts'
import type {Tile,Profile} from '../geometry.ts'
export function ConflictOverlay({conflicts,tiles,profiles,focus}:{conflicts:LayoutConflicts;tiles:readonly Tile[];profiles:readonly Profile[];focus:string}){
 const items=[...conflicts.overlaps,...conflicts.occupancy,...conflicts.edgeContacts],chosen=items.find(i=>i.id===focus),ids=new Set((chosen?[chosen]:items).flatMap(i=>i.tileIds))
 return <g className="candidate-conflict-overlay" pointerEvents="none" aria-hidden="true">
  {tiles.filter(t=>ids.has(t.id)).map(t=><polygon key={t.id} data-conflict-outline={t.id} points={vertices(t,profiles).map(p=>p.join(',')).join(' ')} fill="none" stroke="#b32b36" strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}
  {conflicts.overlaps.map(o=><polygon key={o.id} data-conflict-overlap={o.id} data-conflict-pair={o.tileIds.join('/')} data-conflict-area={o.area} points={o.polygon.map(p=>p.join(',')).join(' ')} fill={focus===o.id?'#ed152b66':'#e2364044'} stroke="#c52e3a" strokeWidth={focus===o.id?2:1} vectorEffect="non-scaling-stroke"><title>{o.tileIds.join('/')} · OVERLAP · {o.area.toPrecision(12)} 标准单位²</title></polygon>)}
  {conflicts.occupancy.map(o=><line key={o.id} data-conflict-occupied={o.id} data-conflict-edge={o.sharedEdge.tileId+'.'+o.sharedEdge.edgeId} data-conflict-range={JSON.stringify(o.range)} data-conflict-length={o.length} x1={o.start[0]} y1={o.start[1]} x2={o.end[0]} y2={o.end[1]} stroke="#e68913" strokeWidth={focus===o.id?9:6} vectorEffect="non-scaling-stroke"><title>{o.sharedEdge.tileId}.{o.sharedEdge.edgeId} · EDGE_OCCUPIED · {o.length.toPrecision(12)}</title></line>)}
  {conflicts.edgeContacts.map(o=><line key={o.id} data-conflict-direction={o.id} x1={o.contact.start[0]} y1={o.contact.start[1]} x2={o.contact.end[0]} y2={o.contact.end[1]} stroke="#823cc0" strokeWidth="2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"><title>{o.a.tileId}.{o.a.edgeId} / {o.b.tileId}.{o.b.edgeId} · {o.reason}</title></line>)}
 </g>
}
export function DiagnosticConflictInspector({data,focus,onFocus}:{data:DiagnosticConflicts;focus:string;onFocus:(id:string)=>void}){
 if(!data.available)return <p>{data.reason}</p>
 const c=data.current
 return <section className="candidate-conflict-inspector" aria-label="当前 Diagnostic 实际冲突">
  <div className="button-row"><b>当前 Diagnostic 实际冲突</b><button disabled={!focus} onClick={()=>onFocus('')}>查看全图</button></div>
  <p className="hint">{data.references.reconstructionId.slice(0,8)} / {data.references.diagnosticId} · {data.geometryInputs.tileCount} 块已保存 Pose · 当前 Validator 复核。红：实际交集；橙：重复区间；紫：同侧/禁用边。</p>
  <p data-testid="candidate-conflict-summary">面积重叠 {c.overlaps.length} · 重复占用 {c.occupancy.length} · 边接触错误 {c.edgeContacts.length} · 组件 {c.report.components.length} · valid {String(c.report.valid)}</p>
  <ul className="candidate-conflict-list">
   {c.overlaps.map(o=><li key={o.id}><button aria-pressed={focus===o.id} data-focus-conflict={o.id} onClick={()=>onFocus(o.id)}>OVERLAP · {o.tileIds.join('/')} · {o.area.toFixed(9)} 单位²</button></li>)}
   {c.occupancy.map(o=><li key={o.id}><button aria-pressed={focus===o.id} data-focus-conflict={o.id} onClick={()=>onFocus(o.id)}>EDGE_OCCUPIED · {o.sharedEdge.tileId}.{o.sharedEdge.edgeId} · 长 {o.length.toFixed(9)}</button><span>区间 [{o.range.map(n=>n.toFixed(9)).join(', ')}]；{o.owners.map(p=>p.other.tileId+'.'+p.other.edgeId).join(' 与 ')} 重复占用。</span></li>)}
   {c.edgeContacts.map(o=><li key={o.id}><button aria-pressed={focus===o.id} data-focus-conflict={o.id} onClick={()=>onFocus(o.id)}>EDGE_CONTACT · {o.a.tileId}.{o.a.edgeId}/{o.b.tileId}.{o.b.edgeId}</button><span>{o.reason==='same-side-interiors'?'内部在接触线同侧':'边未启用'} · 长 {o.contact.length.toFixed(9)}</span></li>)}
   {c.report.issues.filter(i=>i.code==='DISCONNECTED').map((i,index)=><li key={'graph-'+index}>DISCONNECTED · {i.message} · {c.report.components.map(ids=>ids.join('/')).join('；')}</li>)}
   {c.structuralIssues.map((i,index)=><li key={index}>{i.code} · {i.tileIds.join('/')} · {i.message}</li>)}
  </ul>
  <p className="hint">{c.report.components.length===1?'接触图为 1 个组件，仍须通过面积及区间检查。':'存在未连接组件，详见复核 JSON。'}Review 关系冲突 {c.relationViolations.length}。保存的 Validator 与当前复核{c.savedReportMatchesCurrent?'一致':'不同；历史原文保持不变'}。</p>
  <details><summary>Review 独立拟合：另有 {data.independentReviewFit.overlapCount} 对潜在重叠（非本候选）</summary><p>仅独立拟合中出现：{data.independentReviewFit.onlyInIndependentFit.join('；')||'无'}。这些数据不用于红色面积或实际冲突列表。</p></details>
  <details><summary>当前候选冲突证据 JSON · 只读</summary><pre>{JSON.stringify(data,null,2)}</pre></details>
 </section>
}

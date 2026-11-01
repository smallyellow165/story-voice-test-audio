import {useState} from 'react'
import type {SpatialUnderstanding3D,VisualConnection3D} from './spatial-understanding.ts'
export const familyLabels={square:'正方形',rectangle:'矩形',triangle:'三角形',polygon:'其他多边形',curved:'曲边形状',unknown:'Unknown'}
const orientation={horizontal:'大致水平',vertical:'大致竖直',inclined:'倾斜',unknown:'Unknown'}
const viewpoint={above:'大致从上方',level:'大致平视',below:'大致从下方',oblique:'斜向观察',unknown:'Unknown'}
export function SpatialUnderstandingPanel({value,label,onChoose,disabled=false,compact=false}:{value?:SpatialUnderstanding3D;label:string;onChoose?:(c:VisualConnection3D)=>void;disabled?:boolean;compact?:boolean}){
 if(compact)return <CompactSpatialUnderstanding value={value} label={label} onChoose={onChoose} disabled={disabled}/>
 if(!value)return <p className="hint">{label}：旧 V1 未记录结构化空间解释；没有从历史文字补造推断。</p>
 return <section className="visible3d-understanding" aria-label={label}>
  <h4>{label} · 模型推断</h4><p className="hint">以下是空间解释，不是照片事实或 Geometry Valid 结论。</p>
  <p>相机：{viewpoint[value.camera.viewpoint]}。{value.camera.evidence} {value.camera.uncertainty}</p>
  {value.overallShapeHypotheses.map((h,i)=><article key={i}><b>整体结构假设：{h.label}</b><p>仅涉及可见片：{h.visiblePieceIds.join(', ')}</p><p>{h.reasoning}</p><p className="hint">{h.uncertainty} · 证据 {h.evidenceRefs.join(', ')||'未指定'}</p></article>)}
  <details><summary>可见面的方向与证据 · {value.faces.length}</summary>{value.faces.map(f=><p key={f.pieceId}><b>{f.pieceId} · {orientation[f.orientation]}</b><br/>{f.reasoning}<br/><small>{f.uncertainty} · {f.evidenceRefs.join(', ')}</small></p>)}</details>
  <details open><summary>可见连接 / 视觉折角建议 · {value.connections.length}</summary>{value.connections.map((c,i)=><article key={i} data-visual-connection={i}><b>{c.pieceA} ↔ {c.pieceB} · {c.relationship}</b><p>折角候选：{c.foldAngleCandidatesDeg.length?c.foldAngleCandidatesDeg.join(', ')+'°':'Unknown'}{c.angleRange?` · 区间 ${c.angleRange.min}..${c.angleRange.max}°`:''}</p><p>{c.reasoning}</p><p className="hint">{c.uncertainty} · {c.evidenceRefs.join(', ')}</p>{onChoose&&<button disabled={disabled||c.relationship==='occlusion'||c.relationship==='separate'} onClick={()=>onChoose(c)}>核对此连接与角度建议</button>}</article>)}<p className="hint">视觉折角尚未绑定端口方向。只有人工确认或 Planning 转换后的 Connection 才交给引擎。</p></details>
  <details><summary>其他解释与 Unknown · {value.alternatives.length+value.unknowns.length}</summary>{value.alternatives.map((a,i)=><p key={i}><b>{a.label}</b>：{a.description}<br/>{a.uncertainty}</p>)}{value.unknowns.map((u,i)=><p key={i}>{u}</p>)}</details>
  <details className="visible3d-hidden"><summary>隐藏结构说明 · {value.hiddenStructureHypotheses.length} · 不进入执行</summary><p>仅为可能性说明，不是可见零件，不参与计数、Profile 确认或 Geometry Execution。</p>{value.hiddenStructureHypotheses.map((h,i)=><p key={i}>{h.description}<br/>{h.reasoning}<br/><small>{h.uncertainty}</small></p>)}</details>
 </section>
}

/** Compact Review presentation; choosing a suggestion still uses the existing
 * guarded form-prefill callback. No connections or approvals are created here. */
function CompactSpatialUnderstanding({value,label,onChoose,disabled}:{value?:SpatialUnderstanding3D;label:string;onChoose?:(c:VisualConnection3D)=>void;disabled:boolean}){
 const [query,setQuery]=useState(''),[selection,setSelection]=useState<{kind:'connection'|'face'|'shape';index:number}|null>(null)
 if(!value)return <p className="hint">{label}：旧 V1 未记录结构化空间解释；没有从历史文字补造推断。</p>
 const connection=selection?.kind==='connection'?value.connections[selection.index]:undefined
 const face=selection?.kind==='face'?value.faces[selection.index]:undefined
 const shape=selection?.kind==='shape'?value.overallShapeHypotheses[selection.index]:undefined
 function choose(c:VisualConnection3D,index:number){setSelection({kind:'connection',index});if(!disabled&&c.relationship!=='occlusion'&&c.relationship!=='separate')onChoose?.(c)}
 const terms=query.trim().toLowerCase()
 return <section className="review-spatial-understanding" aria-label={label}>
  <p className="hint">AI 空间解释待核对；不是照片事实或 Geometry Valid 结论。</p>
  <div className="review-connection-heading"><b>可见连接 / 视觉折角建议 · {value.connections.length}</b><input aria-label="筛选可见连接" placeholder="筛选 ID / 类型" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  <div className="review-suggestion-table-scroll" tabIndex={0} aria-label="可见连接建议表格滚动区"><table className="review-suggestion-table" aria-label="可见连接建议"><thead><tr><th>连接</th><th>类型</th><th>折角</th><th>区间</th><th>操作</th></tr></thead><tbody>
   {value.connections.map((c,i)=>({c,i})).filter(({c})=>`${c.pieceA} ${c.pieceB} ${c.relationship}`.toLowerCase().includes(terms)).map(({c,i})=><tr key={i} data-visual-connection={i} aria-selected={selection?.kind==='connection'&&selection.index===i} tabIndex={0} onClick={()=>choose(c,i)} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();choose(c,i)}}}>
    <td title={`${c.pieceA} ↔ ${c.pieceB}`}>{c.pieceA} ↔ {c.pieceB}</td><td title={c.relationship}>{c.relationship}</td><td title={c.foldAngleCandidatesDeg.map(n=>`${n}°`).join(', ')||'Unknown'}>{c.foldAngleCandidatesDeg.map(n=>`${n}°`).join(', ')||'Unknown'}</td><td title={c.angleRange?`${c.angleRange.min}–${c.angleRange.max}°`:'Unknown'}>{c.angleRange?`${c.angleRange.min}–${c.angleRange.max}°`:'Unknown'}</td><td><button aria-label="核对此连接与角度建议" title={`核对 ${c.pieceA} ↔ ${c.pieceB}`} disabled={disabled||c.relationship==='occlusion'||c.relationship==='separate'} onClick={e=>{e.stopPropagation();choose(c,i)}}>核对</button></td>
   </tr>)}
  </tbody></table></div>
  {!value.connections.length&&<p>无可见连接建议。</p>}
  {!!value.connections.length&&!value.connections.some(c=>`${c.pieceA} ${c.pieceB} ${c.relationship}`.toLowerCase().includes(terms))&&<p>没有匹配的连接建议。</p>}
  {selection&&<div className="review-spatial-selection" role="region" aria-label="空间建议详情">
   <div className="review-spatial-detail-heading"><b>{connection?`${connection.pieceA} ↔ ${connection.pieceB}`:face?`${face.pieceId} · ${orientation[face.orientation]}`:shape?.label}</b><button aria-label="关闭空间建议详情" onClick={()=>setSelection(null)}>关闭</button></div>
   {connection&&<dl><dt>关系 / 可见特征</dt><dd>{connection.relationship} · {connection.pieceA}:{connection.featureA??'Unknown'} ↔ {connection.pieceB}:{connection.featureB??'Unknown'}</dd><dt>折角建议 / 区间</dt><dd>{connection.foldAngleCandidatesDeg.map(n=>`${n}°`).join(', ')||'Unknown'} · {connection.angleRange?`${connection.angleRange.min}..${connection.angleRange.max}°`:'Unknown'}</dd><dt>推断依据</dt><dd>{connection.reasoning}</dd><dt>不确定性</dt><dd>{connection.uncertainty||'未指定'}</dd><dt>证据引用</dt><dd>{connection.evidenceRefs.join(', ')||'未指定'}</dd></dl>}
   {face&&<dl><dt>方向依据</dt><dd>{face.reasoning}</dd><dt>不确定性</dt><dd>{face.uncertainty||'未指定'}</dd><dt>证据引用</dt><dd>{face.evidenceRefs.join(', ')||'未指定'}</dd></dl>}
   {shape&&<dl><dt>仅涉及可见片</dt><dd>{shape.visiblePieceIds.join(', ')}</dd><dt>结构依据</dt><dd>{shape.reasoning}</dd><dt>不确定性</dt><dd>{shape.uncertainty||'未指定'}</dd><dt>证据引用</dt><dd>{shape.evidenceRefs.join(', ')||'未指定'}</dd></dl>}
  </div>}
  <details><summary>整体结构假设 · {value.overallShapeHypotheses.length}</summary><ul className="review-shape-hypotheses">{value.overallShapeHypotheses.map((h,i)=><li key={i}><button title={h.label} onClick={()=>setSelection({kind:'shape',index:i})}>{h.label}</button></li>)}</ul></details>
  <details><summary>可见面的方向与证据 · {value.faces.length}</summary><div className="review-suggestion-table-scroll"><table className="review-suggestion-table review-face-table" aria-label="可见面方向建议"><thead><tr><th>Tile</th><th>方向</th><th>证据</th></tr></thead><tbody>{value.faces.map((f,i)=><tr key={f.pieceId}><td><button onClick={()=>setSelection({kind:'face',index:i})}>{f.pieceId}</button></td><td>{orientation[f.orientation]}</td><td title={f.reasoning}>{f.evidenceRefs.join(', ')||'未指定'}</td></tr>)}</tbody></table></div></details>
  <details><summary>相机 · {viewpoint[value.camera.viewpoint]}</summary><p>{value.camera.evidence}</p><p>{value.camera.uncertainty}</p></details>
  <details><summary>隐藏结构、其他解释与 Unknown · {value.hiddenStructureHypotheses.length+value.alternatives.length+value.unknowns.length}</summary>
   <p>隐藏结构仅为可能性说明，不计入可见零件或 Geometry Execution。</p>
   {value.hiddenStructureHypotheses.map((h,i)=><div key={`hidden-${i}`}><b>{h.description}</b><p>{h.reasoning}</p><p>{h.uncertainty}</p></div>)}
   {value.alternatives.map((a,i)=><div key={`alternative-${i}`}><b>{a.label}</b><p>{a.description}</p><p>{a.uncertainty}</p><p>证据 {a.evidenceRefs.join(', ')||'未指定'}</p></div>)}
   <ul>{value.unknowns.map((u,i)=><li key={i}>{u}</li>)}</ul>
  </details>
 </section>
}

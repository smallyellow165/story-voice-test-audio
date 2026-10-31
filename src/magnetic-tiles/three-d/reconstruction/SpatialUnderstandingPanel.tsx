import type {SpatialUnderstanding3D,VisualConnection3D} from './spatial-understanding.ts'
export const familyLabels={square:'正方形',rectangle:'矩形',triangle:'三角形',polygon:'其他多边形',curved:'曲边形状',unknown:'Unknown'}
const orientation={horizontal:'大致水平',vertical:'大致竖直',inclined:'倾斜',unknown:'Unknown'}
const viewpoint={above:'大致从上方',level:'大致平视',below:'大致从下方',oblique:'斜向观察',unknown:'Unknown'}
export function SpatialUnderstandingPanel({value,label,onChoose,disabled=false}:{value?:SpatialUnderstanding3D;label:string;onChoose?:(c:VisualConnection3D)=>void;disabled?:boolean}){
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

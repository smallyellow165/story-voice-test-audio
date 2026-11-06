import type {EdgeSnapPreview} from './editor-snap.ts'

export function TileSnapPreview({preview,onConfirm,onCancel}:{preview:EdgeSnapPreview;onConfirm:()=>void;onCancel:()=>void}){
 const {connection:c,geometry,mode}=preview
 const collisions=geometry.issues.filter(i=>i.code==='intersection'&&i.severity==='error')
 return <section className="magnetic-3d-snap-preview" aria-label="3D 吸附预览">
  <h4>吸附预览 · {mode==='less-strict'?'Less Strict':'Strict'} · 尚未修改 Draft</h4>
  <p>{c.pieceB}:{c.portB} → {c.pieceA}:{c.portA}<br/>{c.dihedralDeg}° · Flip {String(c.flip??false)}</p>
  <p>仅移动源零件 B；不修改其他零件或原连接。{geometry.valid?'Geometry Valid。':'Geometry Invalid；实际诊断保持不变。'}</p>
  {mode==='less-strict'&&collisions.length>0&&<section className="magnetic-3d-snap-warning" aria-label="Snap 碰撞 Warning" role="status">
   <p>Warning · {collisions.length} 项实体碰撞；Less Strict 允许确认，Geometry Invalid 仍保留。</p>
   <ul>{collisions.map((issue,i)=><li key={i}><b>{issue.relatedPieceIds?.join(' ↔ ')??issue.pieceId}</b> · {issue.message}{typeof issue.penetrationDepth==='number'&&<> · Depth {issue.penetrationDepth.toPrecision(5)}</>}</li>)}</ul>
  </section>}
  <button onClick={onConfirm}>确认吸附</button><button onClick={onCancel}>取消吸附</button>
 </section>
}

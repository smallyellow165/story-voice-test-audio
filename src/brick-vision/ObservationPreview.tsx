import { useState } from 'react'
import './review.css'
import { bboxStyle } from './observation-view.mjs'

export function ObservationPreview({ src, observations, activeId, onSelect, hiddenIds, alt = '本次识别原图及 Observation 标注' }: {
  hiddenIds?: ReadonlySet<string>; src: string; observations: readonly { id: string; bbox?: unknown; status?: string }[]; activeId: string; onSelect(id: string): void; alt?: string
}) {
  const [show, setShow] = useState(true)
  const [loadedSource, setLoadedSource] = useState(''), [failedSource, setFailedSource] = useState('')
  const invalid = observations.filter(o => !bboxStyle(o.bbox))
  return <div className="vision-preview">
    <label className="vision-bbox-toggle"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />显示 Observation BBox</label>
    <div className="vision-preview-frame">
      <img src={src} alt={alt} onLoad={() => { setLoadedSource(src); setFailedSource('') }} onError={() => setFailedSource(src)} />
      {show && loadedSource === src && failedSource !== src && observations.map(o => {
        const style = bboxStyle(o.bbox)
        return style && !hiddenIds?.has(o.id) && <button key={o.id} type="button" className={`vision-bbox${o.id === activeId ? ' is-active' : ''}`}
          style={style} aria-label={`高亮 Observation ${o.id}`} aria-pressed={o.id === activeId}
          title={o.status ? `${o.id} · 模型 ${o.status}` : o.id} onClick={() => onSelect(o.id)}><span>{o.id}</span></button>
      })}
    </div>
    {failedSource === src && <p role="alert">图片加载失败，未显示 BBox。</p>}
    {!!invalid.length && <p role="status">无有效 BBox，未绘制：{invalid.map(o => o.id).join('、')}。可在表格详情中查看原始数据。</p>}
  </div>
}

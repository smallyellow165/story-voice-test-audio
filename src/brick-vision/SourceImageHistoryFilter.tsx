import { InfoHint } from './InfoHint'
import { useEffect, useState, useId } from 'react'
import { imageHistoryGroups } from './image-history.mjs'
export function SourceImageHistoryFilter({ records, value, onChange, disabled }: {
  records: {sourceImageId:string; originalName?:string; image_reference?:{name:string}}[]; value:string; onChange(value:string):void; disabled:boolean
}) {
  const filterId = useId()
  const [preview, setPreview] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    setPreview(''); setError('')
    if (!value) return
    const controller = new AbortController()
    void fetch('/api/brick-source-images/' + encodeURIComponent(value), {signal:controller.signal})
      .then(async response => { const source = await response.json(); if (!response.ok) throw Error(source.error); if(source.imageId !== value) throw Error('Source Image identity mismatch'); return source })
      .then(source => { if(!controller.signal.aborted) setPreview('data:' + source.original.mimeType + ';base64,' + source.original.imageBase64) })
      .catch(e => { if(!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [value])
  return <div className="source-image-history-filter">
    <div className="vision-history-line"><label htmlFor={filterId}>按图片筛选</label><InfoHint label="按图片筛选">按正式 Source Image 关联筛选历史，不改变当前加载结果或 Selected。名称仅用于展示。</InfoHint></div><select id={filterId} aria-label="按 Source Image 查看" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">全部图片</option>
      {imageHistoryGroups(records).map(g => <option key={g.imageId} value={g.imageId} title={g.imageId}>{[...new Set(records.filter(r => r.sourceImageId === g.imageId).map(r => r.originalName || r.image_reference?.name).filter(Boolean))].join(' / ') || '未记录图片名称'} · {g.count} 次 Analysis · {g.imageId.slice(7, 15)}</option>)}
    </select>
    {value && <details><summary>图片身份</summary><a style={{overflowWrap:'anywhere'}} href={'/api/brick-source-images/' + encodeURIComponent(value)} target="_blank" rel="noreferrer">{value}</a></details>}
    {preview && <img src={preview} alt="当前 History 的原始 Source Image" style={{maxWidth:180,maxHeight:180,objectFit:'contain'}}/>}
    {error && <p role="alert">{error}</p>}
  </div>
}

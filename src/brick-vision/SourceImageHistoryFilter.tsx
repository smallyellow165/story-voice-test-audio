import { useEffect, useState } from 'react'
import { imageHistoryGroups } from './image-history.mjs'
export function SourceImageHistoryFilter({ records, value, onChange, disabled }: {
  records: {sourceImageId:string}[]; value:string; onChange(value:string):void; disabled:boolean
}) {
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
    <label>按 Source Image 查看<select aria-label="按 Source Image 查看" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">全部图片 · 原有 History</option>
      {imageHistoryGroups(records).map(g => <option key={g.imageId} value={g.imageId}>{g.imageId} · {g.count} 次 Analysis</option>)}
    </select></label>
    {value && <p style={{overflowWrap:'anywhere'}}>Source Image: <a href={'/api/brick-source-images/' + encodeURIComponent(value)} target="_blank" rel="noreferrer">{value}</a></p>}
    {preview && <img src={preview} alt="当前 History 的原始 Source Image" style={{maxWidth:180,maxHeight:180,objectFit:'contain'}}/>}
    {error && <p role="alert">{error}</p>}
    <p>筛选只改变历史列表；请明确选择 Analysis 并加载，不会自动选择或生成结果。</p>
  </div>
}

import { useState } from 'react'
import type { Observation } from './contracts.ts'
import { InfoHint } from '../../brick-vision/InfoHint.tsx'

export function PartActions({observation,relationCount,onDelete,onExclude}:{observation:Observation;relationCount:number;onDelete:()=>void;onExclude:()=>void}) {
  const [deleting,setDeleting]=useState(false)
  return <section className="review-part-actions" aria-label="零件操作">
    <div className="button-row">
      <button onClick={onExclude}>{observation.excluded?'恢复零件':'排除零件'}</button>
      {observation.origin==='manual'&&<button className="review-delete" onClick={()=>setDeleting(true)}>删除零件</button>}
      <InfoHint label="零件操作">排除保留原始证据与关联，可在 Excluded 筛选中恢复。手工新增零件可从草稿删除，同时清理关联。新增、删除、排除或恢复后可单步撤销；下一次修改、保存或打开其他记录后结束撤销。</InfoHint>
    </div>
    {deleting&&<div className="review-delete-confirm" role="group" aria-label="删除零件确认">
      <p>删除 {observation.id}？将同时移除 {relationCount} 条关联，可在下一次修改或保存前撤销。</p>
      <div className="button-row"><button className="review-delete" onClick={onDelete}>确认删除</button><button onClick={()=>setDeleting(false)}>取消</button></div>
    </div>}
  </section>
}

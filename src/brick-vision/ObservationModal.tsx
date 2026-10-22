import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function ObservationModal({ title, data, onClose }: { title: string; data: unknown; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const labelId = useId()
  const [copyStatus, setCopyStatus] = useState('')
  const json = JSON.stringify(data, null, 2)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return createPortal(<dialog ref={dialog} className="vision-detail-modal" aria-labelledby={labelId}
    onCancel={onClose} onClose={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="vision-detail-content">
      <header><h2 id={labelId}>{title}</h2><button type="button" onClick={onClose}>关闭</button></header>
      <div className="vision-detail-actions"><button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(json); setCopyStatus('已复制 JSON') }
        catch { setCopyStatus('复制失败，请选择下方 JSON 手动复制。') }
      }}>Copy JSON</button><span role="status">{copyStatus}</span></div>
      <pre tabIndex={0}>{json}</pre>
    </div>
  </dialog>, document.body)
}

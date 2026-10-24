import { useState } from 'react'
import { buildExplorerSceneLink } from './explorer-scene.mjs'
import type { SceneLink } from './explorer-scene.mjs'
export function CopySceneLink({ scene, dirty, disabled = false }: { scene: SceneLink; dirty: boolean; disabled?: boolean }) {
  const [notice, setNotice] = useState(''), [manual, setManual] = useState('')
  return <div className="inventory-scene-link">
    <button type="button" disabled={disabled} onClick={async () => {
      const url = buildExplorerSceneLink(window.location.href, scene)
      const warning = dirty ? '请先保存审核；此链接只能恢复最近一次已保存的审核。' : ''
      try { await navigator.clipboard.writeText(url); setManual(''); setNotice('现场链接已复制。' + warning) }
      catch { setManual(url); setNotice('无法自动复制，请复制下方链接。' + warning) }
    }}>复制现场链接</button>
    {dirty && <small>审核有未保存修改；请先保存，否则链接只恢复最近一次已保存状态。</small>}
    {notice && <p role="status">{notice}</p>}
    {manual && <input aria-label="现场链接" readOnly value={manual} onFocus={event => event.currentTarget.select()} />}
  </div>
}

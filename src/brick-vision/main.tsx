import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { mount } from '../brick-building-module'
import type { BrickGameArtifact } from '../brick-game-contract'
import { requestJson } from '../brick-inventory/api.mjs'
import { newSessionId } from '../brick-inventory/inventory'
import '../brick-inventory/inventory.css'

function VisionTests() {
  const [designs, setDesigns] = useState<{ id: string; name: string; createdAt: string }[]>([])
  const [selected, setSelected] = useState(''), [artifact, setArtifact] = useState<BrickGameArtifact | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/brick-games', { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error(`设计列表 HTTP ${r.status}`)
      const data: unknown = await r.json()
      if (!Array.isArray(data)) throw new Error('设计列表格式错误')
      setDesigns(data)
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!artifact || !host.current) return
    try {
      const game = mount(host.current, { artifact, instanceId: newSessionId(), onMessage: () => {},
        libraryUrl: `${import.meta.env.BASE_URL}brick-ldraw/` })
      return () => game.unmount()
    } catch (e) { setError(String(e)) }
  }, [artifact])
  return <main className="brick-inventory-page">
    <h1>DUPLO Vision 测试</h1>
    <section className="inventory-catalog"><h2>Inventory Image Recognition</h2>
      <a href={`${import.meta.env.BASE_URL}brick-inventory.html#inventory-image`}>打开图片识别 → 库存草稿 → 人工保存</a></section>
    <section className="inventory-catalog" style={{ marginTop: 24 }}><h2>Step Image Confirmation</h2>
      <p>选择已有真实库存生成且通过 Validator 的设计。这里挂载同一 Brick 游戏模块作独立测试，不推进 V4 中的另一局游戏。在 V4 游戏内上传则推进该局。</p>
      <select aria-label="选择已验证设计" value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">选择设计</option>
        {designs.map(d => <option key={d.id} value={d.id}>{d.name} · {d.createdAt} · {d.id}</option>)}</select>
      <button disabled={!selected || busy} onClick={async () => {
        setBusy(true); setError('')
        try { setArtifact(await requestJson<BrickGameArtifact>(`/api/brick-games/${encodeURIComponent(selected)}`, {}, '设计加载与复核')) }
        catch (e) { setError(String(e)) } finally { setBusy(false) }
      }}>加载设计并测试</button>
      {artifact && <details><summary>当前设计及原库存证据</summary><pre style={{ overflow: 'auto', maxHeight: 350 }}>{JSON.stringify(artifact, null, 2)}</pre></details>}
      {error && <p role="alert">{error}</p>}<div ref={host} />
    </section>
  </main>
}
const root = createRoot(document.getElementById('brick-vision-root')!)
root.render(<VisionTests />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())

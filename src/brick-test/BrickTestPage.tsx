import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { COLORS, PARTS, exampleBricks } from './catalog'
import type { Brick } from './catalog'
import { BrickViewer } from './viewer'
import './brick-test.css'

export function BrickTestPage({ libraryUrl = `${import.meta.env.BASE_URL}brick-ldraw/` }: { libraryUrl?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<BrickViewer | null>(null)
  const operation = useRef(0)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bricks, setBricks] = useState<Brick[]>([])
  const [part, setPart] = useState('3437')
  const [color, setColor] = useState('4')
  const [quantity, setQuantity] = useState(1)
  const [x, setX] = useState(0)
  const [z, setZ] = useState(0)
  const [layer, setLayer] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [arrangement, setArrangement] = useState('stack')

  useEffect(() => {
    if (!host.current) return
    const token = ++operation.current
    let engine: BrickViewer
    setBusy(true)
    setReady(false)
    setError('')
    setBricks([])
    try {
      engine = new BrickViewer(host.current, libraryUrl, (message) => {
        ++operation.current
        setError(message)
        setReady(false)
        setBusy(false)
      })
      viewer.current = engine
      const initial: Brick[] = [{ id: crypto.randomUUID(), part: '3437', color: '4', x: 0, z: 0, layer: 0, rotation: 0 }]
      engine.replace(initial).then((applied) => {
        if (operation.current === token && applied) { setBricks(initial); setLayer(1) }
      }).catch((reason) => {
        if (operation.current === token) setError(String(reason.message || reason))
      }).finally(() => {
        if (operation.current === token) { setBusy(false); setReady(true) }
      })
    } catch (reason) {
      setError(`无法初始化 3D Viewer，请确认浏览器支持 WebGL 2。${String(reason)}`)
      setBusy(false)
      setReady(false)
    }
    return () => {
      ++operation.current
      engine?.dispose()
      viewer.current = null
    }
  }, [libraryUrl])

  async function commit(next: Brick[]) {
    if (!viewer.current || busy || !ready) return false
    const token = ++operation.current
    setBusy(true)
    setError('')
    try {
      const applied = await viewer.current.replace(next)
      if (token !== operation.current || !applied) return false
      setBricks(next)
      return true
    } catch (reason) {
      if (token === operation.current) setError(reason instanceof Error ? reason.message : String(reason))
      return false
    } finally {
      if (token === operation.current) setBusy(false)
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    if (![x, z, layer, quantity].every(Number.isFinite) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !Number.isInteger(layer) || layer < 0 || layer > 20 || Math.abs(x) > 20 || Math.abs(z) > 20) {
      setError('请输入有效位置：X/Z 为 −20 到 20，层高为 0–20 的整数，数量为 1–20 的整数。')
      return
    }
    if (bricks.length + quantity > 100) { setError('此原型最多显示 100 块积木。'); return }
    const length = PARTS.find((item) => item.id === part)!.length
    const added = Array.from({ length: quantity }, (_, index): Brick => ({
      id: crypto.randomUUID(), part, color, rotation,
      x: x + (arrangement === 'row' ? index * (rotation % 180 === 0 ? length : 2) : 0),
      z,
      layer: layer + (arrangement === 'stack' ? index : 0),
    }))
    if (added.some((brick) => brick.layer > 20 || Math.abs(brick.x) > 20)) {
      setError('整批积木超出位置范围，请减少数量或调整起点。')
      return
    }
    if (await commit([...bricks, ...added])) {
      if (arrangement === 'stack') setLayer(Math.min(20, layer + quantity))
    }
  }

  function reset() {
    ++operation.current
    viewer.current?.reset()
    setBricks([])
    setError('')
    setBusy(false)
    setX(0); setZ(0); setLayer(0); setRotation(0); setQuantity(1)
  }

  const inventory = [...bricks.reduce((map, brick) => {
    const key = `${brick.part}:${brick.color}`
    const row = map.get(key) || { part: brick.part, color: brick.color, count: 0 }
    row.count++
    map.set(key, row)
    return map
  }, new Map<string, { part: string; color: string; count: number }>()).values()]

  return <main className="brick-page">
    <header className="brick-header">
      <div><span className="brick-eyebrow">PLAY LAB / 01</span><h1>DUPLO Brick Test</h1><p>真实零件，自由搭建。用三个基础形状探索你的下一个小作品。</p></div>
      <span className="brick-badge">LDraw · 3D Prototype</span>
    </header>
    <div className="brick-layout">
      <aside className="brick-panel">
        <h2>添加积木</h2>
        <form onSubmit={add}>
          <fieldset disabled={!ready || busy}>
            <label>Brick 型号<select value={part} onChange={(event) => setPart(event.target.value)}>{PARTS.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.id}.dat</option>)}</select></label>
            <label>颜色<select value={color} onChange={(event) => setColor(event.target.value)}>{COLORS.map((item) => <option key={item.code} value={item.code}>{item.label} · LDraw {item.code}</option>)}</select></label>
            <div className="brick-fields"><label>数量<input type="number" required min="1" max="20" step="1" value={quantity} onChange={(event) => setQuantity(event.target.valueAsNumber)} /></label><label>排列<select value={arrangement} onChange={(event) => setArrangement(event.target.value)}><option value="stack">向上堆叠</option><option value="row">沿 X 并排</option></select></label></div>
            <div className="brick-fields"><label>X · 凸点间距<input type="number" required min="-20" max="20" step="0.5" value={x} onChange={(event) => setX(event.target.valueAsNumber)} /></label><label>Z · 凸点间距<input type="number" required min="-20" max="20" step="0.5" value={z} onChange={(event) => setZ(event.target.valueAsNumber)} /></label></div>
            <div className="brick-fields"><label>底部层高<input type="number" required min="0" max="20" step="1" value={layer} onChange={(event) => setLayer(event.target.valueAsNumber)} /></label><label>旋转<select value={rotation} onChange={(event) => setRotation(Number(event.target.value))}>{[0, 90, 180, 270].map((value) => <option key={value} value={value}>{value}°</option>)}</select></label></div>
            <p className="brick-help">位置以砖体中心为准。每格 16 mm，每层 19.2 mm。批量堆叠后，起始层高会自动上移。位置由你指定，积木可能重叠或悬空。</p>
            <button className="brick-primary" type="submit">＋ 添加到场景</button>
          </fieldset>
        </form>
        <div className="brick-actions"><button disabled={!ready || busy} onClick={async () => { if (await commit(exampleBricks())) { setX(-2); setZ(0); setLayer(3) } }}>载入阶梯示例</button><button disabled={!ready} onClick={reset}>Reset</button></div>
        <p className="brick-help">示例替换当前组合；Reset 清空场景。</p>
      </aside>
      <section className="brick-stage-panel" aria-label="积木场景">
        <div className="brick-stage-toolbar"><span>{bricks.length} 块积木</span><button disabled={!ready || busy} onClick={() => viewer.current?.fit()}>适合视图</button></div>
        <div className="brick-stage" ref={host} />
        <div className="brick-status" role="status" aria-live="polite">{busy ? '正在读取 LDraw 模型及子文件…' : bricks.length ? '左键旋转 · 滚轮缩放 · 右键平移' : '场景为空 · 添加积木或载入示例'}</div>
        {error && <div className="brick-error" role="alert"><strong>模型未能完成加载</strong><p>{error}</p><small>检查本地零件库路径和浏览器 Network 请求。修复后重新添加或载入示例；失败操作不会写入清单。</small></div>}
      </section>
      <section className="brick-panel brick-inventory">
        <div className="brick-inventory-title"><h2>当前 Brick 清单</h2><span>{bricks.length} / 100</span></div>
        {inventory.length ? <table><thead><tr><th>型号</th><th>颜色</th><th>数量</th></tr></thead><tbody>{inventory.map((row) => <tr key={`${row.part}:${row.color}`}><td>{row.part}.dat <small>{PARTS.find((item) => item.id === row.part)?.label}</small></td><td>{COLORS.find((item) => item.code === row.color)?.label} <small>#{row.color}</small></td><td>{row.count}</td></tr>)}</tbody></table> : <p className="brick-help">成功加载的积木会显示在这里。</p>}
        {!!bricks.length && <details><summary>查看位置 / 删除单块</summary><ul className="brick-instance-list">{bricks.map((brick, index) => <li key={brick.id}><span>{index + 1}. {brick.part} · {COLORS.find((item) => item.code === brick.color)?.label}<small>X {brick.x} / Z {brick.z} / 层 {brick.layer} / {brick.rotation}°</small></span><button disabled={busy || !ready} aria-label={`删除第 ${index + 1} 块积木`} onClick={() => void commit(bricks.filter((item) => item.id !== brick.id))}>删除</button></li>)}</ul></details>}
      </section>
    </div>
    <footer className="brick-footer">几何数据：LDraw.org 官方零件库 · 模型作者与许可见原始 .dat 文件及库内 CAreadme.txt。场景仅保留在当前页面，刷新后重置。</footer>
  </main>
}

import { workflowTerms, workModeNames } from './studio-terms.ts'
import { readStudioUrl, useUrlRequest, writeStudioUrl } from './studio-url.ts'
import { canonical } from './build-plan.ts'
import { profileSizeLabel, profileViewBox } from './profiles.ts'
import { StudioLayout, StudioSlot } from './StudioLayout.tsx'
import { checkArtwork, workMode } from './artwork.ts'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { profiles } from './profiles.ts'
import { connectionSegment, findSnap, MAX_TILES, profileFor, rotateTile, mirrorTile, validate, vertices } from './geometry.ts'
import type { Assembly, Pose, Snap, Tile, Vec } from './geometry.ts'
import { emptyAssembly, loadWorkspace, parseAssembly, saveWorkspace } from './storage.ts'
import type { Workspace } from './storage.ts'
import './style.css'
import { ImageIntake } from './intake/ImageIntake.tsx'
import type { Origin } from './intake/contracts.ts'
import { BuildPanel } from './BuildPanel.tsx'

const palette = ['#f5b942', '#ef795d', '#55b8ac', '#7e9bda', '#b895cf']
type Drag = { pointerId: number; id: string; start: Vec; original: Pose; moved: boolean; raw: Tile; snap: Snap | null }
function initial(): { workspace: Workspace; error: string } {
  try { return { workspace: loadWorkspace(localStorage, profiles) ?? { schemaVersion: 1, current: emptyAssembly(), saved: [] }, error: '' } }
  catch (e) { return { workspace: { schemaVersion: 1, current: emptyAssembly(), saved: [] }, error: `无法恢复存档，原数据未覆盖。${String(e)}` } }
}
function Playground() {
  const urlRequest=useUrlRequest()
  const [draftBackup,setDraftBackup]=useState(()=>!!localStorage.getItem('magnetic-assembly-url-backup'))
  const [boot] = useState(initial)
  const [workspace, setWorkspace] = useState(boot.workspace)
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace
  const [history, setHistory] = useState<Assembly[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [color, setColor] = useState(palette[0])
  const [message, setMessage] = useState(boot.error || '选一种形状，开始拼搭。')
  const [storageError, setStorageError] = useState(boot.error)
  const [storageBlocked, setStorageBlocked] = useState(!!boot.error)
  const [savedId, setSavedId] = useState(boot.workspace.saved[0]?.id || '')
  const [view, setView] = useState({ x: 0, y: 0, width: 10 })
  const svg = useRef<SVGSVGElement>(null), file = useRef<HTMLInputElement>(null)
  const current = workspace.current, report = validate(current.instances, profiles)
  const chosen = current.instances.find(t => t.id === selected)
  const display = drag ? current.instances.map(t => t.id === drag.id ? drag.snap?.tile ?? drag.raw : t) : current.instances
  const preview = validate(display, profiles)
  useEffect(()=>{
    const {values:v,errors}=readStudioUrl(urlRequest.href)
    if(errors.length||!v.assemblyId)return
    const w=workspaceRef.current,a=w.saved.find(a=>a.id===v.assemblyId)
    if(!a){setStorageError('URL 作品不存在于当前浏览器存档：'+v.assemblyId);return}
    try{
      if(canonical(w.current)!==canonical(a)&&!w.saved.some(s=>canonical(s)===canonical(w.current))){
        // One backup is retained until explicitly restored, never overwritten by navigation.
        if(localStorage.getItem('magnetic-assembly-url-backup')){setStorageError('已有保留草稿，当前作品也有修改；请先保存或恢复草稿，再打开 URL 作品。');return}
        localStorage.setItem('magnetic-assembly-url-backup',JSON.stringify(w.current));setDraftBackup(true)
      }
      persist({...w,current:structuredClone(a)});setSavedId(a.id);setSelected(null);fit(a);setMessage('已按 URL 打开保存作品；本地草稿若有修改已单独保留。')
    }catch(e){setStorageError('URL 作品恢复失败：'+String(e))}
  },[urlRequest])
  function persist(next: Workspace) {
    workspaceRef.current = next
    setWorkspace(next)
    if (storageBlocked) return false
    try { saveWorkspace(localStorage, next, profiles); setStorageError(''); return true }
    catch (e) { setStorageError(`保存失败，当前修改仅在内存中：${String(e)}`); return false }
  }
  function commit(next: Assembly, notice: string) {
    const result = validate(next.instances, profiles)
    if (!result.draftValid) { setMessage(`未提交：${result.issues.map(i => i.message).join('；')}`); return false }
    writeStudioUrl({assemblyId:undefined})
    setHistory(h => [...h.slice(-49), structuredClone(current)])
    persist({ ...workspace, current: { ...next, revision: Math.max(next.revision, current.revision) + 1 } })
    setMessage(notice); return true
  }
  function replace(tile: Tile, notice: string) { return commit({ ...current, instances: current.instances.map(t => t.id === tile.id ? tile : t) }, notice) }
  function add(profileId: string, profileVersion: number) {
    if (current.instances.length >= MAX_TILES) { setMessage(`最多 ${MAX_TILES} 块`); return }
    const p = profiles.find(p => p.id === profileId && p.version === profileVersion)!
    // Search free space in the visible work area; never generate an artwork.
    const halfH = view.width * .35
    for (let y = view.y + halfH - 1.35; y >= view.y - halfH + .15; y -= 1.25) for (let x = view.x - view.width / 2 + .35; x < view.x + view.width / 2 - 1.2; x += 1.25) {
      const t: Tile = { id: crypto.randomUUID(), profileId: p.id, profileVersion: p.version, color, pose: { x, y, angleRad: 0 } }
      if (validate([...current.instances, t], profiles).draftValid) {
        commit({ ...current, instances: [...current.instances, t] }, `已添加${p.name}；拖动靠近可连接边进行吸附。`); setSelected(t.id); return
      }
    }
    setMessage('当前视野没有空位，请缩小视图后再添加。')
  }
  function world(event: { clientX: number; clientY: number }): Vec {
    const matrix = svg.current!.getScreenCTM()!
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return [p.x, -p.y]
  }
  function start(event: ReactPointerEvent<SVGPolygonElement>, tile: Tile) {
    if (event.button !== 0 || dragRef.current) return
    event.preventDefault(); event.stopPropagation(); setSelected(tile.id)
    svg.current!.focus({ preventScroll: true }); svg.current!.setPointerCapture(event.pointerId)
    const d = { pointerId: event.pointerId, id: tile.id, start: world(event), original: { ...tile.pose }, moved: false, raw: tile, snap: null }
    dragRef.current = d; setDrag(d)
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const d = dragRef.current
    if (!d || event.pointerId !== d.pointerId) return
    const [x, y] = world(event), dx = x - d.start[0], dy = y - d.start[1]
    const pixelsPerUnit = Math.abs(svg.current!.getScreenCTM()!.a)
    if (!d.moved && Math.hypot(dx, dy) * pixelsPerUnit < 3) return
    const raw = { ...d.raw, pose: { ...d.original, x: d.original.x + dx, y: d.original.y + dy } }
    const snap = findSnap(raw, current.instances.filter(t => t.id !== d.id), profiles, 22 / pixelsPerUnit, d.snap?.key)
    const next = { ...d, raw, snap, moved: true }; dragRef.current = next; setDrag(next)
  }
  function end(event: ReactPointerEvent<SVGSVGElement>) {
    const d = dragRef.current
    if (!d || event.pointerId !== d.pointerId) return
    dragRef.current = null; setDrag(null)
    if (svg.current!.hasPointerCapture(event.pointerId)) svg.current!.releasePointerCapture(event.pointerId)
    if (d.moved) replace(d.snap?.tile ?? d.raw, d.snap ? '已吸附：有效边接触段准确对齐。' : '已移动；连接关系已重新计算。')
  }
  function cancel() { dragRef.current = null; setDrag(null); setMessage('已取消拖动，恢复原位置。') }
  function rotate(degrees: number) { if (chosen) replace(rotateTile(chosen, degrees * Math.PI / 180, profiles), '已旋转；连接关系已重新计算。') }
  function remove() { if (chosen) { commit({ ...current, instances: current.instances.filter(t => t.id !== chosen.id) }, '已删除一块；可撤销。'); setSelected(null) } }
  function undo() {
    const previous = history.at(-1)
    if (!previous) return
    writeStudioUrl({assemblyId:undefined});setHistory(h => h.slice(0, -1)); persist({ ...workspace, current: previous }); setSelected(null); setMessage('已撤销上一次编辑。')
  }
  function fit(assembly = current) {
    const points = assembly.instances.flatMap(t => vertices(t, profiles))
    if (!points.length) { setView({ x: 0, y: 0, width: 10 }); return }
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    setView({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2,
      width: Math.max(5, Math.max(...xs) - Math.min(...xs) + 2, (Math.max(...ys) - Math.min(...ys) + 2) / .7) })
  }
  function save() {
    if (storageBlocked) { setMessage('原存档读取失败，请先导出当前 JSON，或明确重置本模块存档。'); return }
    const next = { ...workspace, saved: [structuredClone(current), ...workspace.saved.filter(a => a.id !== current.id)] }
    if (next.saved.length > 50) { setMessage('已达到 50 个保存作品上限。'); return }
    const stored = persist(next); if(stored)writeStudioUrl({assemblyId:current.id}); setSavedId(current.id); setMessage(stored ? checkArtwork(current, profiles).ready ? '已保存作品快照。' : '已保存草稿快照；组件尚未全部连接。' : '未写入浏览器存档；请导出 JSON 备份。')
  }
  function exportJson() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'magnetic-tiles-assembly.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function importJson(input: File | undefined) {
    if (!input) return
    try {
      if (input.size > 500_000) throw Error('文件超过 500 KB')
      const a = parseAssembly(JSON.parse(await input.text()), profiles)
      commit(a, '已导入并重新验证 Assembly。'); fit(a); setSelected(null)
    } catch (e) { setMessage(`导入失败，当前作品未改变：${String(e)}`) }
  }
  async function applyImage(candidate: Assembly, bind: (actual: Assembly) => Promise<Origin>) {
    if (storageBlocked || dragRef.current) throw Error('请先完成拖动或处理工作区存档错误')
    const before = workspaceRef.current
    const parsed = parseAssembly(candidate, profiles)
    if (!checkArtwork(parsed, profiles).ready) throw Error('重建候选未通过几何验证')
    const actual = { ...parsed, revision: Math.max(parsed.revision, before.current.revision) + 1 }
    await bind(actual)
    if (workspaceRef.current !== before || dragRef.current) throw Error('来源已保存，但期间画布发生变化；未覆盖当前编辑，请重新打开候选')
    writeStudioUrl({assemblyId:undefined});const next = { ...before, current: actual }
    saveWorkspace(localStorage, next, profiles)
    setHistory(h => [...h.slice(-49), structuredClone(before.current)])
    workspaceRef.current = next; setWorkspace(next); setSelected(null); fit(actual)
    setMessage('图片候选已载入；来源已保存，可撤销或继续编辑。')
  }
  const height = view.width * .7
  return <StudioLayout dragging={!!drag}>
    <ImageIntake assembly={current} onApply={applyImage}/>
    <StudioSlot column="inspector" stages={['assembly']}>
      <aside className="tiles-panel"><h2>{workflowTerms.assembly.label}</h2><div className="tiles-palette">{profiles.map(p => <button key={`${p.id}@${p.version}`} onClick={() => add(p.id, p.version)} disabled={!!drag} className="shape-button" aria-label={`添加${p.name}`}>
        <svg viewBox={profileViewBox(p)} aria-hidden="true"><g transform="scale(1 -1)"><polygon points={p.vertices.map(v => v.join(',')).join(' ')} fill={color}/></g></svg><span>{p.name}</span><small>{profileSizeLabel(p)}</small></button>)}</div>
        <div className="swatches" aria-label="新磁力片颜色">{palette.map(c => <button key={c} aria-label={`颜色 ${c}`} aria-pressed={c === color} style={{ background: c }} onClick={() => setColor(c)}/>)}</div>
        <h2>当前选中</h2><p>{chosen ? `${profileFor(chosen, profiles)!.name} · ${Math.round(chosen.pose.angleRad * 180 / Math.PI)}°${chosen.pose.mirrored?' · 镜像':''}` : '点击画布上的一块磁力片'}</p>
        <div className="button-row"><button disabled={!chosen || !!drag} onClick={() => rotate(-15)}>↶ 15°</button><button disabled={!chosen || !!drag} onClick={() => rotate(15)}>↷ 15°</button><button disabled={!chosen || !!drag} onClick={()=>{if(chosen)replace(mirrorTile(chosen,profiles),'已翻面；连接与碰撞按原规则重新计算。')}}>翻面选中</button><button disabled={!chosen || !!drag} onClick={() => rotate(90)}>旋转 90°</button><button disabled={!chosen || !!drag} onClick={remove}>删除选中</button></div>
        <p className="hint">直接拖动已连接的单片即可拿起。靠近可连接边时，绿色虚线显示吸附预览；松手确认。可自动对齐约 45° 内的边，更大角度请先旋转。重叠会被拒绝。</p>
        <details><summary>键盘操作</summary><p>在画布中选中零件：方向键移动 0.1 单位，R 旋转 15°，Delete 删除，Esc 取消拖动。Tab 可选择零件，Enter 确认选择。</p></details>
      </aside>
    </StudioSlot><StudioSlot column="workspace" stages={['assembly']}>
      <section className="tiles-workspace" aria-label="作品编辑工作区（Assembly）">
        <div className="board-toolbar"><div className="button-row"><button onClick={undo} disabled={!history.length || !!drag}>撤销</button><button disabled={!!drag} onClick={() => { commit(emptyAssembly(), '新画布已准备；可撤销返回。'); setSelected(null); fit(emptyAssembly()) }}>新建</button></div><div className="button-row"><button aria-label="放大视图" onClick={() => setView(v => ({ ...v, width: Math.max(4, v.width / 1.25) }))} disabled={!!drag}>＋</button><button aria-label="缩小视图" onClick={() => setView(v => ({ ...v, width: Math.min(3000, v.width * 1.25) }))} disabled={!!drag}>−</button><button onClick={() => fit()} disabled={!!drag}>适合画布</button></div></div>
        <svg ref={svg} className="tiles-board" viewBox={`${view.x - view.width / 2} ${-view.y - height / 2} ${view.width} ${height}`} tabIndex={0} aria-label="磁力片二维画布"
          onPointerDown={e => { if (e.target === e.currentTarget) setSelected(null) }} onPointerMove={move} onPointerUp={end} onPointerCancel={e => { if (e.pointerId === dragRef.current?.pointerId) cancel() }} onLostPointerCapture={e => { if (e.pointerId === dragRef.current?.pointerId) cancel() }}
          onKeyDown={e => {
            if (e.key === 'Escape' && dragRef.current) { cancel(); return }
            if (dragRef.current || !chosen) return
            const directions: Record<string, Vec> = { ArrowLeft: [-.1, 0], ArrowRight: [.1, 0], ArrowUp: [0, .1], ArrowDown: [0, -.1] }
            if (directions[e.key]) { e.preventDefault(); const [x, y] = directions[e.key]; replace({ ...chosen, pose: { ...chosen.pose, x: chosen.pose.x + x, y: chosen.pose.y + y } }, '已移动 0.1 单位。') }
            else if (e.key.toLowerCase() === 'r') { e.preventDefault(); rotate(15) }
            else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove() }
          }}>
          <defs><pattern id="tile-grid" width="1" height="1" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r=".012" fill="#c6d3cf"/></pattern></defs>
          <rect x={view.x - view.width / 2} y={-view.y - height / 2} width={view.width} height={height} fill="url(#tile-grid)" pointerEvents="none"/>
          <g transform="scale(1 -1)">{display.map((t, index) => <g key={t.id}>
            <polygon data-tile-id={t.id} data-profile={t.profileId} className={`tile ${t.id === selected ? 'selected' : ''} ${drag?.id === t.id && !preview.draftValid ? 'invalid' : ''}`}
              points={vertices(t, profiles).map(v => v.join(',')).join(' ')} fill={t.color} role="button" tabIndex={0} aria-label={`磁力片 ${index + 1} ${profileFor(t, profiles)!.name}`} aria-pressed={t.id === selected}
              onPointerDown={e => start(e, current.instances.find(b => b.id === t.id)!)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(t.id) } }}/>
          </g>)}
          {preview.connections.map((c, i) => { const segment=connectionSegment(c,display,profiles),edge={a:segment.start,b:segment.end}; return <line key={i} className="connection-line" x1={edge.a[0]} y1={edge.a[1]} x2={edge.b[0]} y2={edge.b[1]}/> })}
          {drag?.snap && <polygon className="snap-preview" points={vertices(drag.snap.tile, profiles).map(v => v.join(',')).join(' ')}/>}
          </g>
        </svg>
        <p className={`board-message ${drag && !preview.draftValid ? 'warning' : ''}`} role="status">{drag?.moved ? drag.snap ? '可吸附 · 松手完成接触段对齐' : preview.draftValid ? '自由移动 · 松手放下，Esc 取消' : '当前位置不合法 · 松手将恢复原位' : message}</p>
        <div className="tiles-stats"><span><b>{current.instances.length}</b> 块磁力片</span><span><b>{preview.connections.length}</b> 条连接</span><span><b>{preview.components.length}</b> 个组件</span><strong data-testid="validation" className={preview.valid || (workMode(current)==='flat-mosaic'&&preview.draftValid&&display.length) ? 'valid-badge' : 'draft-badge'}>{!preview.draftValid ? '位置无效 · 不可放置' : workMode(current)==='flat-mosaic' && display.length ? '正式有效 · 平面拼图' : preview.valid ? '正式有效 · 整体连通' : '草稿 · 尚未连通'}</strong></div>
      </section>
    </StudioSlot><StudioSlot column="inspector" stages={['assembly']}>
      <aside className="tiles-panel storage-panel"><h2>我的作品</h2>{draftBackup&&<p>URL 打开前的未保存草稿已保留。<button onClick={()=>{try{const a=parseAssembly(JSON.parse(localStorage.getItem('magnetic-assembly-url-backup')!),profiles);if(commit(a,'已恢复保留草稿；可撤销。')){localStorage.removeItem('magnetic-assembly-url-backup');setDraftBackup(false);fit(a)}}catch(e){setStorageError(String(e))}}}>恢复 URL 打开前的作品草稿</button></p>}<label>作品模式<select aria-label="作品模式" disabled={!!drag} value={workMode(current)} onChange={e=>commit({...current,schemaVersion:2,mode:e.target.value as 'connected-construction'|'flat-mosaic'},'作品模式已更新；可撤销。')}><option value="connected-construction">{workModeNames['connected-construction']}</option><option value="flat-mosaic">{workModeNames['flat-mosaic']}</option></select></label><label>作品名称<input key={current.id + ':' + current.revision} defaultValue={current.name} maxLength={80} onBlur={e => { const name = e.target.value.trim(); if (name && name !== current.name) commit({ ...current, name }, '作品名称已更新。') }}/></label>
        <button className="primary" onClick={save} disabled={!!drag || storageBlocked || !current.instances.length}>保存作品快照</button>
        <label>已保存作品<select value={savedId} onChange={e => setSavedId(e.target.value)}><option value="">选择一个作品</option>{workspace.saved.map(a => <option key={a.id} value={a.id}>{a.name} · {a.instances.length} 块</option>)}</select></label>
        <button disabled={!savedId || !!drag} onClick={() => { const a = workspace.saved.find(s => s.id === savedId); if (a) { commit(structuredClone(a), '已加载保存快照，可以继续编辑。'); writeStudioUrl({assemblyId:a.id}); setSelected(null); fit(a) } }}>加载所选作品</button>
        <div className="button-row"><button onClick={exportJson}>导出 JSON</button><button onClick={() => file.current?.click()} disabled={!!drag}>导入 JSON</button><input ref={file} type="file" accept=".json,application/json" hidden onChange={e => { void importJson(e.target.files?.[0]); e.target.value = '' }}/></div>
        <p className="hint">每次有效编辑自动保存在当前浏览器，刷新可恢复。保存快照后，可随时加载重新编辑。JSON 可用于备份或换设备。</p>
        {storageError && <p role="alert" className="storage-error">{storageError}</p>}
        {storageBlocked && <button onClick={() => { if (!confirm('确认用当前工作区替换无法读取的磁力片存档？其他模块数据不会改变。')) return; try { saveWorkspace(localStorage, workspace, profiles); setStorageBlocked(false); setStorageError('') } catch (e) { setStorageError(String(e)) } }}>重置本模块存档</button>}
        <h2>几何检查</h2><p>零件规格、位姿、重叠、共线接触段、区间占用与连通性。</p><ul className="issues">{(drag ? preview : report).issues.filter(i=>workMode(current)!=='flat-mosaic'||i.code!=='DISCONNECTED').map((i, index) => <li key={index}>{i.message}</li>)}</ul>{checkArtwork(current, profiles).ready && !drag && <p className="success">所有检查通过。</p>}
        <details open><summary>连接关系（自动推导，含拖动预览）</summary>{preview.connections.length ? <ul className="connections">{preview.connections.map((c, i) => <li key={i}>#{current.instances.findIndex(t => t.id === c.a.tileId) + 1}.{c.a.edgeId} ↔ #{current.instances.findIndex(t => t.id === c.b.tileId) + 1}.{c.b.edgeId}{c.contact?` · 接触段 ${c.contact.length.toFixed(3)}`:''}</li>)}</ul> : <p className="hint">尚无正长度边连接。</p>}</details>
      </aside>
    </StudioSlot><BuildPanel assembly={current} savedAssemblies={workspace.saved} workspaceError={storageError} profiles={profiles} dragging={!!drag}/>
  </StudioLayout>
}
createRoot(document.getElementById('root')!).render(<Playground/>)

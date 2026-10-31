import { useEffect, useMemo, useRef, useState } from 'react'
import { StudioSlot, useStudio } from '../StudioLayout.tsx'
import { parseAssembly3D, serializeAssembly3D } from './assembly.ts'
import { validateAssembly3D } from './engine-adapter.ts'
import { componentCount, createViewerModel, rotationDegrees } from './viewer-model.ts'
import { MagnetScene3D, ViewerErrorBoundary } from './vendor/components/MagnetScene3D.tsx'
import { useProfileRegistry } from '../ProfileRegistry.tsx'
import { canonical } from '../build-plan.ts'
import type { Pose3D } from './assembly.ts'
import type { EditorHistory } from './vendor/editor/state.ts'
import * as actions from './vendor/editor/state.ts'
import { uid } from './vendor/editor/id.ts'
import { createShapeCatalog } from './profile-adapter.ts'
import { editorProject } from './editor-project.ts'
import type { Selection } from './editor-project.ts'
import { EditorCanvas } from './vendor/components/editor/EditorCanvas.tsx'
import type { ToolMode } from './vendor/components/editor/EditorCanvas.tsx'
import { EditorInspector } from './EditorInspector.tsx'
import { loadDraft3D, saveDraft3D } from './draft-storage.ts'
import { Vector3 } from 'three'
import rightAngle from './examples/right-angle.json' with { type: 'json' }
import cube from './examples/closed-cube.json' with { type: 'json' }
import mixed from './examples/mixed-profiles.json' with { type: 'json' }
import './viewer.css'

const examples = [
  { id: 'right-angle', name: '两片 90° 连接', data: rightAngle },
  { id: 'closed-cube', name: '闭合立方体 · 12 条连接', data: cube },
  { id: 'mixed-profiles', name: '方片与三角形 · 含自由片', data: mixed },
]
const initial = JSON.stringify(rightAngle, null, 2)
const format = (n: number) => Number(n.toFixed(6)).toString()
export default function ThreeDWorkspace() {
  const { stage, viewMode } = useStudio()
  const active = stage === 'assembly' && viewMode === '3d'
  const { registry: { profiles } } = useProfileRegistry()
  const [boot] = useState(() => {
    try { const saved = loadDraft3D(localStorage); return { ...saved, error: '' } }
    catch (e) { return { assembly: null, raw: null, error: `原 3D 草稿无法读取，已禁止覆盖：${String(e)}` } }
  })
  const [history, setHistory] = useState(() => actions.createInitialHistory(boot.assembly ?? parseAssembly3D(initial)))
  const historyRef = useRef(history); historyRef.current = history
  const [loaded, setLoaded] = useState(() => ({ source: boot.raw ?? initial, name: boot.assembly ? '已保存的 3D Draft' : examples[0].name, sequence: 0, isDraft: !!boot.assembly }))
  const [text, setText] = useState(boot.raw ?? initial), [error, setError] = useState(boot.error)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [editing, setEditing] = useState(false), [tool, setTool] = useState<ToolMode>('select'), [ownPort, setOwnPort] = useState('e0-p0')
  const [live, setLive] = useState<{ pieceId: string; tf: Pose3D } | null>(null)
  const [clean, setClean] = useState(() => serializeAssembly3D(history.current)), [saveNotice, setSaveNotice] = useState('')
  const expectedRaw = useRef(boot.raw), fileRequest = useRef(0), cameraTargetRef = useRef(new Vector3())
  const current = history.current
  const dirty = loaded.isDraft && serializeAssembly3D(current) !== clean
  const assembly = useMemo(() => live ? { ...current, pieces: current.pieces.map(p => p.id === live.pieceId ? { ...p, pose: live.tf } : p) } : current, [current, live])
  const selected = selection.kind === 'piece' ? selection.id : null
  const setSelected = (id: string | null) => { if (!live) setSelection(id ? { kind: 'piece', id } : { kind: 'none' }) }
  const items = useMemo(() => createViewerModel(assembly), [assembly])
  const validation = useMemo(() => validateAssembly3D(assembly), [assembly])
  const chosen = items.find(p => p.id === selected)
  const profileSignature = canonical(current.profiles)
  const catalog = useMemo(() => createShapeCatalog(current.profiles), [profileSignature])
  const shapes = useMemo(() => new Map([...catalog].map(([key, item]) => [key, item.shape])), [catalog])
  const project = useMemo(() => ({ ...editorProject(current, catalog), shapes }), [current, catalog, shapes])
  function accept(next: EditorHistory) { historyRef.current = next; setHistory(next); setLive(null); setSaveNotice('') }
  function apply(action: (h: EditorHistory) => EditorHistory) {
    if (!editing) return
    try { accept(action(historyRef.current)); setError('') } catch (e) { setError(String(e)); setLive(null) }
  }
  useEffect(() => { if (!active) setLive(null) }, [active])
  useEffect(() => {
    if (selection.kind === 'piece' && !current.pieces.some(p => p.id === selection.id) || selection.kind === 'connection' && !current.connections[selection.index]) setSelection({ kind: 'none' })
  }, [current, selection])
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if (!active || !editing || live || !(e.ctrlKey || e.metaKey) || !['z','y'].includes(e.key.toLowerCase())) return
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')) return
      e.preventDefault(); accept(e.key.toLowerCase() === 'y' || e.shiftKey ? actions.redo(historyRef.current) : actions.undo(historyRef.current)); setSelection({ kind: 'none' })
    }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut)
  }, [active, editing, live])
  function allowReplace() { return !dirty || confirm('当前 3D Draft 有未保存修改。确认替换？可先取消并导出或保存草稿。') }
  function startEdit() {
    if (!loaded.isDraft) {
      const draft = structuredClone(current); draft.id = uid('draft'); draft.revision = 0
      accept(actions.createInitialHistory(draft)); setClean(serializeAssembly3D(draft)); setLoaded(old => ({ ...old, isDraft: true }))
    }
    setEditing(true)
  }
  function blank() {
    if (!allowReplace()) return
    const draft = actions.createEmptyProject(); accept(actions.createInitialHistory(draft)); setClean(serializeAssembly3D(draft))
    setLoaded(old => ({ ...old, name: '空白 3D Draft', isDraft: true, sequence: old.sequence + 1 })); setSelection({ kind: 'none' }); setEditing(true)
  }
  function save() {
    try {
      if (boot.error) throw Error(boot.error)
      if (live) throw Error('请先结束画布操作，再保存')
      expectedRaw.current = saveDraft3D(localStorage, historyRef.current.current, expectedRaw.current)
      setClean(serializeAssembly3D(historyRef.current.current)); setSaveNotice('3D Draft 已保存，刷新可恢复；几何状态未被修正。'); setError('')
    } catch (e) { setError(String(e)) }
  }
  function reloadSaved() {
    if (!allowReplace()) return
    try {
      const saved = loadDraft3D(localStorage); if (!saved.assembly) throw Error('尚未保存 3D Draft')
      expectedRaw.current = saved.raw; accept(actions.createInitialHistory(saved.assembly)); setClean(saved.raw!)
      setLoaded(old => ({ source: saved.raw!, name: '已保存的 3D Draft', isDraft: true, sequence: old.sequence + 1 }))
      setText(saved.raw!); setSelection({ kind: 'none' }); setEditing(false); setError('')
    } catch (e) { setError(String(e)) }
  }
  function load(source: string, name: string) {
    try {
      if (!allowReplace()) return
      if (source.length > 1_000_000) throw Error('JSON 超过 1 MB 限制')
      const assembly = parseAssembly3D(source)
      accept(actions.createInitialHistory(assembly)); setClean(serializeAssembly3D(assembly))
      setLoaded(old => ({ source, name, sequence: old.sequence + 1, isDraft: false })); setEditing(false)
      setText(source); setSelected(null); setError('')
    } catch (e) { setError(`加载失败，保留当前作品：${String(e)}`) }
  }
  return <>
    <StudioSlot column="workspace" stages={['assembly']} view="3d">
      <section className="magnetic-3d-workspace" aria-label="3D 作品查看">
        <header className="magnetic-3d-heading"><div><h3>3D 作品查看</h3><p>{loaded.name}</p></div>
          <button onClick={() => { fileRequest.current++; load(loaded.source, loaded.name) }}>重新加载来源</button></header>
        <div className="magnetic-3d-edit-toggle" role="group" aria-label="3D View / Edit">
          <button disabled={!!live} aria-pressed={!editing} onClick={() => { setLive(null); setEditing(false) }}>View</button>
          <button disabled={!!live} aria-pressed={editing} onClick={startEdit}>{loaded.isDraft ? 'Edit Draft' : '从当前作品创建 Draft'}</button>
        </div>
        <div className="magnetic-3d-examples" role="group" aria-label="3D 示例">{examples.map(example =>
          <button key={example.id} data-3d-example={example.id} aria-pressed={assembly.id === example.id}
            onClick={() => { fileRequest.current++; load(JSON.stringify(example.data, null, 2), example.name) }}>{example.name}</button>)}</div>
        <p className="magnetic-3d-summary" role="status">{assembly.pieces.length} 片 · {assembly.connections.length} 条连接 · {componentCount(assembly)} 个组件 · {validation.valid ? '几何校验通过 · Geometry Valid' : '存在几何问题 · Geometry Invalid'}{live ? ' · 正在编辑预览，尚未提交' : loaded.isDraft ? dirty ? ' · Draft 未保存' : ' · Draft 无未保存修改' : ''}</p>
        {active && (editing ? <ViewerErrorBoundary key={`edit-${loaded.sequence}`}><EditorCanvas project={project} selection={selection} toolMode={tool}
          onSelectPiece={id => { if (!live) setSelection({ kind: 'piece', id }) }}
          onSelectConnection={index => { if (!live) setSelection({ kind: 'connection', index }) }}
          onSelectPort={(id, portId) => { setSelection({ kind: 'piece', id }); setOwnPort(portId) }}
          onClearSelection={() => { if (!live) setSelection({ kind: 'none' }) }} focusRequest={null} fitRequest={null}
          onMovePiece={(pieceId, tf) => setLive({ pieceId, tf })}
          onMovePieceCommit={(id, tf) => apply(h => actions.setPieceTransformAction(h, id, tf))}
          onCreateConnection={connection => apply(h => actions.createConnectionAction(h, connection, true))}
          cameraTargetRef={cameraTargetRef} liveTransformOverride={live}/></ViewerErrorBoundary>
          : <MagnetScene3D key={loaded.sequence} assembly={assembly} selected={selected} onSelect={setSelected}/>)}
        <details className="magnetic-3d-load"><summary>加载 / 导出 Assembly3D</summary>
          <label>Assembly3D JSON<textarea aria-label="Assembly3D JSON" value={text} spellCheck={false} maxLength={1_000_000}
            onChange={e => setText(e.target.value)}/></label>
          <div className="button-row"><button onClick={() => { fileRequest.current++; load(text, '加载的 Assembly3D') }}>加载 JSON</button>
            <label className="magnetic-3d-file">打开 JSON 文件<input type="file" aria-label="打开 Assembly3D 文件" accept=".json,application/json"
              onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
                const request = ++fileRequest.current
                try { if (file.size > 1_000_000) throw Error('JSON 文件超过 1 MB 限制'); const source = await file.text()
                  if (request === fileRequest.current) load(source, file.name)
                } catch (e) { if (request === fileRequest.current) setError(`读取失败：${String(e)}`) }
              }}/></label>
            <button onClick={() => { const url = URL.createObjectURL(new Blob([serializeAssembly3D(assembly)], { type: 'application/json' }))
              const link = document.createElement('a'); link.href = url; link.download = `${assembly.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}>导出 Assembly3D</button></div>
          <p className="hint">加载只恢复保存的位姿，不自动求解、贴地或替换 Catalog 版本。需要刷新恢复时，请在 Edit 中保存 3D Draft；导出仍是同一 Assembly3D 格式。</p>
        </details>
      </section>
    </StudioSlot>
    <StudioSlot column="inspector" stages={['assembly']} view="3d">
      <section className="magnetic-3d-inspector" aria-label="3D Inspector">
        <h3>3D Inspector</h3><p className="hint">{editing ? '手动移动只修改 Pose；吸附与显式求解才沿约束重新放置。' : 'View 只读：点击画布或列表查看。'}</p>
        <div className="magnetic-3d-draft-tools">
          <button disabled={!!live} onClick={blank}>新建空白 3D Draft</button>
          <button disabled={!!live} onClick={reloadSaved}>重新加载已保存 Draft</button>
          {editing && <><button disabled={!!live || !history.past.length} onClick={() => { apply(actions.undo); setSelection({ kind: 'none' }) }}>3D Undo</button>
            <button disabled={!!live || !history.future.length} onClick={() => { apply(actions.redo); setSelection({ kind: 'none' }) }}>3D Redo</button>
            <button disabled={!!live || !!boot.error} onClick={save}>保存 3D Draft</button></>}
        </div>
        {saveNotice && <p role="status">{saveNotice}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="magnetic-3d-piece-list" role="group" aria-label="3D 零件列表">{items.map(item => <button key={item.id}
          data-3d-piece={item.id} aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>
          <span className="magnetic-3d-swatch" style={{ background: item.color }}/>{item.id}<small>{item.shape.id}</small></button>)}</div>
        {chosen ? <div className="magnetic-3d-piece-info" data-selected-3d-piece={chosen.id}>
          <h4>{chosen.id}</h4><dl><dt>Profile</dt><dd>{chosen.shape.id} · {chosen.profile.profile.name}</dd>
            <dt>颜色</dt><dd><span className="magnetic-3d-swatch" style={{ background: chosen.color }}/>{chosen.color}{!chosen.piece.color && '（默认）'}</dd>
            <dt>位置 XYZ</dt><dd data-3d-position={JSON.stringify(chosen.piece.pose.position)}>{chosen.piece.pose.position.map(format).join(', ')}</dd>
            <dt>旋转 XYZ（度）</dt><dd>{rotationDegrees(chosen.piece.pose.quaternion).map(format).join(', ')}</dd>
            <dt>四元数 XYZW</dt><dd data-3d-quaternion={JSON.stringify(chosen.piece.pose.quaternion)}>{chosen.piece.pose.quaternion.map(format).join(', ')}</dd>
            <dt>厚度（世界单位）</dt><dd>{format(chosen.shape.thickness)}</dd>
            <dt>边长（世界单位）</dt><dd>{chosen.shape.edges.map(e => format(e.length)).join(' / ')}</dd>
            <dt>Profile 缩放</dt><dd>{chosen.profile.scale ?? 1}</dd></dl>
        </div> : <p>尚未选择零件。</p>}
        {assembly.connections.length > 0 && <details open={editing}><summary>连接关系</summary><div className="magnetic-3d-connections">{assembly.connections.map((c, index) =>
          <button key={index} data-3d-connection={index} aria-pressed={selection.kind === 'connection' && selection.index === index}
            disabled={!!live} onClick={() => setSelection({ kind: 'connection', index })}>#{index} · {c.pieceA}:{c.portA} → {c.pieceB}:{c.portB} · {c.dihedralDeg}°</button>)}</div></details>}
        {editing && <EditorInspector assembly={current} project={project} profiles={profiles} selection={selection} ownPort={ownPort}
          setOwnPort={setOwnPort} apply={apply} select={setSelection} busy={!!live} tool={tool} setTool={setTool}/>}
        <details open={!validation.valid}><summary>几何检查 · {validation.valid ? '通过' : '需检查'}</summary>
          <p>{assembly.id} · revision {assembly.revision}</p>
          {validation.issues.length ? <ul>{validation.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul> : <p>保存位姿满足当前连接与碰撞检查。</p>}
          <p className="hint">几何校验不代表真实磁力或物理稳定性保证。</p></details>
      </section>
    </StudioSlot>
  </>
}

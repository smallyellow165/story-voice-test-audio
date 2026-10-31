import { useEffect, useState } from 'react'
import type { Profile } from '../geometry.ts'
import type { Assembly3D } from './assembly.ts'
import type { EditorProject, Selection } from './editor-project.ts'
import type { EditorHistory } from './vendor/editor/state.ts'
import * as actions from './vendor/editor/state.ts'
import { profileKey3D } from './profile-adapter.ts'
import { PropertyPanel } from './vendor/components/editor/PropertyPanel.tsx'
import { findCompatibleTargets, isPortOccupied, portsCompatible } from './vendor/editor/snap.ts'
import type { Connection } from './vendor/engine/types.ts'
import type { ToolMode } from './vendor/components/editor/EditorCanvas.tsx'

type Props = {
  assembly: Assembly3D; project: EditorProject; profiles: readonly Profile[]; selection: Selection
  ownPort: string; setOwnPort: (id: string) => void
  apply: (action: (h: EditorHistory) => EditorHistory) => void
  select: (s: Selection) => void; busy: boolean; tool: ToolMode; setTool: (tool: ToolMode) => void
}
export function EditorInspector({ assembly, project, profiles, selection, ownPort, setOwnPort, apply, select, busy, tool, setTool }: Props) {
  const [profileKey, setProfileKey] = useState(profileKey3D(profiles[0]))
  const [thickness, setThickness] = useState('.05'), [color, setColor] = useState('#55b8ac')
  const [baseId, setBaseId] = useState(''), [basePort, setBasePort] = useState('e0-p0')
  const [angle, setAngle] = useState('90'), [flip, setFlip] = useState(false)
  const selectedId = selection.kind === 'piece' ? selection.id : ''
  const piece = assembly.pieces.find(p => p.id === selectedId)
  const ownShape = piece ? project.shapes.get(profileKey3D({ id: piece.profileId, version: piece.profileVersion })) : undefined
  const base = assembly.pieces.find(p => p.id === baseId && p.id !== selectedId) ?? assembly.pieces.find(p => p.id !== selectedId)
  const baseShape = base ? project.shapes.get(profileKey3D({ id: base.profileId, version: base.profileVersion })) : undefined
  const effectiveOwn = ownShape?.ports.find(p => p.portId === ownPort) ?? ownShape?.ports[0]
  const effectiveBase = baseShape?.ports.find(p => p.portId === basePort) ?? baseShape?.ports[0]
  const compatible = selectedId && effectiveOwn ? findCompatibleTargets({ pieceId: selectedId, portId: effectiveOwn.portId }, project) : []
  const canSnap = !!(base && effectiveOwn && effectiveBase && portsCompatible(effectiveOwn, effectiveBase) &&
    !isPortOccupied(selectedId, effectiveOwn.portId, assembly.connections) && !isPortOccupied(base.id, effectiveBase.portId, assembly.connections))
  const [snapshotThickness, setSnapshotThickness] = useState('')
  const selectedKey = piece ? profileKey3D({ id: piece.profileId, version: piece.profileVersion }) : ''
  const snapshot = assembly.profiles.find(s => profileKey3D(s.profile) === selectedKey)
  useEffect(() => setSnapshotThickness(String(snapshot?.thickness ?? .05)), [selectedKey, snapshot?.thickness])
  useEffect(() => {
    const s = assembly.profiles.find(s => profileKey3D(s.profile) === profileKey)
    setThickness(String(s?.thickness ?? .05))
  }, [profileKey, assembly.profiles])
  const connection = (): Connection => ({ pieceA: base!.id, portA: effectiveBase!.portId,
    pieceB: selectedId, portB: effectiveOwn!.portId, dihedralDeg: Number(angle), flip })
  function add() {
    apply(h => {
      const profile = profiles.find(p => profileKey3D(p) === profileKey)!
      const existing = h.current.profiles.find(s => profileKey3D(s.profile) === profileKey)
      const snapshot = existing ? { ...existing, profile, thickness: Number(thickness) } : { profile, thickness: Number(thickness) }
      const width = Math.max(...profile.vertices.map(v => v[0])) - Math.min(...profile.vertices.map(v => v[0]))
      const x = h.current.pieces.length ? Math.max(...h.current.pieces.map(p => p.pose.position[0])) + width + .35 : 0
      const result = actions.addPieceAction(h, snapshot, color, [x, Number(thickness) * (snapshot.scale ?? 1) / 2, 0])
      select({ kind: 'piece', id: result.pieceId }); return result.history
    })
  }
  return <fieldset className="magnetic-3d-edit-inspector" disabled={busy}>
    <legend>编辑操作</legend>
    <label>工具<select aria-label="3D 编辑工具" value={tool} onChange={e => setTool(e.target.value as ToolMode)}>
      <option value="select">选择</option><option value="move">移动 Gizmo</option><option value="rotate">旋转 Gizmo</option><option value="snap">磁吸拖动</option>
    </select></label>
    <details open><summary>从 Tiles Catalog 添加</summary>
      <label>Profile<select aria-label="3D Catalog Profile" value={profileKey} onChange={e => setProfileKey(e.target.value)}>
        {profiles.map(p => <option key={profileKey3D(p)} value={profileKey3D(p)}>{p.name} · {profileKey3D(p)}</option>)}</select></label>
      <label>厚度（Profile 单位）<input aria-label="新零件厚度" type="number" min=".000001" step=".01" value={thickness} onChange={e => setThickness(e.target.value)}/></label>
      <label>颜色<input aria-label="新 3D 零件颜色" type="color" value={color} onChange={e => setColor(e.target.value)}/></label>
      <button onClick={add}>添加 3D 零件</button>
      <p className="hint">同一文档的同版本 Profile 共用快照与厚度；已有配置不会被添加操作覆盖。</p>
    </details>
    <PropertyPanel project={project} selection={selection}
      onSetPieceTransform={(id, pose) => apply(h => actions.setPieceTransformAction(h, id, pose))}
      onSetPieceColor={(id, c) => apply(h => actions.setPieceColorAction(h, id, c))}
      onDuplicatePiece={() => apply(h => { const result = actions.duplicatePieceAction(h, selectedId); select({ kind: 'piece', id: result.newId }); return result.history })}
      onDeleteSelected={() => apply(h => { select({ kind: 'none' }); return actions.deletePieceAction(h, selectedId) })}
      onUpdateConnection={(i, patch) => apply(h => actions.updateConnectionAction(h, i, patch))}
      onRemoveConnection={i => apply(h => { select({ kind: 'none' }); return actions.removeConnectionAction(h, i) })}/>
    {piece && <>
      <label>当前零件颜色<input aria-label="当前 3D 零件颜色" type="color" value={piece.color ?? '#55b8ac'} onChange={e => apply(h => actions.setPieceColorAction(h, piece.id, e.target.value))}/></label>
      <details><summary>修改当前 Profile 快照厚度</summary>
        <label>Profile 厚度<input aria-label="当前 Profile 厚度" type="number" min=".000001" step=".01" value={snapshotThickness} onChange={e => setSnapshotThickness(e.target.value)}/></label>
        <p className="hint">明确修改此文档的 {selectedKey}，影响引用它的全部零件；不写入 Registry。</p>
        <button onClick={() => apply(h => actions.setProfileThicknessAction(h, selectedKey, Number(snapshotThickness)))}>应用快照厚度</button></details>
      <details open><summary>选择边并连接</summary>
        <p>固定目标 A，连接选中零件 B。点击画布的蓝色边也可选择 B 端口。</p>
        <label>B 端口<select aria-label="3D 自身端口 B" value={effectiveOwn?.portId ?? ''} onChange={e => setOwnPort(e.target.value)}>
          {ownShape?.ports.map(p => <option key={p.portId} value={p.portId}>{p.portId} · 长 {p.length.toFixed(4)}</option>)}</select></label>
        <label>目标 A<select aria-label="3D 目标零件 A" value={base?.id ?? ''} onChange={e => setBaseId(e.target.value)}>
          {assembly.pieces.filter(p => p.id !== selectedId).map(p => <option key={p.id} value={p.id}>{p.id}</option>)}</select></label>
        <label>A 端口<select aria-label="3D 目标端口 A" value={effectiveBase?.portId ?? ''} onChange={e => setBasePort(e.target.value)}>
          {baseShape?.ports.map(p => <option key={p.portId} value={p.portId}>{p.portId} · 长 {p.length.toFixed(4)}</option>)}</select></label>
        <label>二面角<input aria-label="新连接二面角" type="number" min="-180" max="180" value={angle} onChange={e => setAngle(e.target.value)}/></label>
        <label><input aria-label="新连接 flip" type="checkbox" checked={flip} onChange={e => setFlip(e.target.checked)}/>flip · 反向端点</label>
        <p className="hint">当前 B 端口有 {compatible.length} 个空闲兼容目标。90° 常用 flip 关闭；相邻共面通常为 0°、flip 开启。</p>
        <button disabled={!canSnap || !angle.trim()} onClick={() => apply(h => actions.createConnectionAction(h, connection(), true))}>吸附并建立连接</button>
        <button disabled={!base || !effectiveOwn || !effectiveBase || !angle.trim()} onClick={() => apply(h => actions.createConnectionAction(h, connection(), false))}>仅建立约束（不移动）</button>
      </details>
      <button onClick={() => apply(h => actions.solveComponentAction(h, piece.id))}>显式求解（固定选中片）</button>
    </>}
    {selection.kind === 'connection' && <>
      <p className="hint">修改角度只更新约束；需要移动结构时，使用下面的显式求解。闭环不一致仍会显示 Diagnostic。</p>
      <button onClick={() => apply(h => actions.solveComponentAction(h, h.current.connections[selection.index].pieceA))}>显式求解（固定 A）</button>
      <ConnectionEndpoints key={selection.index} connection={assembly.connections[selection.index]} project={project}
        onUpdate={patch => apply(h => actions.updateConnectionAction(h, selection.index, patch))}/>
    </>}
  </fieldset>
}
function ConnectionEndpoints({ connection, project, onUpdate }: { connection: Connection; project: EditorProject; onUpdate: (patch: Partial<Connection>) => void }) {
  const [draft, setDraft] = useState(connection)
  useEffect(() => setDraft(connection), [connection])
  if (!connection) return null
  return <details><summary>修改连接端口</summary>{(['A','B'] as const).map(side => {
    const pieceKey = side === 'A' ? 'pieceA' : 'pieceB', portKey = side === 'A' ? 'portA' : 'portB'
    const part = project.parts.find(p => p.id === draft[pieceKey]), shape = part ? project.shapes.get(part.shape) : undefined
    return <div key={side}><label>零件 {side}<select aria-label={`连接零件 ${side}`} value={draft[pieceKey]} onChange={e => {
      const selected = project.parts.find(p => p.id === e.target.value)
      setDraft({ ...draft, [pieceKey]: e.target.value, [portKey]: (selected && project.shapes.get(selected.shape)?.ports[0]?.portId) ?? '' })
    }}>{project.pieces.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}</select></label>
      <label>端口 {side}<select aria-label={`连接端口 ${side}`} value={draft[portKey]} onChange={e => setDraft({ ...draft, [portKey]: e.target.value })}>
        {shape?.ports.map(p => <option key={p.portId} value={p.portId}>{p.portId}</option>)}</select></label></div>
  })}<button onClick={() => onUpdate(draft)}>更新连接端口（不移动）</button></details>
}

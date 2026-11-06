import { useEffect, useState } from 'react'
import type {ReactNode} from 'react'
import type { Profile } from '../geometry.ts'
import type { Assembly3D } from './assembly.ts'
import type { EditorProject, Selection } from './editor-project.ts'
import type { EditorHistory } from './vendor/editor/state.ts'
import * as actions from './vendor/editor/state.ts'
import {canonicalProfileSnapshot} from './canonical-geometry.ts'
import { profileKey3D } from './profile-adapter.ts'
import { PropertyPanel } from './vendor/components/editor/PropertyPanel.tsx'
import type { Connection } from './vendor/engine/types.ts'
import {disconnectPieceForSnap} from './editor-snap.ts'
import {combinedSolveReason} from './combined-editing.ts'
import type {AssemblyOperation} from './ModuleTransformPanel.tsx'

type Props = {
  connectionRotationActive:boolean;editing:boolean;canInsert:boolean;onInserted:(id:string)=>void;readOnlyReason?:string;selectionInfo:ReactNode;globalTools:ReactNode;
  currentToolLabel:string;currentToolPanel:ReactNode;toolControls:ReactNode;selectionTitle:ReactNode;selectionControls:ReactNode
  assembly: Assembly3D; project: EditorProject; profiles: readonly Profile[]; selection: Selection
  apply: (action: (h: EditorHistory) => EditorHistory) => void
  select: (s: Selection) => void; busy: boolean; operation:AssemblyOperation|'select'
}
export function EditorInspector({ connectionRotationActive,editing,canInsert,onInserted,readOnlyReason,selectionInfo,globalTools,currentToolLabel,currentToolPanel,toolControls,selectionTitle,selectionControls,assembly, project, profiles, selection, apply, select, busy, operation }: Props) {
  const [profileKey, setProfileKey] = useState(profileKey3D(profiles[0]))
  const [color, setColor] = useState('#55b8ac')
  const selectedId = selection.kind === 'piece' ? selection.id : ''
  const piece = assembly.pieces.find(p => p.id === selectedId)
  function add() {
    apply(h => {
      const profile = profiles.find(p => profileKey3D(p) === profileKey)!
      const snapshot = canonicalProfileSnapshot(profile)
      const width = Math.max(...profile.vertices.map(v => v[0])) - Math.min(...profile.vertices.map(v => v[0]))
      const x = h.current.pieces.length ? Math.max(...h.current.pieces.map(p => p.pose.position[0])) + width + .35 : 0
      const result = actions.addPieceAction(h, snapshot, color, [x, snapshot.thickness / 2, 0])
      onInserted(result.pieceId); return result.history
    })
  }
  return <>
    <section className="assembly-current-tool" aria-label="Current Tool"><h4>Current Tool <span>· {currentToolLabel}</span></h4>
    {currentToolPanel}{toolControls}
    {readOnlyReason&&<small>{readOnlyReason}</small>}
    {editing && (selection.kind==='piece'&&operation!=='select'&&operation!=='snap'||selection.kind==='connection') && <fieldset className="magnetic-3d-edit-inspector" disabled={busy}><legend className="sr-only">当前选择编辑</legend>
    {!connectionRotationActive&&<PropertyPanel operation={operation} showPieceActions={false} showPieceColor={false} project={project} selection={selection}
      onSetPieceTransform={(id, pose) => apply(h => actions.setPieceTransformAction(h, id, pose))}
      onSetPieceColor={(id, c) => apply(h => actions.setPieceColorAction(h, id, c))}
      onDuplicatePiece={() => apply(h => { const result = actions.duplicatePieceAction(h, selectedId); select({ kind: 'piece', id: result.newId }); return result.history })}
      onDeleteSelected={() => apply(h => { select({ kind: 'none' }); return actions.deletePieceAction(h, selectedId) })}
      onUpdateConnection={(i, patch) => apply(h => actions.updateConnectionAction(h, i, patch))}
      onRemoveConnection={i => apply(h => { select({ kind: 'none' }); return actions.removeConnectionAction(h, i) })}/>}
    {selection.kind === 'connection' && <>
      <button onClick={()=>select({kind:'piece',id:assembly.connections[selection.index].pieceB})}>重新吸附 B（先解除相关连接）</button>
      <p className="hint">修改角度只更新约束；需要移动结构时，使用下面的显式求解。闭环不一致仍会显示 Diagnostic。</p>
      <span title={combinedSolveReason(assembly,assembly.connections[selection.index].pieceA)}><button disabled={!!combinedSolveReason(assembly,assembly.connections[selection.index].pieceA)} onClick={() => apply(h => actions.solveComponentAction(h, h.current.connections[selection.index].pieceA))}>显式求解（固定 A）</button></span>
      <ConnectionEndpoints key={selection.index} connection={assembly.connections[selection.index]} project={project}
        onUpdate={patch => apply(h => actions.updateConnectionAction(h, selection.index, patch))}/>
    </>}
  </fieldset>}</section>
    <section className="magnetic-3d-selection-detail" aria-label="Selection Detail"><h4>Selection Detail{selectionTitle&&<> · {selectionTitle}</>}</h4>{selectionControls}{selectionInfo}
      {editing&&piece&&<details><summary>其他单片操作</summary><button disabled={busy||!assembly.connections.some(c=>c.pieceA===piece.id||c.pieceB===piece.id)} onClick={()=>apply(h=>disconnectPieceForSnap(h,piece.id))}>解除选中零件全部连接（保留 Pose）</button><span title={combinedSolveReason(assembly,piece.id)}><button disabled={busy||!!combinedSolveReason(assembly,piece.id)} onClick={()=>apply(h=>actions.solveComponentAction(h,piece.id))}>显式求解（固定选中片）</button></span></details>}
    </section>
    <details className="magnetic-3d-edit-tools"><summary>Edit Tools</summary>
    <fieldset className="magnetic-3d-edit-inspector" disabled={busy}><legend className="sr-only">全局编辑操作</legend>{globalTools}{canInsert&&<>
    <details><summary>从 Tiles Catalog 添加</summary>
      <label>Profile<select aria-label="3D Catalog Profile" value={profileKey} onChange={e => setProfileKey(e.target.value)}>
        {profiles.map(p => <option key={profileKey3D(p)} value={profileKey3D(p)}>{p.name} · {profileKey3D(p)}</option>)}</select></label>
      <p className="hint">厚度及 Port 来自版本化 Profile；修改规格请在 Tiles Catalog 创建新版本。</p>
      <label>颜色<input aria-label="新 3D 零件颜色" type="color" value={color} onChange={e => setColor(e.target.value)}/></label>
      <button onClick={add}>添加 3D 零件</button>
      <p className="hint">所有阶段共用同一版本的 Canonical Profile / Port。</p>
    </details>

    </>}
    </fieldset></details>
  </>
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

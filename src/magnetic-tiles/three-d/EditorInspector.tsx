import {SnapSelector} from './SnapSelector.tsx'
import type {SnapPicker} from './module-snap-selection.ts'
import {parentModule} from './combined-editing.ts'
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
import { findCompatibleTargets, portsCompatible } from './vendor/editor/snap.ts'
import { portPairKey } from './vendor/engine/port-compatibility.ts'
import type { Connection } from './vendor/engine/types.ts'
import {disconnectPieceForSnap} from './editor-snap.ts'
import {combinedSolveReason} from './combined-editing.ts'
import type {AssemblyOperation} from './ModuleTransformPanel.tsx'

type Props = {
  connectionRotationActive:boolean;editing:boolean;canInsert:boolean;onInserted:(id:string)=>void;readOnlyReason?:string;selectionInfo:ReactNode;globalTools:ReactNode;
  currentToolLabel:string;currentToolPanel:ReactNode;toolControls:ReactNode;selectionTitle:ReactNode;selectionControls:ReactNode
  assembly: Assembly3D; project: EditorProject; profiles: readonly Profile[]; selection: Selection
  hasSnapPreview:boolean;tileSnap:{fixedTile:string;fixedPort:string};setTileSnap:(s:{fixedTile:string;fixedPort:string})=>void;picker:SnapPicker|null;togglePicker:(kind:SnapPicker)=>void
  ownPort: string; setOwnPort: (id: string) => void
  apply: (action: (h: EditorHistory) => EditorHistory) => void
  select: (s: Selection) => void; busy: boolean; operation:AssemblyOperation|'select'
  onPreviewSnap:(connection:Connection)=>void;snapSettings:{dihedralDeg:number;flip:boolean};setSnapSettings:(settings:{dihedralDeg:number;flip:boolean})=>void
}
export function EditorInspector({ connectionRotationActive,editing,canInsert,onInserted,readOnlyReason,selectionInfo,globalTools,currentToolLabel,currentToolPanel,toolControls,selectionTitle,selectionControls,assembly, project, profiles, selection,hasSnapPreview,tileSnap,setTileSnap,picker,togglePicker, ownPort, setOwnPort, apply, select, busy, operation,onPreviewSnap,snapSettings,setSnapSettings }: Props) {
  const [profileKey, setProfileKey] = useState(profileKey3D(profiles[0]))
  const [color, setColor] = useState('#55b8ac')
  const {fixedTile:baseId,fixedPort:basePort}=tileSnap
  const setBaseId=(id:string)=>setTileSnap({fixedTile:id,fixedPort:''}),setBasePort=(port:string)=>setTileSnap({...tileSnap,fixedPort:port})
  const [angle,setAngleText]=useState(()=>Number.isFinite(snapSettings.dihedralDeg)?String(snapSettings.dihedralDeg):'')
  const flip=snapSettings.flip
  const setAngle=(angle:string)=>{setAngleText(angle);setSnapSettings({...snapSettings,dihedralDeg:angle.trim()?Number(angle):NaN})},setFlip=(flip:boolean)=>setSnapSettings({...snapSettings,flip})
  const selectedId = selection.kind === 'piece' ? selection.id : ''
  const piece = assembly.pieces.find(p => p.id === selectedId)
  const ownShape = piece ? project.shapes.get(profileKey3D({ id: piece.profileId, version: piece.profileVersion })) : undefined
  const base = assembly.pieces.find(p => p.id === baseId && p.id !== selectedId) ?? assembly.pieces.find(p => p.id !== selectedId)
  const baseShape = base ? project.shapes.get(profileKey3D({ id: base.profileId, version: base.profileVersion })) : undefined
  const effectiveOwn = ownShape?.ports.find(p => p.portId === ownPort) ?? ownShape?.ports[0]
  const effectiveBase = baseShape?.ports.find(p => p.portId === basePort) ?? baseShape?.ports[0]
  const compatible = selectedId && effectiveOwn ? findCompatibleTargets({ pieceId: selectedId, portId: effectiveOwn.portId }, project) : []
  const canSnap = !!(base && effectiveOwn && effectiveBase && portsCompatible(effectiveOwn, effectiveBase) &&
    !assembly.connections.some(c=>portPairKey(c)===portPairKey({pieceA:base.id,portA:effectiveBase.portId,pieceB:selectedId,portB:effectiveOwn.portId})))
  const connection = (): Connection => ({ pieceA: base!.id, portA: effectiveBase!.portId,
    pieceB: selectedId, portB: effectiveOwn!.portId, dihedralDeg: Number(angle), flip })
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
    {editing && (selection.kind==='piece'&&operation!=='select'||selection.kind==='connection') && <fieldset className="magnetic-3d-edit-inspector" disabled={busy&&!(hasSnapPreview&&piece&&operation==='snap')}><legend className="sr-only">当前选择编辑</legend>
    {!connectionRotationActive&&<PropertyPanel operation={operation} showPieceActions={false} showPieceColor={false} project={project} selection={selection}
      onSetPieceTransform={(id, pose) => apply(h => actions.setPieceTransformAction(h, id, pose))}
      onSetPieceColor={(id, c) => apply(h => actions.setPieceColorAction(h, id, c))}
      onDuplicatePiece={() => apply(h => { const result = actions.duplicatePieceAction(h, selectedId); select({ kind: 'piece', id: result.newId }); return result.history })}
      onDeleteSelected={() => apply(h => { select({ kind: 'none' }); return actions.deletePieceAction(h, selectedId) })}
      onUpdateConnection={(i, patch) => apply(h => actions.updateConnectionAction(h, i, patch))}
      onRemoveConnection={i => apply(h => { select({ kind: 'none' }); return actions.removeConnectionAction(h, i) })}/>}
    {piece && <>
      {operation==='snap'&&<div className="module-snap-parameters" aria-label="Tile Snap 参数">
        <div className="snap-side-heading snap-moving"><b>Moving</b><small>仅移动此 Tile</small></div>
        <div className="snap-fields-row">
          <label>Moving Tile<div className="snap-select-field"><select aria-label="3D 移动零件 B" value={selectedId} onChange={e=>select({kind:'piece',id:e.target.value})}>
            {assembly.pieces.filter(p=>!parentModule(assembly,p.id)).map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select><SnapSelector kind="moving-tile" active={picker} toggle={togglePicker} disabled={hasSnapPreview||!piece}/></div></label>
          <label>Moving Port<div className="snap-select-field"><select aria-label="3D 自身端口 B" value={effectiveOwn?.portId??''} onChange={e=>setOwnPort(e.target.value)}>
            {ownShape?.ports.map(p=><option key={p.portId} value={p.portId}>{p.portId} · 长 {p.length.toFixed(4)}</option>)}</select><SnapSelector kind="moving-port" active={picker} toggle={togglePicker} disabled={hasSnapPreview||!effectiveOwn}/></div></label>
        </div>
        <div className="snap-side-heading snap-fixed"><b>Fixed</b><small>不动 · 可选 Group 成员</small></div>
        <div className="snap-fields-row">
          <label>Fixed Tile<div className="snap-select-field"><select aria-label="3D 目标零件 A" value={base?.id??''} onChange={e=>setBaseId(e.target.value)}>
            {assembly.pieces.filter(p=>p.id!==selectedId).map(p=><option key={p.id} value={p.id}>{p.id}</option>)}</select><SnapSelector kind="fixed-tile" active={picker} toggle={togglePicker} disabled={hasSnapPreview||!base}/></div></label>
          <label>Fixed Port<div className="snap-select-field"><select aria-label="3D 目标端口 A" value={effectiveBase?.portId??''} onChange={e=>setBasePort(e.target.value)}>
            {baseShape?.ports.map(p=><option key={p.portId} value={p.portId}>{p.portId} · 长 {p.length.toFixed(4)}</option>)}</select><SnapSelector kind="fixed-port" active={picker} toggle={togglePicker} disabled={hasSnapPreview||!effectiveBase}/></div></label>
        </div>
        <div className="snap-options">
          <label>Dihedral °<input aria-label="新连接二面角" type="number" min="-180" max="180" value={angle} onChange={e=>setAngle(e.target.value)}/></label>
          <label><input aria-label="新连接 flip" type="checkbox" checked={flip} onChange={e=>setFlip(e.target.checked)}/>Flip</label>
          <button disabled={hasSnapPreview||!!picker||!canSnap||!angle.trim()} onClick={()=>onPreviewSnap(connection())}>预览吸附</button>
        </div>
        {picker&&<small className="snap-picker-hint">Viewer：{picker.replace('-',' ')} · Esc 取消</small>}
        <p className="hint">{compatible.length} 个空闲兼容目标。预览后确认；也可直接点击目标兼容边。仅建立约束不调整 Pose，不匹配会显示 Invalid。</p>
        <button disabled={hasSnapPreview||!!picker||!base||!effectiveOwn||!effectiveBase||!angle.trim()} onClick={()=>apply(h=>actions.createConnectionAction(h,connection(),false))}>仅建立约束（不移动）</button>
      </div>}
    </>}
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

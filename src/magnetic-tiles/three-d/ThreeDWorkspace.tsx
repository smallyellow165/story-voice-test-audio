import { useEffect, useMemo, useRef, useState } from 'react'
import { StudioSlot, useStudio } from '../StudioLayout.tsx'
import { parseAssembly3D, serializeAssembly3D } from './assembly.ts'
import { validateAssembly3D,inspectAssemblyCollisions } from './engine-adapter.ts'
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
import {InfoHint} from '../../brick-vision/InfoHint.tsx'
import {AssemblySelectionTable} from './AssemblySelectionTable.tsx'
import { EditorInspector } from './EditorInspector.tsx'
import { loadDraft3D, saveDraft3D } from './draft-storage.ts'
import type {CameraView3D} from './camera-view.ts'
import type {PhotoOrigin3D} from './reconstruction/adopt-draft.ts'
import {adoptReconstructionDraft,loadPhotoOrigin,photoDraftGeometryGate,revalidatePhotoDraft} from './reconstruction/adopt-draft.ts'
import {previewEdgeSnap,confirmEdgeSnap} from './editor-snap.ts'
import type {EdgeSnapPreview} from './editor-snap.ts'
import type {Connection} from './vendor/engine/types.ts'
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
  const { stage, viewMode, setAssembly3D, adoption3D, clearAdoption3D } = useStudio()
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
  const [showTileIds,setShowTileIds]=useState(true)
  const [showGeometryDetails,setShowGeometryDetails]=useState(false)
  const [editing, setEditing] = useState(false), [tool, setTool] = useState<ToolMode>('snap'), [ownPort, setOwnPort] = useState('e0-p0')
  const [snapMode,setSnapMode]=useState<'drag'|'click'>('drag'),[snapSettings,setSnapSettings]=useState({dihedralDeg:90,flip:false})
  const [pendingSnap,setPendingSnap]=useState<EdgeSnapPreview|null>(null)
  const [live, setLive] = useState<{ pieceId: string; tf: Pose3D } | null>(null)
  const [clean, setClean] = useState(() => serializeAssembly3D(history.current)), [saveNotice, setSaveNotice] = useState('')
  const expectedRaw = useRef(boot.raw), fileRequest = useRef(0), cameraTargetRef = useRef(new Vector3())
  const [photoOrigin,setPhotoOrigin]=useState<PhotoOrigin3D|null>(()=>loadPhotoOrigin(localStorage))
  const [editorCamera,setEditorCamera]=useState<CameraView3D|null>(null)
  useEffect(()=>{
    if(!adoption3D)return
    try{
      if(!allowReplace()){clearAdoption3D();return}
      if(boot.error)throw Error(boot.error)
      const assembly=parseAssembly3D(JSON.stringify(adoption3D.assembly)),{raw,sidecar}=adoptReconstructionDraft(localStorage,assembly,adoption3D.origin,expectedRaw.current,adoption3D.cameraView)
      expectedRaw.current=raw
      accept(actions.createInitialHistory(assembly));setClean(raw);setText(raw);setPhotoOrigin(sidecar)
      setLoaded(old=>({source:raw,name:adoption3D.origin.entryMode==='diagnostic-override'?'Visible 3D · 待修复 Draft':'Visible 3D · 人工采用的候选 Draft',sequence:old.sequence+1,isDraft:true}));setSelection({kind:'none'});setEditing(true);setError('')
    }catch(e){setError(String(e))}finally{clearAdoption3D()}
  },[adoption3D])
  const current = history.current
  const operationBusy=!!live||!!pendingSnap
  const initialCameraView=photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?photoOrigin.cameraView:undefined
  useEffect(() => setAssembly3D(current), [current, setAssembly3D])
  const dirty = loaded.isDraft && serializeAssembly3D(current) !== clean
  const assembly = useMemo(() => live ? { ...current, pieces: current.pieces.map(p => p.id === live.pieceId ? { ...p, pose: live.tf } : p) } : current, [current, live])
  const selected = selection.kind === 'piece' ? selection.id : null
  const setSelected = (id: string | null) => { if (!live&&!pendingSnap) setSelection(id ? { kind: 'piece', id } : { kind: 'none' }) }
  const items = useMemo(() => createViewerModel(assembly), [assembly])
  const validation = useMemo(() => validateAssembly3D(assembly), [assembly])
  const geometryGate=useMemo(()=>photoDraftGeometryGate(assembly,photoOrigin,validation),[assembly,photoOrigin,validation])
  const selectedConnection=selection.kind==='connection'?assembly.connections[selection.index]:undefined
  const geometryErrors=validation.issues.filter(i=>i.severity==='error')
  const collisionDetails=useMemo(()=>showGeometryDetails?inspectAssemblyCollisions(assembly,validation):[],[showGeometryDetails,assembly,validation])
  const chosen = items.find(p => p.id === selected)
  const profileSignature = canonical(current.profiles)
  const catalog = useMemo(() => createShapeCatalog(current.profiles), [profileSignature])
  const shapes = useMemo(() => new Map([...catalog].map(([key, item]) => [key, item.shape])), [catalog])
  const project = useMemo(() => ({ ...editorProject(current, catalog), shapes }), [current, catalog, shapes])
  function accept(next: EditorHistory) { historyRef.current = next; setHistory(next); setLive(null);setPendingSnap(null); setSaveNotice('') }
  function apply(action: (h: EditorHistory) => EditorHistory) {
    if (!editing) return
    try { accept(action(historyRef.current)); setError('') } catch (e) { setError(String(e)); setLive(null) }
  }
  useEffect(() => { if (!active){setLive(null);setPendingSnap(null)} }, [active])
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setPendingSnap(null);setLive(null)}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[])
  useEffect(() => {
    if (selection.kind === 'piece' && !current.pieces.some(p => p.id === selection.id) || selection.kind === 'connection' && !current.connections[selection.index]) setSelection({ kind: 'none' })
  }, [current, selection])
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if (!active || !editing || operationBusy || !(e.ctrlKey || e.metaKey) || !['z','y'].includes(e.key.toLowerCase())) return
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')) return
      e.preventDefault(); accept(e.key.toLowerCase() === 'y' || e.shiftKey ? actions.redo(historyRef.current) : actions.undo(historyRef.current)); setSelection({ kind: 'none' })
    }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut)
  }, [active, editing, operationBusy])
  function prepareSnap(connection:Connection){
    setLive(null);setPendingSnap(null);
    try{setPendingSnap(previewEdgeSnap(historyRef.current.current,connection));setError('')}catch(e){setError(String(e))}
  }
  function confirmSnap(){
    if(!pendingSnap)return;
    try{accept(confirmEdgeSnap(historyRef.current,pendingSnap));setError('');setSaveNotice('吸附已确认：仅更新源零件 Pose 和真实连接；仍使用严格几何验证。')}catch(e){setPendingSnap(null);setLive(null);setError(String(e))}
  }
  function allowReplace() { return !dirty || confirm('当前 3D Draft 有未保存修改。确认替换？可先取消并导出或保存草稿。') }
  function startEdit() {
    if (!loaded.isDraft) {
      const draft = structuredClone(current); draft.id = uid('draft'); draft.revision = 0
      accept(actions.createInitialHistory(draft)); setClean(serializeAssembly3D(draft)); setLoaded(old => ({ ...old, isDraft: true }))
    }
    setTool(snapMode==='drag'?'snap':'select');setEditing(true)
  }
  function blank() {
    if (!allowReplace()) return
    const draft = actions.createEmptyProject(); accept(actions.createInitialHistory(draft)); setClean(serializeAssembly3D(draft))
    setLoaded(old => ({ ...old, name: '空白 3D Draft', isDraft: true, sequence: old.sequence + 1 })); setSelection({ kind: 'none' });setTool(snapMode==='drag'?'snap':'select'); setEditing(true)
  }
  function save() {
    try {
      if (boot.error) throw Error(boot.error)
      if (operationBusy) throw Error('请先结束画布操作或确认/取消吸附预览，再保存')
      expectedRaw.current = saveDraft3D(localStorage, historyRef.current.current, expectedRaw.current)
      setClean(serializeAssembly3D(historyRef.current.current)); setSaveNotice('3D Draft 已保存，刷新可恢复；几何状态未被修正。'); setError('')
    } catch (e) { setError(String(e)) }
  }
  async function revalidate() {
    const target=historyRef.current.current,signature=serializeAssembly3D(target);
    try {
      if(operationBusy)throw Error('请先结束画布操作或吸附预览，再执行 Revalidate Geometry');
      const report=validateAssembly3D(target);
      if(photoDraftGeometryGate(target,loadPhotoOrigin(localStorage),report).repair){
        const next=await revalidatePhotoDraft(localStorage,target,expectedRaw.current);
        setPhotoOrigin(next);
        if(serializeAssembly3D(historyRef.current.current)!==signature)throw Error('复验期间 Draft 已变化，结果已过期，请重新执行 Revalidate Geometry');
        setAssembly3D(structuredClone(target));
        setSaveNotice(`Revalidate Geometry：revision ${target.revision} · Hash ${next.geometryReview!.assemblyHash} · ${report.valid?'Geometry Valid':'Geometry Invalid；保留待修复 Draft'}`);
      }else setSaveNotice(`Revalidate Geometry：revision ${target.revision} · ${report.valid?'Geometry Valid':'Geometry Invalid；保留 Draft'}`);
      setError(report.valid?'':'严格复验失败：'+report.issues.filter(i=>i.severity==='error').map(i=>i.message).join('；'));
    } catch(e) {setError(String(e))}
  }
  function reloadSaved() {
    if (!allowReplace()) return
    try {
      const saved = loadDraft3D(localStorage); if (!saved.assembly) throw Error('尚未保存 3D Draft')
      setPhotoOrigin(loadPhotoOrigin(localStorage));expectedRaw.current = saved.raw; accept(actions.createInitialHistory(saved.assembly)); setClean(saved.raw!)
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
        <div className="magnetic-3d-toolbar" aria-label="3D Assembly 工具栏">
          <header className="magnetic-3d-toolbar-row"><div className="magnetic-3d-toolbar-title"><h2>作品编辑（Assembly）</h2><span className="hint" title={loaded.name}>{photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?`照片 · ${String(photoOrigin.origin.sourceId).slice(0,8)}`:loaded.isDraft?'3D Draft':'3D 查看'}</span></div>
           <div className="magnetic-3d-edit-toggle" role="group" aria-label="3D View / Edit"><button disabled={operationBusy} aria-pressed={!editing} onClick={()=>{setLive(null);setEditing(false)}}>View</button><button disabled={operationBusy} aria-pressed={editing} onClick={startEdit}>{loaded.isDraft?'Edit Draft':'从当前作品创建 Draft'}</button><button disabled={operationBusy} onClick={()=>{fileRequest.current++;load(loaded.source,loaded.name)}}>重新加载来源</button></div>
          </header>
          <div className="magnetic-3d-toolbar-row"><p className="magnetic-3d-summary" role="status"><span>{assembly.pieces.length} 片 · {assembly.connections.length} 条连接 · </span><span className={!validation.valid?'magnetic-3d-blocker':undefined}>{validation.valid?geometryGate.repair&&!geometryGate.current?'几何预检查通过 · 尚未复验':'几何校验通过 · Geometry Valid':'Geometry Invalid'}</span>{loaded.isDraft&&<span> · {dirty?'未保存':'Draft'}</span>}</p>
           <div className="magnetic-3d-display-tools"><label><input type="checkbox" checked={showTileIds} onChange={e=>setShowTileIds(e.target.checked)}/>显示 Tile ID</label>{editing&&<label className="magnetic-3d-snap-switch">吸附方式<select aria-label="3D 吸附方式" value={snapMode} disabled={operationBusy} onChange={e=>{const mode=e.target.value as 'drag'|'click';setPendingSnap(null);setSnapMode(mode);setTool(mode==='drag'?'snap':'select')}}><option value="drag">拖动吸附</option><option value="click">点击吸附</option></select></label>}</div>
          </div>
        </div>
        {active && (editing ? <ViewerErrorBoundary key={`edit-${loaded.sequence}`}><EditorCanvas project={project} selection={selection} toolMode={tool} showTileIds={showTileIds}
          onSelectPiece={id => { if (!live&&!pendingSnap) setSelection({ kind: 'piece', id }) }}
          onSelectConnection={index => { if (!live&&!pendingSnap) setSelection({ kind: 'connection', index }) }}
          onSelectPort={(id,portId)=>{if(operationBusy)return;if(snapMode==='click'&&selected&&id!==selected){prepareSnap({pieceA:id,portA:portId,pieceB:selected,portB:ownPort,...snapSettings});return}setSelection({kind:'piece',id});setOwnPort(portId)}}
          onClearSelection={() => { if (!live&&!pendingSnap) setSelection({ kind: 'none' }) }} focusRequest={null} fitRequest={null}
          onMovePiece={(pieceId, tf) => setLive({ pieceId, tf })}
          onMovePieceCommit={(id, tf) => apply(h => actions.setPieceTransformAction(h, id, tf))}
          onCreateConnection={prepareSnap} onSnapProposal={prepareSnap} onMovePieceCancel={()=>setLive(null)} snapCandidates={[snapSettings]} snapSourcePort={ownPort} showSnapTargets={snapMode==='click'} interactionLocked={!!pendingSnap} snapGhost={pendingSnap?{pieceId:pendingSnap.connection.pieceB,tf:pendingSnap.assembly.pieces.find(p=>p.id===pendingSnap.connection.pieceB)!.pose}:null}
          cameraTargetRef={cameraTargetRef} liveTransformOverride={live} initialCameraView={initialCameraView} onCameraViewChange={setEditorCamera}/></ViewerErrorBoundary>
          : <MagnetScene3D key={loaded.sequence} assembly={assembly} selected={selected} onSelect={setSelected} showTileIds={showTileIds} selectedConnection={selectedConnection} initialCameraView={initialCameraView}/>)}
        {editing&&<details><summary>相机状态</summary><output aria-label="3D Editor 相机状态">{JSON.stringify(editorCamera)}</output></details>}
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
        <header className="magnetic-3d-inspector-title"><h3>3D Inspector</h3><InfoHint label="3D Inspector">
          <p>{editing ? (snapMode==='drag'?'拖动吸附：选择零件，拖动 Gizmo 靠近兼容边，松手后确认或取消。没有候选时保留原位；自由移动/旋转可使用 Edit Tools。':'点击吸附：选择源零件 B 及其连接边，再点击目标 A 的兼容边或在右栏指定，预览后确认。') : 'View 只读：点击画布或表格查看。'}</p>
          <p>已连接零件需要移动时，请先明确解除连接。手动移动只修改 Pose；吸附与显式求解才沿约束重新放置。WASDQE 移动，RTFGVB 旋转，Shift 大步；Undo / Redo 可恢复编辑。</p>
          <p>连接使用当前 Assembly 中的索引 # 作为身份；两端表格按钮指向同一条连接。标签被其他零件遮挡时隐藏，选中标签仍保留并使用虚线；标签不拦截鼠标。</p>
          <p>几何校验不代表真实磁力或物理稳定性保证。Invalid Draft 可保存继续编辑，不能作为合法 Assembly 或进入 Build。</p>
        </InfoHint></header>
        <section className="magnetic-3d-geometry-check" aria-label="Geometry Check"><h4>Geometry Check</h4>
          <p role="status"><b className={!validation.valid?'magnetic-3d-blocker':undefined}>{!validation.valid?'Geometry Invalid':geometryGate.repair&&!geometryGate.current?'Needs Revalidation':'Geometry Valid'}</b><br/>Revision {assembly.revision} · {assembly.pieces.length} 片 · {assembly.connections.length} 条连接</p>
          <button disabled={operationBusy} onClick={()=>void revalidate()}>Revalidate Geometry</button>
          {!!geometryErrors.length&&<p className="magnetic-3d-blocker">{geometryErrors.length} 个错误 · {geometryErrors[0].message}</p>}
          {geometryGate.repair&&<div aria-label="待修复 Draft 几何状态"><b>Diagnostic 来源 · 待修复 Draft</b><p data-testid="repair-draft-status" role={geometryGate.blocker?'alert':'status'}>{geometryGate.blocker??'当前 Draft Revision / Hash 已通过 Revalidate Geometry，可进入 Build。'} 原始碰撞错误保留在照片来源记录中。</p></div>}
          <details onToggle={e=>setShowGeometryDetails(e.currentTarget.open)}><summary>详细几何 / Collision Diagnostic · {validation.issues.length}</summary>
            <p>{assembly.id} · revision {assembly.revision}</p>
            {validation.issues.length?<ul>{validation.issues.map((issue,i)=><li key={i} className={issue.severity==='error'?'magnetic-3d-blocker':undefined}>{issue.message}</li>)}</ul>:<p>保存位姿满足当前连接与碰撞检查。</p>}
            {!!collisionDetails.length&&<details><summary>碰撞空间证据 / Raw</summary><pre>{JSON.stringify(collisionDetails,null,2)}</pre></details>}
          </details>
        </section>
        {pendingSnap&&<section className="magnetic-3d-snap-preview" aria-label="3D 吸附预览"><h4>吸附预览 · 尚未修改 Draft</h4><p>{pendingSnap.connection.pieceB}:{pendingSnap.connection.portB} → {pendingSnap.connection.pieceA}:{pendingSnap.connection.portA}<br/>{pendingSnap.connection.dihedralDeg}° · flip {String(pendingSnap.connection.flip??false)}</p><p>仅移动源零件 B；不修改其他零件或原连接。{pendingSnap.geometry.valid?'预览几何校验通过。':'现有 Invalid 问题仍保留，不能作为正式有效作品。'}</p><button onClick={confirmSnap}>确认吸附</button><button onClick={()=>{setPendingSnap(null);setLive(null)}}>取消吸附</button></section>}
        <div className="magnetic-3d-draft-tools">
          {editing && <><button disabled={operationBusy || !history.past.length} onClick={() => { apply(actions.undo); setSelection({ kind: 'none' }) }}>3D Undo</button>
            <button disabled={operationBusy || !history.future.length} onClick={() => { apply(actions.redo); setSelection({ kind: 'none' }) }}>3D Redo</button>
            <button disabled={operationBusy || !!boot.error} onClick={save}>保存 3D Draft</button></>}
        </div>
        {saveNotice && <p className="magnetic-3d-save-notice" role="status">{saveNotice}</p>}
        {error && <div><p role="alert">{error.length>200?error.slice(0,200)+'…':error}</p>{error.length>200&&<details><summary>操作错误详情</summary><p>{error}</p></details>}</div>}
        <AssemblySelectionTable assembly={assembly} selection={selection} select={setSelection} busy={operationBusy}/>
        <EditorInspector editing={editing} selectionInfo={<>
        {chosen ? <div className="magnetic-3d-piece-info" data-selected-3d-piece={chosen.id}>
          <h4>{chosen.id}</h4><dl><dt>Profile</dt><dd>{chosen.shape.id} · {chosen.profile.profile.name}</dd>
            <dt>颜色</dt><dd><span className="magnetic-3d-swatch" style={{ background: chosen.color }}/>{chosen.color}{!chosen.piece.color && '（默认）'}</dd>
            <dt>厚度</dt><dd>{format(chosen.shape.thickness)}（世界单位）</dd></dl>
          <details><summary>保存的 Pose / Profile 规格</summary><dl>
            <dt>位置 XYZ</dt><dd data-3d-position={JSON.stringify(chosen.piece.pose.position)}>{chosen.piece.pose.position.map(format).join(', ')}</dd>
            <dt>旋转 XYZ（度）</dt><dd>{rotationDegrees(chosen.piece.pose.quaternion).map(format).join(', ')}</dd>
            <dt>四元数 XYZW</dt><dd data-3d-quaternion={JSON.stringify(chosen.piece.pose.quaternion)}>{chosen.piece.pose.quaternion.map(format).join(', ')}</dd>
            <dt>边长</dt><dd>{chosen.shape.edges.map(e => format(e.length)).join(' / ')}</dd>
            <dt>Profile 缩放</dt><dd>{chosen.profile.scale ?? 1}</dd></dl></details>
        </div> : selectedConnection ? <div data-selected-3d-connection={selection.kind==='connection'?selection.index:''}><h4>Connection #{selection.kind==='connection'?selection.index:''}</h4><dl>
          <dt>A / Port</dt><dd>{selectedConnection.pieceA} · {selectedConnection.portA}</dd><dt>B / Port</dt><dd>{selectedConnection.pieceB} · {selectedConnection.portB}</dd>
          <dt>Dihedral / Flip</dt><dd>{selectedConnection.dihedralDeg}° · {String(selectedConnection.flip??false)}</dd>
        </dl></div> : <p className="hint">点击画布或表格选择 Tile / Connection。</p>}
        {chosen&&<div className="magnetic-3d-related-connections">{assembly.connections.map((c,i)=>c.pieceA===chosen.id||c.pieceB===chosen.id?<button key={i} disabled={operationBusy} onClick={()=>setSelection({kind:'connection',index:i})}>连接 #{i} · {c.pieceA} ↔ {c.pieceB}</button>:null)}</div>}
        </>} globalTools={<div className="button-row"><button disabled={operationBusy} onClick={blank}>新建空白 3D Draft</button><button disabled={operationBusy} onClick={reloadSaved}>重新加载已保存 Draft</button></div>}
          assembly={current} project={project} profiles={profiles} selection={selection} ownPort={ownPort}
          setOwnPort={setOwnPort} apply={apply} select={setSelection} busy={operationBusy} tool={tool} setTool={next=>{setTool(next);if(next==='snap')setSnapMode('drag')}} onPreviewSnap={prepareSnap} snapSettings={snapSettings} setSnapSettings={setSnapSettings}/>
        {photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id&&<details className="visible3d-origin"><summary>照片来源与快照</summary><p>Source {photoOrigin.origin.sourceId as string} · {photoOrigin.assemblyRaw===serializeAssembly3D(current)?'采用时快照一致':'已编辑，原照片关联仅供追溯'}</p><p>Geometry Valid 与照片匹配独立；来源记录 {photoOrigin.origin.id as string}</p><pre>{JSON.stringify(photoOrigin.origin,null,2)}</pre></details>}
        <details className="magnetic-3d-examples-debug"><summary>Examples / Debug</summary><p className="hint">开发示例；加载会替换当前查看内容，不属于正式 Tiles Catalog。当前来源：{loaded.name}</p><div className="magnetic-3d-examples" role="group" aria-label="3D 示例">{examples.map(example=><button key={example.id} disabled={operationBusy} data-3d-example={example.id} aria-pressed={assembly.id===example.id} onClick={()=>{fileRequest.current++;load(JSON.stringify(example.data,null,2),example.name)}}>{example.name}</button>)}</div><p>{componentCount(assembly)} 个组件 · revision {assembly.revision}</p></details>
      </section>
    </StudioSlot>
  </>
}

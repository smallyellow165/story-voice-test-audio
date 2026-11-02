import {ModuleTransformPanel} from './ModuleTransformPanel.tsx'
import type {ModuleTool} from './ModuleTransformPanel.tsx'
import {modulePivot,pivotDelta,transformModule,confirmModulePreview,previewModuleTransform} from './module-transform.ts'
import type {ModulePreview} from './module-transform.ts'
import {geometryIssueReferences} from './reconstruction/diagnostic-visual.ts'
import {PendingObservations} from './reconstruction/PendingObservations.tsx';
import {placePendingObservation} from './reconstruction/pending-observations.ts';
import type {PendingObservation} from './reconstruction/pending-observations.ts';
import {intakeApi} from '../intake/api.ts'
import {createPortal} from 'react-dom'
import {arrangeAssemblyDisplays,readAssemblyVisibility,saveAssemblyVisibility} from './multi-assembly-display.ts'
import type {AssemblyVisibility,ReadOnlyPieceSelection} from './multi-assembly-display.ts'
import {preserveSavedAssembly,saveAssemblySnapshot,restoreAssemblySnapshot,groupSnapshot,savedAssemblyRef} from './assembly-library.ts'
import type {SavedAssembly,SavedAssemblySummary} from './assembly-library.ts'
import {restoreSavedHumanReview} from './human-collision-client.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StudioSlot, useStudio } from '../StudioLayout.tsx'
import {assertCanonicalProfiles} from './canonical-geometry.ts'
import { parseAssembly3D, serializeAssembly3D } from './assembly.ts'
import { validateAssembly3D,inspectAssemblyCollisions } from './engine-adapter.ts'
import { componentCount, createViewerModel, rotationDegrees } from './viewer-model.ts'
import { MagnetScene3D, ViewerErrorBoundary } from './vendor/components/MagnetScene3D.tsx'
import { useProfileRegistry } from '../ProfileRegistry.tsx'
import { canonical } from '../build-plan.ts'
import type { Assembly3D,Pose3D } from './assembly.ts'
import type { EditorHistory } from './vendor/editor/state.ts'
import * as actions from './vendor/editor/state.ts'
import { createShapeCatalog } from './profile-adapter.ts'
import { editorProject } from './editor-project.ts'
import type { Selection } from './editor-project.ts'
import { EditorCanvas } from './vendor/components/editor/EditorCanvas.tsx'
import type { ToolMode } from './vendor/components/editor/EditorCanvas.tsx'
import {InfoHint} from '../../brick-vision/InfoHint.tsx'
import {useHumanCollisionReview} from './useHumanCollisionReview.ts'
import {hasHumanReview} from './human-collision-client.ts'
import {collisionReviewPolicy,collisionErrorKey} from './human-collision-policy.ts'
import {collisionVisual,collisionPairKey,collisionLocality} from './collision-visual.ts'
import type {CollisionFocus} from './CollisionOverlay.tsx'
import {SymmetryFillPanel} from './SymmetryFillPanel.tsx'
import {confirmSymmetryFill} from './symmetry-fill.ts'
import type {SymmetryFillPreview} from './symmetry-fill.ts'
import {useAssemblyAngleHints} from './useAssemblyAngleHints.ts'
import {AutoConstraintRepairPanel} from './AutoConstraintRepairPanel.tsx'
import type {RepairPreview} from './AutoConstraintRepairPanel.tsx'
import {confirmConstraintRepair} from './constraint-repair.ts'
import type {RepairCandidate,RepairResult} from './constraint-repair.ts'
import {AssemblyAngleHints} from './AssemblyAngleHints.tsx'
import {AssemblySelectionTable} from './AssemblySelectionTable.tsx'
import { EditorInspector } from './EditorInspector.tsx'
import { DRAFT_3D_KEY,DRAFT_COLLISION_POLICY_KEY,loadDraftCollisionPolicy,loadDraft3D, saveDraft3D } from './draft-storage.ts'
import type {CameraView3D} from './camera-view.ts'
import type {PhotoOrigin3D} from './reconstruction/adopt-draft.ts'
import {PHOTO_ORIGIN_3D_KEY,adoptReconstructionDraft,loadPhotoOrigin,photoDraftGeometryGate,revalidatePhotoDraft} from './reconstruction/adopt-draft.ts'
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
const depthFormat=(n:number)=>Number(n.toPrecision(6)).toString()
export default function ThreeDWorkspace() {
  const { stage, viewMode, setAssembly3D, adoption3D, clearAdoption3D, navigate, showInspector, project3D, setAssemblyOrigin3D, hosts } = useStudio()
  const active = stage === 'assembly' && viewMode === '3d'
  const { registry: { profiles } } = useProfileRegistry()
  const [boot] = useState(() => {
    try { const saved = loadDraft3D(localStorage); return { ...saved,...loadDraftCollisionPolicy(localStorage,saved.assembly,saved.raw), error: '' } }
    catch (e) { return { assembly: null, raw: null, policyRaw:null, nonRepairable:[] as string[], error: `原 3D 草稿无法读取，已禁止覆盖：${String(e)}` } }
  })
  const [history, setHistory] = useState(() => actions.createInitialHistory(boot.assembly ?? parseAssembly3D(initial),boot.nonRepairable))
  const historyRef = useRef(history); historyRef.current = history
  const [loaded, setLoaded] = useState(() => ({ source: boot.raw ?? initial, name: boot.assembly ? '已保存的 3D Draft' : examples[0].name, sequence: 0 }))
  const [text, setText] = useState(boot.raw ?? initial), [error, setError] = useState(boot.error)
  const [selection, setSelection] = useState<Selection>({ kind: 'none' })
  const [showTileIds,setShowTileIds]=useState(true)
  const [showGeometryDetails,setShowGeometryDetails]=useState(false)
  const [collisionFocus,setCollisionFocus]=useState<CollisionFocus>(null)
  const [errorFocus,setErrorFocus]=useState<{pieceId:string;ts:number}|null>(null)
  const [assemblyIO,setAssemblyIO]=useState(false),[savedAssemblies,setSavedAssemblies]=useState<SavedAssemblySummary[]>([]),[libraryError,setLibraryError]=useState('')
  const [displayPreferences,setDisplayPreferences]=useState<{projectId:string;values:AssemblyVisibility}>({projectId:'',values:{}}),[displayError,setDisplayError]=useState('')
  const [displaySnapshots,setDisplaySnapshots]=useState<{projectId:string;records:SavedAssembly[]}>({projectId:'',records:[]}),[readOnlySelection,setReadOnlySelection]=useState<ReadOnlyPieceSelection>(null)
  const archiveQueue=useRef<Promise<unknown>>(Promise.resolve()),projectRef=useRef(project3D);projectRef.current=project3D
  const [editing, setEditing] = useState(true), [tool, setTool] = useState<ToolMode>('snap'), [ownPort, setOwnPort] = useState('e0-p0')
  const [snapMode,setSnapMode]=useState<'drag'|'click'>('drag'),[snapSettings,setSnapSettings]=useState({dihedralDeg:90,flip:false})
  const [repairSearching,setRepairSearching]=useState(false),[repairPreview,setRepairPreview]=useState<RepairPreview|null>(null),[repairTargets,setRepairTargets]=useState<string[]>([])
  const [pendingSnap,setPendingSnap]=useState<EdgeSnapPreview|null>(null)
  const [symmetryOpen,setSymmetryOpen]=useState(false),[symmetrySources,setSymmetrySources]=useState<string[]>([]),[symmetryPreview,setSymmetryPreview]=useState<SymmetryFillPreview|null>(null)
  const symmetryPieces=useMemo(()=>symmetryPreview?createViewerModel(symmetryPreview.assembly).filter(p=>symmetryPreview.addedIds.includes(p.id)):undefined,[symmetryPreview])
  const [moduleFit,setModuleFit]=useState<{ts:number}|null>(null)
  const [moduleToolOpen,setModuleToolOpen]=useState(false),[moduleTool,setModuleTool]=useState<ModuleTool>({fixed:'module-0',moving:'module-1',face:'',space:'global',mode:'translate'}),[moduleLive,setModuleLive]=useState<Assembly3D|null>(null),[modulePreview,setModulePreview]=useState<ModulePreview|null>(null)
  const [live, setLive] = useState<{ pieceId: string; tf: Pose3D } | null>(null)
  const [clean, setClean] = useState(() => serializeAssembly3D(history.current)), [saveNotice, setSaveNotice] = useState('')
  const [cleanPolicy,setCleanPolicy]=useState(()=>canonical(boot.nonRepairable))
  const expectedPolicyRaw=useRef<string|null>(boot.policyRaw)
  const expectedRaw = useRef(boot.raw), fileRequest = useRef(0), cameraTargetRef = useRef(new Vector3())
  const [photoOrigin,setPhotoOrigin]=useState<PhotoOrigin3D|null>(()=>loadPhotoOrigin(localStorage))
  const [editorCamera,setEditorCamera]=useState<CameraView3D|null>(null)
  useEffect(()=>{
    if(!adoption3D)return
    void (async()=>{setAssemblyIO(true);try{
      if(viewMode!=='3d')throw Error('当前已切换至 2D；3D 候选未载入。')
      if(!allowReplace())throw Error('已取消替换当前 3D Draft；原草稿保留。')
      if(boot.error)throw Error(boot.error)
      await protectSavedWorking();
      setEditorCamera(adoption3D.cameraView??null);
      const assembly=parseAssembly3D(JSON.stringify(adoption3D.assembly));assertCanonicalProfiles(assembly.profiles,profiles);const {raw,sidecar}=adoptReconstructionDraft(localStorage,assembly,adoption3D.origin,expectedRaw.current,adoption3D.cameraView)
      expectedRaw.current=raw;expectedPolicyRaw.current=localStorage.getItem(DRAFT_COLLISION_POLICY_KEY);setCleanPolicy(canonical([]))
      accept(actions.createInitialHistory(assembly));setClean(raw);setText(raw);setPhotoOrigin(sidecar)
      setLoaded(old=>({source:raw,name:adoption3D.origin.entryMode==='human-accepted-diagnostic'?'Human Accepted Diagnostic':adoption3D.origin.entryMode==='diagnostic-override'?'Visible 3D · 待修复 Draft':'Visible 3D · 人工采用的候选 Draft',sequence:old.sequence+1}));setSelection({kind:'none'});setEditing(true);setError('')
      // Navigate from the receiver's current context only after CAS persistence
      // and editor state setup succeeded; an async sender may hold old context.
      navigate('assembly');adoption3D.complete()
    }catch(e){setError(String(e));adoption3D.complete(e)}finally{setAssemblyIO(false);clearAdoption3D();void refreshAssemblies().catch(e=>setLibraryError(String(e)))}})()
  },[adoption3D])
  const current = history.current
  const profileError=useMemo(()=>{try{assertCanonicalProfiles(current.profiles,profiles);return ''}catch(e){return String(e)}},[current.profiles,profiles])
  const nonRepairable=actions.currentNonRepairable(history)
  const angleHints=useAssemblyAngleHints(current,photoOrigin,active)
  const currentRepair=repairPreview?.sourceRaw===serializeAssembly3D(current)?repairPreview:null
  const humanDiagnosticSource=photoOrigin?.origin.entryMode==='human-accepted-diagnostic'&&JSON.parse(photoOrigin.assemblyRaw).id===current.id
  const humanReview=useHumanCollisionReview(current,active,true)
  const operationBusy=assemblyIO||!!moduleLive||!!modulePreview||!!live||!!pendingSnap||!!symmetryPreview||repairSearching||!!currentRepair
  const initialCameraView=photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?photoOrigin.cameraView:undefined
  useEffect(() => setAssembly3D(current), [current, setAssembly3D])
  useEffect(()=>{setAssemblyOrigin3D(photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?photoOrigin.origin:null)},[photoOrigin,current.id,setAssemblyOrigin3D])
  useEffect(()=>{let alive=true;setSavedAssemblies([]);void protectSavedWorking().then(async r=>{if(!alive)return;if(r&&serializeAssembly3D(historyRef.current.current)===serializeAssembly3D(r.snapshot.assembly))setLibraryError(r.lineage.selected?'':`来源不匹配：${r.lineage.error}；Draft 可查看，Build 仍受来源校验。`);if(r?.reviewRef&&r.lineage.selected&&serializeAssembly3D(historyRef.current.current)===serializeAssembly3D(r.snapshot.assembly))await restoreSavedHumanReview(r.snapshot.assembly,r.hash);await refreshAssemblies()}).catch(e=>{if(alive){setLibraryError(String(e));void refreshAssemblies().catch(()=>{})}});return()=>{alive=false}},[project3D?.id])
  const visibility=displayPreferences.projectId===project3D?.id?displayPreferences.values:{[current.id]:true}
  const activeVisible=visibility[current.id]!==false
  useEffect(()=>{
    if(!project3D){setDisplayPreferences({projectId:'',values:{}});return}
    try{setDisplayPreferences({projectId:project3D.id,values:readAssemblyVisibility(localStorage,project3D.id,historyRef.current.current.id)});setDisplayError('')}
    catch(e){setDisplayPreferences({projectId:project3D.id,values:{[historyRef.current.current.id]:true}});setDisplayError(String(e))}
  },[project3D?.id])
  const visibleSavedKey=JSON.stringify(savedAssemblies.filter(a=>a.id!==current.id&&visibility[a.id]).map(a=>[a.id,a.hash]))
  useEffect(()=>{
    let alive=true;const p=project3D?.id
    const wanted=savedAssemblies.filter(a=>a.id!==current.id&&visibility[a.id])
    void Promise.all(wanted.map(async a=>{const r=await intakeApi<SavedAssembly>('assembly3d/records/'+a.id);if(r.project.id!==p||r.hash!==a.hash)throw Error('显示作品的 Project / Snapshot 已变化，请重新打开或保存作品');assertCanonicalProfiles(r.snapshot.assembly.profiles,profiles);return r})).then(records=>{if(alive)setDisplaySnapshots({projectId:p??'',records})}).catch(e=>{if(alive){setDisplaySnapshots({projectId:p??'',records:[]});setDisplayError(String(e))}})
    return()=>{alive=false}
  },[project3D?.id,current.id,visibleSavedKey])
  // Freeze the initial placement envelope per opened document, not per Gizmo frame.
  const displayAnchor=useMemo(()=>current,[current.id,loaded.sequence])
  const readOnlyAssemblies=useMemo(()=>arrangeAssemblyDisplays(displayAnchor,displaySnapshots.projectId===project3D?.id?displaySnapshots.records.filter(r=>r.assembly.id!==current.id&&visibility[r.assembly.id]&&savedAssemblies.some(a=>a.id===r.assembly.id&&a.hash===r.hash)).map(r=>({id:r.assembly.id,name:r.name,snapshotHash:r.snapshotHash,assembly:r.snapshot.assembly})):[]),[displayAnchor,displaySnapshots,project3D?.id,visibility,savedAssemblies,current.id])
  useEffect(()=>{setReadOnlySelection(null)},[current.id])
  useEffect(()=>{if(selection.kind!=='none')setReadOnlySelection(null)},[selection])
  function setAssemblyVisible(id:string,visible:boolean){
    const p=projectRef.current;if(!p)return
    const values={...(displayPreferences.projectId===p.id?displayPreferences.values:{[historyRef.current.current.id]:true}),[id]:visible}
    setDisplayPreferences({projectId:p.id,values});setReadOnlySelection(null);if(id===historyRef.current.current.id&&!visible)setSelection({kind:'none'})
    try{saveAssemblyVisibility(localStorage,p.id,values);setDisplayError('')}catch(e){setDisplayError(`显示状态仅在本页生效：${String(e)}`)}
  }
  function inspectReadOnly(assemblyId:string,pieceId:string){if(operationBusy)return;setSelection({kind:'none'});setReadOnlySelection({assemblyId,pieceId})}
  const dirty = (serializeAssembly3D(current) !== clean || canonical(nonRepairable)!==cleanPolicy)
  const assembly = useMemo(() => live ? { ...current, pieces: current.pieces.map(p => p.id === live.pieceId ? { ...p, pose: live.tf } : p) } : current, [current, live])
  const snapshotKey=useMemo(()=>`${loaded.sequence}:${serializeAssembly3D(assembly)}`,[loaded.sequence,assembly])
  const selected = selection.kind === 'piece' ? selection.id : null
  const setSelected = (id: string | null) => { if (!operationBusy) setSelection(id ? { kind: 'piece', id } : { kind: 'none' }) }
  const items = useMemo(() => createViewerModel(assembly), [assembly])
  const validation = useMemo(() => validateAssembly3D(assembly), [assembly])
  const geometryGate=useMemo(()=>photoDraftGeometryGate(assembly,photoOrigin,validation),[assembly,photoOrigin,validation])
  const selectedConnection=selection.kind==='connection'?assembly.connections[selection.index]:undefined
  const geometryErrors=validation.issues.filter(i=>i.severity==='error')
  const reviewPolicy=useMemo(()=>collisionReviewPolicy(assembly,validation),[assembly,validation])
  const reviewedCount=reviewPolicy.keys.filter(k=>humanReview.state?.acceptedKeys.includes(k)).length
  const allReviewed=reviewPolicy.keys.length>0&&reviewedCount===reviewPolicy.keys.length
  const collisionIssues=useMemo(()=>validation.issues.filter(i=>i.severity==='error'&&i.code==='intersection'),[validation])
  const selectedCollision=useMemo(()=>{
    if(!active||operationBusy||selection.kind!=='collision'||selection.sourceKey!==snapshotKey)return undefined
    const issue=collisionIssues.find(i=>i.relatedPieceIds&&collisionPairKey(i.relatedPieceIds)===selection.key)
    if(!issue)return undefined
    // Ask the existing evidence function only for the selected issue. The strict report remains untouched.
    const evidence=inspectAssemblyCollisions(assembly,{...validation,issues:[issue]})[0]
    return evidence?collisionVisual(evidence,snapshotKey):undefined
  },[active,operationBusy,selection,snapshotKey,collisionIssues,assembly,validation])
  const collisionDetails=useMemo(()=>showGeometryDetails?inspectAssemblyCollisions(assembly,validation):[],[showGeometryDetails,assembly,validation])
  const chosen = items.find(p => p.id === selected)
  const profileSignature = canonical(current.profiles)
  const catalog = useMemo(() => createShapeCatalog(current.profiles), [profileSignature])
  const shapes = useMemo(() => new Map([...catalog].map(([key, item]) => [key, item.shape])), [catalog])
  const project = useMemo(() => ({ ...editorProject(current, catalog), shapes }), [current, catalog, shapes])
  const repairProject=useMemo(()=>currentRepair?{...editorProject(currentRepair.candidate.assembly,catalog),shapes}:null,[currentRepair,catalog,shapes])
  useEffect(()=>{setModuleToolOpen(!!current.modules);setModulePreview(null);setModuleLive(null);if(current.modules){const fixed=current.modules[0],moving=current.modules[1],joint=[...current.connections].reverse().find(c=>fixed.pieces.some(p=>p.id===c.pieceA)&&moving.pieces.some(p=>p.id===c.pieceB));setModuleTool({fixed:fixed.id,moving:moving.id,face:joint?.pieceB??moving.pieces[0].id,space:'global',mode:'translate'})}},[current.id])
  const moduleProject=useMemo(()=>moduleLive||modulePreview?{...editorProject(moduleLive??modulePreview!.assembly,catalog),shapes}:null,[moduleLive,modulePreview,catalog,shapes])
  const modulePivotPose=useMemo(()=>{if(!moduleToolOpen||!current.modules||moduleTool.fixed===moduleTool.moving||modulePreview)return undefined;try{return modulePivot(current,moduleTool.moving,moduleTool.space,moduleTool.face||current.modules.find(m=>m.id===moduleTool.moving)?.pieces[0].id)}catch{return undefined}},[current,moduleToolOpen,moduleTool,modulePreview])
  function applyModule(preview:ModulePreview){try{const next=confirmModulePreview(historyRef.current.current,preview);accept(actions.commit(historyRef.current,()=>next));setError('');setSaveNotice('模块操作已应用；内部连接保持不变，新增 / 变化错误仍需审核。')}catch(e){setModuleLive(null);setModulePreview(null);setError(String(e))}}
  const moduleGizmo=modulePivotPose?{pose:modulePivotPose,mode:moduleTool.mode,onCancel:()=>setModuleLive(null),onChange:(target:Pose3D,commit:boolean)=>{try{const next=transformModule(current,moduleTool.moving,pivotDelta(modulePivotPose,target));if(commit)applyModule(previewModuleTransform(current,next));else setModuleLive(next)}catch(e){setModuleLive(null);setError(String(e))}}}:undefined
  async function createCombined(name:string,ids:string[]){
    if(operationBusy||!allowReplace())return
    setAssemblyIO(true)
    try{await protectSavedWorking();const parents=ids.map(id=>{const a=savedAssemblies.find(a=>a.id===id);if(!a)throw Error('请选择当前 Project 已保存的作品');return a});const r=await intakeApi<SavedAssembly>('assembly3d/combine',{name,parents:parents.map(a=>({id:a.id,hash:a.hash,version:a.version}))});await openSavedAssembly(r.assembly.id,true)}finally{setAssemblyIO(false);await refreshAssemblies()}
  }
  const repairCollision=useMemo(()=>{if(!currentRepair)return undefined;const issue=currentRepair.candidate.geometry.issues.find(i=>i.code==='intersection');if(!issue)return undefined;const evidence=inspectAssemblyCollisions(currentRepair.candidate.assembly,{...currentRepair.candidate.geometry,issues:[issue]})[0];return evidence?collisionVisual(evidence,'repair-preview:'+currentRepair.candidate.id):undefined},[currentRepair])
  async function applyConstraintRepair(result:RepairResult,candidate:RepairCandidate){
    if(!editing||!angleHints.source)throw Error('当前不是可编辑的有效来源，未应用修复')
    if(localStorage.getItem(DRAFT_COLLISION_POLICY_KEY)!==expectedPolicyRaw.current)throw Error('保存的不可修复标记已被其他页面更新，请重新加载 Draft')
    if(!photoOrigin)throw Error('缺少当前 Selected 来源');
    await intakeApi('visible3d/selected-origin/'+String(photoOrigin.origin.id));
    const next=confirmConstraintRepair(historyRef.current,angleHints.source,result,candidate,actions.currentNonRepairable(historyRef.current))
    accept(next);setError('');setSaveNotice(candidate.geometry.valid?'自动修复已应用；Geometry Valid，尚未保存 Draft。':'已应用部分改善；Geometry Invalid 仍保留，变化的错误需按现有流程重新审核。')
  }
  function locateGeometryError(issue:typeof validation.issues[number]){
    if(operationBusy)return
    if(issue.code==='intersection'&&issue.relatedPieceIds){
      const evidence=inspectAssemblyCollisions(assembly,{...validation,issues:[issue]})[0]
      setSelection({kind:'collision',key:collisionPairKey(issue.relatedPieceIds),sourceKey:snapshotKey})
      if(evidence)setCollisionFocus({target:collisionVisual(evidence,snapshotKey),sequence:Date.now()})
      return
    }
    const refs=geometryIssueReferences(assembly,issue)
    if(refs.connectionIndices.length)setSelection({kind:'connection',index:refs.connectionIndices[0]})
    else if(refs.pieceIds[0])setSelection({kind:'piece',id:refs.pieceIds[0]})
    if(refs.pieceIds[0])setErrorFocus({pieceId:refs.pieceIds[0],ts:Date.now()})
  }
  function accept(next: EditorHistory,restoring=false) { setModuleLive(null);setModulePreview(null); const geometryChanged=canonical(next.current)!==canonical(historyRef.current.current);setRepairPreview(null);setRepairTargets(ids=>geometryChanged?[]:ids.filter(id=>!actions.currentNonRepairable(next).includes(id))); setErrorFocus(null);setSymmetryPreview(null);setSymmetryOpen(false);setSymmetrySources([]); if(!restoring&&next.current.id===historyRef.current.current.id&&canonical(next.current)!==canonical(historyRef.current.current))humanReview.noteMutation(next.current);setSelection(s=>geometryChanged&&s.kind==='collision'?{kind:'none'}:s);if(geometryChanged)setCollisionFocus(null);historyRef.current = next; setHistory(next); setLive(null);setPendingSnap(null); setSaveNotice('') }
  function apply(action: (h: EditorHistory) => EditorHistory) {
    if (!editing) return
    try { accept(action(historyRef.current)); setError('') } catch (e) { setError(String(e)); setLive(null) }
  }
  useEffect(() => { if(active)setEditing(true);else{setModuleLive(null);setModulePreview(null);setRepairPreview(null);setRepairSearching(false);setRepairTargets([]);setSymmetryPreview(null);setSymmetryOpen(false);setLive(null);setPendingSnap(null);setSelection(s=>s.kind==='collision'?{kind:'none'}:s);setCollisionFocus(null)} }, [active])
  useEffect(()=>{if(selection.kind==='collision'&&!selectedCollision){setSelection({kind:'none'});setCollisionFocus(null)}},[selection,selectedCollision])
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setModuleLive(null);setModulePreview(null);setRepairPreview(null);setSymmetryPreview(null);setPendingSnap(null);setLive(null)}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[])
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
  function confirmFill(){
    if(!symmetryPreview||!editing)return
    let prior:string|null=null,written:string|null=null
    try{
      const next=confirmSymmetryFill(historyRef.current,symmetryPreview)
      // Reuse the existing photo-origin sidecar for hypothesis provenance only.
      // The immutable origin and Assembly schema remain unchanged.
      let origin=photoOrigin
      if(origin&&JSON.parse(origin.assemblyRaw).id===current.id){
        prior=localStorage.getItem(PHOTO_ORIGIN_3D_KEY)
        if(canonical(loadPhotoOrigin(localStorage))!==canonical(origin))throw Error('照片来源已被其他页面更新，未加入补全')
        origin={...origin,symmetryFills:[...(origin.symmetryFills??[]),{sourceIds:symmetryPreview.request.sourceIds,addedIds:symmetryPreview.addedIds,plane:symmetryPreview.request.plane,sourceRevision:current.revision,addedRevision:next.current.revision}]}
        written=JSON.stringify(origin);localStorage.setItem(PHOTO_ORIGIN_3D_KEY,written)
      }
      accept(next);if(origin)setPhotoOrigin(origin);setSelection({kind:'none'});setError('');setSaveNotice('已加入对称假设零件及复核后的连接；原零件保持原位，已有人工接受继续按原规则核对；新增或变化的错误需审核。请验证并保存 Draft。')
    }catch(e){if(written&&localStorage.getItem(PHOTO_ORIGIN_3D_KEY)===written){if(prior===null)localStorage.removeItem(PHOTO_ORIGIN_3D_KEY);else localStorage.setItem(PHOTO_ORIGIN_3D_KEY,prior)}setError(String(e))}
  }
  async function refreshAssemblies(){
    const p=projectRef.current;if(!p){setSavedAssemblies([]);return}
    const r=await intakeApi<{assemblies:SavedAssemblySummary[]}>('assembly3d/projects/'+p.id)
    if(projectRef.current?.id===p.id)setSavedAssemblies(r.assemblies)
  }
  function protectSavedWorking(){
    const next=archiveQueue.current.catch(()=>{}).then(()=>preserveSavedAssembly(localStorage));archiveQueue.current=next;return next
  }
  async function openSavedAssembly(id:string,replaceConfirmed=false){
    if(operationBusy||!replaceConfirmed&&!allowReplace())return
    const p=projectRef.current,request=++fileRequest.current,expected={raw:expectedRaw.current,policy:expectedPolicyRaw.current,origin:localStorage.getItem(PHOTO_ORIGIN_3D_KEY)}
    setAssemblyIO(true)
    try{
      const cached=loadDraft3D(localStorage).assembly
      if(cached&&savedAssemblyRef(localStorage)?.id!==cached.id)await protectSavedWorking()
      const r=await intakeApi<SavedAssembly>('assembly3d/records/'+id)
      if(request!==fileRequest.current||projectRef.current?.id!==p?.id||p&&r.project.id!==p.id)throw Error('Project 或选择已变化，未打开其他作品')
      assertCanonicalProfiles(r.snapshot.assembly.profiles,profiles)
      const saved=restoreAssemblySnapshot(localStorage,r,expected)
      expectedRaw.current=saved.raw;expectedPolicyRaw.current=saved.policy;setPhotoOrigin(saved.photoOrigin);setEditorCamera(saved.photoOrigin.cameraView??null)
      accept(actions.createInitialHistory(r.snapshot.assembly,r.snapshot.nonRepairable),true);setClean(saved.raw);setCleanPolicy(canonical(r.snapshot.nonRepairable));setText(saved.raw)
      if(r.type==='combined'){const values={...visibility,[r.assembly.id]:true};for(const m of r.snapshot.assembly.modules??[])values[m.parent.id]=false;setDisplayPreferences({projectId:r.project.id,values});try{saveAssemblyVisibility(localStorage,r.project.id,values)}catch(e){setDisplayError(String(e))}}else setAssemblyVisible(r.assembly.id,true);setLoaded(old=>({source:saved.raw,name:r.name,sequence:old.sequence+1}));setSelection({kind:'none'});setEditing(true);setError('');setLibraryError(r.lineage.selected?'':`来源不匹配：${r.lineage.error}；Draft 可查看，Build 仍受来源校验。`)
      if(r.reviewRef&&r.lineage.selected){try{await restoreSavedHumanReview(r.snapshot.assembly,r.hash)}catch(e){setLibraryError(`作品已恢复；审核授权未恢复：${String(e)}`)}}
      await refreshAssemblies();navigate('assembly')
    }catch(e){setLibraryError(String(e))}finally{setAssemblyIO(false)}
  }
  function allowReplace() { return !dirty || confirm('当前 3D Draft 有未保存修改。确认替换？可先取消并导出或保存草稿。') }
  function startEdit() {
    if(profileError){setError(profileError);return}
    setTool(snapMode==='drag'?'snap':'select');setEditing(true)
  }
  function blank() {
    if (!allowReplace()) return
    const draft = actions.createEmptyProject(); accept(actions.createInitialHistory(draft)); setClean(serializeAssembly3D(draft));setCleanPolicy(canonical([]))
    setLoaded(old => ({ ...old, name: '空白 3D Draft', sequence: old.sequence + 1 })); setSelection({ kind: 'none' });setTool(snapMode==='drag'?'snap':'select'); setEditing(true)
  }
  async function persistDraft(){
    const h=historyRef.current
    assertCanonicalProfiles(h.current.profiles,profiles)
    if(loadDraft3D(localStorage).assembly?.id!==h.current.id)await protectSavedWorking()
    const expected={raw:expectedRaw.current,policy:expectedPolicyRaw.current,origin:localStorage.getItem(PHOTO_ORIGIN_3D_KEY)}
    if(localStorage.getItem(DRAFT_3D_KEY)!==expected.raw||localStorage.getItem(DRAFT_COLLISION_POLICY_KEY)!==expected.policy)throw Error('工作区已被其他页面更新，未覆盖')
    const storedOrigin=loadPhotoOrigin(localStorage)
    if(canonical(storedOrigin?.origin??null)!==canonical(photoOrigin?.origin??null)||storedOrigin?.assemblyRaw!==photoOrigin?.assemblyRaw)throw Error('作品来源已被其他页面更新，未保存')
    const snapshot=groupSnapshot(h.current,storedOrigin?{...storedOrigin,...(editorCamera?{cameraView:editorCamera}:{})}:null,actions.currentNonRepairable(h))
    if(snapshot){
      const record=await saveAssemblySnapshot(snapshot,savedAssemblyRef(localStorage)),saved=restoreAssemblySnapshot(localStorage,record,expected)
      expectedRaw.current=saved.raw;expectedPolicyRaw.current=saved.policy;setPhotoOrigin(saved.photoOrigin);setLibraryError(record.lineage.selected?'':`来源不匹配：${record.lineage.error}；Draft 已保存，Build 仍受来源校验。`);await refreshAssemblies()
    }else{
      expectedRaw.current=saveDraft3D(localStorage,h.current,expectedRaw.current,{nonRepairable:actions.currentNonRepairable(h),expectedRaw:expectedPolicyRaw.current})
      expectedPolicyRaw.current=localStorage.getItem(DRAFT_COLLISION_POLICY_KEY)
    }

    setClean(serializeAssembly3D(h.current));setCleanPolicy(canonical(actions.currentNonRepairable(h)))
  }
  async function save() {
    try {
      if (boot.error) throw Error(boot.error)
      if (operationBusy) throw Error('请先结束画布操作或确认/取消吸附预览，再保存')
      setAssemblyIO(true);await persistDraft(); setSaveNotice('3D Draft 已保存，刷新可恢复；几何状态未被修正。'); setError('')
    } catch (e) { setError(String(e)) } finally{setAssemblyIO(false)}
  }
  async function revalidate() {
    setSelection(s=>s.kind==='collision'?{kind:'none'}:s);setCollisionFocus(null)
    const target=historyRef.current.current,signature=serializeAssembly3D(target);
    try {
      assertCanonicalProfiles(target.profiles,profiles);
      if(operationBusy||humanReview.busy)throw Error('请先结束当前画布或审核操作，再执行 Revalidate Geometry');
      if(hasHumanReview(target.id))await humanReview.revalidate();
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
  async function approveCurrent(){
    try{if(operationBusy||humanReview.busy)throw Error('请先结束当前操作');if(boot.error)throw Error(boot.error);setAssemblyIO(true);await persistDraft();await humanReview.approve();await persistDraft();setError('')}catch(e){setError(String(e))}finally{setAssemblyIO(false)}
  }
  function reloadSaved() {
    if(photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id){void openSavedAssembly(current.id);return}
    if (!allowReplace()) return
    try {
      const saved = loadDraft3D(localStorage); if (!saved.assembly) throw Error('尚未保存 3D Draft')
      assertCanonicalProfiles(saved.assembly.profiles,profiles)
      const policy=loadDraftCollisionPolicy(localStorage,saved.assembly,saved.raw);setCleanPolicy(canonical(policy.nonRepairable));expectedPolicyRaw.current=policy.policyRaw
      setPhotoOrigin(loadPhotoOrigin(localStorage));expectedRaw.current = saved.raw; accept(actions.createInitialHistory(saved.assembly,policy.nonRepairable),true); setClean(saved.raw!)
      setLoaded(old => ({ source: saved.raw!, name: '已保存的 3D Draft', sequence: old.sequence + 1 }))
      setText(saved.raw!); setSelection({ kind: 'none' }); setEditing(true); setError('')
    } catch (e) { setError(String(e)) }
  }
  function load(source: string, name: string) {
    try {
      if (!allowReplace()) return
      if (source.length > 1_000_000) throw Error('JSON 超过 1 MB 限制')
      const assembly = parseAssembly3D(source)
      assertCanonicalProfiles(assembly.profiles,profiles)
      const policy=loadDraftCollisionPolicy(localStorage,assembly,serializeAssembly3D(assembly));setCleanPolicy(canonical(policy.nonRepairable));
      const isSavedDraft=localStorage.getItem(DRAFT_3D_KEY)===serializeAssembly3D(assembly)
      if(isSavedDraft)expectedPolicyRaw.current=policy.policyRaw
      accept(actions.createInitialHistory(assembly,policy.nonRepairable)); setClean(assembly.id===current.id?clean:serializeAssembly3D(assembly))
      setLoaded(old => ({ source, name, sequence: old.sequence + 1 })); setEditing(true)
      setText(source); setSelected(null); setError('')
    } catch (e) { setError(`加载失败，保留当前作品：${String(e)}`) }
  }
  const inProject=!!project3D&&photoOrigin?.origin.sourceId===project3D.id&&JSON.parse(photoOrigin.assemblyRaw).id===current.id
  let currentSaved=false;try{const ref=savedAssemblyRef(localStorage);currentSaved=!dirty&&ref?.id===current.id&&savedAssemblies.some(a=>a.id===current.id&&a.hash===ref.hash)}catch{/* unknown receipt is never displayed as Saved */}
  return <>
    {hosts.assemblies&&createPortal(<section hidden={viewMode!=='3d'} className="assembly-selector" aria-label="Assembly Selector">
      <div className="assembly-list-heading">Assembly / 当前作品 <InfoHint label="Assembly 显示与编辑"><p>勾选只控制显示；点击作品名称切换当前编辑对象。其他作品只读，显示偏移不是对齐或合并。切换时恢复已保存的完整 Draft。</p></InfoHint></div>
      {!savedAssemblies.length&&!inProject&&<small>当前 Project 尚无已保存作品。</small>}
      <ul className="assembly-list" aria-label="Project Assemblies">
        {inProject&&!savedAssemblies.some(a=>a.id===current.id)&&<li data-assembly-row={current.id} aria-current="true"><input type="checkbox" aria-label={'显示作品 '+current.id} checked={activeVisible} disabled={operationBusy} onChange={e=>setAssemblyVisible(current.id,e.target.checked)}/><span>{String((photoOrigin!.origin.reconstructionScope as {groupName?:string})?.groupName??'Group')} · {current.pieces.length} Tiles · Draft <b>编辑中</b></span></li>}
        {savedAssemblies.map(a=>{const isCurrent=inProject&&a.id===current.id;return <li key={a.id} data-assembly-row={a.id} aria-current={isCurrent?'true':undefined}>
          <input type="checkbox" aria-label={'显示作品 '+a.id} title="仅控制显示" checked={isCurrent?activeVisible:!!visibility[a.id]} disabled={operationBusy} onChange={e=>setAssemblyVisible(a.id,e.target.checked)}/>
          <button type="button" disabled={operationBusy} aria-label={'编辑作品 '+a.id} aria-pressed={isCurrent} onClick={()=>{if(!isCurrent||!currentSaved)void openSavedAssembly(a.id)}} title={`${a.name} · ${a.id}`}><span>{a.name} · {isCurrent?current.pieces.length:a.tiles} Tiles{a.type==='combined'?' · Combined':''}</span><small>{isCurrent&&!currentSaved?'未保存':'Saved'} · r{isCurrent?current.revision:a.revision}{isCurrent&&<b> · 编辑中</b>}</small></button>
        </li>})}
      </ul>
      {inProject&&photoOrigin?.origin.kind==='combined-assembly'?<small data-testid="assembly-origin-summary">Combined · {current.modules?.map(m=>`${m.name} r${m.parent.revision} · ${m.parent.id.slice(0,12)} / ${m.parent.hash.slice(0,8)}`).join(' + ')}</small>:inProject&&<small data-testid="assembly-origin-summary">Group {String((photoOrigin!.origin.reconstructionScope as {groupName?:string})?.groupName??'全部模块')} · Plan {String(photoOrigin!.origin.planId).slice(0,8)} · Execution {String(photoOrigin!.origin.executionId).slice(0,8)} · {String(photoOrigin!.origin.entryMode??'Candidate')}</small>}
      {libraryError&&<p role="alert">{libraryError}</p>}{displayError&&<p role="alert">{displayError}</p>}{project3D&&photoOrigin&&!inProject&&<small>工作区来自其他 Project；选择列表中的作品可恢复当前 Project 的存档。</small>}
    </section>,hosts.assemblies)}
    <StudioSlot column="workspace" stages={['assembly']} view="3d">
      <section className="magnetic-3d-workspace" aria-label="3D 作品查看">
        <div className="magnetic-3d-toolbar" aria-label="3D Assembly 工具栏">
          <header className="magnetic-3d-toolbar-row"><div className="magnetic-3d-toolbar-title"><h2>作品编辑（Assembly）</h2><span className="hint" title={loaded.name}>{photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?`${photoOrigin.origin.kind==='combined-assembly'?'Combined':'照片'} · ${String(photoOrigin.origin.sourceId).slice(0,8)}`:editing?'3D Draft':'3D 查看'}</span></div>
           <div className="magnetic-3d-edit-toggle" role="group" aria-label="3D View / Edit"><button disabled={operationBusy} aria-pressed={!editing} onClick={()=>{setLive(null);setEditing(false)}}>View</button><button disabled={operationBusy} aria-pressed={editing} onClick={startEdit}>Edit Draft</button><button disabled={operationBusy} onClick={()=>{fileRequest.current++;load(photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?photoOrigin.assemblyRaw:loaded.source,loaded.name)}}>重新加载来源</button></div>
          </header>
        </div>
        <section className="magnetic-3d-assembly-actions" aria-label="3D Assembly 操作栏" aria-busy={humanReview.busy||assemblyIO}>
          <div className="magnetic-3d-main-actions"><div><button disabled={operationBusy} onClick={()=>void revalidate()}>Revalidate Geometry</button>{editing&&<button disabled={operationBusy || !!boot.error} onClick={save}>保存 3D Draft</button>}</div><button disabled={operationBusy||humanReview.busy||!reviewPolicy.eligible||!allReviewed||!!humanReview.grant} onClick={()=>void approveCurrent()}>批准当前作品</button></div>
          <div className="magnetic-3d-toolbar-row"><p className="magnetic-3d-summary" role="status"><span>{assembly.pieces.length} 片 · {assembly.connections.length} 条连接 · </span><span className={!validation.valid?'magnetic-3d-blocker':undefined}>{validation.valid?geometryGate.receiptRequired&&!geometryGate.current?'几何预检查通过 · 尚未复验':'几何校验通过 · Geometry Valid':'Geometry Invalid'}</span><span> · {dirty?'未保存':'Draft'}</span><span> · 碰撞 {collisionIssues.length} · {reviewedCount}/{reviewPolicy.keys.length} 已审核</span>{current.modules&&<span> · Combined · {current.modules.length} Modules</span>}{humanDiagnosticSource&&<span> · Human Accepted Diagnostic</span>}{humanReview.grant&&!humanDiagnosticSource&&<span> · Human Approved</span>}{humanReview.busy&&<span> · 正在提交审核</span>}{humanReview.error&&<span className="magnetic-3d-blocker"> · 审核未就绪</span>}</p>
           <div className="magnetic-3d-display-tools"><label><input type="checkbox" checked={showTileIds} onChange={e=>setShowTileIds(e.target.checked)}/>显示 Tile ID</label>{editing&&<button disabled={operationBusy} aria-expanded={moduleToolOpen} onClick={()=>{showInspector();setSymmetryOpen(false);setModuleToolOpen(v=>!v)}}>模块变换 / Snap</button>}{editing&&<button disabled={operationBusy} aria-expanded={symmetryOpen} onClick={()=>{if(!symmetryOpen)showInspector();setModuleToolOpen(false);setSymmetryOpen(v=>!v);setSymmetrySources(!symmetryOpen&&selection.kind==='piece'?[selection.id]:[]);setSymmetryPreview(null);setSelection({kind:'none'})}}>对称补全</button>}{editing&&<label className="magnetic-3d-snap-switch">吸附方式<select aria-label="3D 吸附方式" value={snapMode} disabled={operationBusy} onChange={e=>{const mode=e.target.value as 'drag'|'click';setPendingSnap(null);setSnapMode(mode);setTool(mode==='drag'?'snap':'select')}}><option value="drag">拖动吸附</option><option value="click">点击吸附</option></select></label>}</div>
          </div>
        </section>
        {profileError&&<p role="alert" className="magnetic-3d-blocker">{profileError}</p>}
        {(readOnlyAssemblies.length>0||!activeVisible)&&<div className="assembly-display-summary" data-testid="multi-assembly-display" data-displayed-assemblies={JSON.stringify([...(activeVisible?[{id:current.id,tiles:current.pieces.length,offset:[0,0,0],active:true}]:[]),...readOnlyAssemblies.map(a=>({id:a.id,tiles:a.pieces.length,offset:a.offset,snapshotHash:a.snapshotHash,active:false}))])}>
          <span>{activeVisible?`${String((photoOrigin?.origin.reconstructionScope as {groupName?:string})?.groupName??current.id)} · 编辑中`:'当前编辑作品已隐藏'}</span>{readOnlyAssemblies.map(a=><span key={a.id}>{a.name} · {a.pieces.length} Tiles · 只读</span>)}<small>并列显示，尚未对齐</small>
        </div>}
        {readOnlySelection&&<p className="assembly-display-inspection" role="status" data-testid="read-only-assembly-selection">{readOnlyAssemblies.find(a=>a.id===readOnlySelection.assemblyId)?.name} · {readOnlySelection.pieceId} · 只读；请在左栏点击作品名称切换编辑。</p>}
        {(moduleLive||modulePreview)&&<p role="status" data-testid="module-viewer-preview">模块{modulePreview?'吸附预览 · 尚未修改 Draft':'刚体拖动预览'} · 全部内部 Pose 联动；固定模块保持不动。</p>}
        {currentRepair&&<p className="magnetic-constraint-repair-banner" data-testid="repair-viewer-preview" data-repair-angles={JSON.stringify(currentRepair.candidate.angles)}>自动修复预览 · {currentRepair.candidate.id} · {currentRepair.candidate.geometry.valid?'Geometry Valid':'Geometry Invalid · 部分改善'} · {currentRepair.candidate.proposedConnection?'建议新增 Connection':'仅改善碰撞'} · 碰撞 {currentRepair.candidate.collisions.length} · 当前 Draft 尚未修改</p>}
        {active && (editing ? <ViewerErrorBoundary key={`edit-${loaded.sequence}`}><EditorCanvas moduleGizmo={moduleGizmo} moduleMode={moduleToolOpen} readOnlyAssemblies={readOnlyAssemblies} activeVisible={activeVisible} onInspectAssemblyPiece={inspectReadOnly} readOnlySelection={readOnlySelection} project={moduleProject??repairProject??project} previewPieces={symmetryPieces} selection={currentRepair?.candidate.proposedConnection?{kind:'connection',index:currentRepair.candidate.assembly.connections.length-1}:selection} toolMode={moduleToolOpen||symmetryOpen||repairSearching||currentRepair?'select':tool} showTileIds={showTileIds} collision={repairCollision??selectedCollision} collisionFocus={currentRepair?null:collisionFocus}
          onSelectPiece={id => {if(operationBusy)return;if(moduleToolOpen&&current.modules?.find(m=>m.id===moduleTool.moving)?.pieces.some(p=>p.id===id))setModuleTool(t=>({...t,face:id}));setSelection({kind:'piece',id});if(symmetryOpen)setSymmetrySources(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])}}
          onSelectConnection={index => { if (!operationBusy) setSelection({ kind: 'connection', index }) }}
          onSelectPort={(id,portId)=>{if(operationBusy||symmetryOpen||moduleToolOpen)return;if(snapMode==='click'&&selected&&id!==selected){prepareSnap({pieceA:id,portA:portId,pieceB:selected,portB:ownPort,...snapSettings});return}setSelection({kind:'piece',id});setOwnPort(portId)}}
          onClearSelection={() => { if (!operationBusy) setSelection({ kind: 'none' }) }} focusRequest={errorFocus} fitRequest={moduleFit}
          onMovePiece={(pieceId, tf) => setLive({ pieceId, tf })}
          onMovePieceCommit={(id, tf) => apply(h => actions.setPieceTransformAction(h, id, tf))}
          onCreateConnection={prepareSnap} onSnapProposal={prepareSnap} onMovePieceCancel={()=>setLive(null)} snapCandidates={[snapSettings]} snapSourcePort={ownPort} showSnapTargets={snapMode==='click'&&!symmetryOpen&&!moduleToolOpen} interactionLocked={!!pendingSnap||symmetryOpen||repairSearching||!!currentRepair} snapGhost={pendingSnap?{pieceId:pendingSnap.connection.pieceB,tf:pendingSnap.assembly.pieces.find(p=>p.id===pendingSnap.connection.pieceB)!.pose}:null}
          cameraTargetRef={cameraTargetRef} liveTransformOverride={live} initialCameraView={initialCameraView} onCameraViewChange={setEditorCamera}/></ViewerErrorBoundary>
          : <MagnetScene3D key={loaded.sequence} assembly={assembly} readOnlyAssemblies={readOnlyAssemblies} activeVisible={activeVisible} onInspectAssemblyPiece={inspectReadOnly} readOnlySelection={readOnlySelection} selected={selected} onSelect={setSelected} showTileIds={showTileIds} selectedConnection={selectedConnection} collision={selectedCollision} collisionFocus={collisionFocus} initialCameraView={initialCameraView}/>)}
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
          <p>几何校验不代表真实磁力或物理稳定性保证。Invalid Draft 可保存继续编辑；只有严格通过或当前几何错误具有有效人工接受授权后，才能进入正式 Build。人工批准不代表 Geometry Valid 或物理稳定。</p>
        </InfoHint></header>
        {editing&&moduleToolOpen&&<ModuleTransformPanel assembly={current} saved={savedAssemblies} visible={visibility} tool={moduleTool} setTool={setModuleTool} busy={assemblyIO||!!moduleLive} preview={modulePreview} onPreview={p=>{setModulePreview(p);setModuleFit({ts:Date.now()})}} onApply={applyModule} onCreate={createCombined} close={()=>{setModulePreview(null);setModuleToolOpen(false)}}/>}
        {editing&&symmetryOpen&&<SymmetryFillPanel assembly={current} sourceIds={symmetrySources} preview={symmetryPreview} setPreview={setSymmetryPreview} confirmPreview={confirmFill} close={()=>{setSymmetryOpen(false);setSymmetrySources([]);setSymmetryPreview(null)}}/>}
        <section className="magnetic-3d-geometry-check" aria-label="Geometry Check"><h4>Geometry Check</h4>
          <p role="status"><b className={!validation.valid?'magnetic-3d-blocker':undefined}>{!validation.valid?'Geometry Invalid':geometryGate.receiptRequired&&!geometryGate.current?'Needs Revalidation':'Geometry Valid'}</b><br/>Revision {assembly.revision} · {assembly.pieces.length} 片 · {assembly.connections.length} 条连接</p>
          {!!geometryErrors.length&&<p className="magnetic-3d-blocker">{geometryErrors.length} 个错误 · {geometryErrors[0].message}</p>}
          {geometryGate.repair&&<div aria-label="待修复 Draft 几何状态"><b>{humanDiagnosticSource?'Human Accepted Diagnostic':'Diagnostic 来源 · 待修复 Draft'}</b><p data-testid="repair-draft-status" role={geometryGate.blocker&&!humanReview.grant?'alert':'status'}>{humanReview.grant?(humanDiagnosticSource?'Geometry Invalid + Human Accepted Diagnostic：已接受且未变化的错误不再阻断；可进入 Build，无须重复批准。':'Geometry Invalid + Human Approved：本快照的碰撞已获人工授权，可进入 Build；不代表 Geometry Valid。'):humanDiagnosticSource?(validation.valid?'当前 Geometry Valid，可进入 Build。':'尚有新增、变化或未确认等价的错误，继续阻断 Build。'):geometryGate.blocker??'当前 Draft Revision / Hash 已通过 Revalidate Geometry，可进入 Build。'} 原始碰撞错误保留在照片来源记录中。</p></div>}
          <section className="magnetic-3d-collision-review" aria-label="Collision Review"><div className="magnetic-3d-collision-heading"><h4>Collision Review · {collisionIssues.length}</h4><span data-testid="collision-review-progress">{reviewedCount}/{reviewPolicy.keys.length} 已审核</span></div>
            {!collisionIssues.length?<p className="hint">当前严格 Validator 未报告实体碰撞。</p>:<table className="magnetic-3d-collision-table"><colgroup><col/><col style={{width:'18%'}}/><col style={{width:'13%'}}/><col style={{width:'13%'}}/><col style={{width:'19%'}}/></colgroup><thead><tr><th>Tile Pair</th><th>Depth</th><th>接受</th><th>修复</th><th title="Non-repairable：不作为优化目标或评分收益，仍完整验证且不得加重">不可修复</th></tr></thead><tbody>{collisionIssues.map((issue,index)=>{
              const key=collisionPairKey(issue.relatedPieceIds??[]),acceptedKey=collisionErrorKey(issue),selected=selectedCollision?.key===key,select=()=>{if(!operationBusy){setSelection(selected?{kind:'none'}:{kind:'collision',key,sourceKey:snapshotKey});setCollisionFocus(null)}}
              return <tr key={index} data-collision-key={key} aria-selected={selected} title={issue.message} onClick={select}>
                <td><button disabled={operationBusy||!issue.relatedPieceIds||issue.relatedPieceIds.length!==2} aria-pressed={selected} onClick={e=>{e.stopPropagation();select()}}>{issue.relatedPieceIds?.join(' / ')??'未指定零件对'}</button></td>
                <td>{typeof issue.penetrationDepth==='number'?depthFormat(issue.penetrationDepth):'—'}</td>
                <td><input type="checkbox" aria-label={`接受碰撞 ${issue.relatedPieceIds?.join(' / ')}`} checked={humanReview.state?.acceptedKeys.includes(acceptedKey)??false} disabled={operationBusy||humanReview.busy||!reviewPolicy.eligible} onClick={e=>e.stopPropagation()} onChange={e=>void humanReview.accept(acceptedKey,e.target.checked,photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?String(photoOrigin.origin.id):undefined)}/></td>
                <td><input type="checkbox" aria-label={`修复目标 ${issue.relatedPieceIds?.join(' / ')}`} checked={repairTargets.includes(key)&&!nonRepairable.includes(key)} disabled={operationBusy||!issue.relatedPieceIds||nonRepairable.includes(key)} onClick={e=>e.stopPropagation()} onChange={e=>setRepairTargets(ids=>e.target.checked?[...ids,key]:ids.filter(id=>id!==key))}/></td>
                <td><input type="checkbox" aria-label={`不可修复碰撞 ${issue.relatedPieceIds?.join(' / ')}`} checked={nonRepairable.includes(key)} disabled={!editing||operationBusy||!issue.relatedPieceIds} onClick={e=>e.stopPropagation()} onChange={e=>apply(h=>actions.setNonRepairableCollisionAction(h,key,e.target.checked))}/></td>
              </tr>
            })}</tbody></table>}
            <div className="magnetic-3d-collision-actions"><div><button disabled={!selectedCollision?.center} onClick={()=>selectedCollision&&setCollisionFocus({target:selectedCollision,sequence:(collisionFocus?.sequence??0)+1})}>聚焦碰撞</button><button disabled={!selectedCollision} onClick={()=>{setSelection({kind:'none'});setCollisionFocus(null)}}>取消碰撞选择</button></div>
            </div>
            {humanReview.grant&&<p role="status" data-testid="human-collision-approved">Geometry Invalid + {humanDiagnosticSource?'Human Accepted Diagnostic':'Human Approved'} · 允许进入 Build。Physical Stability 未验证。</p>}
            {humanReview.busy&&<p role="status" className="hint">正在提交审核，请稍候。</p>}
            {humanReview.error&&<p role="alert">{humanReview.error} <button onClick={()=>void humanReview.refresh()}>重新读取审核</button></p>}
            {!!(humanReview.state?.humanAcceptedDiagnostic?humanReview.state.blockers.length:reviewPolicy.blockers.length)&&<p className="magnetic-3d-blocker">{humanDiagnosticSource?'存在新增、变化或不可定位错误，不能放行当前作品。':'存在结构性、未知或不可定位错误，不能批准当前作品。'}</p>}
            {selectedCollision&&<p className="hint">{selectedCollision.kind==='volume'?'显示完整厚度碰撞代理的实际交集（透视），与 Viewer 外观网格不同；仍为 Invalid。':selectedCollision.reason}</p>}
          </section>
          <AutoConstraintRepairPanel assembly={current} hints={angleHints} editing={editing} disabled={operationBusy||humanReview.busy} nonRepairable={nonRepairable} excludedCount={collisionIssues.filter(i=>nonRepairable.includes(collisionPairKey(i.relatedPieceIds??[]))).length} targets={repairTargets} highlighted={selectedCollision?.key} collisionCount={collisionIssues.length} onBusy={setRepairSearching} onPreview={setRepairPreview} onApply={applyConstraintRepair}/>
          <details onToggle={e=>setShowGeometryDetails(e.currentTarget.open)}><summary>详细几何 / Collision Diagnostic · {validation.issues.length}</summary>
            <p>{assembly.id} · revision {assembly.revision}</p>
            {validation.issues.length?<ul>{validation.issues.map((issue,i)=><li key={i} className={issue.severity==='error'?'magnetic-3d-blocker':undefined}><button className={issue.severity==='error'?'magnetic-3d-blocker':undefined} disabled={operationBusy} onClick={()=>locateGeometryError(issue)}>{issue.message}</button></li>)}</ul>:<p>保存位姿满足当前连接与碰撞检查。</p>}
            {!!collisionDetails.length&&<details><summary>碰撞空间证据 / Raw</summary><pre>{JSON.stringify(collisionDetails,null,2)}</pre></details>}
          </details>
        </section>
        {pendingSnap&&<section className="magnetic-3d-snap-preview" aria-label="3D 吸附预览"><h4>吸附预览 · 尚未修改 Draft</h4><p>{pendingSnap.connection.pieceB}:{pendingSnap.connection.portB} → {pendingSnap.connection.pieceA}:{pendingSnap.connection.portA}<br/>{pendingSnap.connection.dihedralDeg}° · flip {String(pendingSnap.connection.flip??false)}</p><p>仅移动源零件 B；不修改其他零件或原连接。{pendingSnap.geometry.valid?'预览几何校验通过。':'现有 Invalid 问题仍保留，不能作为正式有效作品。'}</p><button onClick={confirmSnap}>确认吸附</button><button onClick={()=>{setPendingSnap(null);setLive(null)}}>取消吸附</button></section>}
        <div className="magnetic-3d-draft-tools">
          {editing && <><button disabled={operationBusy || !history.past.length} onClick={() => { apply(actions.undo); setSelection({ kind: 'none' }) }}>3D Undo</button>
            <button disabled={operationBusy || !history.future.length} onClick={() => { apply(actions.redo); setSelection({ kind: 'none' }) }}>3D Redo</button></>}
        </div>
        {saveNotice && <p className="magnetic-3d-save-notice" role="status">{saveNotice}</p>}
        {error && <div><p role="alert">{error.length>200?error.slice(0,200)+'…':error}</p>{error.length>200&&<details><summary>操作错误详情</summary><p>{error}</p></details>}</div>}
        {photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id&&Array.isArray(photoOrigin.origin.pendingObservations)&&<PendingObservations assembly={current} values={photoOrigin.origin.pendingObservations as PendingObservation[]} disabled={!editing||operationBusy} onPlace={(p,pose)=>apply(h=>{const next=placePendingObservation(h,p,pose);setSelection({kind:'piece',id:p.id});return next})}/>}
        <AssemblySelectionTable angleHints={<AssemblyAngleHints report={validation} assembly={assembly} state={angleHints} selection={selection} select={setSelection} busy={operationBusy}/>} symmetrySources={editing&&symmetryOpen?symmetrySources:undefined} onSymmetrySource={(id,checked)=>{setSymmetryPreview(null);setSymmetrySources(ids=>checked?[...ids,id]:ids.filter(x=>x!==id))}} collisionIds={selectedCollision?.evidence.pieceIds} assembly={assembly} selection={selection} select={setSelection} busy={operationBusy}/>
        <EditorInspector editing={editing} selectionInfo={<>
        {selectedCollision?<div className="magnetic-3d-collision-detail" data-selected-collision={selectedCollision.key} data-collision-revision={assembly.revision}>
          <h4>{selectedCollision.evidence.pieceIds.join(' / ')}</h4><p className="magnetic-3d-blocker">Solid Collision Invalid · depth {depthFormat(selectedCollision.evidence.penetrationDepth)}</p>
          <p>{collisionLocality(selectedCollision.evidence.locality)} · Revision {assembly.revision} · 当前完整快照</p>
          <p className="hint">{selectedCollision.reason}</p>
          <dl><dt>交集中心</dt><dd>{selectedCollision.center?.map(format).join(', ')??'不可用'}</dd><dt>交集体积</dt><dd>{selectedCollision.kind==='volume'?selectedCollision.volume.toExponential(6):'未可靠构造'}</dd></dl>
          <details><summary>当前碰撞完整证据 / Raw</summary><pre>{JSON.stringify(selectedCollision.evidence,null,2)}</pre></details>
        </div>:chosen ? <div className="magnetic-3d-piece-info" data-selected-3d-piece={chosen.id}>
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
          setOwnPort={setOwnPort} apply={apply} select={setSelection} busy={operationBusy||moduleToolOpen} tool={tool} setTool={next=>{setTool(next);if(next==='snap')setSnapMode('drag')}} onPreviewSnap={prepareSnap} snapSettings={snapSettings} setSnapSettings={setSnapSettings}/>
        {photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id&&<details className="visible3d-origin"><summary>照片来源与快照</summary><p>Source {photoOrigin.origin.sourceId as string} · {photoOrigin.assemblyRaw===serializeAssembly3D(current)?'采用时快照一致':'已编辑，原照片关联仅供追溯'}</p><p>Geometry Valid 与照片匹配独立；来源记录 {photoOrigin.origin.id as string}</p><pre>{JSON.stringify(photoOrigin.origin,null,2)}</pre>{!!photoOrigin.symmetryFills?.length&&<details><summary>编辑器对称假设来源（非照片观察）</summary><pre>{JSON.stringify(photoOrigin.symmetryFills,null,2)}</pre></details>}</details>}
        <details className="magnetic-3d-examples-debug"><summary>Examples / Debug</summary><p className="hint">开发示例；加载会替换当前查看内容，不属于正式 Tiles Catalog。当前来源：{loaded.name}</p><div className="magnetic-3d-examples" role="group" aria-label="3D 示例">{examples.map(example=><button key={example.id} disabled={operationBusy} data-3d-example={example.id} aria-pressed={assembly.id===example.id} onClick={()=>{fileRequest.current++;load(JSON.stringify(example.data,null,2),example.name)}}>{example.name}</button>)}</div><p>{componentCount(assembly)} 个组件 · revision {assembly.revision}</p></details>
      </section>
    </StudioSlot>
  </>
}

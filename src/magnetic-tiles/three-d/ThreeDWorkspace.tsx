import {currentWorkspace,ownAssemblyReferences,rememberSavedAssembly,WORKING_DRAFT_KEY,WORKSPACE_RECORD_KEY,WORKSPACE_HEAD_KEY} from '../workspace-context.ts'
import {studioStorage} from '../workspace-context.ts'
import {touchDraftProject} from '../draft-projects.ts'
import {normalizeModuleSnapSelection,validSnapPort} from './module-snap-selection.ts'
import type {ModuleSnapSelection,SnapPicker,SnapViewport} from './module-snap-selection.ts'
import {TileSelectionDetails,GroupSelectionDetails} from './AssemblySelectionDetails.tsx'
import {ModuleTransformPanel,CreateCombinedPanel} from './ModuleTransformPanel.tsx'
import type {AssemblyOperation,ModuleTool} from './ModuleTransformPanel.tsx'
import {modulePivot,pivotDelta,transformModule,confirmModulePreview,previewModuleTransform} from './module-transform.ts'
import {parentModule,parentInternalConnection} from './combined-editing.ts'
import type {ModulePreview} from './module-transform.ts'
import type {SnapOrientationTarget} from './module-snap-diagnostics.ts'
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
import {addAssemblyToGalleryUrl} from '../../magnetic-gallery/links.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StudioSlot, useStudio } from '../StudioLayout.tsx'
import {assertCanonicalProfiles} from './canonical-geometry.ts'
import { parseAssembly3D, serializeAssembly3D } from './assembly.ts'
import { validateAssembly3D,inspectAssemblyCollisions } from './engine-adapter.ts'
import { componentCount, createViewerModel } from './viewer-model.ts'
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
import {collisionVisual,collisionPairKey,collisionLocality} from './collision-visual.ts'
import type {CollisionFocus} from './CollisionOverlay.tsx'
import {SymmetryFillPanel} from './SymmetryFillPanel.tsx'
import {confirmSymmetryFill} from './symmetry-fill.ts'
import {AssemblyEditorToolbar} from './AssemblyEditorToolbar.tsx'
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
import {PHOTO_ORIGIN_3D_KEY,adoptReconstructionDraft,loadPhotoOrigin} from './reconstruction/adopt-draft.ts'
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
  const scope=currentWorkspace(),storage=useMemo(()=>studioStorage(),[])
  const { stage, viewMode, setAssembly3D, adoption3D, clearAdoption3D, navigate, showInspector, showWorkspace, project3D, setAssemblyOrigin3D, hosts, setProject3D } = useStudio()
  const active = stage === 'assembly' && viewMode === '3d'
  const { registry: { profiles } } = useProfileRegistry()
  const [boot] = useState(() => {
    try { const saved = loadDraft3D(storage),policy=loadDraftCollisionPolicy(storage,saved.assembly,saved.raw)
      const recoveryRaw=scope?storage.getItem(WORKING_DRAFT_KEY):null,recovery=recoveryRaw?JSON.parse(recoveryRaw):null
      if(recovery&&(recovery.baseRaw!==saved.raw||recovery.assembly.id!==saved.assembly?.id))throw Error('恢复草稿的保存基线不一致；未覆盖')
      if(recovery){
        parseAssembly3D(JSON.stringify(recovery.assembly))
        const origin=loadPhotoOrigin(storage)
        if(canonical(recovery.photoOrigin?.origin??null)!==canonical(origin?.origin??null)||recovery.photoOrigin?.assemblyRaw!==origin?.assemblyRaw)throw Error('恢复草稿来源与本作品不一致')
      }
      return { ...saved,...policy,recovery,recoveryRaw,error: '' }
    }
    catch (e) { return { assembly: null, raw: null, policyRaw:null,recovery:null,recoveryRaw:null, nonRepairable:[] as string[], error: `原 3D 草稿无法读取，已禁止覆盖：${String(e)}` } }
  })
  const [history, setHistory] = useState(() => actions.createInitialHistory(boot.recovery?.assembly ?? boot.assembly ?? (scope?{kind:'magnetic-assembly-3d' as const,schemaVersion:1 as const,id:scope.mode==='edit'?scope.assemblyId:'creation-'+scope.id,revision:0,profiles:[],pieces:[],connections:[]}:parseAssembly3D(initial)),boot.recovery?.nonRepairable??boot.nonRepairable))
  const historyRef = useRef(history); historyRef.current = history
  const [loaded, setLoaded] = useState(() => ({ source: boot.raw ?? initial, name: boot.recovery?'已恢复本作品工作草稿':boot.assembly ? '已保存的 3D Draft' : examples[0].name, sequence: 0 }))
  const [text, setText] = useState(boot.raw ?? initial), [error, setError] = useState(boot.error)
  const [saveConflict,setSaveConflict]=useState<{id:string;version:number;hash:string}|null>(null)
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
  const [selectionMode,setSelectionMode]=useState<'group'|'tile'>(boot.assembly?.modules?'group':'tile'),[operation,setOperation]=useState<AssemblyOperation>('move'),[createCombinedOpen,setCreateCombinedOpen]=useState(false)
  const [selectOnly,setSelectOnly]=useState(false)
  const moduleToolOpen=!!history.current.modules&&selectionMode==='group'
  const [moduleTool,setModuleTool]=useState<ModuleTool>({fixed:'module-0',moving:'module-1',face:'',space:'global',mode:'translate'}),[moduleLive,setModuleLive]=useState<Assembly3D|null>(null),[modulePreview,setModulePreview]=useState<ModulePreview|null>(null)
  const [snapOrientationTargets,setSnapOrientationTargets]=useState<Record<string,SnapOrientationTarget>>({})
  useEffect(()=>setSaveConflict(null),[history.current.id])
  useEffect(()=>setSnapOrientationTargets({}),[history.current.id,loaded.sequence])
  const [snapSelection,setSnapSelection]=useState<ModuleSnapSelection>({fixedTile:'',fixedPort:'',movingPort:''}),[snapPicker,setSnapPicker]=useState<SnapPicker|null>(null)
  const [live, setLive] = useState<{ pieceId: string; tf: Pose3D } | null>(null)
  const [clean, setClean] = useState(() => boot.raw??serializeAssembly3D(history.current)), [saveNotice, setSaveNotice] = useState('')
  const [cleanPolicy,setCleanPolicy]=useState(()=>canonical(boot.nonRepairable))
  const expectedPolicyRaw=useRef<string|null>(boot.policyRaw)
  const expectedHeadRaw=useRef(scope?storage.getItem(WORKSPACE_HEAD_KEY):null)
  const expectedRaw = useRef(boot.raw), fileRequest = useRef(0), cameraTargetRef = useRef(new Vector3())
  const [photoOrigin,setPhotoOrigin]=useState<PhotoOrigin3D|null>(()=>boot.recovery?.photoOrigin??loadPhotoOrigin(storage))
  const [editorCamera,setEditorCamera]=useState<CameraView3D|null>(boot.recovery?.cameraView??null)
  useEffect(()=>{
    if(!adoption3D)return
    void (async()=>{setAssemblyIO(true);try{
      if(viewMode!=='3d')throw Error('当前已切换至 2D；3D 候选未载入。')
      if(!allowReplace())throw Error('已取消替换当前 3D Draft；原草稿保留。')
      if(boot.error)throw Error(boot.error)
      await protectSavedWorking();
      setEditorCamera(adoption3D.cameraView??null);
      const assembly=parseAssembly3D(JSON.stringify(adoption3D.assembly));assertCanonicalProfiles(assembly.profiles,profiles);const {raw,sidecar}=adoptReconstructionDraft(storage,assembly,adoption3D.origin,expectedRaw.current,adoption3D.cameraView)
      if(scope){storage.removeItem(WORKSPACE_RECORD_KEY);storage.removeItem(WORKSPACE_HEAD_KEY);expectedHeadRaw.current=null}
      expectedRaw.current=raw;expectedPolicyRaw.current=storage.getItem(DRAFT_COLLISION_POLICY_KEY);setCleanPolicy(canonical([]))
      accept(actions.createInitialHistory(assembly));setClean(raw);setText(raw);setPhotoOrigin(sidecar)
      setLoaded(old=>({source:raw,name:'Visible 3D · 候选 Draft',sequence:old.sequence+1}));setSelection({kind:'none'});setEditing(true);setError('')
      // Navigate from the receiver's current context only after CAS persistence
      // and editor state setup succeeded; an async sender may hold old context.
      navigate('assembly');adoption3D.complete()
    }catch(e){setError(String(e));adoption3D.complete(e)}finally{setAssemblyIO(false);clearAdoption3D();void refreshAssemblies().catch(e=>setLibraryError(String(e)))}})()
  },[adoption3D])
  const current = history.current
  const profileError=useMemo(()=>{try{assertCanonicalProfiles(current.profiles,profiles);return ''}catch(e){return String(e)}},[current.profiles,profiles])
  const nonRepairable=actions.currentNonRepairable(history)
  const angleHints=useAssemblyAngleHints(current,photoOrigin,active&&scope?.mode!=='edit')
  const currentRepair=repairPreview?.sourceRaw===serializeAssembly3D(current)?repairPreview:null
  const operationBusy=assemblyIO||!!moduleLive||!!modulePreview||!!live||!!pendingSnap||!!symmetryPreview||repairSearching||!!currentRepair
  const initialCameraView=photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?photoOrigin.cameraView:undefined
  useEffect(() => setAssembly3D(current), [current, setAssembly3D])
  useEffect(()=>{setAssemblyOrigin3D(photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?photoOrigin.origin:null)},[photoOrigin,current.id,setAssemblyOrigin3D])
  useEffect(()=>{if(scope){void refreshAssemblies().catch(e=>setLibraryError(String(e)));return}let alive=true;setSavedAssemblies([]);void protectSavedWorking().then(async r=>{if(!alive)return;if(r&&serializeAssembly3D(historyRef.current.current)===serializeAssembly3D(r.snapshot.assembly))setLibraryError(scope||r.lineage.selected?'':`来源不匹配：${r.lineage.error}；Draft 可查看，Build 仍受来源校验。`);await refreshAssemblies()}).catch(e=>{if(alive){setLibraryError(String(e));void refreshAssemblies().catch(()=>{})}});return()=>{alive=false}},[project3D?.id])
  const visibility=displayPreferences.projectId===project3D?.id?displayPreferences.values:{[current.id]:true}
  const activeVisible=visibility[current.id]!==false
  useEffect(()=>{
    if(!project3D){setDisplayPreferences({projectId:'',values:{}});return}
    try{setDisplayPreferences({projectId:project3D.id,values:readAssemblyVisibility(storage,project3D.id,historyRef.current.current.id)});setDisplayError('')}
    catch(e){setDisplayPreferences({projectId:project3D.id,values:{[historyRef.current.current.id]:true}});setDisplayError(String(e))}
  },[project3D?.id])
  const visibleSavedKey=JSON.stringify(savedAssemblies.filter(a=>a.id!==current.id&&visibility[a.id]).map(a=>[a.id,a.hash]))
  useEffect(()=>{
    let alive=true;const p=project3D?.id
    const wanted=savedAssemblies.filter(a=>a.id!==current.id&&visibility[a.id])
    void Promise.all(wanted.map(async a=>{const r=await intakeApi<SavedAssembly>('assembly3d/records/'+a.id+(scope?'/versions/'+a.version:''));if(r.project.id!==p||r.hash!==a.hash)throw Error('显示作品的 Project / Snapshot 已变化，请重新打开或保存作品');assertCanonicalProfiles(r.snapshot.assembly.profiles,profiles);return r})).then(records=>{if(alive)setDisplaySnapshots({projectId:p??'',records})}).catch(e=>{if(alive){setDisplaySnapshots({projectId:p??'',records:[]});setDisplayError(String(e))}})
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
    try{saveAssemblyVisibility(storage,p.id,values);setDisplayError('')}catch(e){setDisplayError(`显示状态仅在本页生效：${String(e)}`)}
  }
  function inspectReadOnly(assemblyId:string,pieceId:string){if(operationBusy||snapPicker)return;setSelection({kind:'none'});setReadOnlySelection({assemblyId,pieceId})}
  const dirty = (serializeAssembly3D(current) !== clean || canonical(nonRepairable)!==cleanPolicy)
  const expectedRecovery=useRef<string|null>(boot.recoveryRaw)
  const recoveryBlocked=useRef(false)
  useEffect(()=>{
    if(!scope||boot.error)return
    try{
      if(storage.getItem(WORKING_DRAFT_KEY)!==expectedRecovery.current)throw Error('本作品草稿已被其他页面更新；本页未覆盖，请导出当前内容后重新打开')
      const raw=JSON.stringify({baseRaw:expectedRaw.current,assembly:current,nonRepairable,photoOrigin,...(editorCamera?{cameraView:editorCamera}:{})})
      if(raw!==expectedRecovery.current){storage.setItem(WORKING_DRAFT_KEY,raw);expectedRecovery.current=raw;if(scope.mode==='create')touchDraftProject(localStorage,scope.id)}
    }catch(e){recoveryBlocked.current=true;setError(String(e))}
  },[current,photoOrigin,clean,cleanPolicy,editorCamera])
  useEffect(()=>{if(!scope)return;const warn=(e:BeforeUnloadEvent)=>{if(recoveryBlocked.current||operationBusy){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[operationBusy])

  const assembly = useMemo(() => live ? { ...current, pieces: current.pieces.map(p => p.id === live.pieceId ? { ...p, pose: live.tf } : p) } : current, [current, live])
  const snapshotKey=useMemo(()=>`${loaded.sequence}:${serializeAssembly3D(assembly)}`,[loaded.sequence,assembly])
  const selected = selection.kind === 'piece' ? selection.id : null
  const setSelected = (id: string | null) => { if (!operationBusy) setSelection(id ? { kind: 'piece', id } : { kind: 'none' }) }
  const items = useMemo(() => createViewerModel(assembly), [assembly])
  const validation = useMemo(() => validateAssembly3D(assembly), [assembly])
  const selectedConnection=selection.kind==='connection'?assembly.connections[selection.index]:undefined
  const geometryErrors=validation.issues.filter(i=>i.severity==='error')
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
  useEffect(()=>{setSelectionMode(current.modules?'group':'tile');setSelectOnly(false);setOperation('move');setTool('move');setCreateCombinedOpen(false);setModulePreview(null);setModuleLive(null);if(current.modules){const fixed=current.modules[0],moving=current.modules[1],joint=[...current.connections].reverse().find(c=>fixed.pieces.some(p=>p.id===c.pieceA)&&moving.pieces.some(p=>p.id===c.pieceB));setModuleTool({fixed:fixed.id,moving:moving.id,face:joint?.pieceB??moving.pieces[0].id,space:'global',mode:'translate'});setSnapSelection({fixedTile:joint?.pieceA??fixed.pieces[0].id,fixedPort:joint?.portA??'',movingPort:joint?.portB??''})}},[current.id])
  const selectedGroup=selection.kind==='piece'?current.modules?.find(m=>m.pieces.some(p=>p.id===selection.id)):undefined
  const parentTile=selection.kind==='piece'?parentModule(current,selection.id):undefined
  const internalConnection=selection.kind==='connection'&&!!current.connections[selection.index]&&parentInternalConnection(current,current.connections[selection.index])
  const parentReadOnly=!moduleToolOpen&&(parentTile?'Parent 成员保持固定；请切换 Group 进行整体变换，或插入自由 Tile 编辑。':internalConnection?'Parent 内部 Connection 保持固定；可以编辑自由 Tile 与 Group 的外部连接。':'')
  useEffect(()=>{if(current.modules&&(selection.kind==='connection'||selection.kind==='piece'&&!parentTile))setSelectionMode('tile')},[current.id,selection,parentTile?.id])
  useEffect(()=>{if(!selectedGroup||selection.kind!=='piece')return;setModuleTool(t=>({...t,moving:selectedGroup.id,face:selection.id,fixed:t.fixed!==selectedGroup.id?t.fixed:current.modules!.find(m=>m.id!==selectedGroup.id)!.id}))},[selectedGroup?.id,selection.kind==='piece'?selection.id:''])
  const snapFixedMembers=current.modules?.find(m=>m.id===moduleTool.fixed)?.pieces.map(p=>p.id)??[]
  const effectiveSnap=normalizeModuleSnapSelection(items,snapFixedMembers,moduleTool.face,snapSelection)
  useEffect(()=>{if(!selectedGroup||!moduleTool.face)return;setSnapSelection(s=>{const next=normalizeModuleSnapSelection(items,snapFixedMembers,moduleTool.face,s);return s.fixedTile===next.fixedTile&&s.fixedPort===next.fixedPort&&s.movingPort===next.movingPort?s:next})},[items,moduleTool.fixed,moduleTool.face,selectedGroup?.id])
  useEffect(()=>setSnapPicker(null),[operation,selectionMode,current.id,current.revision,moduleTool.fixed,moduleTool.moving,selectedGroup?.id,editing,active,activeVisible,symmetryOpen,operationBusy])
  function toggleSnapPicker(kind:SnapPicker){setSnapPicker(p=>p===kind?null:kind);if(snapPicker!==kind)showWorkspace()}
  function pickSnap(tileId:string,portId?:string){
    if(!snapPicker||operationBusy)return
    const fixed=snapPicker.startsWith('fixed'),members=fixed?snapFixedMembers:current.modules?.find(m=>m.id===moduleTool.moving)?.pieces.map(p=>p.id)??[]
    if(!members.includes(tileId))return
    if(snapPicker.endsWith('port')){
      if(tileId!==(fixed?effectiveSnap.fixedTile:moduleTool.face)||!portId||!validSnapPort(items,tileId,portId))return
      setSnapSelection({...effectiveSnap,[fixed?'fixedPort':'movingPort']:portId})
    }else if(fixed)setSnapSelection({...effectiveSnap,fixedTile:tileId,fixedPort:validSnapPort(items,tileId,effectiveSnap.fixedPort)})
    else{setModuleTool(t=>({...t,face:tileId}));setSelection({kind:'piece',id:tileId});setSnapSelection({...effectiveSnap,movingPort:validSnapPort(items,tileId,effectiveSnap.movingPort)})}
    setSnapPicker(null)
  }
  const snapViewport:SnapViewport|undefined=editing&&active&&activeVisible&&!selectOnly&&moduleToolOpen&&selectedGroup&&operation==='snap'&&!operationBusy?{
    picker:snapPicker,fixed:{tileId:effectiveSnap.fixedTile,portId:effectiveSnap.fixedPort,members:snapFixedMembers},moving:{tileId:moduleTool.face,portId:effectiveSnap.movingPort,members:selectedGroup.pieces.map(p=>p.id)},onPick:pickSnap
  }:undefined
  function chooseOperation(next:AssemblyOperation){setSelectOnly(false);setSymmetryOpen(false);setSymmetrySources([]);setOperation(next);setTool(next==='snap'?(snapMode==='drag'?'snap':'select'):next==='move'||next==='rotate'?next:'select');setModuleTool(t=>({...t,mode:next==='rotate'?'rotate':'translate'}));showInspector()}
  function chooseSelect(){setSelectOnly(true);setSnapPicker(null);setSymmetryOpen(false);setSymmetrySources([]);setTool('select')}
  function toggleSymmetry(){if(!symmetryOpen)showInspector();setSymmetryOpen(v=>!v);setSymmetrySources(!symmetryOpen&&selection.kind==='piece'?[selection.id]:[]);setSymmetryPreview(null);setSelection({kind:'none'})}
  const toolbarDisabled=!editing?'请切换到 Edit Draft':operationBusy?'请先完成或取消当前操作':!activeVisible?'请先显示当前作品':''
  const transformDisabled=moduleToolOpen?!selectedGroup?'请先选择 Group':'':parentReadOnly||(!chosen?'请先选择 Tile':'')
  const copyDisabled=symmetryOpen?'请先关闭对称补全':moduleToolOpen?'Group 不支持复制，请切换 Tile 模式':!chosen?'请先选择 Tile':''
  const deleteDisabled=copyDisabled||(current.modules?.some(m=>m.pieces.some(p=>p.id===selected))?'Combined Parent 成员不可删除；请在来源作品中编辑':'')
  const symmetryDisabled=moduleToolOpen?'Group 不支持镜像复制，请切换 Tile 模式':!current.pieces.length?'请先添加 Tile':''
  const moduleProject=useMemo(()=>moduleLive||modulePreview?{...editorProject(moduleLive??modulePreview!.assembly,catalog),shapes}:null,[moduleLive,modulePreview,catalog,shapes])
  const modulePivotPose=useMemo(()=>{if(!editing||selectOnly||!moduleToolOpen||!selectedGroup||selectedGroup.id!==moduleTool.moving||!current.modules||modulePreview||symmetryOpen||repairSearching||currentRepair||(operation!=='move'&&operation!=='rotate'))return undefined;try{return modulePivot(current,moduleTool.moving,moduleTool.space,moduleTool.face||current.modules.find(m=>m.id===moduleTool.moving)?.pieces[0].id)}catch{return undefined}},[current,editing,selectOnly,moduleToolOpen,selectedGroup,moduleTool,modulePreview,symmetryOpen,repairSearching,currentRepair,operation])
  function applyModule(preview:ModulePreview){try{const next=confirmModulePreview(historyRef.current.current,preview);accept(actions.commit(historyRef.current,()=>next));setError('');setSaveNotice('模块操作已应用；内部连接保持不变，几何诊断保持真实显示。');return true}catch(e){setModuleLive(null);setModulePreview(null);setError(String(e));return false}}
  const moduleGizmo=modulePivotPose?{pose:modulePivotPose,mode:moduleTool.mode,onCancel:()=>setModuleLive(null),onChange:(target:Pose3D,commit:boolean)=>{try{const next=transformModule(current,moduleTool.moving,pivotDelta(modulePivotPose,target));if(commit)applyModule(previewModuleTransform(current,next));else setModuleLive(next)}catch(e){setModuleLive(null);setError(String(e))}}}:undefined
  async function createCombined(name:string,ids:string[],registration?:{id:string;hash:string}){
    if(operationBusy||!allowReplace())return
    setAssemblyIO(true)
    try{await protectSavedWorking();const parents=ids.map(id=>{const a=savedAssemblies.find(a=>a.id===id);if(!a)throw Error('请选择当前 Project 已保存的作品');return a});const r=await intakeApi<SavedAssembly>('assembly3d/combine',{name,parents:parents.map(a=>({id:a.id,hash:a.hash,version:a.version})),...(registration?{registration}:{})});if(scope?.mode==='create')rememberSavedAssembly(storage,{id:r.assembly.id,version:r.version,hash:r.hash});await openSavedAssembly(r.assembly.id,true)}finally{setAssemblyIO(false);await refreshAssemblies()}
  }
  const repairCollision=useMemo(()=>{if(!currentRepair)return undefined;const issue=currentRepair.candidate.geometry.issues.find(i=>i.code==='intersection');if(!issue)return undefined;const evidence=inspectAssemblyCollisions(currentRepair.candidate.assembly,{...currentRepair.candidate.geometry,issues:[issue]})[0];return evidence?collisionVisual(evidence,'repair-preview:'+currentRepair.candidate.id):undefined},[currentRepair])
  async function applyConstraintRepair(result:RepairResult,candidate:RepairCandidate){
    if(!editing||!angleHints.source)throw Error('当前不是可编辑的有效来源，未应用修复')
    if(storage.getItem(DRAFT_COLLISION_POLICY_KEY)!==expectedPolicyRaw.current)throw Error('保存的不可修复标记已被其他页面更新，请重新加载 Draft')
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
  function accept(next: EditorHistory) { const sameAssembly=next.current.id===historyRef.current.current.id;setModuleLive(null);setModulePreview(null); const geometryChanged=canonical(next.current)!==canonical(historyRef.current.current);setRepairPreview(null);setRepairTargets(ids=>geometryChanged?[]:ids.filter(id=>!actions.currentNonRepairable(next).includes(id))); setErrorFocus(null);setSymmetryPreview(null);setSymmetryOpen(open=>open&&sameAssembly);setSymmetrySources([]); setSelection(s=>geometryChanged&&s.kind==='collision'?{kind:'none'}:s);if(geometryChanged)setCollisionFocus(null);historyRef.current = next; setHistory(next); setLive(null);setPendingSnap(null); setSaveNotice('') }
  function apply(action: (h: EditorHistory) => EditorHistory) {
    if (!editing) return
    try { accept(action(historyRef.current)); setError('') } catch (e) { setError(String(e)); setLive(null) }
  }
  useEffect(() => { if(active)setEditing(true);else{setModuleLive(null);setModulePreview(null);setRepairPreview(null);setRepairSearching(false);setRepairTargets([]);setSymmetryPreview(null);setSymmetryOpen(false);setLive(null);setPendingSnap(null);setSelection(s=>s.kind==='collision'?{kind:'none'}:s);setCollisionFocus(null)} }, [active])
  useEffect(()=>{if(selection.kind==='collision'&&!selectedCollision){setSelection({kind:'none'});setCollisionFocus(null)}},[selection,selectedCollision])
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setSnapPicker(null);setModuleLive(null);setModulePreview(null);setRepairPreview(null);setSymmetryPreview(null);setPendingSnap(null);setLive(null)}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[])
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
        prior=storage.getItem(PHOTO_ORIGIN_3D_KEY)
        if(canonical(scope?loadPhotoOrigin(storage)?.origin:loadPhotoOrigin(storage))!==canonical(scope?origin.origin:origin))throw Error('照片来源已被其他页面更新，未加入补全')
        origin={...origin,symmetryFills:[...(origin.symmetryFills??[]),{sourceIds:symmetryPreview.request.sourceIds,addedIds:symmetryPreview.addedIds,plane:symmetryPreview.request.plane,sourceRevision:current.revision,addedRevision:next.current.revision}]}
        if(!scope){written=JSON.stringify(origin);storage.setItem(PHOTO_ORIGIN_3D_KEY,written)}
      }
      accept(next);if(origin)setPhotoOrigin(origin);setSelection({kind:'none'});setError('');setSaveNotice('已加入对称假设零件及复核后的连接；原零件保持原位，当前几何错误保留在诊断中。请验证并保存 Draft。')
    }catch(e){if(written&&storage.getItem(PHOTO_ORIGIN_3D_KEY)===written){if(prior===null)storage.removeItem(PHOTO_ORIGIN_3D_KEY);else storage.setItem(PHOTO_ORIGIN_3D_KEY,prior)}setError(String(e))}
  }
  async function refreshAssemblies(){
    if(scope){
      const raw=storage.getItem(WORKSPACE_RECORD_KEY),currentRef=raw?JSON.parse(raw):null
      const refs=scope.mode==='edit'?(currentRef?[currentRef]:[]):ownAssemblyReferences(storage)
      const records=await Promise.all(refs.map(async ref=>{
        const r=await intakeApi<SavedAssembly>('assembly3d/records/'+ref.id+'/versions/'+ref.version)
        if(r.hash!==ref.hash)throw Error('工作区固定保存版本 Hash 不一致')
        return {...r,id:r.assembly.id,revision:r.snapshot.assembly.revision,tiles:r.snapshot.assembly.pieces.length,connections:r.snapshot.assembly.connections.length,savedAt:''}
      }))
      setSavedAssemblies(records.filter(r=>scope.mode==='edit'||r.project.id===projectRef.current?.id));return
    }
    const p=projectRef.current;if(!p){setSavedAssemblies([]);return}
    const r=await intakeApi<{assemblies:SavedAssemblySummary[]}>('assembly3d/projects/'+p.id)
    if(projectRef.current?.id===p.id)setSavedAssemblies(r.assemblies)
  }
  function protectSavedWorking(){
    if(scope)return Promise.resolve(null)
    const next=archiveQueue.current.catch(()=>{}).then(()=>preserveSavedAssembly(storage));archiveQueue.current=next;return next
  }
  async function openSavedAssembly(id:string,replaceConfirmed=false){
    if(operationBusy||!replaceConfirmed&&!allowReplace())return
    const p=projectRef.current,request=++fileRequest.current,expected={raw:expectedRaw.current,policy:expectedPolicyRaw.current,origin:storage.getItem(PHOTO_ORIGIN_3D_KEY)}
    setAssemblyIO(true)
    try{
      const cached=loadDraft3D(storage).assembly
      if(cached&&savedAssemblyRef(storage)?.id!==cached.id)await protectSavedWorking()
      const ref=scope?.mode==='create'?ownAssemblyReferences(storage).find(r=>r.id===id):scope?JSON.parse(storage.getItem(WORKSPACE_RECORD_KEY)||'null'):null
      if(scope&&(!ref||ref.id!==id))throw Error('不能从当前工作区加载其他作品')
      const r=await intakeApi<SavedAssembly>('assembly3d/records/'+id+(ref?'/versions/'+ref.version:''))
      if(ref&&r.hash!==ref.hash)throw Error('固定版本 Hash 不一致')
      if(request!==fileRequest.current||projectRef.current?.id!==p?.id||p&&r.project.id!==p.id)throw Error('Project 或选择已变化，未打开其他作品')
      assertCanonicalProfiles(r.snapshot.assembly.profiles,profiles)
      const saved=restoreAssemblySnapshot(storage,r,expected)
      if(scope?.mode==='create'){storage.setItem(WORKSPACE_RECORD_KEY,JSON.stringify(ref));storage.setItem(WORKSPACE_HEAD_KEY,JSON.stringify(ref));expectedHeadRaw.current=JSON.stringify(ref)}
      expectedRaw.current=saved.raw;expectedPolicyRaw.current=saved.policy;setPhotoOrigin(saved.photoOrigin);setEditorCamera(saved.photoOrigin.cameraView??null)
      accept(actions.createInitialHistory(r.snapshot.assembly,r.snapshot.nonRepairable));setClean(saved.raw);setCleanPolicy(canonical(r.snapshot.nonRepairable));setText(saved.raw)
      if(r.type==='combined'){const values={...visibility,[r.assembly.id]:true};for(const m of r.snapshot.assembly.modules??[])values[m.parent.id]=false;setDisplayPreferences({projectId:r.project.id,values});try{saveAssemblyVisibility(storage,r.project.id,values)}catch(e){setDisplayError(String(e))}}else setAssemblyVisible(r.assembly.id,true);setLoaded(old=>({source:saved.raw,name:r.name,sequence:old.sequence+1}));setSelection({kind:'none'});setEditing(true);setError('');setLibraryError(scope||r.lineage.selected?'':`来源不匹配：${r.lineage.error}；Draft 可查看，Build 仍受来源校验。`)
      await refreshAssemblies();navigate('assembly')
    }catch(e){setLibraryError(String(e))}finally{setAssemblyIO(false)}
  }
  function allowReplace() { return !dirty || confirm('当前 3D Draft 有未保存修改。确认替换？可先取消并导出或保存草稿。') }
  function startEdit() {
    if(profileError){setError(profileError);return}
    chooseOperation(operation);setEditing(true)
  }
  function blank() {
    if (!allowReplace()) return
    const draft = actions.createEmptyProject(); accept(actions.createInitialHistory(draft)); setClean(serializeAssembly3D(draft));setCleanPolicy(canonical([]))
    setLoaded(old => ({ ...old, name: '空白 3D Draft', sequence: old.sequence + 1 })); setSelection({ kind: 'none' });setTool(snapMode==='drag'?'snap':'select'); setEditing(true)
  }
  async function persistDraft(){
    if(scope&&(storage.getItem(WORKING_DRAFT_KEY)!==expectedRecovery.current||storage.getItem(WORKSPACE_HEAD_KEY)!==expectedHeadRaw.current))throw Error('本作品工作区已被其他页面更新；未覆盖 Draft 或保存版本，请导出本页内容后重新打开')
    if(recoveryBlocked.current)throw Error('恢复草稿存在并发冲突；未保存或覆盖，请先导出本页内容')
    const h=historyRef.current
    assertCanonicalProfiles(h.current.profiles,profiles)
    if(loadDraft3D(storage).assembly?.id!==h.current.id)await protectSavedWorking()
    const expected={raw:expectedRaw.current,policy:expectedPolicyRaw.current,origin:storage.getItem(PHOTO_ORIGIN_3D_KEY)}
    if(storage.getItem(DRAFT_3D_KEY)!==expected.raw||storage.getItem(DRAFT_COLLISION_POLICY_KEY)!==expected.policy)throw Error('工作区已被其他页面更新，未覆盖')
    const storedOrigin=loadPhotoOrigin(storage)
    if(canonical(storedOrigin?.origin??null)!==canonical(photoOrigin?.origin??null)||storedOrigin?.assemblyRaw!==photoOrigin?.assemblyRaw)throw Error('作品来源已被其他页面更新，未保存')
    const currentOrigin=scope?photoOrigin:storedOrigin
    const snapshot=groupSnapshot(h.current,currentOrigin?{...currentOrigin,...(editorCamera?{cameraView:editorCamera}:{})}:null,actions.currentNonRepairable(h))
    if(scope?.mode==='edit'&&!snapshot)throw Error('Edit 缺少本作品的不可变 Origin；未保存或回退到其他来源')
    if(snapshot||scope?.mode==='create'){
      const saveHead=scope?JSON.parse(expectedHeadRaw.current||'null'):null
      const record=snapshot?await saveAssemblySnapshot(snapshot,savedAssemblyRef(storage),scope?saveHead?.id===h.current.id?saveHead.hash:null:undefined):await intakeApi<SavedAssembly>('assembly3d/save-editor',{workspaceId:scope!.id,assembly:h.current,nonRepairable:actions.currentNonRepairable(h),cameraView:editorCamera})
      const saved=restoreAssemblySnapshot(storage,record,expected)
      if(scope){const ref={id:record.assembly.id,version:record.version,hash:record.hash};storage.setItem(WORKSPACE_RECORD_KEY,JSON.stringify(ref));storage.setItem(WORKSPACE_HEAD_KEY,JSON.stringify(ref));expectedHeadRaw.current=JSON.stringify(ref);if(scope.mode==='create')rememberSavedAssembly(storage,ref);}

      expectedRaw.current=saved.raw;expectedPolicyRaw.current=saved.policy;setPhotoOrigin(saved.photoOrigin);if(scope)setProject3D({id:record.project.id,name:record.name});setLibraryError(scope||record.lineage.selected?'':`来源不匹配：${record.lineage.error}；Draft 已保存，Build 仍受来源校验。`);await refreshAssemblies()
    }else{
      expectedRaw.current=saveDraft3D(storage,h.current,expectedRaw.current,{nonRepairable:actions.currentNonRepairable(h),expectedRaw:expectedPolicyRaw.current})
      expectedPolicyRaw.current=storage.getItem(DRAFT_COLLISION_POLICY_KEY)
    }

    setClean(serializeAssembly3D(h.current));setCleanPolicy(canonical(actions.currentNonRepairable(h)))
  }
  async function save() {
    try {
      if (boot.error) throw Error(boot.error)
      if (operationBusy) throw Error('请先结束画布操作或确认/取消吸附预览，再保存')
      setAssemblyIO(true);await persistDraft(); setSaveNotice('3D Draft 已保存，刷新可恢复；几何状态未被修正。');setSaveConflict(null); setError('')
    } catch (e) {
      setError(String(e))
      if(scope&&(e as {statusCode?:number})?.statusCode===409&&/其他页面更新|并发保存/.test(String(e))){
        try{const head=await intakeApi<{id:string;version:number;hash:string}>('assembly3d/save-head/'+historyRef.current.current.id);setSaveConflict(head)}catch{/* Preserve the original save error and working document. */}
      }
    } finally{setAssemblyIO(false)}
  }
  async function saveAfterConflict(){
    try{
      if(!scope||!saveConflict||operationBusy||saveConflict.id!==historyRef.current.current.id)throw Error('作品或操作已切换，请重新保存')
      if(storage.getItem(WORKSPACE_HEAD_KEY)!==expectedHeadRaw.current||storage.getItem(WORKING_DRAFT_KEY)!==expectedRecovery.current||recoveryBlocked.current)throw Error('本作品本地草稿已被其他页面更新；未覆盖，请先导出后重新打开')
      const raw=JSON.stringify(saveConflict);storage.setItem(WORKSPACE_HEAD_KEY,raw);expectedHeadRaw.current=raw;setSaveConflict(null)
      await save()
    }catch(e){setError(String(e))}
  }
  function revalidate() {
    setSelection(s=>s.kind==='collision'?{kind:'none'}:s);setCollisionFocus(null)
    try {
      if(operationBusy)throw Error('请先结束当前画布操作，再执行 Revalidate Geometry')
      const target=historyRef.current.current
      assertCanonicalProfiles(target.profiles,profiles)
      const report=validateAssembly3D(target)
      setSaveNotice(`Revalidate Geometry：revision ${target.revision} · ${report.valid?'Geometry Valid':'Geometry Invalid；可继续编辑、保存和展示'}`)
      setError(report.valid?'':'几何诊断：'+report.issues.filter(i=>i.severity==='error').map(i=>i.message).join('；'))
    }catch(e){setError(String(e))}
  }
  function reloadSaved() {
    if(!scope&&photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id){void openSavedAssembly(current.id);return}
    if (!allowReplace()) return
    try {
      if(scope&&(storage.getItem(WORKING_DRAFT_KEY)!==expectedRecovery.current||storage.getItem(WORKSPACE_HEAD_KEY)!==expectedHeadRaw.current))throw Error('本作品草稿已被其他页面更新；请导出本页内容后刷新恢复，未覆盖其他页面的修改')
      const saved = loadDraft3D(storage); if (!saved.assembly) throw Error('尚未保存 3D Draft')
      assertCanonicalProfiles(saved.assembly.profiles,profiles)
      const policy=loadDraftCollisionPolicy(storage,saved.assembly,saved.raw);setCleanPolicy(canonical(policy.nonRepairable));expectedPolicyRaw.current=policy.policyRaw
      setPhotoOrigin(loadPhotoOrigin(storage));expectedRaw.current = saved.raw; accept(actions.createInitialHistory(saved.assembly,policy.nonRepairable)); setClean(saved.raw!)
      setLoaded(old => ({ source: saved.raw!, name: '已保存的 3D Draft', sequence: old.sequence + 1 }))
      setText(saved.raw!); setSelection({ kind: 'none' }); setEditing(true); setError('')
    } catch (e) { setError(String(e)) }
  }
  function load(source: string, name: string) {
    try {
      if (!allowReplace()) return
      if (source.length > 1_000_000) throw Error('JSON 超过 1 MB 限制')
      const assembly = parseAssembly3D(source)
      if(scope&&assembly.id!==historyRef.current.current.id)throw Error('当前工作区不能导入其他作品；请从 Gallery 新建或编辑')
      assertCanonicalProfiles(assembly.profiles,profiles)
      const policy=loadDraftCollisionPolicy(storage,assembly,serializeAssembly3D(assembly));setCleanPolicy(canonical(policy.nonRepairable));
      const isSavedDraft=storage.getItem(DRAFT_3D_KEY)===serializeAssembly3D(assembly)
      if(isSavedDraft)expectedPolicyRaw.current=policy.policyRaw
      accept(actions.createInitialHistory(assembly,policy.nonRepairable)); setClean(assembly.id===current.id?clean:serializeAssembly3D(assembly))
      setLoaded(old => ({ source, name, sequence: old.sequence + 1 })); setEditing(true)
      setText(source); setSelected(null); setError('')
    } catch (e) { setError(`加载失败，保留当前作品：${String(e)}`) }
  }
  const inProject=!!project3D&&photoOrigin?.origin.sourceId===project3D.id&&JSON.parse(photoOrigin.assemblyRaw).id===current.id
  let currentSaved=false;try{const ref=savedAssemblyRef(storage);currentSaved=!dirty&&ref?.id===current.id&&savedAssemblies.some(a=>a.id===current.id&&a.hash===ref.hash)}catch{/* unknown receipt is never displayed as Saved */}
  return <>
    {hosts.assemblies&&createPortal(<section hidden={viewMode!=='3d'} className="assembly-selector" aria-label="Assembly Selector">
      <div className="assembly-list-heading">Assembly / 当前作品 <InfoHint label="Assembly 显示与编辑"><p>勾选只控制显示；点击作品名称切换当前编辑对象。其他作品只读，显示偏移不是对齐或合并。切换时恢复已保存的完整 Draft。</p></InfoHint></div>
      {!savedAssemblies.length&&!inProject&&<small>当前 Project 尚无已保存作品。</small>}
      <ul className="assembly-list" aria-label="Project Assemblies">
        {inProject&&!savedAssemblies.some(a=>a.id===current.id)&&<li data-assembly-row={current.id} aria-current="true"><input type="checkbox" aria-label={'显示作品 '+current.id} checked={activeVisible} disabled={operationBusy} onChange={e=>setAssemblyVisible(current.id,e.target.checked)}/><span>{String((photoOrigin!.origin.reconstructionScope as {groupName?:string})?.groupName??'Group')} · {current.pieces.length} Tiles · Draft <b>编辑中</b></span></li>}
        {savedAssemblies.map(a=>{const isCurrent=inProject&&a.id===current.id;return <li key={a.id} data-assembly-row={a.id} aria-current={isCurrent?'true':undefined}>
          <input type="checkbox" aria-label={'显示作品 '+a.id} title="仅控制显示" checked={isCurrent?activeVisible:!!visibility[a.id]} disabled={operationBusy} onChange={e=>setAssemblyVisible(a.id,e.target.checked)}/>
          <button type="button" disabled={operationBusy} aria-label={'编辑作品 '+a.id} aria-pressed={isCurrent} onClick={()=>{if(!isCurrent||!currentSaved)void openSavedAssembly(a.id)}} title={`${a.name} · ${a.id}`}><span>{a.name} · {isCurrent?current.pieces.length:a.tiles} Tiles{a.type==='combined'?' · Combined':''}</span><small>{isCurrent&&!currentSaved?'未保存':'Saved'} · r{isCurrent?current.revision:a.revision}{isCurrent&&<b> · 编辑中</b>}</small></button>
          <a href={addAssemblyToGalleryUrl(a)} target="_blank" rel="noreferrer" aria-label={'Add to Gallery '+a.name}>Add to Gallery · v{a.version} ↗</a>
        </li>})}
      </ul>
      {inProject&&photoOrigin?.origin.kind==='editor-created'?<small data-testid="assembly-origin-summary">Editor · 独立新建作品</small>:inProject&&photoOrigin?.origin.kind==='combined-assembly'?<small data-testid="assembly-origin-summary">Combined · {current.modules?.map(m=>`${m.name} r${m.parent.revision} · ${m.parent.id.slice(0,12)} / ${m.parent.hash.slice(0,8)}`).join(' + ')}</small>:inProject&&<small data-testid="assembly-origin-summary">Group {String((photoOrigin!.origin.reconstructionScope as {groupName?:string})?.groupName??'全部模块')} · Plan {String(photoOrigin!.origin.planId).slice(0,8)} · Execution {String(photoOrigin!.origin.executionId).slice(0,8)} · {photoOrigin!.origin.diagnostic?'Diagnostic':'Candidate'}</small>}
      {libraryError&&<p role="alert">{libraryError}</p>}{displayError&&<p role="alert">{displayError}</p>}{project3D&&photoOrigin&&!inProject&&<small>工作区来自其他 Project；选择列表中的作品可恢复当前 Project 的存档。</small>}
    </section>,hosts.assemblies)}
    <StudioSlot column="workspace" stages={['assembly']} view="3d">
      <section className="magnetic-3d-workspace" aria-label="3D 作品查看" data-workspace-assembly-id={current.id} data-workspace-revision={current.revision}>
        <section className="magnetic-3d-assembly-actions" aria-label="3D Assembly 操作栏" aria-busy={assemblyIO}>
          <div className="assembly-primary-actions">
            <div role="group" aria-label="3D View / Edit"><button disabled={operationBusy} aria-pressed={!editing} onClick={()=>{setLive(null);setEditing(false)}}>View</button><button disabled={operationBusy} aria-pressed={editing} onClick={startEdit}>Edit Draft</button></div>
            <button disabled={!editing||operationBusy||!!boot.error} onClick={save}>保存 3D Draft</button>
            <button disabled={operationBusy} onClick={()=>void revalidate()}>Revalidate Geometry</button>
            <button disabled={operationBusy} onClick={()=>{fileRequest.current++;load(photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id?photoOrigin.assemblyRaw:loaded.source,loaded.name)}}>重新加载来源</button>
            <button hidden={scope?.mode==='edit'} disabled={operationBusy||savedAssemblies.length<2} aria-expanded={createCombinedOpen} onClick={()=>setCreateCombinedOpen(v=>!v)}>新建 Combined Assembly</button>
          </div>
          <div className="assembly-status-row"><p className="magnetic-3d-summary" role="status"><span>{assembly.pieces.length} 片 · {assembly.connections.length} 条连接 · </span><span className={!validation.valid?'magnetic-3d-blocker':undefined}>{validation.valid?'Geometry Valid':'Geometry Invalid'}</span><span> · {dirty?'未保存':'Draft'}</span><span> · 碰撞 {collisionIssues.length}</span>{current.modules&&<span> · {current.modules.length} Groups</span>}{boot.recovery&&dirty&&<span data-testid="workspace-recovery-status"> · 已恢复未保存修改</span>}</p>
            <label className="assembly-tile-ids"><input type="checkbox" checked={showTileIds} onChange={e=>setShowTileIds(e.target.checked)}/>显示 Tile ID</label>
          </div>
          <AssemblyEditorToolbar operation={operation} selectOnly={selectOnly} symmetryOpen={symmetryOpen} disabledReason={toolbarDisabled} transformReason={transformDisabled} copyReason={copyDisabled} deleteReason={deleteDisabled} symmetryReason={symmetryDisabled}
            onSelect={chooseSelect} onOperation={chooseOperation} onSymmetry={toggleSymmetry}
            onCopy={()=>{if(selected)apply(h=>{const result=actions.duplicatePieceAction(h,selected);setSelection({kind:'piece',id:result.newId});return result.history})}}
            onDelete={()=>{if(selected)apply(h=>{setSelection({kind:'none'});return actions.deletePieceAction(h,selected)})}}/>
        </section>
      {createCombinedOpen&&<CreateCombinedPanel key={'create-'+current.id} currentId={current.id} saved={savedAssemblies} visible={visibility} busy={operationBusy} onCreate={createCombined}/>}
        {profileError&&<p role="alert" className="magnetic-3d-blocker">{profileError}</p>}
        {(readOnlyAssemblies.length>0||!activeVisible)&&<div className="assembly-display-summary" data-testid="multi-assembly-display" data-displayed-assemblies={JSON.stringify([...(activeVisible?[{id:current.id,tiles:current.pieces.length,offset:[0,0,0],active:true}]:[]),...readOnlyAssemblies.map(a=>({id:a.id,tiles:a.pieces.length,offset:a.offset,snapshotHash:a.snapshotHash,active:false}))])}>
          <span>{activeVisible?`${String((photoOrigin?.origin.reconstructionScope as {groupName?:string})?.groupName??current.id)} · 编辑中`:'当前编辑作品已隐藏'}</span>{readOnlyAssemblies.map(a=><span key={a.id}>{a.name} · {a.pieces.length} Tiles · 只读</span>)}<small>并列显示，尚未对齐</small>
        </div>}
        {readOnlySelection&&<p className="assembly-display-inspection" role="status" data-testid="read-only-assembly-selection">{readOnlyAssemblies.find(a=>a.id===readOnlySelection.assemblyId)?.name} · {readOnlySelection.pieceId} · 只读；请在左栏点击作品名称切换编辑。</p>}
        {(moduleLive||modulePreview)&&<p role="status" data-testid="module-viewer-preview">模块{modulePreview?(modulePreview.boundsAlignment?'边界对齐预览 · 尚未修改 Draft':'吸附预览 · 尚未修改 Draft'):'刚体拖动预览'} · 全部内部 Pose 联动；固定模块保持不动。</p>}
        {currentRepair&&<p className="magnetic-constraint-repair-banner" data-testid="repair-viewer-preview" data-repair-angles={JSON.stringify(currentRepair.candidate.angles)}>自动修复预览 · {currentRepair.candidate.id} · {currentRepair.candidate.geometry.valid?'Geometry Valid':'Geometry Invalid · 部分改善'} · {currentRepair.candidate.proposedConnection?'建议新增 Connection':'仅改善碰撞'} · 碰撞 {currentRepair.candidate.collisions.length} · 当前 Draft 尚未修改</p>}
        {active && (editing ? <ViewerErrorBoundary key={`edit-${loaded.sequence}`}><EditorCanvas snapViewport={snapViewport} selectionHighlightIds={symmetryOpen?symmetrySources:undefined} groupSelectedIds={moduleToolOpen?selectedGroup?.pieces.map(p=>p.id):undefined} moduleGizmo={moduleGizmo} moduleMode={moduleToolOpen} readOnlyAssemblies={readOnlyAssemblies} activeVisible={activeVisible} onInspectAssemblyPiece={inspectReadOnly} readOnlySelection={readOnlySelection} project={moduleProject??repairProject??project} previewPieces={symmetryPieces} selection={currentRepair?.candidate.proposedConnection?{kind:'connection',index:currentRepair.candidate.assembly.connections.length-1}:selection} toolMode={selectOnly||moduleToolOpen||!!parentReadOnly||symmetryOpen||repairSearching||currentRepair?'select':tool} showTileIds={showTileIds} collision={repairCollision??selectedCollision} collisionFocus={currentRepair?null:collisionFocus}
          onSelectPiece={id => {if(operationBusy||snapPicker)return;setSelection({kind:'piece',id});if(symmetryOpen)setSymmetrySources(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])}}
          onSelectConnection={index => { if (!operationBusy&&!snapPicker) setSelection({ kind: 'connection', index }) }}
          onSelectPort={(id,portId)=>{if(operationBusy||symmetryOpen||moduleToolOpen)return;if(!selectOnly&&operation==='snap'&&snapMode==='click'&&selected&&id!==selected){prepareSnap({pieceA:id,portA:portId,pieceB:selected,portB:ownPort,...snapSettings});return}setSelection({kind:'piece',id});setOwnPort(portId)}}
          onClearSelection={() => { if (!operationBusy&&!snapPicker) setSelection({ kind: 'none' }) }} focusRequest={errorFocus} fitRequest={moduleFit}
          onMovePiece={(pieceId, tf) => setLive({ pieceId, tf })}
          onMovePieceCommit={(id, tf) => apply(h => actions.setPieceTransformAction(h, id, tf))}
          onCreateConnection={prepareSnap} onSnapProposal={prepareSnap} onMovePieceCancel={()=>setLive(null)} snapCandidates={[snapSettings]} snapSourcePort={ownPort} showSnapTargets={!selectOnly&&operation==='snap'&&snapMode==='click'&&!symmetryOpen&&!moduleToolOpen&&!parentReadOnly} interactionLocked={!!parentReadOnly||!!pendingSnap||symmetryOpen||repairSearching||!!currentRepair} snapGhost={pendingSnap?{pieceId:pendingSnap.connection.pieceB,tf:pendingSnap.assembly.pieces.find(p=>p.id===pendingSnap.connection.pieceB)!.pose}:null}
          cameraTargetRef={cameraTargetRef} liveTransformOverride={live} initialCameraView={initialCameraView} onCameraViewChange={setEditorCamera}/></ViewerErrorBoundary>
          : <MagnetScene3D key={loaded.sequence} assembly={assembly} readOnlyAssemblies={readOnlyAssemblies} activeVisible={activeVisible} onInspectAssemblyPiece={inspectReadOnly} readOnlySelection={readOnlySelection} selected={selected} onSelect={setSelected} showTileIds={showTileIds} selectedConnection={selectedConnection} collision={selectedCollision} collisionFocus={collisionFocus} initialCameraView={initialCameraView}/>)}
        {editing&&<details><summary>相机状态</summary><output aria-label="3D Editor 相机状态">{JSON.stringify(editorCamera)}</output></details>}
        <details className="magnetic-3d-load"><summary>加载 / 导出 Assembly3D</summary>
          <label>Assembly3D JSON<textarea aria-label="Assembly3D JSON" value={text} spellCheck={false} maxLength={1_000_000}
            onChange={e => setText(e.target.value)}/></label>
          <div className="button-row"><button hidden={!!scope} onClick={() => { fileRequest.current++; load(text, '加载的 Assembly3D') }}>加载 JSON</button>
            <label hidden={!!scope} className="magnetic-3d-file">打开 JSON 文件<input type="file" aria-label="打开 Assembly3D 文件" accept=".json,application/json"
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
          <p>{editing ? (moduleToolOpen?'Group 模式：点击任意成员选中整个 Group，在顶部切换 Move / Rotate / Orient / Snap。来源作品不会随之修改。':snapMode==='drag'?'拖动吸附：选择零件，拖动 Gizmo 靠近兼容边，松手后确认或取消。没有候选时保留原位；自由移动/旋转可使用 Edit Tools。':'点击吸附：选择源零件 B 及其连接边，再点击目标 A 的兼容边或在右栏指定，预览后确认。') : 'View 只读：点击画布或表格查看。'}</p>
          <p>已连接零件需要移动时，请先明确解除连接。手动移动只修改 Pose；吸附与显式求解才沿约束重新放置。WASDQE 移动，RTFGVB 旋转，Shift 大步；Undo / Redo 可恢复编辑。</p>
          <p>连接使用当前 Assembly 中的索引 # 作为身份；两端表格按钮指向同一条连接。标签被其他零件遮挡时隐藏，选中标签仍保留并使用虚线；标签不拦截鼠标。</p>
          <p>几何校验不代表真实磁力或物理稳定性保证。Invalid Draft 可继续编辑、保存和展示；教程仍显示真实几何诊断。</p>
        </InfoHint></header>
        <EditorInspector editing={editing&&!moduleToolOpen&&!symmetryOpen&&!parentReadOnly} canInsert={editing&&!symmetryOpen} onInserted={id=>{setSelectionMode('tile');setSelection({kind:'piece',id});chooseOperation('move')}} readOnlyReason={parentReadOnly||undefined} operation={selectOnly?'select':operation}
          currentToolLabel={!editing?'View':symmetryOpen?'Symmetry Fill':selectOnly?'Select':`${moduleToolOpen?'Group · ':''}${({move:'Move',rotate:'Rotate',orient:'Orient',snap:'Snap'})[operation]}`}
          currentToolPanel={<>
            {editing&&symmetryOpen&&<SymmetryFillPanel assembly={current} sourceIds={symmetrySources} preview={symmetryPreview} setPreview={setSymmetryPreview} confirmPreview={confirmFill} close={()=>{setSymmetryOpen(false);setSymmetrySources([]);setSymmetryPreview(null)}}/>}
            {editing&&moduleToolOpen&&!selectOnly&&!symmetryOpen&&<div hidden={!selectedGroup}><ModuleTransformPanel showSpatialInspection={false} key={current.id} orientationTarget={snapOrientationTargets[moduleTool.moving]} onOrientationTarget={target=>setSnapOrientationTargets(ts=>({...ts,[target.groupId]:target}))} assembly={current} snapSelection={effectiveSnap} setSnapSelection={s=>{setSnapSelection(s);setSnapPicker(null)}} picker={snapPicker} togglePicker={toggleSnapPicker} inspectionAssembly={moduleLive??modulePreview?.assembly??current} selectedGroupId={selectedGroup?.id} operation={operation} tool={moduleTool} setTool={t=>{setModuleTool(t);if(t.face!==moduleTool.face)setSelection({kind:'piece',id:t.face})}} busy={assemblyIO||!!moduleLive||!!live||!!pendingSnap||!!symmetryPreview||repairSearching||!!currentRepair||!selectedGroup||symmetryOpen} preview={modulePreview} onPreview={p=>{setModulePreview(p);setModuleFit({ts:Date.now()})}} onApply={applyModule}/></div>}
            {pendingSnap&&<section className="magnetic-3d-snap-preview" aria-label="3D 吸附预览"><h4>吸附预览 · 尚未修改 Draft</h4><p>{pendingSnap.connection.pieceB}:{pendingSnap.connection.portB} → {pendingSnap.connection.pieceA}:{pendingSnap.connection.portA}<br/>{pendingSnap.connection.dihedralDeg}° · flip {String(pendingSnap.connection.flip??false)}</p><p>仅移动源零件 B；不修改其他零件或原连接。{pendingSnap.geometry.valid?'预览几何校验通过。':'现有 Invalid 问题仍保留，不能作为正式有效作品。'}</p><button onClick={confirmSnap}>确认吸附</button><button onClick={()=>{setPendingSnap(null);setLive(null)}}>取消吸附</button></section>}
          </>}
          toolControls={editing&&!moduleToolOpen&&!selectOnly&&operation==='snap'&&!symmetryOpen&&<label className="magnetic-3d-snap-switch">吸附方式<select aria-label="3D 吸附方式" value={snapMode} disabled={operationBusy} onChange={e=>{const mode=e.target.value as 'drag'|'click';setPendingSnap(null);setSnapMode(mode);setTool(mode==='drag'?'snap':'select')}}><option value="drag">拖动吸附</option><option value="click">点击吸附</option></select></label>}
          selectionTitle={moduleToolOpen&&selectedGroup?<span data-testid="selected-assembly-group" data-group-id={selectedGroup.id}>{selectedGroup.name}</span>:chosen?.id??(selectedConnection&&selection.kind==='connection'?`Connection #${selection.index}`:'')}
          selectionControls={editing&&current.modules&&<div className="assembly-selection-controls">
            <div className="button-row" role="group" aria-label="Selection 模式">{(['group','tile'] as const).map(mode=><button key={mode} disabled={operationBusy} aria-pressed={selectionMode===mode} onClick={()=>setSelectionMode(mode)}>{mode==='group'?'Group':'Tile'}</button>)}</div>
            {moduleToolOpen&&<label>Group<select aria-label="当前 Group" disabled={operationBusy} value={selectedGroup?.id??''} onChange={e=>{const m=current.modules!.find(m=>m.id===e.target.value);setSelection(m?{kind:'piece',id:m.pieces[0].id}:{kind:'none'})}}><option value="">点击 Viewer 选择 Group</option>{current.modules!.map(m=><option key={m.id} value={m.id}>{m.name} · {m.pieces.length} Tiles</option>)}</select></label>}
          </div>}
          selectionInfo={<>
        {current.modules&&chosen&&!parentTile&&<small data-testid="combined-free-tile">自由 Tile · 当前 Combined 自有，不属于固定 Parent Group</small>}
        {moduleToolOpen&&selectedGroup?<GroupSelectionDetails assembly={moduleLive??modulePreview?.assembly??current} groupId={selectedGroup.id} format={format} preview={!!moduleLive||!!modulePreview}/>:selectedCollision?<div className="magnetic-3d-collision-detail" data-selected-collision={selectedCollision.key} data-collision-revision={assembly.revision}>
          <h4>{selectedCollision.evidence.pieceIds.join(' / ')}</h4><p className="magnetic-3d-blocker">Solid Collision Invalid · depth {depthFormat(selectedCollision.evidence.penetrationDepth)}</p>
          <p>{collisionLocality(selectedCollision.evidence.locality)} · Revision {assembly.revision} · 当前完整快照</p>
          <p className="hint">{selectedCollision.reason}</p>
          <dl><dt>交集中心</dt><dd>{selectedCollision.center?.map(format).join(', ')??'不可用'}</dd><dt>交集体积</dt><dd>{selectedCollision.kind==='volume'?selectedCollision.volume.toExponential(6):'未可靠构造'}</dd></dl>
          <details><summary>当前碰撞完整证据 / Raw</summary><pre>{JSON.stringify(selectedCollision.evidence,null,2)}</pre></details>
        </div>:chosen ? <TileSelectionDetails piece={chosen} assembly={assembly} format={format} busy={operationBusy} onConnection={index=>setSelection({kind:'connection',index})} onColor={editing&&!moduleToolOpen&&!symmetryOpen?color=>apply(h=>actions.setPieceColorAction(h,chosen.id,color)):undefined}/> : selectedConnection ? <div data-selected-3d-connection={selection.kind==='connection'?selection.index:''}><dl>
          <dt>A / Port</dt><dd>{selectedConnection.pieceA} · {selectedConnection.portA}</dd><dt>B / Port</dt><dd>{selectedConnection.pieceB} · {selectedConnection.portB}</dd>
          <dt>Dihedral / Flip</dt><dd>{selectedConnection.dihedralDeg}° · {String(selectedConnection.flip??false)}</dd>
        </dl></div> : <p className="hint">点击画布或表格选择 Tile / Connection。</p>}

        </>} globalTools={<div className="button-row"><button hidden={!!scope} disabled={operationBusy} onClick={blank}>新建空白 3D Draft</button><button disabled={operationBusy} onClick={reloadSaved}>重新加载已保存 Draft</button></div>}
          assembly={current} project={project} profiles={profiles} selection={selection} ownPort={ownPort}
          setOwnPort={setOwnPort} apply={apply} select={setSelection} busy={operationBusy} onPreviewSnap={prepareSnap} snapSettings={snapSettings} setSnapSettings={setSnapSettings}/>


        <section className="magnetic-3d-geometry-check" aria-label="Geometry Check"><h4>Geometry Check</h4>
          <p role="status"><b className={!validation.valid?'magnetic-3d-blocker':undefined}>{!validation.valid?'Geometry Invalid':'Geometry Valid'}</b><br/>Revision {assembly.revision} · {assembly.pieces.length} 片 · {assembly.connections.length} 条连接</p>
          {!!geometryErrors.length&&<p className="magnetic-3d-blocker">{geometryErrors.length} 个错误 · {geometryErrors[0].message}</p>}
          <section className="magnetic-3d-collision-review" aria-label="Collision Diagnostics"><div className="magnetic-3d-collision-heading"><h4>Collision Diagnostics · {collisionIssues.length}</h4></div>
            {!collisionIssues.length?<p className="hint">当前严格 Validator 未报告实体碰撞。</p>:<table className="magnetic-3d-collision-table"><colgroup><col/><col style={{width:'18%'}}/><col style={{width:'13%'}}/><col style={{width:'19%'}}/></colgroup><thead><tr><th>Tile Pair</th><th>Depth</th><th>修复</th><th title="Non-repairable：不作为优化目标或评分收益，仍完整验证且不得加重">不可修复</th></tr></thead><tbody>{collisionIssues.map((issue,index)=>{
              const key=collisionPairKey(issue.relatedPieceIds??[]),selected=selectedCollision?.key===key,select=()=>{if(!operationBusy){setSelection(selected?{kind:'none'}:{kind:'collision',key,sourceKey:snapshotKey});setCollisionFocus(null)}}
              return <tr key={index} data-collision-key={key} aria-selected={selected} title={issue.message} onClick={select}>
                <td><button disabled={operationBusy||!issue.relatedPieceIds||issue.relatedPieceIds.length!==2} aria-pressed={selected} onClick={e=>{e.stopPropagation();select()}}>{issue.relatedPieceIds?.join(' / ')??'未指定零件对'}</button></td>
                <td>{typeof issue.penetrationDepth==='number'?depthFormat(issue.penetrationDepth):'—'}</td>
                <td><input type="checkbox" aria-label={`修复目标 ${issue.relatedPieceIds?.join(' / ')}`} checked={repairTargets.includes(key)&&!nonRepairable.includes(key)} disabled={operationBusy||!issue.relatedPieceIds||nonRepairable.includes(key)} onClick={e=>e.stopPropagation()} onChange={e=>setRepairTargets(ids=>e.target.checked?[...ids,key]:ids.filter(id=>id!==key))}/></td>
                <td><input type="checkbox" aria-label={`不可修复碰撞 ${issue.relatedPieceIds?.join(' / ')}`} checked={nonRepairable.includes(key)} disabled={!editing||operationBusy||!issue.relatedPieceIds} onClick={e=>e.stopPropagation()} onChange={e=>apply(h=>actions.setNonRepairableCollisionAction(h,key,e.target.checked))}/></td>
              </tr>
            })}</tbody></table>}
            <div className="magnetic-3d-collision-actions"><div><button disabled={!selectedCollision?.center} onClick={()=>selectedCollision&&setCollisionFocus({target:selectedCollision,sequence:(collisionFocus?.sequence??0)+1})}>聚焦碰撞</button><button disabled={!selectedCollision} onClick={()=>{setSelection({kind:'none'});setCollisionFocus(null)}}>取消碰撞选择</button></div>
            </div>
            {selectedCollision&&<p className="hint">{selectedCollision.kind==='volume'?'显示完整厚度碰撞代理的实际交集（透视），与 Viewer 外观网格不同；仍为 Invalid。':selectedCollision.reason}</p>}
          </section>
          <AutoConstraintRepairPanel assembly={current} hints={angleHints} editing={editing} disabled={operationBusy} nonRepairable={nonRepairable} excludedCount={collisionIssues.filter(i=>nonRepairable.includes(collisionPairKey(i.relatedPieceIds??[]))).length} targets={repairTargets} highlighted={selectedCollision?.key} collisionCount={collisionIssues.length} onBusy={setRepairSearching} onPreview={setRepairPreview} onApply={applyConstraintRepair}/>
          <details onToggle={e=>setShowGeometryDetails(e.currentTarget.open)}><summary>详细几何 / Collision Diagnostic · {validation.issues.length}</summary>
            <p>{assembly.id} · revision {assembly.revision}</p>
            {validation.issues.length?<ul>{validation.issues.map((issue,i)=><li key={i} className={issue.severity==='error'?'magnetic-3d-blocker':undefined}><button className={issue.severity==='error'?'magnetic-3d-blocker':undefined} disabled={operationBusy} onClick={()=>locateGeometryError(issue)}>{issue.message}</button></li>)}</ul>:<p>保存位姿满足当前连接与碰撞检查。</p>}
            {!!collisionDetails.length&&<details><summary>碰撞空间证据 / Raw</summary><pre>{JSON.stringify(collisionDetails,null,2)}</pre></details>}
          </details>
        </section>

        <div className="magnetic-3d-draft-tools">
          {editing && <><button disabled={operationBusy || !history.past.length} onClick={() => { apply(actions.undo); setSelection({ kind: 'none' }) }}>3D Undo</button>
            <button disabled={operationBusy || !history.future.length} onClick={() => { apply(actions.redo); setSelection({ kind: 'none' }) }}>3D Redo</button></>}
        </div>
        {saveConflict&&<section aria-label="保存版本冲突"><p>服务端已有 v{saveConflict.version}；当前草稿仍保留。可以明确选择在该版本后追加当前草稿，Gallery 发布版本保持不变。</p><button disabled={operationBusy} onClick={()=>void saveAfterConflict()}>保留当前草稿，在 v{saveConflict.version} 后追加保存</button></section>}
        {saveNotice && <p className="magnetic-3d-save-notice" role="status">{saveNotice}</p>}
        {error && <div><p role="alert">{error.length>200?error.slice(0,200)+'…':error}</p>{error.length>200&&<details><summary>操作错误详情</summary><p>{error}</p></details>}</div>}
        {photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id&&Array.isArray(photoOrigin.origin.pendingObservations)&&<PendingObservations assembly={current} values={photoOrigin.origin.pendingObservations as PendingObservation[]} disabled={!editing||operationBusy} onPlace={(p,pose)=>apply(h=>{const next=placePendingObservation(h,p,pose);setSelection({kind:'piece',id:p.id});return next})}/>}
        <AssemblySelectionTable angleHints={<AssemblyAngleHints report={validation} assembly={assembly} state={angleHints} selection={selection} select={setSelection} busy={operationBusy}/>} symmetrySources={editing&&symmetryOpen?symmetrySources:undefined} onSymmetrySource={(id,checked)=>{setSymmetryPreview(null);setSymmetrySources(ids=>checked?[...ids,id]:ids.filter(x=>x!==id))}} collisionIds={selectedCollision?.evidence.pieceIds} assembly={assembly} selection={selection} select={setSelection} busy={operationBusy}/>
        {photoOrigin&&JSON.parse(photoOrigin.assemblyRaw).id===current.id&&<details className="visible3d-origin"><summary>{photoOrigin.origin.kind==='editor-created'?'Editor 起点与快照':'照片来源与快照'}</summary><p>Source {photoOrigin.origin.sourceId as string} · {photoOrigin.assemblyRaw===serializeAssembly3D(current)?'起点快照一致':photoOrigin.origin.kind==='editor-created'?'已编辑，保留独立 Editor 起点':'已编辑，原照片关联仅供追溯'}</p><p>{photoOrigin.origin.kind==='editor-created'?'Editor 直接创建；没有照片或重建历史。':'Geometry Valid 与照片匹配独立；'}来源记录 {photoOrigin.origin.id as string}</p><pre>{JSON.stringify(photoOrigin.origin,null,2)}</pre>{!!photoOrigin.symmetryFills?.length&&<details><summary>编辑器对称假设来源（非照片观察）</summary><pre>{JSON.stringify(photoOrigin.symmetryFills,null,2)}</pre></details>}</details>}
        <details hidden={!!scope} className="magnetic-3d-examples-debug"><summary>Examples / Debug</summary><p className="hint">开发示例；加载会替换当前查看内容，不属于正式 Tiles Catalog。当前来源：{loaded.name}</p><div className="magnetic-3d-examples" role="group" aria-label="3D 示例">{examples.map(example=><button key={example.id} disabled={operationBusy} data-3d-example={example.id} aria-pressed={assembly.id===example.id} onClick={()=>{fileRequest.current++;load(JSON.stringify(example.data,null,2),example.name)}}>{example.name}</button>)}</div><p>{componentCount(assembly)} 个组件 · revision {assembly.revision}</p></details>
      </section>
    </StudioSlot>
  </>
}

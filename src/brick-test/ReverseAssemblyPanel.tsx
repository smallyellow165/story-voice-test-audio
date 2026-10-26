import {TraceLinks} from '../llm-traces/TraceLinks'
import {reviewObservations,validateReviewParts,type HiddenPart,type ManualSymmetry} from '../brick-vision/review-parts.mjs'
import {observationPrintHints} from '../brick-vision/print-hints.mjs'
import { recognitionBlockReason } from './reverse-recognition-state.mjs'
import { AnchorRevisionForm } from './AnchorRevisionForm'
import { reviewStatus, reviewStatusLabels, matchesReviewFilter } from '../brick-vision/review-status.mjs'
import { CopySceneLink } from '../brick-inventory/CopySceneLink'
import type { ExplorerScene, SceneImageSelection } from '../brick-inventory/explorer-scene.mjs'
import { ReviewStatusFilter, ReviewToolbar } from '../brick-vision/ReviewToolbar'
import type { ReviewFilter } from '../brick-vision/ReviewToolbar'
import type { ObservationCatalogSearch } from '../brick-vision/types'
import { createPortal } from 'react-dom'
import { reverseFeatureEditor } from '../brick-vision/reverse-review.mjs'
import type { InventoryItem } from '../brick-inventory/inventory'
import type { Analysis, AnalysisMode, Draft, Artifact, HistoryItem, History, Restored, Search, Model } from './reverse-types'
import { ServerImagePicker } from '../brick-vision/ServerImagePicker'
import type { PreparedSourceImage } from '../brick-vision/ServerImagePicker'
import { GeometryObservationTable } from './GeometryObservationTable'
import { useEffect, useRef, useState } from 'react'
import { ModelSelector } from '../model-selector'
import { ObservationPreview } from '../brick-vision/ObservationPreview'
import { ObservationTable, ObservationFeatureCells } from '../brick-vision/ObservationTable'
import { ObservationActions } from '../brick-vision/ObservationActions'
import { ObservationModal } from '../brick-vision/ObservationModal'
import { readFeatureEditor } from '../brick-vision/catalog-features.mjs'
import { requestJson } from '../brick-inventory/api.mjs'
import { loadSessions } from '../brick-inventory/storage'
import { newSessionId } from '../brick-inventory/inventory'
import type { SessionInventory } from '../brick-inventory/inventory'
import { AvailableInventory } from './AvailableInventory'
import type { InventoryRow } from './design-types'
import './reverse.css'

type Props = { designSessionId?: string; initialScene?: ExplorerScene; initialHistory?: History; modelsReady?: boolean; onRestoreModel?(id: string): void; inventory: InventoryRow[]; onQuantity(row: InventoryRow, quantity: number): void; models: Model[]; model: string;
  onModel(model: string): void; disabled: boolean; onBusy(busy: boolean): void;
  analysisMode: AnalysisMode; onAnalysisMode(mode: AnalysisMode): void; onDirty(dirty: boolean): void;
  active: boolean; geometryHost: HTMLElement | null; onGeometryPresence(value: boolean): void; onSearchCatalog(request: ObservationCatalogSearch): void; workspaceHost: HTMLElement | null; onApply(items: InventoryItem[]): boolean | void; onReset?(items: InventoryItem[]): boolean | void }
const post = <T,>(action: string, body: unknown) => requestJson<T>('/api/brick-reverse/' + action, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000),
}, 'Reverse ' + action)

export function ReverseRecognitionPanel({ designSessionId, inventory, onQuantity, models, model, onModel, disabled, onBusy, analysisMode, onAnalysisMode, onDirty, active: visible, workspaceHost, geometryHost, onGeometryPresence, onSearchCatalog, onApply, onReset, initialScene, initialHistory, modelsReady = true, onRestoreModel }: Props) {
  const [source, setSource] = useState('full'), [sessions, setSessions] = useState<SessionInventory[]>([]), [sessionId, setSessionId] = useState('')
  const [image, setImage] = useState<PreparedSourceImage | null>(null)
  const [record, setRecord] = useState<Analysis | null>(null), [rows, setRows] = useState<Record<string, Draft>>({})
  const [hiddenParts,setHiddenParts]=useState<HiddenPart[]>([])
  const [manualRelations,setManualRelations]=useState<ManualSymmetry[]>([])
  const reviewParts=reviewObservations(record?.analysis?.observations||[],hiddenParts)
  const [promptVersion, setPromptVersion] = useState(3)
  const [guidedIds, setGuidedIds] = useState<Set<string>>(() => new Set())
  const [hint, setHint] = useState('')
  const [hiddenBoxes, setHiddenBoxes] = useState<Set<string>>(() => new Set())
  const [active, setActive] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const [recordId, setRecordId] = useState(initialScene?.analysisId || ''), [submitted, setSubmitted] = useState(false)
  const [applied, setApplied] = useState(false)
  const [reviewColors, setReviewColors] = useState<{id:number;name:string}[]>([])
  useEffect(() => {
    let active = true
    void requestJson<{colors:{id:number;name:string}[]}>('/api/brick-catalog/filters', {}, '审核颜色').then(r => {if(active)setReviewColors(r.colors)}).catch(() => {})
    return () => {active = false}
  }, [])
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [generationSubmitted, setGenerationSubmitted] = useState(false)
  const [detailId, setDetailId] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory?.items || []), [historyWarning, setHistoryWarning] = useState(initialHistory?.warnings.join('；') || '')
  const [historyReady, setHistoryReady] = useState(initialHistory !== undefined), [pickerReady, setPickerReady] = useState(false)
  const [sceneRestored, setSceneRestored] = useState(!initialScene?.analysisId)
  const autoRestored = useRef(false)
  const [imageSelection, setImageSelection] = useState<SceneImageSelection>({ source: initialScene?.imageSource || 'server_library', name: '' })
  const [restoredSelection, setRestoredSelection] = useState<SceneImageSelection>()
  const [copyMessage, setCopyMessage] = useState('')
  const [copyTarget, setCopyTarget] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false), [savedAt, setSavedAt] = useState(''), [restoreWarning, setRestoreWarning] = useState('')
  const reviewHost = useRef<HTMLDivElement>(null)
  const [reviewFocus, setReviewFocus] = useState(0)
  const tableHost = useRef<HTMLDivElement>(null), previewHost = useRef<HTMLDivElement>(null)
  const gate = useRef(false)
  const requestId = useRef(newSessionId())
  const locked = disabled || !!busy
  const geometryOnly = (record ? record.analysis_mode || 'catalog_match' : analysisMode) === 'geometry_only'
  const recognitionReason = recognitionBlockReason({ busy, disabled, submitted, record, hasImage: !!image,
    modelAvailable: models.some(m => m.id === model), modelsReady, needsSession: !geometryOnly && source === 'today' && !sessionId })
  const catalogEpoch = useRef(0)
  const [candidateNotes, setCandidateNotes] = useState<Record<string, string>>({})
  useEffect(() => { catalogEpoch.current++ }, [visible])
  useEffect(() => () => { catalogEpoch.current++ }, [])
  useEffect(() => { onGeometryPresence(visible && geometryOnly && !!record?.analysis) }, [visible, geometryOnly, record?.analysis, onGeometryPresence])

  async function refreshHistory() {
    const value = await requestJson<History>('/api/brick-reverse/history', {}, '识别历史')
    setHistory(value.items); setHistoryWarning(value.warnings.join('；')); setHistoryReady(true)
  }
  useEffect(() => {
    if (initialHistory !== undefined) return
    let cancelled = false
    void requestJson<History>('/api/brick-reverse/history', {}, '识别历史').then(value => {
      if (!cancelled) { setHistory(value.items); setHistoryWarning(value.warnings.join('；')) }
    }).catch(e => { if (!cancelled) setHistoryWarning(String(e)) }).finally(() => { if (!cancelled) setHistoryReady(true) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!visible || !pickerReady || !modelsReady || !historyReady || autoRestored.current || !initialScene?.analysisId) return
    autoRestored.current = true
    if (!history.some(row => row.id === initialScene.analysisId)) { setError('URL 历史不在成品分析历史中，未加载。'); setSceneRestored(true); return }
    void loadHistory(initialScene.analysisId, true).finally(() => setSceneRestored(true))
  }, [visible, pickerReady, modelsReady, historyReady])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  async function saveReview() {
    if (!record) return
    const value = await post<{ updatedAt: string; copiedSearches: Record<string, Search> }>('saveReview', { analysisId: record.id, hiddenParts, manualRelations,
      rows: Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, {
        features: r.features, quantity: r.quantity, excluded: r.excluded, reason: r.reason,
        searchId: r.search?.id, index: r.index, copiedFromAnalysisId: r.copiedFromAnalysisId,
      }])) })
    setRows(old => Object.fromEntries(Object.entries(old).map(([id,r]) => [id,value.copiedSearches[id] ? {...r,search:value.copiedSearches[id],copiedFromAnalysisId:undefined} : r])))
    setDirty(false); setSavedAt(value.updatedAt); setCopyMessage('')
  }

  async function openCopySources(observationId = '') {
    await refreshHistory()
    setCopyTarget(observationId)
  }
  async function copyPrevious(sourceId: string, observationId?: string) {
    if (!record?.analysis) return
    setCopyTarget(null)
    const previous = await requestJson<{rows:Record<string,Draft>;message:string}>('/api/brick-reverse/previous-review/'+record.id+'?sourceId='+encodeURIComponent(sourceId), {}, '读取所选历史审核')
    const ids = record.analysis.observations.map(o=>o.id).filter(id=>(!observationId||id===observationId)&&previous.rows[id])
    if (!ids.length) { setCopyMessage(Object.keys(previous.rows).length ? '所选历史没有相同 Observation ID，未复制。' : previous.message); return }
    catalogEpoch.current++; setCandidateNotes({}); setApplied(false); setDirty(true)
    setRows(old=>({...old,...Object.fromEntries(ids.map(id=>[id,structuredClone(previous.rows[id])]))}))
    setCopyMessage(`已从所选历史复制 ${ids.length} 项审核。尚未保存；原始识别证据不变。`)
  }

  function additionsChanged() { catalogEpoch.current++;setApplied(false);setDirty(true) }
  function addHiddenPart() {
    const id=window.prompt('Observation ID（例如 wing_opposite；创建后保持不变）')?.trim()
    if(!id||!record?.analysis)return
    const part:HiddenPart={id,source:'manual',visibility:'hidden'}
    try { validateReviewParts(record.analysis.observations,[...hiddenParts,part],manualRelations) }
    catch(e){setError(e instanceof Error?e.message:String(e));return}
    setHiddenParts(old=>[...old,part])
    setRows(old=>({...old,[id]:{features:reverseFeatureEditor({},reviewColors),quantity:'1',excluded:false,reason:''}}))
    additionsChanged();setActive(id);setReviewFilter('all');setReviewFocus(n=>n+1);setError('')
  }
  function removeHiddenPart(id:string) {
    if(!window.confirm('删除人工零件 '+id+' 及引用它的人工关系？点击保存审核后生效。'))return
    setHiddenParts(old=>old.filter(p=>p.id!==id))
    setManualRelations(old=>old.filter(r=>r.from!==id&&r.to!==id))
    setRows(old=>{const next={...old};delete next[id];return next})
    if(active===id)setActive('')
    if(detailId===id)setDetailId('')
    additionsChanged()
  }
  function changeRelations(next:ManualSymmetry[]) { setManualRelations(next);additionsChanged() }

  function selectBox(id: string) {
    if (record?.status === 'complete' && rows[id]) find(id)
    setActive(id)
    setReviewFilter('all')
    setReviewFocus(value => value + 1)
  }
  useEffect(() => {
    if (!reviewFocus) return
    const row = [...(reviewHost.current?.querySelectorAll<HTMLElement>('[data-observation-id]') || [])].find(r => r.dataset.observationId === active)
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    row?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }, [reviewFocus])
  function reset() {
    if (dirty && !window.confirm('存在未保存的审核修改。确定放弃并新建分析？')) return
    catalogEpoch.current++; setCandidateNotes({})
    setDirty(false); setSavedAt(''); setRestoreWarning('')
    setDetailId('')
    if (!initialScene?.image && record?.image && record.originalImage && record.compression) setImage({ ...record.image,
      originalImage: record.originalImage, compression: record.compression,
      imageReference: { kind: record.image_reference?.kind === 'server_library' ? 'server_library' : 'upload',
        name: record.image_reference?.name || record.originalImage.name } })
    setCopyMessage('')
    setHiddenParts([]);setManualRelations([])
    requestId.current = newSessionId(); setRecordId(''); setSubmitted(false); setRecord(null); setRows({}); setArtifact(null)
    setGenerationSubmitted(false); setApplied(false); setError('')
  }
  useEffect(() => {
    if ((record && (record.analysis_mode || 'catalog_match') !== analysisMode) || (submitted && !record)) reset()
    // Strategy changes start a fresh request; history restores retain their own matching strategy.
  }, [analysisMode])
  async function action(name: string, work: () => Promise<void>) {
    if (gate.current || disabled) return
    gate.current = true; setBusy(name); onBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { gate.current = false; setBusy(''); onBusy(false) }
  }
  async function loadHistory(id: string, automatic = false) {
    await action('加载识别结果', async () => {
      const value = await requestJson<Restored>('/api/brick-reverse/restore/' + encodeURIComponent(id), {}, '恢复识别结果与审核')
      if (value.analysis.kind !== 'reverse-analysis') throw new Error('请选择成品分析历史。')
      const mode = value.analysis.analysis_mode || 'catalog_match'
      if (automatic && initialScene?.strategy && initialScene.strategy !== mode) throw new Error('URL 策略与历史类型不兼容；未加载。')
      await acceptAnalysis(value.analysis, value.rows)
      setHiddenParts(value.hiddenParts);setManualRelations(value.manualRelations)
      if (!automatic || !initialScene?.image) {
        setImage(null)
        setRestoredSelection({ source: (automatic && initialScene?.imageSource) || (value.analysis.image_reference?.kind === 'server_library' ? 'server_library' : 'upload'),
          name: value.analysis.image_reference?.name || value.analysis.originalImage?.name || '' })
      }
      if (!automatic || (!initialScene?.provider && !initialScene?.model)) onRestoreModel?.(value.analysis.model)
      setSavedAt(value.updatedAt || '')
      setArtifact(value.artifact); setGenerationSubmitted(value.generationStatus !== 'none')
      setRestoreWarning([...(mode === 'geometry_only' ? [value.analysis.revision ? '已恢复独立人工修订；未调用模型。' : '已恢复 Geometry 原始分析；未调用模型。'] : ['生成状态：' + value.generationStatus]), ...value.warnings].join('；'))
    })
  }
  async function acceptAnalysis(value: Analysis, restoredRows?: Record<string, Draft>) {
    setHiddenParts([]);setManualRelations([])
    setCopyMessage('')
    setCopyTarget(null)
    setHiddenBoxes(new Set())
    setGuidedIds(new Set()); setHint('')
    if (value.status === 'failed' && value.analysis_mode === 'geometry_only' && !value.outputValidation) {
      // Rehydrate diagnostics when a historical response has no structured report.
      try { value = { ...value, outputValidation: await post<NonNullable<Analysis['outputValidation']>>('revalidate', { analysisId: value.id }) } }
      catch { /* Provider/no-output failures retain their original error. */ }
    }
    setError('')

    setReviewFilter('all')
    catalogEpoch.current++; setCandidateNotes({})
    setDetailId(''); setDirty(false); setSavedAt(''); setRestoreWarning('')
    setSource(value.source.kind); onAnalysisMode(value.analysis_mode || 'catalog_match')
    if (value.kind !== 'reverse-analysis') throw new Error('请选择 Reverse Analysis 记录 ID。')
    setRecord(value); setRecordId(value.id); setSubmitted(true); setArtifact(null); setGenerationSubmitted(false); setApplied(false)
    let colors: { id: number; name: string }[] = []
    if (!restoredRows && value.analysis_mode === 'geometry_only') {
      try { colors = (await requestJson<{ colors: typeof colors }>('/api/brick-catalog/filters', {}, 'Catalog 颜色')).colors }
      catch { setRestoreWarning('Catalog 颜色列表暂不可用；请人工核对颜色，原始分析保持不变。') }
    }
    setRows(restoredRows ?? Object.fromEntries((value.analysis?.observations || []).map(o => [o.id, {
      features: reverseFeatureEditor(o, colors), quantity: String(o.quantity ?? 1), excluded: false, reason: '',
    }])))
    setActive(value.analysis?.observations[0]?.id || '')
    if (value.status !== 'complete') setError(value.error?.message || '分析尚未完成；可稍后读取相同记录，不会再次调用模型。')
  }
  function edit(id: string, patch: Partial<Draft>) {
    catalogEpoch.current++
    setCandidateNotes(old => ({ ...old, [id]: '' }))
    setApplied(false); setDirty(true)
    setRows(old => ({ ...old, [id]: { ...old[id], ...patch } }))
  }
  function find(id: string, method: 'features' | 'part' | 'manual' = 'features') {
    if (!record || locked) return
    try {
      const row = rows[id]
      const partNumber = method === 'part' ? row.features.partNumber?.trim() : undefined
      if (method === 'part' && !partNumber) throw new Error('请先填写 Part Number；模型参考不会自动用于确认。')
      const features = method === 'features' ? readFeatureEditor(row.features)
        : { color_id: null, size: null, shape: null, print: 'unknown' as const }
      const epoch = ++catalogEpoch.current
      setActive(id); setError('')
      setCandidateNotes(old => ({ ...old, [id]: '正在检索；结果见右栏' }))
      onSearchCatalog({ key: record.id + ':' + id + ':' + epoch, observationId: id,
        method, partNumber, features, quantity: row.quantity, analysisId: record.id,
        printHints: method === 'features' ? observationPrintHints(record.analysis?.observations.find(o=>o.id===id)) : [],
        onResults(count) {
          if (catalogEpoch.current !== epoch) return
          setCandidateNotes(old => ({ ...old, [id]: count == null ? '检索失败；查看右栏' : '待选择 · 本页 ' + count + ' 个型号' }))
        },
        async onChoose(item, _evidence, isCurrent) {
          if (catalogEpoch.current !== epoch || gate.current || !isCurrent()) throw new Error('识别项已改变，请重新检索。')
          gate.current = true; setBusy('确认 Catalog 身份'); onBusy(true)
          try {
            // Existing persistence requires a server-owned searchId/index. Only
            // after explicit selection, resolve that exact identity for saving.
            // This does not render a second candidate list or assert geometry.
            const resolved = await post<Search>('search', { analysisId: record.id, observationId: id, hiddenParts,
              features: { color_id: null, size: null, shape: null, print: 'unknown' }, partNumber: item.part_num, page: 1 })
            if (catalogEpoch.current !== epoch || !isCurrent()) throw new Error('搜索目标已改变，本次结果未回填。')
            const index = resolved.rows.findIndex(r => r.source.part_num === item.part_num && r.source.color_id === item.color_id && r.sourceAllowed)
            if (index < 0) throw new Error('该型号 / 颜色未通过现有 Catalog 身份或 可用零件范围检查。')
            edit(id, { features: { ...row.features, partNumber: item.part_num, color: String(item.color_id) }, quantity: String(item.quantity),
              search: resolved, index, excluded: false })
            setActive(id)
          } finally { gate.current = false; setBusy(''); onBusy(false) }
        },
      })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  function download(value: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = name + '.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const isConfirmed = (row: Draft | undefined) => !!row && !row.excluded
    && !!(row.index === undefined ? undefined : row.search?.rows[row.index])?.sourceAllowed
  const confirmedCount = reviewParts.filter(o => isConfirmed(rows[o.id])).length
  const confirmedItems = Object.values(rows).flatMap(r => {
    const chosen = r.index === undefined ? undefined : r.search?.rows[r.index]
    const quantity = Number(r.quantity)
    return !r.excluded && chosen?.sourceAllowed && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100
      ? [{ ...chosen.source, quantity }] : []
  })
  const displayedInventory = record?.source.kind === 'virtual' ? record.source.inventory : inventory
  const preview = record ? record.originalImage?.imageBase64 ? record.originalImage : record.image?.imageBase64 ? record.image : null : image
  const selectedReview = rows[active]
  const selectedPart = selectedReview?.index === undefined ? undefined : selectedReview.search?.rows[selectedReview.index]?.source
  const geometry = <div className="brick-reverse" hidden={!visible}>
    {record?.analysis && geometryOnly && <>
      <p>{record.analysis.appearance}</p>
      <p>Observed = 直接可见；Inferred = 几何推断；Unknown = 无法确定。此结果未经后续几何验证，不是 Validated。</p>
      <p><b>Scale:</b> {record.analysis.scale_evidence || 'Unknown'}</p>
      <div><b>Anchors:</b> {record.analysis.anchors?.length ? record.analysis.anchors.map(a => <p key={a.observation_id}>
        <button onClick={() => selectBox(a.observation_id)}>{a.observation_id}</button> · {a.confidence} · {a.evidence}
      </p>) : '无可靠 Anchor'}</div>
      <GeometryObservationTable observations={record.analysis.observations} active={active} hostRef={tableHost}
        onSelect={id => { setActive(id); previewHost.current?.scrollIntoView({ block: 'nearest' }) }} onDetail={setDetailId} />
      <details><summary>Possible connections · 视觉假设 / Unknowns</summary>
        <pre>{JSON.stringify({ relations: record.analysis.relations, unknowns: record.analysis.unknowns }, null, 2)}</pre>
      </details>
    </>}
  </div>
  const workspace = <div className="brick-reverse vision-review-layout" hidden={!visible}>
    <ReviewToolbar confirmed={confirmedCount} total={reviewParts.length}
      saved={!dirty && !!savedAt} help={<>
        <p>从左栏识别或加载历史，在此审核；零件目录位于右栏。</p>
        <p>宽、深使用 Stud（16 mm），高使用 Brick（19.2 mm）；未知请留空。按特征查找会重置并填写右栏零件目录。确认型号与颜色不代表已通过拼装验证，原始几何证据保持不变。</p>
        {!geometryOnly && record?.analysis && <p>{record.analysis.appearance}</p>}
        <p>识别结果已保存；审核记录保存在服务器。已确认数量按识别项计算，尺寸仅验证查询时已填条件，请核对候选依据。</p>
        <p>加入我的积木仅累计到当前清单，不保存审核或清单。未保存审核请点击“保存审核”；未匹配的识别项也可保存。先保存审核，再进入 Design Lab。</p>
      </>}>
      <button disabled={locked || !record?.analysis || record.status !== 'complete'} onClick={() => void action('保存审核', saveReview)}>保存审核</button>
      <button disabled={locked || record?.status !== 'complete'} onClick={() => void action('读取历史审核来源', () => openCopySources())}>Copy from ▾</button>
      <button disabled={locked || record?.status !== 'complete'} onClick={addHiddenPart}>Add Hidden Part</button>
      <button disabled={locked || applied || !confirmedItems.length} onClick={() => void action('加入我的积木', async () => {
        if (onApply(confirmedItems) !== false) setApplied(true)
      })}>{applied ? '已加入我的积木；请保存积木清单' : '加入我的积木'}</button>
      {onReset && <button disabled={locked || !confirmedItems.length} onClick={() => void action('重置我的积木', async () => {
        if (onReset(confirmedItems) !== false) setApplied(false)
      })}>重置我的积木</button>}
      {!dirty && !!savedAt && record?.status === 'complete' && <a className="vision-review-design-link" href={import.meta.env.BASE_URL + 'brick-test.html?analysisId=' + encodeURIComponent(record.id) + (designSessionId ? '&sessionId=' + encodeURIComponent(designSessionId) : '')}>在 Design Lab 加载参考分析 ↗</a>}
      {!dirty && !!savedAt && record?.status === 'complete' && <a className="vision-review-design-link" href={import.meta.env.BASE_URL + 'brick-test.html?workflow=spatial&analysisId=' + encodeURIComponent(record.id)}>Spatial Assembly · 复原已审核照片 ↗</a>}
    </ReviewToolbar>
    {copyMessage && <p role="status">{copyMessage}</p>}
    {copyTarget !== null && <div role="dialog" aria-label="Copy from 历史 Review" style={{position:'fixed',zIndex:1000,top:'20%',left:'50%',transform:'translateX(-50%)',width:'min(560px, 90vw)',maxHeight:'60vh',overflowY:'auto',background:'white',border:'1px solid #b9ceca',borderRadius:6,padding:12,boxShadow:'0 4px 20px #0003'}}>
      <div className="brick-actions"><strong>{copyTarget ? `复制到 ${copyTarget}` : '批量复制匹配的审核行'}</strong><button type="button" onClick={()=>setCopyTarget(null)}>关闭</button></div>
      {history.filter(r=>r.id!==record?.id && r.hasSavedReview).slice(0,10).map(r=><button type="button" key={r.id} disabled={locked} style={{display:'block',width:'100%',textAlign:'left',marginTop:6}} onClick={()=>void action('复制历史审核',()=>copyPrevious(r.id,copyTarget||undefined))}>
        {r.createdAt} · {r.provider} / {r.model}<br/>{(r.appearance || r.image_reference?.name || r.status).slice(0,100)}
      </button>)}
      {!history.some(r=>r.id!==record?.id && r.hasSavedReview) && <p role="status">没有可用的历史 Review。</p>}
    </div>}
    {record?.analysis && <>
      <div className="brick-actions" aria-label="照片 BBox 显示控制">
        <button type="button" onClick={() => setHiddenBoxes(new Set())}>全部显示 BBox</button>
        <button type="button" onClick={() => setHiddenBoxes(new Set(record.analysis!.observations.map(o => o.id)))}>全部隐藏 BBox</button>
        <small>仅控制照片标注；总开关关闭时不显示。</small>
      </div>
      <ObservationTable stickyAction hostRef={reviewHost} columns={[
        { label: '操作', width: 52 }, { label: 'BBox', width: 54 }, { label: '再识别', width: 62 }, { label: '审核状态', width: 96, header: <ReviewStatusFilter value={reviewFilter} onChange={setReviewFilter} /> }, { label: '识别项', width: 104 }, { label: '型号', width: 128 },
        { label: '宽 (Stud)', width: 72 }, { label: '深 (Stud)', width: 72 }, { label: '高 (Brick)', width: 76 },
        { label: '颜色（Rebrickable）', width: 180 }, { label: '形状', width: 112 }, { label: '印花', width: 76 },
        { label: '数量', width: 60 },
      ]}>
        {reviewParts.map(o => {
          const manual=hiddenParts.some(p=>p.id===o.id)
          const row = rows[o.id]
          if (!row) return null
          const status = reviewStatus(row.excluded, isConfirmed(row))
          if (!matchesReviewFilter(reviewFilter, status)) return null
          const chosen = row.index === undefined ? undefined : row.search?.rows[row.index]
          return <tr key={o.id} data-observation-id={o.id} className={active === o.id ? 'is-active' : ''} onClick={event => {
            if (event.target instanceof Element && event.target.closest('input, select, button, [popover], a, summary')) return
            selectBox(o.id)
          }}>
            <td><ObservationActions observationId={o.id} actions={[
              { label: 'Copy from ▸', disabled: locked, run: () => void action('读取历史审核来源', () => openCopySources(o.id)) },
              { label: '按型号查找', disabled: locked || !row.features.partNumber?.trim(), run: () => find(o.id, 'part') },
              { label: '按特征查找', disabled: locked, run: () => find(o.id, 'features') },
              { label: '在零件目录中查找', disabled: locked, run: () => find(o.id, 'manual') },
              { label: '查看候选 / 人工确认', disabled: locked, run: () => find(o.id, row.search?.partNumber ? 'part' : 'features') },
              { label: '查看详情', run: () => setDetailId(o.id) },
              ...(manual?[{label:'删除人工零件',disabled:locked,run:()=>removeHiddenPart(o.id)}]:[]),
              { label: row.excluded ? '恢复审核' : '排除', disabled: locked || generationSubmitted, run: () => edit(o.id, { excluded: !row.excluded }) },
            ]} /></td>
            <td><input type="checkbox" aria-label={o.id + ' 显示 BBox'} disabled={manual} checked={!manual&&!hiddenBoxes.has(o.id)} style={{ width: 'auto' }} onChange={e => {
              const visible = e.target.checked
              setHiddenBoxes(previous => { const next = new Set(previous); if (visible) next.delete(o.id); else next.add(o.id); return next })
            }} /></td>
            <td><input type="checkbox" aria-label={o.id + ' Guided 再识别'} disabled={locked || !geometryOnly || manual} checked={guidedIds.has(o.id)} style={{ width: 'auto' }} onChange={e => {
              const selected = e.target.checked
              setGuidedIds(previous => { const next = new Set(previous); if (selected) next.add(o.id); else next.delete(o.id); return next })
            }} /></td>
            <td className="vision-match-status"><span className="vision-review-badge">{reviewStatusLabels[status]}</span></td>
            <td><button type="button" className="vision-observation-id" aria-pressed={active === o.id} title={o.id}
              onClick={() => { selectBox(o.id); previewHost.current?.scrollIntoView({ block: 'nearest' }) }}>{o.id}</button>
              <small>{manual?'manual / hidden · 无照片标注':`置信度 ${o.confidence}`}</small></td>
            <td><input aria-label={o.id + ' 用户 Part Number'} value={row.features.partNumber ?? ''} placeholder="输入 RB 型号" disabled={locked}
              onChange={e => edit(o.id, { features: { ...row.features, partNumber: e.target.value }, search: undefined, index: undefined })} />
              <small>确认：{chosen?.source.part_num || '—'} / 颜色 ID {chosen?.source.color_id ?? '—'}</small>
              {row.excluded && <input aria-label={o.id + ' 排除原因'} value={row.reason} placeholder="请填写排除原因" disabled={locked}
                onChange={e => edit(o.id, { reason: e.target.value })} />}
            </td>
            <ObservationFeatureCells id={o.id} features={row.features} disabled={locked} colors={reviewColors}
              onChange={features => edit(o.id, { features, search: undefined, index: undefined })} />
            <td><input aria-label={o.id + ' 确认可见数量'} type="number" min="1" max="100" value={row.quantity}
              disabled={locked || generationSubmitted} onChange={e => edit(o.id, { quantity: e.target.value })} /></td>

          </tr>
        })}
      </ObservationTable>
      <fieldset disabled={locked}>
        <legend>Manual Relations · 人工对称线索</legend>
        <small>模型识别 {record.analysis.observations.length} 项 · 人工隐藏 {hiddenParts.length} 项。关系没有指定对称轴或平面，需 Planning 推断，未经几何验证。与审核一起保存。</small>
        {manualRelations.map((r,i)=>{
          const editRelation=(patch:Partial<ManualSymmetry>)=>changeRelations(manualRelations.map((old,n)=>n===i?{...old,...patch}:old))
          return <div key={i} style={{borderTop:'1px solid #dbe7e3',paddingTop:8,marginTop:8}}>
            <div className="brick-actions">
              <label>Source<select value={r.from} onChange={e=>editRelation({from:e.target.value})}>{reviewParts.map(o=><option key={o.id} value={o.id}>{o.id}</option>)}</select></label>
              <span>symmetric / 对称</span>
              <label>Target<select value={r.to} onChange={e=>editRelation({to:e.target.value})}>{reviewParts.map(o=><option key={o.id} value={o.id}>{o.id}</option>)}</select></label>
              <button type="button" onClick={()=>changeRelations(manualRelations.filter((_,n)=>n!==i))}>删除关系</button>
            </div>
            <label>说明（可选）<textarea maxLength={2000} value={r.note} onChange={e=>editRelation({note:e.target.value})}/></label>
            <small>source: manual</small>
          </div>
        })}
        <button type="button" disabled={reviewParts.length<2||manualRelations.length>=100} onClick={()=>{
          const from=hiddenParts.at(-1)?.id||reviewParts[0].id
          const to=reviewParts.find(o=>o.id!==from)!.id
          changeRelations([...manualRelations,{from,to,relation:'symmetric',source:'manual',note:''}])
        }}>添加 symmetric 关系</button>
      </fieldset>
    </>}
    {generationSubmitted && <p className="brick-help">此识别结果已提交生成；可以继续保存审核或读取已有方案。原有防重复生成保护仍生效，不覆盖 Artifact。</p>}
    {artifact && <div role="status"><p>Approximation · {artifact.status} · {artifact.error || artifact.generation?.error?.message || '请在 Viewer 与原图对比；Validator 不验证外观相似度。'}</p>
      <button onClick={() => download(artifact, 'reverse-design-' + artifact.id)}>下载 Reverse Artifact</button>
      <details><summary>确认、Geometry Snapshot、Design Hash 与诊断</summary><pre>{JSON.stringify(artifact, null, 2)}</pre></details></div>}
  </div>
  return <section className="brick-reverse" aria-label="Assembled Recognition">
    <h2>{geometryOnly ? '成品几何识别' : '成品目录识别'}</h2>
    <p className="brick-help">{geometryOnly ? '先分析宽、深、高；仅在你手动检索时使用 Catalog。原始几何观察独立保存。' : '分析可见特征，再检索候选、人工确认；组装生成在 Design Lab 中继续。'} 单张照片无法确认的结构保持 Unknown。</p>
    {geometryOnly && <label>Reverse Geometry Prompt Version<select aria-label="Reverse Geometry Prompt Version" disabled={locked} value={promptVersion} onChange={e => setPromptVersion(Number(e.target.value))}>
      <option value={3}>reverse_geometry_v1 · v3（当前默认）</option><option value={4}>reverse_geometry_v1 · v4（遮挡与连续结构，待验证）</option>
    </select></label>}
    <fieldset disabled={locked || submitted}>
      <ServerImagePicker initialScene={initialScene} restoredSelection={restoredSelection} onSelectionChange={setImageSelection} onReady={() => setPickerReady(true)} disabled={locked || submitted} onChange={setImage} onBusy={value => { gate.current = value; setBusy(value ? '准备图片' : ''); onBusy(value) }} />
      {!geometryOnly && <>
      <label>可用零件范围<select value={source} onChange={e => { setSource(e.target.value); reset() }}>
        <option value="virtual">虚拟积木清单</option><option value="today">我的积木 · 已保存清单</option><option value="full">零件目录 · 全部 DUPLO</option>
      </select></label>
      {source === 'virtual' && (displayedInventory ? <AvailableInventory inventory={displayedInventory} total={displayedInventory.reduce((n, r) => n + r.quantity, 0)} onQuantity={onQuantity} /> : <p>记录缺少虚拟清单快照。</p>)}
      {source === 'today' && (record ? <pre>{record.source.session ? JSON.stringify(record.source.session, null, 2) : '记录缺少积木清单快照。'}</pre> : <>
        <button type="button" onClick={() => { try { setSessions(loadSessions(localStorage)); setError('') } catch (e) { setError(String(e)) } }}>读取保存积木清单（不调用模型）</button>
        <label>已保存积木清单<select value={sessionId} onChange={e => setSessionId(e.target.value)}><option value="">请选择</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.updated_at} · {s.id}</option>)}</select></label>
      </>)}
      </>}
      <ModelSelector models={models} value={{ id: model, provider: models.find(m => m.id === model)?.provider || '' }} onChange={m => onModel(m.id)} />
      <p>当前图片：{imageSelection.name || record?.image_reference?.name || image?.imageReference.name || '未选择'}</p>
      {record?.image_reference?.name && imageSelection.name && record.image_reference.name !== imageSelection.name && <small>历史识别与标注仍使用参考图片：{record.image_reference.name}。</small>}
      <small title={image ? JSON.stringify(image.compression) : '自动按 EXIF 方向处理，最长边 1024px，JPEG 80%；压缩失败不发送原图。'}>ⓘ 图片压缩信息</small>
      <button type="button" disabled={!!recognitionReason} aria-describedby="reverse-recognition-status" onClick={() => void action('分析照片', async () => {
        const selected = source === 'today' ? sessions.find(s => s.id === sessionId) : undefined
        if (!geometryOnly && source === 'today' && !selected) throw new Error('请先选择已保存积木清单。')
        setSubmitted(true); setRecordId(requestId.current)
        await acceptAnalysis(await post<Analysis>('analyze', { ...image, model, promptVersion: geometryOnly ? promptVersion : undefined, analysis_mode: analysisMode, requestId: requestId.current,
          source: geometryOnly ? { kind: 'full' } : source === 'virtual' ? { kind: source, inventory } : source === 'today' ? { kind: source, session: selected } : { kind: source } }))
        await refreshHistory()
      })}>识别图片（调用模型）</button>
    </fieldset>
    <p id="reverse-recognition-status" role="status">{recognitionReason || `可以识别${geometryOnly ? ' · Prompt v' + promptVersion : ''}。仅点击“识别图片（调用模型）”后才会发起请求。`}</p>
    <button type="button" disabled={locked} onClick={reset}>新建分析 / 允许再次识别</button>
    {geometryOnly && record?.status === 'complete' && <fieldset disabled={locked}>
      <legend>Guided Re-analysis · 定向再识别</legend>
      <p>已选 {guidedIds.size} 项：{[...guidedIds].join('、') || '请在审核表的“再识别”列选择'}。BBox 仅控制显示，与此选择无关。</p>
      <label>用户 Hint<textarea aria-label="Guided Hint" value={hint} maxLength={4000} onChange={e => setHint(e.target.value)} /></label>
      <ModelSelector models={models} value={{ id: model, provider: models.find(m => m.id === model)?.provider || '' }} onChange={m => onModel(m.id)} />
      <p>使用上方选择的 Prompt v{promptVersion} 与来源原图。Hint 是待核对假设。将调用一次模型并保存独立 Analysis；原审核保留在来源中，新结果全部待审核。</p>
      {dirty && <p>请先保存当前审核草稿。</p>}
      <button type="button" disabled={!guidedIds.size || !hint.trim() || !model || dirty} onClick={() => void action('根据 Hint 重新分析', async () => {
        const result = await post<Analysis>('analyze', { requestId: newSessionId(), model, analysis_mode: 'geometry_only', promptVersion,
          guidance: { analysisId: record.id, observationIds: [...guidedIds], hint } })
        await acceptAnalysis(result)
        await refreshHistory()
      })}>根据 Hint 重新分析（调用模型）</button>
    </fieldset>}


    <div className="brick-reverse-recovery">
      <TraceLinks source="reverse" id={record?.id||undefined}/>
      <label>识别历史<select value={recordId} disabled={locked} onChange={e => setRecordId(e.target.value)}>
        <option value="">选择历史分析</option>
        {recordId && !history.some(r => r.id === recordId) && <option value={recordId}>{recordId}</option>}
        {history.map(r => <option key={r.id} value={r.id}>
          {r.createdAt} · {r.analysis_mode || 'catalog_match'} · {r.prompt_id || 'reverse_catalog_v1'} v{r.prompt_version || 1} · {r.provider} / {r.model} · {r.image_reference?.name || ''} · {r.isRevision ? (r.status === 'complete' ? 'Recovered / Ready for Review · ' : 'Revision Validation Failed · ') : ''}{r.isGuided ? 'Guided · ' : ''}{r.appearance || r.status} · {r.count} 个识别项
        </option>)}
      </select></label>
      <div className="brick-actions">
        <button type="button" disabled={locked} onClick={() => void action('刷新历史', refreshHistory)}>刷新</button>
        <button type="button" disabled={locked || !recordId || dirty} onClick={() => void loadHistory(recordId)}>加载识别结果</button>
      </div>
      {historyWarning && <p role="status">{historyWarning}</p>}
    </div>
    <CopySceneLink sync={visible && pickerReady && modelsReady && historyReady && sceneRestored && (!record || (record.analysis_mode || 'catalog_match') === analysisMode)} disabled={!historyReady || !sceneRestored || locked || !pickerReady || !modelsReady} dirty={dirty} scene={{ strategy: analysisMode,
      imageSource: imageSelection.source, image: imageSelection.name, model, provider: models.find(m => m.id === model)?.provider,
      analysisId: record?.id }} />
    {preview && <div ref={previewHost}><ObservationPreview
      src={'data:' + preview.mimeType + ';base64,' + preview.imageBase64} alt="原始参考照片及识别项标注"
      observations={record?.analysis?.observations || []} hiddenIds={hiddenBoxes} activeId={active} onSelect={selectBox} />
      {record && <div className="vision-selected-review">
        <p>点击照片框选积木，再修改审核型号或颜色；照片框是模型标注，可能有偏差。</p>
        <label>照片中的识别项<select aria-label="照片中的识别项" value={active} onChange={e => selectBox(e.target.value)}>
          {record.analysis?.observations.map(o => <option key={o.id} value={o.id}>{o.id}</option>)}
        </select></label>
        <p>当前审核：{selectedPart ? `${selectedPart.part_num} / ${reviewColors.find(c => c.id === selectedPart.color_id)?.name || '颜色'} · RB ${selectedPart.color_id}` : '尚未确认'}。型号或颜色修改后需重新选择候选并保存审核。</p>
        <button type="button" disabled={locked || !active} onClick={() => selectBox(active)}>定位并修改型号 / 颜色</button>
        <button type="button" disabled={locked || !active} onClick={() => find(active, 'manual')}>为此积木选择型号与颜色</button>
      </div>}
    </div>}
    {record && <>
      <p>{record.analysis_mode || 'catalog_match'} · {record.prompt_id || 'reverse_catalog_v1'} v{record.prompt_version || 1} · {record.image_reference?.name} · {record.revision ? (record.status === 'complete' ? 'Recovered' : 'Revision Validation Failed') : record.status} · {record.provider} · {record.model} / {record.modelVersion || '未返回'} · Source {record.source.kind}</p>
      {record.guidance && <section aria-label="Guided 来源与变更">
        <strong>Guided Re-analysis · 独立结果，需重新人工审核</strong>
        <p>来源：{record.guidance.sourceAnalysisId} · 选中：{record.guidance.observationIds.join('、')}</p>
        <p>用户 Hint：{record.guidance.hint}</p>
        <button disabled={locked || dirty} onClick={() => void loadHistory(record.guidance!.sourceAnalysisId)}>查看 Guided 来源 Analysis</button>
        <details open><summary>Observation 与 Relations 变更</summary><pre>{JSON.stringify(record.guidedChanges || '尚无通过校验的结果', null, 2)}</pre></details>
      </section>}
      {record.revision && <section aria-label="Revision status">
        <strong>{record.status === 'complete' ? 'Recovered / Ready for Review · 修订已恢复，型号与颜色仍需逐块审核' : 'Revision Validation Failed · 修订校验失败'}</strong>
        <p>当前修订：{record.id} · 来源：{record.revision.parentAnalysisId}</p>
        <button disabled={locked || dirty} onClick={() => void loadHistory(record.revision!.originalAnalysisId)}>查看原始 Failed Analysis</button>
        <details><summary>修订记录</summary><pre>{JSON.stringify(record.revision, null, 2)}</pre></details>
      </section>}
      {record.status === 'failed' && !record.outputValidation && <p role="alert">Provider Failed / No Output · {record.error?.message}</p>}
      {record.outputValidation && <section aria-label="Output Validation" style={{ padding: 12, border: '1px solid', borderColor: record.outputValidation.valid ? '#a6c9b4' : '#f1c2bd', background: record.outputValidation.valid ? '#f0faf4' : '#fff0ee', color: record.outputValidation.valid ? '#245c42' : '#913c30', overflowWrap: 'anywhere' }}>
        <strong>{record.outputValidation.valid ? (record.revision ? 'Revision Validation Passed · 待人工审核' : '离线校验通过（历史状态未修改）') : record.outputValidation.stage === 'provider_failed' ? 'Provider Failed · 模型调用未完成' : !record.outputValidation.parsed ? 'JSON Parse Failed · JSON 解析失败' : record.revision ? 'Revision Validation Failed · 修订输出校验失败' : 'Original Analysis Failed · Output Validation Failed · 输出校验失败'}</strong>
        <p>原始模型输出已保存；{record.outputValidation.parsed ? 'JSON 解析成功' : 'JSON 解析失败'}。{record.outputValidation.observationCount} 个 Observation / {record.outputValidation.relationCount} 条 Relations。</p>
        {record.outputValidation.issues.map((issue, i) => <div key={i}>
          <code>{issue.path}</code><p>{issue.message}</p>
          {issue.context != null && <details><summary>此尺寸的原始证据与不确定性</summary><pre>{JSON.stringify(issue.context, null, 2)}</pre></details>}
          <p>期望：{JSON.stringify(issue.expected)}；实际：{JSON.stringify(issue.actual)}</p>
        </div>)}
        <p>离线校验不调用模型、不修改原始输出、不自动确认零件。校验失败时无法进入正式审核。</p>
        <button disabled={locked} onClick={() => void action('离线重新校验', async () => {
          const outputValidation = await post<NonNullable<Analysis['outputValidation']>>('revalidate', { analysisId: record.id })
          setRecord({ ...record, outputValidation })
        })}>离线重新校验（不调用 LLM）</button>
        <button onClick={() => download(record.outputValidation, 'output-validation-' + record.id)}>下载校验报告</button>
        {record.status === 'failed' && <AnchorRevisionForm key={record.id} report={record.outputValidation} disabled={locked} onSubmit={operation => void action('保存独立修订并校验', async () => {
          const revised = await post<Analysis>('revise', { analysisId: record.id, requestId: newSessionId(), operation })
          await acceptAnalysis(revised)
          await refreshHistory()
        })} />}
        <details><summary>完整输出校验诊断</summary><pre>{JSON.stringify(record.outputValidation, null, 2)}</pre></details>
      </section>}
      <button type="button" onClick={() => download(record, 'reverse-analysis-' + record.id)}>下载完整分析诊断 / Raw Trace 路径</button>
      <details><summary>识别结果 ID、清单快照、原始证据与未知项</summary><pre>{JSON.stringify({ id: record.id, source: record.source, analysis: record.analysis, error: record.error }, null, 2)}</pre></details>
    </>}
    {restoreWarning && <p role="status">{restoreWarning}</p>}
    {workspaceHost ? createPortal(workspace, workspaceHost) : workspace}
    {geometryHost && createPortal(geometry, geometryHost)}
    {detailId && <ObservationModal title={'识别项 ' + detailId} data={{
      observation: reviewParts.find(o => o.id === detailId),
      review: rows[detailId],
      candidateStatus: candidateNotes[detailId],
      dimensionNote: '尺寸验证范围见候选证据',
      relations: record?.analysis?.relations,
    }} onClose={() => setDetailId('')} />}
    {busy && <p role="status">{busy}… 不自动重试。</p>}
    {error && <p className="brick-error" role="alert">{error}</p>}
  </section>
}

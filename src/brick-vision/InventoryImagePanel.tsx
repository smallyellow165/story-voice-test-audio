import {observationPrintHints} from './print-hints.mjs'
import { reviewStatus, reviewStatusLabels, matchesReviewFilter } from './review-status.mjs'
import { CopySceneLink } from '../brick-inventory/CopySceneLink'
import { selectSceneModel } from '../brick-inventory/explorer-scene.mjs'
import type { ExplorerScene, SceneImageSelection } from '../brick-inventory/explorer-scene.mjs'
import { ReviewStatusFilter, ReviewToolbar } from './ReviewToolbar'
import type { ReviewFilter } from './ReviewToolbar'
import { ServerImagePicker } from './ServerImagePicker'
import type { PreparedSourceImage } from './ServerImagePicker'
import { ObservationTable, ObservationFeatureCells } from './ObservationTable'
import { ModelSelector } from '../model-selector'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addItem, newSessionId } from '../brick-inventory/inventory'
import type { InventoryItem } from '../brick-inventory/inventory'
import { requestJson } from '../brick-inventory/api.mjs'
import { recognizeImage, downloadVision } from './upload'
import type { ObservationCatalogSearch, VisionResult, VisionHistoryItem } from './types'
import { ObservationPreview } from './ObservationPreview'
import { ObservationActions } from './ObservationActions'
import { ObservationModal } from './ObservationModal'
import { bboxStyle } from './observation-view.mjs'
import { catalogFeatureParams, createObservationDraft, readFeatureEditor, validateReviewDimensions } from './catalog-features.mjs'
import { uniqueCatalogIdentity, hasConfirmedIdentity, completeCatalogIdentity } from './catalog-autofill.mjs'
import type { FeatureEditor } from './catalog-features.mjs'
import './review.css'

type DraftRow = { id: string; selected: boolean; part: string; color: string; quantity: string;
  features: FeatureEditor; confirmation: unknown; identityOrigin?: 'auto' | 'manual'; excluded?: boolean }
type ModelStatus = { model: string; openaiApiKeyConfigured: boolean; models: { id: string; label: string; provider: 'gemini' | 'openai' }[] }
export function InventoryImagePanel({ onApply, onReset, workspaceHost, onSearchCatalog, active = true, onBusy, initialScene, initialHistory }: {
  active?: boolean; onBusy?(busy: boolean): void
  initialScene?: ExplorerScene; initialHistory?: VisionHistoryItem[]
  onApply(items: InventoryItem[]): boolean | void; onReset?(items: InventoryItem[]): boolean | void; workspaceHost?: HTMLElement | null
  onSearchCatalog?(request: ObservationCatalogSearch): void
}) {
  const [preview, setPreview] = useState('')
  const [prepared, setPrepared] = useState<PreparedSourceImage | null>(null)
  const [imageInfo, setImageInfo] = useState<VisionResult['compression']>(null)
  const [history, setHistory] = useState<VisionHistoryItem[]>(initialHistory || [])
  const [historyReady, setHistoryReady] = useState(initialHistory !== undefined)
  const [modelsReady, setModelsReady] = useState(false), [pickerReady, setPickerReady] = useState(false)
  const [sceneRestored, setSceneRestored] = useState(!initialScene?.analysisId)
  const autoRestored = useRef(false), modelBootApplied = useRef(false)
  const [imageSelection, setImageSelection] = useState<SceneImageSelection>({ source: initialScene?.imageSource || 'server_library', name: '' })
  const [restoredSelection, setRestoredSelection] = useState<SceneImageSelection>()
  const [historyId, setHistoryId] = useState(initialScene?.analysisId || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [applied, setApplied] = useState(false)
  useEffect(() => { onBusy?.(busy) }, [busy, onBusy])
  const [result, setResult] = useState<VisionResult | null>(null), [rows, setRows] = useState<DraftRow[]>([])
  const [validation, setValidation] = useState<unknown>(null)
  const [activeId, setActiveId] = useState('')
  const [detail, setDetail] = useState<{ kind: 'observation'; id: string } | { kind: 'diagnostics' | 'validation' } | null>(null)
  const tableHost = useRef<HTMLDivElement>(null), previewHost = useRef<HTMLDivElement>(null)
  useEffect(() => { setActiveId(''); setDetail(null) }, [result?.id])
  const [model, setModel] = useState(''), [models, setModels] = useState<ModelStatus['models']>([])
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini')
  const [openaiConfigured, setOpenaiConfigured] = useState(false)
  const [modelError, setModelError] = useState(''), [configRevision, setConfigRevision] = useState(0)
  const lock = useRef(false), requestId = useRef('')
  const catalogEpoch = useRef(0)
  const autoCache = useRef(new Map<string, { expires: number; data: unknown }>())
  const [autoNotes, setAutoNotes] = useState<Record<string, string>>({})
  const [autoSummary, setAutoSummary] = useState('')
  const [draftNotice, setDraftNotice] = useState('')
  const [reviewSaved, setReviewSaved] = useState(false)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  useEffect(() => () => { catalogEpoch.current++ }, [])
  function restoreResult(next: VisionResult) {
    catalogEpoch.current++
    autoCache.current.clear(); setAutoNotes({}); setAutoSummary('')
    setResult(next); setApplied(false); setValidation(null)
    const initial = (next.matches || []).map(m => createObservationDraft(m.observation))
    setReviewFilter('all'); setRows(initial); setReviewSaved(false); setDraftNotice('')
    try {
      const saved = JSON.parse(localStorage.getItem('part-explorer:review:' + next.id) || 'null')
      if (saved) {
        if (!Array.isArray(saved.rows) || !saved.rows.every((r: DraftRow) => initial.some(o => o.id === r.id)
          && typeof r.part === 'string' && typeof r.color === 'string' && typeof r.quantity === 'string'
          && r.features && typeof r.features.size === 'string' && typeof r.features.color === 'string'
          && typeof r.features.shape === 'string' && typeof r.features.print === 'string')) throw new Error('审核草稿字段无效')
        saved.rows.forEach((r: DraftRow) => validateReviewDimensions(r.features))
        setRows(saved.rows); setReviewSaved(true); setDraftNotice('已恢复此浏览器保存的审核草稿；加入我的积木 时仍校验 Catalog。')
      }
    } catch (e) { setDraftNotice('审核草稿未恢复：' + String(e) + '；原始识别结果仍可审核。') }
  }
  function saveDraft() {
    if (!result) return
    try {
      rows.forEach(row => validateReviewDimensions(row.features))
      localStorage.setItem('part-explorer:review:' + result.id, JSON.stringify({ rows }))
      setReviewSaved(true); setDraftNotice('审核草稿已保存到此浏览器；重新加载相同历史记录可恢复。')
    } catch (e) { setDraftNotice('保存失败：' + String(e)) }
  }
  function editRow(id: string, changes: Partial<DraftRow>) {
    catalogEpoch.current++
    setReviewSaved(false); setDraftNotice('审核有未保存修改。')
    if (changes.features) autoCache.current.clear()
    setAutoNotes(previous => ({ ...previous, [id]: '' })); setAutoSummary('')
    setValidation(null)
    setRows(previous => previous.map(r => r.id === id ? { ...r, selected: false, confirmation: null,
      ...(changes.features && r.identityOrigin === 'auto' ? { part: '', color: '', identityOrigin: undefined } : {}),
      ...('part' in changes || 'color' in changes ? { identityOrigin: 'manual' as const } : {}), ...changes } : r))
  }
  function searchObservation(row: DraftRow, method: 'features' | 'part' | 'manual' = 'features') {
    if (!onSearchCatalog || !result || lock.current || applied) return
    try {
      const partNumber = method === 'part' ? row.part.trim() : undefined
      if (method === 'part' && (!partNumber || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(partNumber))) throw new Error('请输入一个有效的 Rebrickable Part Number。')
      const features = method === 'features' ? readFeatureEditor(row.features) : { color_id: null, size: null, shape: null, print: 'unknown' as const }
      if (method === 'features' && !Object.keys(catalogFeatureParams(features)).length) {
        throw new Error('没有可检索的已知特征，请先人工填写至少一项；不会使用模型猜测编号代替检索。')
      }
      const epoch = ++catalogEpoch.current
      setError(''); setAutoNotes(previous => ({ ...previous, [row.id]: '正在检索；结果见右栏' }))
      onSearchCatalog({ method, partNumber, key: `${result.id}:${row.id}:${epoch}`, observationId: row.id, features, quantity: row.quantity, analysisId: result.id,
        printHints: method === 'features' ? observationPrintHints(result.matches?.find(m=>m.observation.id===row.id)?.observation) : [],
        onResults(count) {
          if (catalogEpoch.current !== epoch) return
          setAutoNotes(previous => ({ ...previous, [row.id]: count == null ? '检索失败；请查看右栏错误' : count ? '待选择 · 本页 ' + count + ' 个 Catalog 型号' : '没有候选' }))
        },
        onChoose(item, evidence) {
          if (catalogEpoch.current !== epoch || lock.current) throw new Error('识别项或人工草稿已改变，请重新点击该行的检索候选。')
          catalogEpoch.current++
          setReviewSaved(false); setDraftNotice('审核有未保存修改。')
          setValidation(null)
          setRows(previous => previous.map(r => r.id === row.id ? { ...r, selected: true, part: item.part_num,
            color: String(item.color_id), quantity: String(item.quantity), identityOrigin: 'manual' as const, excluded: false, confirmation: { features, item, evidence } } : r))
          setActiveId(row.id)
        },
      })
    } catch (e) { setError(String(e)) }
  }
  async function autofill(requested: DraftRow[]) {
    if (lock.current || applied || !result) return
    const epoch = ++catalogEpoch.current
    lock.current = true; setBusy(true); setAutoSummary('')
    const counts = { filled: 0, multiple: 0, none: 0, failed: 0, skipped: 0 }
    try {
      // Serial requests bound concurrency and share identical feature results.
      for (const row of requested.filter(r => !r.excluded)) {
        if (catalogEpoch.current !== epoch) return
        const note = (text: string) => setAutoNotes(previous => ({ ...previous, [row.id]: text }))
        if (hasConfirmedIdentity(row)) { counts.skipped++; note('跳过：确认型号和颜色均已填写。'); continue }
        try {
          const features = readFeatureEditor(row.features)
          const params = catalogFeatureParams(features)
          if (!Object.keys(params).length) throw new Error('没有已知特征，请先填写特征。')
          const key = JSON.stringify(params)
          const cached = autoCache.current.get(key)
          const data = cached && cached.expires > Date.now() ? cached.data : await requestJson<unknown>(
            '/api/brick-catalog/candidates?' + new URLSearchParams({ ...params, page: '1', page_size: '2' }), {}, '识别项目录检索')
          if (catalogEpoch.current !== epoch) return
          const decision = uniqueCatalogIdentity(data, features.color_id)
          autoCache.current.set(key, { data, expires: cached && cached.expires > Date.now() ? cached.expires : Date.now() + 60000 })
          if (decision.status === 'filled') {
            const completed = completeCatalogIdentity(row, decision)
            counts.filled++
            setReviewSaved(false); setDraftNotice('审核有未保存修改。')
            setValidation(null)
            setRows(previous => previous.map(current => current.id === row.id && !hasConfirmedIdentity(current)
              && JSON.stringify(current.features) === JSON.stringify(row.features)
              && current.part === row.part && current.color === row.color
              ? { ...current, ...completed, selected: false,
                  identityOrigin: row.part.trim() || row.color.trim() ? 'manual' as const : 'auto' as const,
                  confirmation: { method: 'catalog_unique', features, evidence: data } } : current))
            note('已补齐空字段，原有非空值保留；请人工勾选并校验。')
          } else {
            counts[decision.status]++
            note(decision.status === 'none' ? '未匹配，未修改确认值。' : '存在多个型号或颜色组合，请检索候选并人工选择。')
          }
        } catch (e) {
          if (catalogEpoch.current !== epoch) return
          counts.failed++; note(e instanceof Error ? e.message : String(e))
        }
      }
      if (catalogEpoch.current === epoch) setAutoSummary(
        `总数 ${requested.length} · 成功回填 ${counts.filled} · 多个候选 ${counts.multiple} · 无候选 ${counts.none} · 失败 ${counts.failed} · 跳过 ${counts.skipped}`)
    } finally { lock.current = false; setBusy(false) }
  }
  async function refreshHistory() {
    try { const value = await requestJson<{ records: typeof history; warnings: string[] }>('/api/brick-vision/history', {}, '识别历史'); setHistory(value.records); if (value.warnings.length) setError(value.warnings.join('；')) }
    catch (e) { setError(String(e)) }
    finally { setHistoryReady(true) }
  }
  useEffect(() => { if (initialHistory === undefined) void refreshHistory() }, [])
  useEffect(() => {
    if (!active || !pickerReady || !modelsReady || !historyReady || autoRestored.current || !initialScene?.analysisId) return
    autoRestored.current = true
    if (!history.some(row => row.id === initialScene.analysisId)) { setError('URL 历史不在散装识别历史中，未加载。'); setSceneRestored(true); return }
    void loadHistory(initialScene.analysisId, true).finally(() => setSceneRestored(true))
  }, [active, pickerReady, modelsReady, historyReady])
  useEffect(() => {
    const controller = new AbortController()
    setModelError('')
    void requestJson<ModelStatus>('/api/brick-vision', { signal: controller.signal }, 'Vision 模型配置').then(status => {
      if (!Array.isArray(status.models) || !status.models.every(m => m && typeof m.id === 'string' && typeof m.label === 'string' && ['gemini', 'openai'].includes(m.provider))
        || !status.models.some(m => m.id === status.model)) throw new Error('Vision 模型配置无效')
      if (!controller.signal.aborted) {
        const choice = selectSceneModel(status.models, status.model, modelBootApplied.current ? undefined : initialScene)
        modelBootApplied.current = true
        setModels(status.models); setModel(choice.id); setProvider(status.models.find(m => m.id === choice.id)!.provider)
        setOpenaiConfigured(status.openaiApiKeyConfigured)
        if (choice.warning) setModelError(choice.warning)
      }
    }).catch(e => { if (!controller.signal.aborted) setModelError(String(e)) }).finally(() => { if (!controller.signal.aborted) setModelsReady(true) })
    return () => controller.abort()
  }, [configRevision])
  async function loadHistory(id: string, automatic = false) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const next = await requestJson<VisionResult>('/api/brick-vision/history/' + encodeURIComponent(id), {}, '加载识别历史')
      if (next.mode !== 'inventory' || next.status !== 'complete') throw new Error('请选择成功的散装识别历史。')
      restoreResult(next); setHistoryId(next.id); setPrepared(null); setImageInfo(next.compression)
      setPreview(next.originalImage ? 'data:' + next.originalImage.mimeType + ';base64,' + next.originalImage.imageBase64 : '')
      if (!automatic || !initialScene?.image) setRestoredSelection({ source: automatic ? initialScene?.imageSource || 'upload' : 'upload', name: next.originalImage?.name || '' })
      if (!automatic || (!initialScene?.provider && !initialScene?.model)) {
        const chosen = models.find(m => m.id === next.model && m.provider === next.provider)
        if (chosen) { setModel(chosen.id); setProvider(chosen.provider) }
      }
    } catch (e) { setError(String(e)) } finally { lock.current = false; setBusy(false) }
  }
  async function recognize() {
    if (!prepared || lock.current || !models.some(m => m.id === model && m.provider === provider)) return
    catalogEpoch.current++
    lock.current = true; setBusy(true); setError(''); setResult(null); setRows([]); setValidation(null)
    try {
      const next = await recognizeImage(prepared, requestId.current, undefined, model, provider)
      restoreResult(next)
    } catch (e) { setError(String(e)) } finally { setBusy(false); lock.current = false }
  }
  async function validateSelection() {
    if (lock.current || applied) return
    catalogEpoch.current++
    lock.current = true; setBusy(true); setError('')
    try {
      const items = rows.filter(r => r.selected && !r.excluded).reduce<InventoryItem[]>((items, r) => {
        if (!r.color.trim() || !r.quantity.trim()) throw new Error('请填写颜色 ID 和数量')
        return addItem(items, { part_num: r.part.trim(), color_id: Number(r.color), quantity: Number(r.quantity) })
      }, [])
      if (!items.length) throw new Error('请勾选确认的积木；不确定项可修改后再勾选。')
      const checked = await requestJson<{ valid: boolean }>('/api/brick-vision/validate', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }, '清单格式 / 目录型号与颜色检查')
      setValidation(checked)
      if (!checked.valid) throw new Error('草稿存在无效型号或颜色组合；请查看 Catalog 校验详情并修改。')
      setRows(previous => previous.map(r => r.selected && !r.excluded
        ? { ...r, identityOrigin: 'manual' as const, confirmation: { method: 'catalog_validated', evidence: checked } } : r))
      setReviewSaved(false); setDraftNotice('型号与颜色已确认；审核有未保存修改。尚未加入我的积木。')
    } catch (e) { setError(String(e)) } finally { setBusy(false); lock.current = false }
  }
  const isConfirmed = (row: DraftRow) => !row.excluded && !!row.confirmation && row.identityOrigin === 'manual'
    && (row.confirmation as { method?: string }).method !== 'catalog_unique'
  const confirmedRows = rows.filter(isConfirmed)
  const selectedConfirmed = confirmedRows.filter(row => row.selected)
  function addConfirmed() {
    if (lock.current || applied || !selectedConfirmed.length) return
    try {
      const items = selectedConfirmed.reduce<InventoryItem[]>((items, row) => addItem(items, {
        part_num: row.part, color_id: Number(row.color), quantity: Number(row.quantity),
      }), [])
      if (onApply(items) !== false) setApplied(true)
    } catch (e) { setError(String(e)) }
  }
  const matches = new Map((result?.matches || []).map(m => [m.observation.id, m]))
  const visibleObservations = rows.flatMap(row => { const m = matches.get(row.id); return m ? [m.observation] : [] })
  const selectBox = (id: string) => {
    setActiveId(id)
    const row = [...(tableHost.current?.querySelectorAll<HTMLElement>('[data-observation-id]') || [])].find(r => r.dataset.observationId === id)
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const review = <div className="inventory-vision-review vision-review-layout" hidden={!active}>
    <ReviewToolbar confirmed={confirmedRows.length} total={rows.length} saved={reviewSaved}
      help={<>
        <p>从左栏识别或加载历史，在此审核；零件目录位于右栏。</p>
        <p>Width / Depth 使用 Stud（16 mm），Height 使用 Brick（19.2 mm），Unknown 留空。填写 Height 时使用可靠主体三维几何检索；Unknown 不匹配。不填 Height 的整数二维 Size 保留现有水平检索。编辑视觉特征后，逐行检索右栏 Catalog 并人工选择型号与颜色。未知特征不参与检索；所有已传入条件严格匹配。模型编号猜测仅在详情中参考，不预填确认结果。旧记录未提供的特征需手动填写。</p>
        <p>审核记录保存在此浏览器。加入我的积木只添加已确认且勾选的识别项，不保存审核或清单。手动填写的型号与颜色请先确认。</p>
        {result && <><p>{result.prompt_id || '历史记录未标注 Prompt'} {result.prompt_version ? 'v' + result.prompt_version : ''} · {result.status} · Provider {result.provider} · 模型 {result.model} / {result.modelVersion || '未返回'} · HTTP {result.httpStatus ?? 'SDK 未提供'} · {result.elapsedMs} ms · {result.finishReason}</p></>}
      </>}>
      <button disabled={busy || !result} onClick={saveDraft}>保存审核</button>
      <button disabled={busy || applied || !selectedConfirmed.length} onClick={addConfirmed}>{applied ? '已加入我的积木；请保存积木清单' : '加入我的积木'}</button>
      {onReset && <button disabled={busy || !confirmedRows.length} onClick={() => {
        try {
          const confirmedItems = confirmedRows.map(row => ({ part_num: row.part, color_id: Number(row.color), quantity: Number(row.quantity) }))
          if (onReset(confirmedItems) !== false) setApplied(false)
        } catch (e) { setError(String(e)) }
      }}>重置我的积木</button>}
    </ReviewToolbar>
    {result && <>
      <p>Analysis ID: {result.id}<br/>Source Image: <a href={'/api/brick-source-images/' + encodeURIComponent(result.sourceImageId!)} target="_blank" rel="noreferrer">{result.sourceImageId}</a></p>
      {result.error && <p role="alert">{result.error.stage}：{result.error.message}</p>}
      {!!rows.length && <>
        <div className="vision-review-actions">
          <button disabled={busy || applied} onClick={() => void autofill(rows)}>检索并回填所有</button>
          <button disabled={busy || applied || !rows.some(row => row.selected && !row.excluded)} onClick={() => void validateSelection()}>确认勾选项的型号与颜色</button>
        </div>
        {/^(保存失败|审核草稿未恢复)/.test(draftNotice) && <p role="alert">{draftNotice}</p>}
        {autoSummary && <p role="status">{autoSummary}</p>}
        <ObservationTable stickyAction hostRef={tableHost} columns={[
          { label: '操作', width: 52 }, { label: '审核状态', width: 96, header: <ReviewStatusFilter value={reviewFilter} onChange={setReviewFilter} /> }, { label: '识别项', width: 104 }, { label: '型号', width: 128 },
          { label: '宽 (Stud)', width: 72 }, { label: '深 (Stud)', width: 72 }, { label: '高 (Brick)', width: 76 },
          { label: '颜色', width: 64 }, { label: '形状', width: 112 }, { label: '印花', width: 76 },
          { label: '数量', width: 60 },
        ]}>
          {rows.map(row => {
              const match = matches.get(row.id)
              if (!match) return null
              const status = reviewStatus(row.excluded, isConfirmed(row))
              if (!matchesReviewFilter(reviewFilter, status)) return null
              const observation = match.observation
              return <tr key={row.id} data-observation-id={row.id} className={activeId === row.id ? 'is-active' : ''}
                onClick={event => {
                  if (event.target instanceof Element && event.target.closest('input, select, button, [popover]')) return
                  setActiveId(row.id)
                }}>
                <td><ObservationActions observationId={row.id} actions={[
                  { label: '按型号查找', disabled: busy || applied || !row.part.trim() || !onSearchCatalog, run: () => searchObservation(row, 'part') },
                  { label: '按特征查找', disabled: busy || applied || !onSearchCatalog, run: () => searchObservation(row) },
                  { label: '在零件目录中查找', disabled: busy || applied || !onSearchCatalog, run: () => searchObservation(row, 'manual') },
                  { label: '检索并回填', disabled: busy || applied, run: () => { void autofill([row]) } },
                  { label: '查看详情', run: () => setDetail({ kind: 'observation', id: row.id }) },
                  { label: row.excluded ? '恢复审核' : '排除', disabled: busy || applied, run: () => editRow(row.id, { excluded: !row.excluded, selected: false }) },
                  { label: '删除', disabled: busy || applied, run: () => { catalogEpoch.current++; setReviewSaved(false); setDraftNotice('审核有未保存修改。'); setValidation(null); setRows(rows.filter(r => r.id !== row.id)); if (activeId === row.id) setActiveId('') } },
                ]} />
                  <label><input type="checkbox" aria-label={row.id + ' 加入我的积木'} checked={row.selected} disabled={busy || applied || row.excluded}
                    onChange={e => { setReviewSaved(false); setDraftNotice('审核有未保存修改。'); setRows(rows.map(r => r.id === row.id ? { ...r, selected: e.target.checked } : r)) }} /></label>
                </td>
                <td className="vision-match-status"><span className="vision-review-badge">{reviewStatusLabels[status]}</span></td>
                <td><button type="button" className="vision-observation-id" aria-pressed={activeId === row.id}
                  title={row.id + (!bboxStyle(observation.bbox) ? ' · 无有效 BBox' : '')}
                  onClick={() => { setActiveId(row.id); previewHost.current?.scrollIntoView({ block: 'nearest' }) }}>{row.id}</button>
                  <small>{observation.status} / {observation.confidence}</small></td>
                <td><input aria-label={row.id + ' 用户 Part Number'} value={row.part} placeholder="输入 RB 型号" disabled={busy || applied}
                  onChange={e => editRow(row.id, { part: e.target.value })} />
                  <small>模型参考：{observation.candidates?.map(c => c.part_num).join(', ') || '—'}</small>
                  <small>确认型号：{isConfirmed(row) ? row.part : '—'}</small>
                  <label>确认 Color<input aria-label={row.id + ' 确认 RB Color ID'} value={row.color} disabled={busy || applied}
                    onChange={e => editRow(row.id, { color: e.target.value })} /></label></td>
                <ObservationFeatureCells id={row.id} features={row.features} disabled={busy || applied}
                  onChange={features => editRow(row.id, { features })} />
                <td><input aria-label={row.id + ' Quantity'} value={row.quantity} disabled={busy || applied}
                  onChange={e => editRow(row.id, { quantity: e.target.value })} /></td>

              </tr>
          })}
        </ObservationTable>
      </>}
      <div className="vision-review-actions">
        {validation !== null && <button onClick={() => setDetail({ kind: 'validation' })}>人工草稿校验结果</button>}
        <button onClick={() => setDetail({ kind: 'diagnostics' })}>完整 JSON / Evidence / Token / 诊断</button>
        <button onClick={() => downloadVision(result)}>下载完整诊断（含原图与模型输入）</button>
      </div>
    </>}
  </div>
  return <section className="inventory-catalog inventory-source" id="inventory-image">
    <h2>散装积木识别</h2>
    <p>照片只发送给所选 Provider；一次识别只请求一次模型，不自动切换。不确定项需人工核对。诊断含原图，保存在本机 Test Audio generated/brick-vision 中。</p>
    <ServerImagePicker initialScene={initialScene} restoredSelection={restoredSelection} onReady={() => setPickerReady(true)} onSelectionChange={setImageSelection} disabled={busy} onBusy={value => { lock.current = value; setBusy(value) }} onChange={image => {
      catalogEpoch.current++
      setPrepared(image); setImageInfo(image?.compression || null); requestId.current = newSessionId()
      setResult(null); setRows([]); setApplied(false); setValidation(null); setError('')
      setPreview(image ? 'data:' + image.originalImage.mimeType + ';base64,' + image.originalImage.imageBase64 : '')
    }} />
    <span tabIndex={0} aria-label="图片压缩信息" style={{ cursor: 'help', marginLeft: 6 }} title={`自动压缩：最长边 1024 px，JPEG Quality 80%，不放大小图，按图片方向保持宽高比；预览和诊断保留原图。${imageInfo ? `\n原图 ${imageInfo.original.width}×${imageInfo.original.height}，${imageInfo.original.bytes} bytes\n发送 ${imageInfo.sent.width}×${imageInfo.sent.height}，${imageInfo.sent.bytes} bytes` : ''}`}>ⓘ</span>
    <div className="inventory-history">
      <label htmlFor="vision-history-select">识别历史</label>
      <select id="vision-history-select" aria-label="已成功识别的图片" value={historyId} disabled={busy} onChange={e => setHistoryId(e.target.value)}>
        <option value="">选择成功记录</option>{history.map(r => <option key={r.id} value={r.id}>{r.createdAt} · {r.provider || '未记录 Provider'} · {r.model} · {r.originalName || r.image.sha256.slice(0, 12)} · {r.id}</option>)}
      </select>
      <button disabled={busy} onClick={() => void refreshHistory()}>刷新</button>
      <button disabled={busy || !historyId} onClick={() => void loadHistory(historyId)}>加载识别结果</button>
      <p>加载原始识别及此浏览器已保存的审核草稿；未保存编辑会被替换。审核草稿不会覆盖服务端原始记录。</p>
    </div>
    <ModelSelector models={models} value={{ provider, id: model }} disabled={busy || !models.length} onChange={chosen => {
      if (lock.current || (chosen.id === model && chosen.provider === provider)) return
      catalogEpoch.current++
      setModel(chosen.id); setProvider(chosen.provider); requestId.current = newSessionId(); setResult(null); setRows([]); setApplied(false); setValidation(null); setError('')
    }} />
    <CopySceneLink sync={active && pickerReady && modelsReady && historyReady && sceneRestored} disabled={!historyReady || !sceneRestored || busy || !pickerReady || !modelsReady} dirty={!!result && !reviewSaved} scene={{ strategy: 'loose',
      imageSource: imageSelection.source, image: imageSelection.name, provider, model, analysisId: result?.id }} />
    {provider === 'openai' && !openaiConfigured && <p role="alert">Test Audio 服务端尚未配置 OPENAI_API_KEY；请配置后重启服务，不会改用 Gemini。</p>}
    {modelError && <p role="alert">{modelError} <button disabled={busy} onClick={() => setConfigRevision(n => n + 1)}>重新读取模型配置（不调用模型）</button></p>}
    <button disabled={!prepared || busy || !!result || !model} onClick={() => void recognize()}>{busy ? '处理中…' : '识别图片'}</button>
    <p>切换模型不会立即识别，需再次点击“识别照片”。相同请求不会自动重试模型。如需重新识别，可明确重新选择图片或切换模型。遮挡、相似模具和光照可能造成误识别。</p>
    {result?.originalImage?.name && imageSelection.name && result.originalImage.name !== imageSelection.name && <small>历史识别与标注仍使用参考图片：{result.originalImage.name}。</small>}
    {preview && <div ref={previewHost}><ObservationPreview src={preview} observations={visibleObservations} activeId={activeId} onSelect={selectBox} /></div>}
    {result && !preview && <p>此记录没有可显示的原图，未绘制 BBox；原始坐标仍可在详情查看。</p>}
    {error && <p role="alert">{error}</p>}
    {result && <p role="status">{result.status} · {result.provider} · {result.model} · {result.elapsedMs} ms</p>}
    {workspaceHost ? createPortal(review, workspaceHost) : review}
    {detail && <ObservationModal title={detail.kind === 'observation' ? '识别项 ' + detail.id : detail.kind === 'validation' ? '人工草稿校验结果' : '完整识别诊断'}
      data={detail.kind === 'observation' ? { original: matches.get(detail.id), reviewDraft: rows.find(r => r.id === detail.id), catalogSearchNote: autoNotes[detail.id] || null, draftValidation: validation } : detail.kind === 'validation' ? validation : result}
      onClose={() => setDetail(null)} />}
  </section>
}

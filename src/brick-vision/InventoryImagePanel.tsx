import { ModelSelector } from '../model-selector'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addItem, newSessionId } from '../brick-inventory/inventory'
import type { InventoryItem } from '../brick-inventory/inventory'
import { requestJson } from '../brick-inventory/api.mjs'
import { prepareInventoryImage, recognizeImage, downloadVision } from './upload'
import type { ObservationCatalogSearch, VisionResult } from './types'
import { ObservationPreview } from './ObservationPreview'
import { ObservationActions } from './ObservationActions'
import { ObservationModal } from './ObservationModal'
import { bboxStyle } from './observation-view.mjs'
import { catalogFeatureParams, catalogShapes, catalogPrints, createObservationDraft, readFeatureEditor } from './catalog-features.mjs'
import { uniqueCatalogIdentity, hasConfirmedIdentity, completeCatalogIdentity } from './catalog-autofill.mjs'
import type { FeatureEditor } from './catalog-features.mjs'
import './review.css'

type DraftRow = { id: string; selected: boolean; part: string; color: string; quantity: string;
  features: FeatureEditor; confirmation: unknown; identityOrigin?: 'auto' | 'manual' }
type ModelStatus = { model: string; openaiApiKeyConfigured: boolean; models: { id: string; label: string; provider: 'gemini' | 'openai' }[] }
export function InventoryImagePanel({ onApply, workspaceHost, onSearchCatalog }: {
  onApply(items: InventoryItem[]): void; workspaceHost?: HTMLElement | null
  onSearchCatalog?(request: ObservationCatalogSearch): void
}) {
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState('')
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareInventoryImage>> | null>(null)
  const [imageInfo, setImageInfo] = useState<VisionResult['compression']>(null)
  const [history, setHistory] = useState<{ id: string; createdAt: string; provider: string; model: string; image: VisionResult['image']; originalName?: string }[]>([])
  const [historyId, setHistoryId] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [applied, setApplied] = useState(false)
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
  useEffect(() => () => { catalogEpoch.current++ }, [])
  function restoreResult(next: VisionResult) {
    catalogEpoch.current++
    autoCache.current.clear(); setAutoNotes({}); setAutoSummary('')
    setResult(next); setApplied(false); setValidation(null)
    setRows((next.matches || []).map(m => createObservationDraft(m.observation)))
  }
  function editRow(id: string, changes: Partial<DraftRow>) {
    catalogEpoch.current++
    if (changes.features) autoCache.current.clear()
    setAutoNotes(previous => ({ ...previous, [id]: '' })); setAutoSummary('')
    setValidation(null)
    setRows(previous => previous.map(r => r.id === id ? { ...r, selected: false, confirmation: null,
      ...(changes.features && r.identityOrigin === 'auto' ? { part: '', color: '', identityOrigin: undefined } : {}),
      ...('part' in changes || 'color' in changes ? { identityOrigin: 'manual' as const } : {}), ...changes } : r))
  }
  function searchObservation(row: DraftRow) {
    if (!onSearchCatalog || !result || lock.current || applied) return
    try {
      const features = readFeatureEditor(row.features)
      if (features.color_id === null && features.size === null && features.shape === null && features.print === 'unknown') {
        throw new Error('没有可检索的已知特征，请先人工填写至少一项；不会使用模型猜测编号代替检索。')
      }
      const epoch = ++catalogEpoch.current
      setError('')
      onSearchCatalog({ key: `${result.id}:${row.id}:${epoch}`, observationId: row.id, features, quantity: row.quantity,
        onChoose(item, evidence) {
          if (catalogEpoch.current !== epoch || lock.current) throw new Error('Observation 或人工草稿已改变，请重新点击该行的检索候选。')
          catalogEpoch.current++
          setValidation(null)
          setRows(previous => previous.map(r => r.id === row.id ? { ...r, selected: true, part: item.part_num,
            color: String(item.color_id), quantity: String(item.quantity), identityOrigin: 'manual' as const, confirmation: { features, item, evidence } } : r))
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
      for (const row of requested) {
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
            '/api/brick-catalog/candidates?' + new URLSearchParams({ ...params, page: '1', page_size: '2' }), {}, 'Observation Catalog 检索')
          if (catalogEpoch.current !== epoch) return
          const decision = uniqueCatalogIdentity(data, features.color_id)
          autoCache.current.set(key, { data, expires: cached && cached.expires > Date.now() ? cached.expires : Date.now() + 60000 })
          if (decision.status === 'filled') {
            const completed = completeCatalogIdentity(row, decision)
            counts.filled++
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
    try { setHistory((await requestJson<{ records: typeof history }>('/api/brick-vision/history', {}, '历史识别')).records) }
    catch (e) { setError(String(e)) }
  }
  useEffect(() => { void refreshHistory() }, [])
  useEffect(() => {
    const controller = new AbortController()
    setModelError('')
    void requestJson<ModelStatus>('/api/brick-vision', { signal: controller.signal }, 'Vision 模型配置').then(status => {
      if (!Array.isArray(status.models) || !status.models.every(m => m && typeof m.id === 'string' && typeof m.label === 'string' && ['gemini', 'openai'].includes(m.provider))
        || !status.models.some(m => m.id === status.model)) throw new Error('Vision 模型配置无效')
      if (!controller.signal.aborted) { setModels(status.models); setModel(status.model); setProvider(status.models.find(m => m.id === status.model)!.provider); setOpenaiConfigured(status.openaiApiKeyConfigured) }
    }).catch(e => { if (!controller.signal.aborted) setModelError(String(e)) })
    return () => controller.abort()
  }, [configRevision])
  async function recognize() {
    if (!file || !prepared || lock.current || !models.some(m => m.id === model && m.provider === provider)) return
    catalogEpoch.current++
    lock.current = true; setBusy(true); setError(''); setResult(null); setRows([]); setValidation(null)
    try {
      const next = await recognizeImage(prepared, requestId.current, undefined, model, provider)
      restoreResult(next)
    } catch (e) { setError(String(e)) } finally { setBusy(false); lock.current = false }
  }
  async function apply() {
    if (lock.current || applied) return
    catalogEpoch.current++
    lock.current = true; setBusy(true); setError('')
    try {
      const items = rows.filter(r => r.selected).reduce<InventoryItem[]>((items, r) => {
        if (!r.color.trim() || !r.quantity.trim()) throw new Error('请填写颜色 ID 和数量')
        return addItem(items, { part_num: r.part.trim(), color_id: Number(r.color), quantity: Number(r.quantity) })
      }, [])
      if (!items.length) throw new Error('请勾选确认的积木；不确定项可修改后再勾选。')
      const checked = await requestJson<{ valid: boolean }>('/api/brick-vision/validate', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }, '库存格式 / Catalog 身份检查')
      setValidation(checked)
      if (!checked.valid) throw new Error('草稿存在无效型号或颜色组合；请查看 Catalog 校验详情并修改。')
      if (window.confirm('将勾选的积木加入当前库存编辑器？不会自动保存，原有积木会保留。')) { onApply(items); setApplied(true) }
    } catch (e) { setError(String(e)) } finally { setBusy(false); lock.current = false }
  }
  const matches = new Map((result?.matches || []).map(m => [m.observation.id, m]))
  const visibleObservations = rows.flatMap(row => { const m = matches.get(row.id); return m ? [m.observation] : [] })
  const selectBox = (id: string) => {
    setActiveId(id)
    const row = [...(tableHost.current?.querySelectorAll<HTMLElement>('[data-observation-id]') || [])].find(r => r.dataset.observationId === id)
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const review = <div className="inventory-vision-review">
    {result && <>
      <p>{result.status} · Provider {result.provider} · 模型 {result.model} / {result.modelVersion || '未返回'} · HTTP {result.httpStatus ?? 'SDK 未提供'} · {result.elapsedMs} ms · {result.finishReason}</p>
      {result.error && <p role="alert">{result.error.stage}：{result.error.message}</p>}
      {!!rows.length && <>
        <p>编辑视觉特征后，逐行检索下方 Catalog 并人工选择型号与颜色。未知特征不参与检索；所有已传入条件严格匹配。模型编号猜测仅在详情中参考，不预填确认结果。旧记录未提供的特征需手动填写。</p>
        <button disabled={busy || applied} onClick={() => void autofill(rows)}>检索并回填所有</button>
        {autoSummary && <p role="status">{autoSummary}</p>}
        <div className="vision-observation-scroll" ref={tableHost} tabIndex={0} role="region" aria-label="Observation 审核表，可横向滚动">
          <table className="vision-observation-table">
            <colgroup>{[40, 90, 230, 88, 86, 120, 90, 130, 90, 68, 64].map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
            <thead><tr>{['选择', 'ID', 'Vision / 置信度 · 审核', '特征颜色 ID', '整体尺寸', 'Shape', 'Print', '确认型号', '确认颜色 ID', '数量', '操作'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{rows.map(row => {
              const match = matches.get(row.id)
              if (!match) return null
              const observation = match.observation
              const note = autoNotes[row.id] || ''
              const reviewStatus = row.part.trim() && row.color.trim() ? (row.confirmation ? (row.identityOrigin === 'manual' ? '已确认' : '已回填') : '待校验')
                : note && !note.startsWith('跳过') ? (note.startsWith('存在多个') ? '多候选' : '未匹配/失败') : '待确认'
              return <tr key={row.id} data-observation-id={row.id} className={activeId === row.id ? 'is-active' : ''}
                onClick={event => {
                  if (event.target instanceof Element && event.target.closest('input, select, button, [popover]')) return
                  setActiveId(row.id)
                }}>
                <td><input type="checkbox" aria-label={row.id + ' 加入库存'} checked={row.selected} disabled={busy || applied}
                  onChange={e => setRows(rows.map(r => r.id === row.id ? { ...r, selected: e.target.checked } : r))} /></td>
                <td><button type="button" className="vision-observation-id" aria-pressed={activeId === row.id}
                  title={row.id + (!bboxStyle(observation.bbox) ? ' · 无有效 BBox' : '')}
                  onClick={() => { setActiveId(row.id); previewHost.current?.scrollIntoView({ block: 'nearest' }) }}>{row.id}</button></td>
                <td title={note || reviewStatus}><span>{observation.status} / {observation.confidence}</span> <span className="vision-review-badge">{reviewStatus}</span></td>
                <td><input aria-label={row.id + ' 特征 RB Color ID'} inputMode="numeric" placeholder="未知" value={row.features.color} disabled={busy || applied}
                  onChange={e => editRow(row.id, { features: { ...row.features, color: e.target.value } })} /></td>
                <td><input aria-label={row.id + ' 整体尺寸'} placeholder="未知" value={row.features.size} disabled={busy || applied}
                  onChange={e => editRow(row.id, { features: { ...row.features, size: e.target.value } })} /></td>
                <td><select aria-label={row.id + ' Shape'} value={row.features.shape} disabled={busy || applied}
                  onChange={e => editRow(row.id, { features: { ...row.features, shape: e.target.value } })}>
                  <option value="">未知</option>{catalogShapes.map(shape => <option key={shape} value={shape}>{shape}</option>)}</select></td>
                <td><select aria-label={row.id + ' Print'} value={row.features.print} disabled={busy || applied}
                  onChange={e => editRow(row.id, { features: { ...row.features, print: e.target.value } })}>
                  {catalogPrints.map(print => <option key={print} value={print}>{print === 'yes' ? '有印花' : print === 'no' ? '无印花' : '未知'}</option>)}</select></td>
                {(['part', 'color', 'quantity'] as const).map(key => <td key={key}><input aria-label={row.id + ' ' + (key === 'part' ? '确认 Part Number' : key === 'color' ? '确认 RB Color ID' : 'Quantity')}
                  title={row[key]} value={row[key]} disabled={busy || applied} onChange={e => editRow(row.id, { [key]: e.target.value })} /></td>)}
                <td><ObservationActions observationId={row.id} actions={[
                  { label: '检索候选', disabled: busy || applied || !onSearchCatalog, run: () => searchObservation(row) },
                  { label: '检索并回填', disabled: busy || applied, run: () => { void autofill([row]) } },
                  { label: '查看详情', run: () => setDetail({ kind: 'observation', id: row.id }) },
                  { label: '删除', disabled: busy || applied, run: () => { catalogEpoch.current++; setValidation(null); setRows(rows.filter(r => r.id !== row.id)); if (activeId === row.id) setActiveId('') } },
                ]} /></td>
              </tr>
            })}</tbody>
          </table>
        </div>
        <button disabled={busy || applied} onClick={() => void apply()}>{applied ? '已加入；请在库存编辑器保存' : '校验并确认加入库存编辑器（不调用模型）'}</button>
      </>}
      <div className="vision-review-actions">
        {validation !== null && <button onClick={() => setDetail({ kind: 'validation' })}>人工草稿校验结果</button>}
        <button onClick={() => setDetail({ kind: 'diagnostics' })}>完整 JSON / Evidence / Token / 诊断</button>
        <button onClick={() => downloadVision(result)}>下载完整诊断（含原图与模型输入）</button>
      </div>
    </>}
  </div>
  return <section className="inventory-catalog inventory-source" id="inventory-image">
    <h2>Inventory Image Recognition · 上传图片</h2>
    <p>照片只发送给所选 Provider；一次识别只请求一次模型，不自动切换。不确定项需人工核对。诊断含原图，保存在本机 Test Audio generated/brick-vision 中。</p>
    <input aria-label="选择库存照片" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async e => {
      const selected = e.target.files?.[0] || null
      catalogEpoch.current++
      setFile(selected); setPrepared(null); setImageInfo(null); requestId.current = newSessionId(); setResult(null); setPreview(''); setRows([]); setApplied(false); setValidation(null); setError('')
      if (!selected) return
      lock.current = true; setBusy(true)
      try {
        const image = await prepareInventoryImage(selected)
        setPrepared(image); setImageInfo(image.compression)
        setPreview(`data:${image.originalImage.mimeType};base64,${image.originalImage.imageBase64}`)
      } catch (err) { setError(String(err)) }
      finally { lock.current = false; setBusy(false) }
    }} />
    <span tabIndex={0} aria-label="图片压缩信息" style={{ cursor: 'help', marginLeft: 6 }} title={`自动压缩：最长边 1024 px，JPEG Quality 80%，不放大小图，按图片方向保持宽高比；预览和诊断保留原图。${imageInfo ? `\n原图 ${imageInfo.original.width}×${imageInfo.original.height}，${imageInfo.original.bytes} bytes\n发送 ${imageInfo.sent.width}×${imageInfo.sent.height}，${imageInfo.sent.bytes} bytes` : ''}`}>ⓘ</span>
    <div className="inventory-history">
      <label htmlFor="vision-history-select">历史识别</label>
      <select id="vision-history-select" aria-label="已成功识别的图片" value={historyId} disabled={busy} onChange={e => setHistoryId(e.target.value)}>
        <option value="">选择成功记录</option>{history.map(r => <option key={r.id} value={r.id}>{r.createdAt} · {r.provider || '未记录 Provider'} · {r.model} · {r.originalName || r.image.sha256.slice(0, 12)} · {r.id}</option>)}
      </select>
      <button disabled={busy} onClick={() => void refreshHistory()}>刷新</button>
      <button disabled={busy || !historyId} onClick={async () => {
        if (lock.current) return
        lock.current = true; setBusy(true); setError('')
        try {
          const next = await requestJson<VisionResult>(`/api/brick-vision/history/${encodeURIComponent(historyId)}`, {}, '加载历史识别')
          restoreResult(next); setFile(null); setPrepared(null); setImageInfo(next.compression)
          setPreview(next.originalImage ? `data:${next.originalImage.mimeType};base64,${next.originalImage.imageBase64}` : '')
        } catch (e) { setError(String(e)) } finally { lock.current = false; setBusy(false) }
      }}>加载结果（不调用模型）</button>
      <p>加载恢复原始识别，未加入库存的草稿编辑会被替换；修改和加入库存不会覆盖服务端原始记录。</p>
    </div>
    <ModelSelector models={models} value={{ provider, id: model }} disabled={busy || !models.length} onChange={chosen => {
      if (lock.current || (chosen.id === model && chosen.provider === provider)) return
      catalogEpoch.current++
      setModel(chosen.id); setProvider(chosen.provider); requestId.current = newSessionId(); setResult(null); setRows([]); setApplied(false); setValidation(null); setError('')
    }} />
    {provider === 'openai' && !openaiConfigured && <p role="alert">Test Audio 服务端尚未配置 OPENAI_API_KEY；请配置后重启服务，不会改用 Gemini。</p>}
    {modelError && <p role="alert">{modelError} <button disabled={busy} onClick={() => setConfigRevision(n => n + 1)}>重新读取模型配置（不调用模型）</button></p>}
    <button disabled={!file || !prepared || busy || !!result || !model} onClick={() => void recognize()}>{busy ? '处理中…' : '识别照片'}</button>
    <p>切换模型不会立即识别，需再次点击“识别照片”。相同请求不会自动重试模型。如需重新识别，可明确重新选择图片或切换模型。遮挡、相似模具和光照可能造成误识别。</p>
    {preview && <div ref={previewHost}><ObservationPreview src={preview} observations={visibleObservations} activeId={activeId} onSelect={selectBox} /></div>}
    {result && !preview && <p>此记录没有可显示的原图，未绘制 BBox；原始坐标仍可在详情查看。</p>}
    {error && <p role="alert">{error}</p>}
    {result && <p role="status">{result.status} · {result.provider} · {result.model} · {result.elapsedMs} ms</p>}
    {workspaceHost ? createPortal(review, workspaceHost) : review}
    {detail && <ObservationModal title={detail.kind === 'observation' ? 'Observation ' + detail.id : detail.kind === 'validation' ? '人工草稿校验结果' : '完整识别诊断'}
      data={detail.kind === 'observation' ? { original: matches.get(detail.id), reviewDraft: rows.find(r => r.id === detail.id), catalogSearchNote: autoNotes[detail.id] || null, draftValidation: validation } : detail.kind === 'validation' ? validation : result}
      onClose={() => setDetail(null)} />}
  </section>
}

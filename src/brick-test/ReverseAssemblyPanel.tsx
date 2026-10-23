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

type Props = { inventory: InventoryRow[]; onQuantity(row: InventoryRow, quantity: number): void; models: Model[]; model: string;
  onModel(model: string): void; disabled: boolean; onBusy(busy: boolean): void;
  analysisMode: AnalysisMode; onAnalysisMode(mode: AnalysisMode): void; onDirty(dirty: boolean): void;
  active: boolean; geometryHost: HTMLElement | null; onGeometryPresence(value: boolean): void; onSearchCatalog(request: ObservationCatalogSearch): void; workspaceHost: HTMLElement | null; resultsHost: HTMLElement | null; onApply(items: InventoryItem[]): void }
const post = <T,>(action: string, body: unknown) => requestJson<T>('/api/brick-reverse/' + action, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000),
}, 'Reverse ' + action)

export function ReverseRecognitionPanel({ inventory, onQuantity, models, model, onModel, disabled, onBusy, analysisMode, onAnalysisMode, onDirty, active: visible, workspaceHost, geometryHost, onGeometryPresence, onSearchCatalog, resultsHost, onApply }: Props) {
  const [source, setSource] = useState('full'), [sessions, setSessions] = useState<SessionInventory[]>([]), [sessionId, setSessionId] = useState('')
  const [image, setImage] = useState<PreparedSourceImage | null>(null)
  const [record, setRecord] = useState<Analysis | null>(null), [rows, setRows] = useState<Record<string, Draft>>({})
  const [active, setActive] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const [recordId, setRecordId] = useState(() => new URL(location.href).searchParams.get('analysisId') || ''), [submitted, setSubmitted] = useState(false)
  const [applied, setApplied] = useState(false)
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [generationSubmitted, setGenerationSubmitted] = useState(false)
  const [detailId, setDetailId] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([]), [historyWarning, setHistoryWarning] = useState('')
  const [dirty, setDirty] = useState(false), [savedAt, setSavedAt] = useState(''), [restoreWarning, setRestoreWarning] = useState('')
  const tableHost = useRef<HTMLDivElement>(null), previewHost = useRef<HTMLDivElement>(null)
  const gate = useRef(false)
  const requestId = useRef(newSessionId())
  const locked = disabled || !!busy
  const geometryOnly = (record ? record.analysis_mode || 'catalog_match' : analysisMode) === 'geometry_only'
  const catalogEpoch = useRef(0)
  const [candidateNotes, setCandidateNotes] = useState<Record<string, string>>({})
  useEffect(() => { catalogEpoch.current++ }, [visible])
  useEffect(() => () => { catalogEpoch.current++ }, [])
  useEffect(() => { onGeometryPresence(visible && geometryOnly && !!record?.analysis) }, [visible, geometryOnly, record?.analysis, onGeometryPresence])

  async function refreshHistory() {
    const value = await requestJson<History>('/api/brick-reverse/history', {}, '历史 Reverse Analysis')
    setHistory(value.items); setHistoryWarning(value.warnings.join('；'))
  }
  useEffect(() => {
    let cancelled = false
    void requestJson<History>('/api/brick-reverse/history', {}, '历史 Reverse Analysis').then(value => {
      if (!cancelled) { setHistory(value.items); setHistoryWarning(value.warnings.join('；')) }
    }).catch(e => { if (!cancelled) setHistoryWarning(String(e)) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  async function saveReview() {
    if (!record) return
    const value = await post<{ updatedAt: string }>('saveReview', { analysisId: record.id,
      rows: Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, {
        features: r.features, quantity: r.quantity, excluded: r.excluded, reason: r.reason,
        searchId: r.search?.id, index: r.index,
      }])) })
    setDirty(false); setSavedAt(value.updatedAt)
  }

  function selectBox(id: string) {
    setActive(id)
    const row = [...(tableHost.current?.querySelectorAll<HTMLElement>('[data-observation-id]') || [])].find(r => r.dataset.observationId === id)
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  function reset() {
    if (dirty && !window.confirm('存在未保存的审核修改。确定放弃并新建分析？')) return
    catalogEpoch.current++; setCandidateNotes({})
    setDirty(false); setSavedAt(''); setRestoreWarning('')
    setDetailId('')
    if (record?.image && record.originalImage && record.compression) setImage({ ...record.image,
      originalImage: record.originalImage, compression: record.compression,
      imageReference: { kind: record.image_reference?.kind === 'server_library' ? 'server_library' : 'upload',
        name: record.image_reference?.name || record.originalImage.name } })
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
  async function acceptAnalysis(value: Analysis, restoredRows?: Record<string, Draft>) {
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
        method, partNumber, features, quantity: row.quantity,
        onResults(count) {
          if (catalogEpoch.current !== epoch) return
          setCandidateNotes(old => ({ ...old, [id]: count == null ? '检索失败；查看右栏' : 'Candidates · 本页 ' + count + ' 个型号' }))
        },
        async onChoose(item, _evidence, isCurrent) {
          if (catalogEpoch.current !== epoch || gate.current || !isCurrent()) throw new Error('Observation 已改变，请重新检索。')
          gate.current = true; setBusy('确认 Catalog 身份'); onBusy(true)
          try {
            // Existing persistence requires a server-owned searchId/index. Only
            // after explicit selection, resolve that exact identity for saving.
            // This does not render a second candidate list or assert geometry.
            const resolved = await post<Search>('search', { analysisId: record.id, observationId: id,
              features: { color_id: null, size: null, shape: null, print: 'unknown' }, partNumber: item.part_num, page: 1 })
            if (catalogEpoch.current !== epoch || !isCurrent()) throw new Error('搜索目标已改变，本次结果未回填。')
            const index = resolved.rows.findIndex(r => r.source.part_num === item.part_num && r.source.color_id === item.color_id && r.sourceAllowed)
            if (index < 0) throw new Error('该型号 / 颜色未通过现有 Catalog 身份或 Part Source 检查。')
            edit(id, { features: { ...row.features, partNumber: item.part_num }, quantity: String(item.quantity),
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
  const confirmedItems = Object.values(rows).flatMap(r => {
    const chosen = r.index === undefined ? undefined : r.search?.rows[r.index]
    const quantity = Number(r.quantity)
    return !r.excluded && chosen?.sourceAllowed && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100
      ? [{ ...chosen.source, quantity }] : []
  })
  const displayedInventory = record?.source.kind === 'virtual' ? record.source.inventory : inventory
  const preview = record ? record.image?.imageBase64 ? record.image : null : image
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
  const workspace = <div className="brick-reverse" hidden={!visible}>
    {record?.analysis && <>

      <div className="brick-actions"><button type="button" disabled={locked || record.status !== 'complete'} onClick={() => void action('保存审核', saveReview)}>保存审核（不调用模型）</button>
        <small>{dirty ? '审核有未保存修改；请保存后再加载其他记录。' : savedAt ? '审核已保存：' + savedAt : '尚未保存审核草稿'}</small></div>
      <p>{record.analysis.appearance}</p>
      <p>Width / Depth 单位 Stud（16 mm），Height 单位 Brick（19.2 mm）；留空表示 Unknown。By Features 会发送已填写的 Width / Depth / Height；填写 Height 时需可靠主体几何证据，Unknown 不匹配。未填写 Height 的完整整数二维尺寸仍走现有水平检索。Catalog 身份和尺寸匹配不是 Assembly 连接能力验证。几何表中的高度、颜色描述和证据保持独立，请人工核对。By Features 会重置并填写右栏 Catalog Search；修改搜索条件后仍为标注的 Observation 选择。退出关联后可普通搜索并加入 Results。</p>
      <ObservationTable stickyAction hostRef={geometryOnly ? undefined : tableHost} columns={[
        { label: 'Action', width: 60 }, { label: 'Observation', width: 110 }, { label: 'Part Number', width: 135 },
        { label: 'Width (Stud)', width: 85 }, { label: 'Depth (Stud)', width: 85 }, { label: 'Height (Brick)', width: 90 },
        { label: 'Color', width: 80 }, { label: 'Shape', width: 105 }, { label: 'Print', width: 80 },
        { label: 'Qty', width: 60 }, { label: 'Match Status', width: 175 },
      ]}>
        {record.analysis.observations.map(o => {
          const row = rows[o.id]
          if (!row) return null
          const chosen = row.index === undefined ? undefined : row.search?.rows[row.index]
          const available = row.search?.rows.filter(r => r.sourceAllowed).length
          const status = row.excluded ? 'Excluded' : chosen?.sourceAllowed ? 'Confirmed · Catalog 身份' : candidateNotes[o.id] || (row.search ? 'Candidates · ' + (available || 0) + ' 本页可用' : 'Pending')
          return <tr key={o.id} data-observation-id={o.id} className={active === o.id ? 'is-active' : ''} onClick={event => {
            if (event.target instanceof Element && event.target.closest('input, select, button, [popover], a, summary')) return
            setActive(o.id)
          }}>
            <td><ObservationActions observationId={o.id} actions={[
              { label: 'By Part Number', disabled: locked || !row.features.partNumber?.trim(), run: () => find(o.id, 'part') },
              { label: 'By Features（含已填 Height）', disabled: locked, run: () => find(o.id, 'features') },
              { label: 'Manual Catalog', disabled: locked, run: () => find(o.id, 'manual') },
              { label: '查看候选 / 人工确认', disabled: locked, run: () => find(o.id, row.search?.partNumber ? 'part' : 'features') },
              { label: '查看详情', run: () => setDetailId(o.id) },
              { label: row.excluded ? '恢复审核' : '排除', disabled: locked || generationSubmitted, run: () => edit(o.id, { excluded: !row.excluded }) },
            ]} /></td>
            <td><button type="button" className="vision-observation-id" aria-pressed={active === o.id} title={o.id}
              onClick={() => { setActive(o.id); previewHost.current?.scrollIntoView({ block: 'nearest' }) }}>{o.id}</button>
              <small>Confidence {o.confidence}</small></td>
            <td><input aria-label={o.id + ' 用户 Part Number'} value={row.features.partNumber ?? ''} placeholder="输入 RB 型号" disabled={locked}
              onChange={e => edit(o.id, { features: { ...row.features, partNumber: e.target.value }, search: undefined, index: undefined })} />
              <small>确认：{chosen?.source.part_num || '—'} / Color {chosen?.source.color_id ?? '—'}</small>
              <small>模型参考见详情；不自动确认</small></td>
            <ObservationFeatureCells id={o.id} features={row.features} disabled={locked}
              onChange={features => edit(o.id, { features, search: undefined, index: undefined })} />
            <td><input aria-label={o.id + ' 确认可见数量'} type="number" min="1" max="100" value={row.quantity}
              disabled={locked || generationSubmitted} onChange={e => edit(o.id, { quantity: e.target.value })} /></td>
            <td className="vision-match-status"><span className="vision-review-badge">{status}</span>
              <small>尺寸验证范围见候选证据</small>
              <small title={'可见凸点 ' + (o.visible_studs ?? 'Unknown') + ' · ' + o.occlusion}>可见凸点 {o.visible_studs ?? 'Unknown'} · 遮挡见详情</small>
              {row.excluded && <input aria-label={o.id + ' 排除原因'} value={row.reason} placeholder="请填写排除原因" disabled={locked}
                onChange={e => edit(o.id, { reason: e.target.value })} />}
            </td>
          </tr>
        })}
      </ObservationTable>
    </>}
    {generationSubmitted && <p className="brick-help">此 Analysis 已提交生成；可以继续保存审核或读取已有方案。原有防重复生成保护仍生效，不覆盖 Artifact。</p>}
    {artifact && <div role="status"><p>Approximation · {artifact.status} · {artifact.error || artifact.generation?.error?.message || '请在 Viewer 与原图对比；Validator 不验证外观相似度。'}</p>
      <button onClick={() => download(artifact, 'reverse-design-' + artifact.id)}>下载 Reverse Artifact</button>
      <details><summary>确认、Geometry Snapshot、Design Hash 与诊断</summary><pre>{JSON.stringify(artifact, null, 2)}</pre></details></div>}
  </div>
  const results = <section className="brick-reverse" hidden={!visible}>
    {record?.analysis && <>
      <h2>Analysis Results</h2>
      <p>原始 Observation 已保存在 Analysis {record.id}，无需匹配 Part Number。{dirty ? '人工审核尚未保存。' : '可随时从历史加载。'}</p>
      <p>已确认 {confirmedItems.length} 项 Catalog 身份；尺寸仅验证查询时已填条件，请核对候选依据。</p>
      <ul>{confirmedItems.map((item, index) => <li key={index}>{item.part_num} / Color {item.color_id} × {item.quantity}</li>)}</ul>
      <button disabled={locked || record.status !== 'complete'} onClick={() => void action('保存审核', saveReview)}>保存观察关联与审核</button>
      <button disabled={locked || applied || !confirmedItems.length} onClick={() => void action('加入 Results', async () => {
        await saveReview(); onApply(confirmedItems); setApplied(true)
      })}>{applied ? '已加入 Results' : '将确认零件加入 Results'}</button>
      {!dirty && record.status === 'complete' && <p><a href={import.meta.env.BASE_URL + 'brick-test.html?analysisId=' + encodeURIComponent(record.id)}>在 Design Lab 加载参考分析 →</a></p>}
      {dirty && <p>先保存审核，再进入 Design Lab；未匹配观察也可以保存。</p>}
    </>}
  </section>
  return <section className="brick-reverse" aria-label="Assembled Recognition">
    <h2>{geometryOnly ? 'Assembled Geometry' : 'Assembled Catalog'}</h2>
    <p className="brick-help">{geometryOnly ? '先分析宽、深、高；仅在你手动检索时使用 Catalog。原始几何观察独立保存。' : '分析可见特征，再检索候选、人工确认；组装生成在 Design Lab 中继续。'} 单张照片无法确认的结构保持 Unknown。</p>
    <fieldset disabled={locked || submitted}>
      <ServerImagePicker disabled={locked || submitted} onChange={setImage} onBusy={value => { gate.current = value; setBusy(value ? '准备图片' : ''); onBusy(value) }} />
      {!geometryOnly && <>
      <label>Part Source<select value={source} onChange={e => { setSource(e.target.value); reset() }}>
        <option value="virtual">Virtual Inventory · 当前虚拟库存</option><option value="today">Today's Inventory · 已保存真实库存</option><option value="full">Full Catalog · 全部 DUPLO</option>
      </select></label>
      {source === 'virtual' && (displayedInventory ? <AvailableInventory inventory={displayedInventory} total={displayedInventory.reduce((n, r) => n + r.quantity, 0)} onQuantity={onQuantity} /> : <p>记录缺少虚拟库存快照。</p>)}
      {source === 'today' && (record ? <pre>{record.source.session ? JSON.stringify(record.source.session, null, 2) : '记录缺少真实库存快照。'}</pre> : <>
        <button type="button" onClick={() => { try { setSessions(loadSessions(localStorage)); setError('') } catch (e) { setError(String(e)) } }}>读取保存库存（不调用模型）</button>
        <label>已保存库存<select value={sessionId} onChange={e => setSessionId(e.target.value)}><option value="">请选择</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.updated_at} · {s.id}</option>)}</select></label>
      </>)}
      </>}
      <ModelSelector models={models} value={{ id: record?.model || model, provider: record?.provider || models.find(m => m.id === model)?.provider || '' }} onChange={m => onModel(m.id)} />
      <p>当前图片：{record?.image_reference?.name || image?.imageReference.name || '未选择'}</p>
      <small title={image ? JSON.stringify(image.compression) : '自动按 EXIF 方向处理，最长边 1024px，JPEG 80%；压缩失败不发送原图。'}>ⓘ 图片压缩信息</small>
      <button type="button" disabled={!image || !model || !geometryOnly && source === 'today' && !sessionId} onClick={() => void action('分析照片', async () => {
        const selected = source === 'today' ? sessions.find(s => s.id === sessionId) : undefined
        if (!geometryOnly && source === 'today' && !selected) throw new Error('请先选择已保存库存。')
        setSubmitted(true); setRecordId(requestId.current)
        await acceptAnalysis(await post<Analysis>('analyze', { ...image, model, analysis_mode: analysisMode, requestId: requestId.current,
          source: geometryOnly ? { kind: 'full' } : source === 'virtual' ? { kind: source, inventory } : source === 'today' ? { kind: source, session: selected } : { kind: source } }))
        await refreshHistory()
      })}>Analyze · 分析照片（调用模型）</button>
    </fieldset>
    <button type="button" disabled={locked} onClick={reset}>新建分析 / 允许再次识别</button>

    <div className="brick-reverse-recovery">
      <label>历史 Reverse Analysis<select value={recordId} disabled={locked} onChange={e => setRecordId(e.target.value)}>
        <option value="">选择历史分析</option>
        {recordId && !history.some(r => r.id === recordId) && <option value={recordId}>{recordId}</option>}
        {history.map(r => <option key={r.id} value={r.id}>
          {r.createdAt} · {r.analysis_mode || 'catalog_match'} · {r.prompt_id || 'reverse_catalog_v1'} v{r.prompt_version || 1} · {r.provider} / {r.model} · {r.image_reference?.name || ''} · {r.appearance || r.status} · {r.count} Observations
        </option>)}
      </select></label>
      <div className="brick-actions">
        <button type="button" disabled={locked} onClick={() => void action('刷新历史', refreshHistory)}>刷新</button>
        <button type="button" disabled={locked || !recordId || dirty} onClick={() => void action('加载分析', async () => {
          const value = await requestJson<Restored>('/api/brick-reverse/restore/' + recordId, {}, '恢复 Reverse 分析')
          await acceptAnalysis(value.analysis, value.rows)
          setImage(null); setSavedAt(value.updatedAt || '')
          setArtifact(value.artifact); setGenerationSubmitted(value.generationStatus !== 'none')
          setRestoreWarning([...(value.analysis.analysis_mode === 'geometry_only' ? ['已恢复 Geometry 原始分析；未调用模型。'] : ['生成状态：' + value.generationStatus]), ...value.warnings].join('；'))
        })}>加载分析（不调用模型）</button>
      </div>
      {historyWarning && <p role="status">{historyWarning}</p>}
    </div>
    {preview && <div ref={previewHost}><ObservationPreview
      src={'data:' + preview.mimeType + ';base64,' + preview.imageBase64} alt="Reverse 实际发送图片及 Observation 标注"
      observations={record?.analysis?.observations || []} activeId={active} onSelect={selectBox} /></div>}
    {record && <>
      <p>{record.analysis_mode || 'catalog_match'} · {record.prompt_id || 'reverse_catalog_v1'} v{record.prompt_version || 1} · {record.image_reference?.name} · {record.status} · {record.provider} · {record.model} / {record.modelVersion || '未返回'} · Source {record.source.kind}</p>
      <button type="button" onClick={() => download(record, 'reverse-analysis-' + record.id)}>下载完整分析诊断 / Raw Trace 路径</button>
      <details><summary>Analysis ID、库存快照、原始分析、关系与 Unknown</summary><pre>{JSON.stringify({ id: record.id, source: record.source, analysis: record.analysis, error: record.error }, null, 2)}</pre></details>
    </>}
    {restoreWarning && <p role="status">{restoreWarning}</p>}
    {workspaceHost ? createPortal(workspace, workspaceHost) : workspace}
    {geometryHost && createPortal(geometry, geometryHost)}
    {resultsHost ? createPortal(results, resultsHost) : results}
    {detailId && <ObservationModal title={'Reverse Observation ' + detailId} data={{
      observation: record?.analysis?.observations.find(o => o.id === detailId),
      review: rows[detailId],
      relations: record?.analysis?.relations,
    }} onClose={() => setDetailId('')} />}
    {busy && <p role="status">{busy}… 不自动重试。</p>}
    {error && <p className="brick-error" role="alert">{error}</p>}
  </section>
}

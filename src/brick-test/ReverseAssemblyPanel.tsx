import { ServerImagePicker } from '../brick-vision/ServerImagePicker'
import type { PreparedSourceImage } from '../brick-vision/ServerImagePicker'
import { GeometryObservationTable } from './GeometryObservationTable'
import type { GeometryFields } from './GeometryObservationTable'
import { useEffect, useRef, useState } from 'react'
import { ModelSelector } from '../model-selector'
import { CatalogPhoto } from '../catalog-photo'
import type { Media } from '../catalog-photo'
import { ObservationPreview } from '../brick-vision/ObservationPreview'
import { ObservationTable, ObservationFeatureCells } from '../brick-vision/ObservationTable'
import { ObservationActions } from '../brick-vision/ObservationActions'
import { ObservationModal } from '../brick-vision/ObservationModal'
import { featureEditor, readFeatureEditor } from '../brick-vision/catalog-features.mjs'
import type { CatalogFeatures, FeatureEditor } from '../brick-vision/catalog-features.mjs'
import { requestJson } from '../brick-inventory/api.mjs'
import { loadSessions } from '../brick-inventory/storage'
import { newSessionId } from '../brick-inventory/inventory'
import type { SessionInventory } from '../brick-inventory/inventory'
import { AvailableInventory } from './AvailableInventory'
import type { GenerationResult, InventoryRow } from './design-types'
import './reverse.css'

type Observation = Partial<CatalogFeatures> & GeometryFields & { id: string; quantity?: number; confidence: number; bbox: number[] | null; evidence: string; occlusion: string; visible_studs: number | null }
type AnalysisMode = 'geometry_only' | 'catalog_match'
type Analysis = { analysis_mode?: AnalysisMode; prompt_id?: string; prompt_version?: number; image_reference?: { kind: string; name: string; sha256: string }; originalImage?: PreparedSourceImage['originalImage']; compression?: PreparedSourceImage['compression']; id: string; kind: string; status: string; model: string; provider: string; modelVersion?: string; source: { kind: string; inventory?: InventoryRow[]; session?: SessionInventory }; image: { mimeType: string; imageBase64: string };
  error?: { message: string }; analysis: { appearance: string; scale_evidence?: string; anchors?: { observation_id: string; evidence: string; confidence: number }[]; unknowns: string[]; observations: Observation[]; relations: unknown[] } | null }
type Candidate = { partCandidates: string[]; colorCandidates: string[]; partCandidateChecks: { part: string; supported: boolean; local: { available: boolean } }[]; source: { part_num: string; color_id: number }; name: string; eligible: boolean; sourceAllowed: boolean; target: { part: string; color: string } | null; errors: string[] }
type Search = { id: string; features: CatalogFeatures; page: number; pageSize: number; catalogTotal: number; rows: Candidate[]; images: Record<string, Media>; imageError: string | null }
type Draft = { features: FeatureEditor; quantity: string; excluded: boolean; reason: string; search?: Search; index?: number }
type Artifact = { id: string; status: string; generation: GenerationResult | null; error?: string; designHash: string | null }

type HistoryItem = { analysis_mode?: AnalysisMode; prompt_id?: string; prompt_version?: number; image_reference?: { name: string }; id: string; createdAt: string; provider: string; model: string; status: string; appearance: string; count: number }
type History = { items: HistoryItem[]; warnings: string[] }
type Restored = { analysis: Analysis; rows: Record<string, Draft>; artifact: Artifact | null; generationStatus: string; updatedAt: string | null; warnings: string[] }

type Model = { id: string; label: string; provider: 'gemini' | 'openai' }
type Props = { inventory: InventoryRow[]; onQuantity(row: InventoryRow, quantity: number): void; models: Model[]; model: string;
  onModel(model: string): void; disabled: boolean; onBusy(busy: boolean): void; onComplete(result: GenerationResult): Promise<void> }
const post = <T,>(action: string, body: unknown) => requestJson<T>('/api/brick-reverse/' + action, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000),
}, 'Reverse ' + action)

export function ReverseAssemblyPanel({ inventory, onQuantity, models, model, onModel, disabled, onBusy, onComplete }: Props) {
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('geometry_only')
  const [source, setSource] = useState('virtual'), [sessions, setSessions] = useState<SessionInventory[]>([]), [sessionId, setSessionId] = useState('')
  const [image, setImage] = useState<PreparedSourceImage | null>(null)
  const [record, setRecord] = useState<Analysis | null>(null), [rows, setRows] = useState<Record<string, Draft>>({})
  const [active, setActive] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const [recordId, setRecordId] = useState(''), [submitted, setSubmitted] = useState(false)
  const [confirmed, setConfirmed] = useState(false), [artifact, setArtifact] = useState<Artifact | null>(null)
  const [generationSubmitted, setGenerationSubmitted] = useState(false)
  const [detailId, setDetailId] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([]), [historyWarning, setHistoryWarning] = useState('')
  const [dirty, setDirty] = useState(false), [savedAt, setSavedAt] = useState(''), [restoreWarning, setRestoreWarning] = useState('')
  const tableHost = useRef<HTMLDivElement>(null), previewHost = useRef<HTMLDivElement>(null), candidateHost = useRef<HTMLDivElement>(null)
  const gate = useRef(false)
  const requestId = useRef(newSessionId())
  const locked = disabled || !!busy
  const geometryOnly = (record ? record.analysis_mode || 'catalog_match' : analysisMode) === 'geometry_only'
  const draft = rows[active], search = draft?.search

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
    setDirty(false); setSavedAt(''); setRestoreWarning('')
    setDetailId('')
    if (record?.image && record.originalImage && record.compression) setImage({ ...record.image,
      originalImage: record.originalImage, compression: record.compression,
      imageReference: { kind: record.image_reference?.kind === 'server_library' ? 'server_library' : 'upload',
        name: record.image_reference?.name || record.originalImage.name } })
    requestId.current = newSessionId(); setRecordId(''); setSubmitted(false); setRecord(null); setRows({}); setArtifact(null)
    setGenerationSubmitted(false); setConfirmed(false); setError('')
  }
  async function action(name: string, work: () => Promise<void>) {
    if (gate.current || disabled) return
    gate.current = true; setBusy(name); onBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { gate.current = false; setBusy(''); onBusy(false) }
  }
  function acceptAnalysis(value: Analysis) {
    setDetailId(''); setDirty(false); setSavedAt(''); setRestoreWarning('')
    setSource(value.source.kind); setAnalysisMode(value.analysis_mode || 'catalog_match')
    if (value.kind !== 'reverse-analysis') throw new Error('请选择 Reverse Analysis 记录 ID。')
    setRecord(value); setRecordId(value.id); setSubmitted(true); setArtifact(null); setGenerationSubmitted(false); setConfirmed(false)
    setRows(Object.fromEntries((value.analysis_mode === 'geometry_only' ? [] : value.analysis?.observations || []).map(o => [o.id, { features: featureEditor(o), quantity: String(o.quantity), excluded: false, reason: '' }])))
    setActive(value.analysis?.observations[0]?.id || '')
    if (value.status !== 'complete') setError(value.error?.message || '分析尚未完成；可稍后读取相同记录，不会再次调用模型。')
  }
  function edit(id: string, patch: Partial<Draft>) {
    setConfirmed(false); setDirty(true)
    setRows(old => ({ ...old, [id]: { ...old[id], ...patch } }))
  }
  async function find(id: string, page = 1) {
    if (!record) return
    const features = readFeatureEditor(rows[id].features)
    const result = await post<Search>('search', { analysisId: record.id, observationId: id, features, page })
    edit(id, { search: result, index: undefined }); setActive(id)
  }
  function download(value: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = name + '.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const allReviewed = !!record?.analysis?.observations.length && record.analysis.observations.every(o => {
    const r = rows[o.id]
    return r && (r.excluded ? !!r.reason.trim() : r.index !== undefined && !!r.search?.rows[r.index]?.eligible && Number.isInteger(Number(r.quantity)) && Number(r.quantity) > 0 && Number(r.quantity) <= 100)
  })
  const displayedInventory = record?.source.kind === 'virtual' ? record.source.inventory : inventory
  const preview = record ? record.image?.imageBase64 ? record.image : null : image
  return <section className="brick-reverse" aria-label="Reverse Assembly">
    <h2>Reverse · Geometry / Catalog</h2>
    <p className="brick-help">{geometryOnly ? 'Geometry Only：先理解宽、深、高，不猜 Part Number、不检索 Catalog。只有点击 Analyze 才调用模型。' : 'Catalog Match：分析、候选检索、人工确认与生成 Approximation 保持原流程。'} 单张照片无法确认的结构保持 Unknown。</p>
    <fieldset disabled={locked || submitted}>
      <ServerImagePicker disabled={locked || submitted} onChange={setImage} onBusy={value => { gate.current = value; setBusy(value ? '准备图片' : ''); onBusy(value) }} />
      <label>Analysis Mode<select value={analysisMode} onChange={e => setAnalysisMode(e.target.value as AnalysisMode)}>
        <option value="geometry_only">Geometry Only</option><option value="catalog_match">Catalog Match</option>
      </select></label>
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
        acceptAnalysis(await post<Analysis>('analyze', { ...image, model, analysis_mode: analysisMode, requestId: requestId.current,
          source: geometryOnly ? { kind: 'full' } : source === 'virtual' ? { kind: source, inventory } : source === 'today' ? { kind: source, session: selected } : { kind: source } }))
        await refreshHistory()
      })}>Analyze · 分析照片（调用模型）</button>
    </fieldset>
    <button type="button" disabled={locked} onClick={reset}>新建分析 / 允许再次识别</button>

    <div className="brick-reverse-recovery">
      <label>历史 Reverse Analysis<select value={recordId} disabled={locked} onChange={e => setRecordId(e.target.value)}>
        <option value="">选择历史分析</option>
        {history.map(r => <option key={r.id} value={r.id}>
          {r.createdAt} · {r.analysis_mode || 'catalog_match'} · {r.prompt_id || 'reverse_catalog_v1'} v{r.prompt_version || 1} · {r.provider} / {r.model} · {r.image_reference?.name || ''} · {r.appearance || r.status} · {r.count} Observations
        </option>)}
      </select></label>
      <div className="brick-actions">
        <button type="button" disabled={locked} onClick={() => void action('刷新历史', refreshHistory)}>刷新</button>
        <button type="button" disabled={locked || !recordId || dirty} onClick={() => void action('加载分析', async () => {
          const value = await requestJson<Restored>('/api/brick-reverse/restore/' + recordId, {}, '恢复 Reverse 分析')
          acceptAnalysis(value.analysis)
          setImage(null); setRows(value.rows); setSavedAt(value.updatedAt || '')
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
    {record?.analysis && !geometryOnly && <>

      <div className="brick-actions"><button type="button" disabled={locked || !dirty} onClick={() => void action('保存审核', saveReview)}>保存审核（不调用模型）</button>
        <small>{dirty ? '审核有未保存修改；请保存后再加载其他记录。' : savedAt ? '审核已保存：' + savedAt : '尚未保存审核草稿'}</small></div>
      <p>{record.analysis.appearance}</p>
      <ObservationTable hostRef={tableHost} columns={[
        { label: 'ID', width: 90 }, { label: 'Confidence', width: 82 },
        { label: '特征颜色 ID', width: 88 }, { label: '整体尺寸', width: 86 }, { label: 'Shape', width: 120 }, { label: 'Print', width: 90 },
        { label: '数量', width: 68 }, { label: '确认型号', width: 110 }, { label: '确认颜色 ID', width: 88 },
        { label: 'Candidate / Resolution', width: 150 }, { label: '可见凸点 / 遮挡', width: 180 },
        { label: '排除', width: 44 }, { label: '排除原因', width: 180 }, { label: '操作', width: 64 },
      ]}>
        {record.analysis.observations.map(o => {
          const row = rows[o.id]
          if (!row) return null
          const chosen = row.index === undefined ? undefined : row.search?.rows[row.index]
          const available = row.search?.rows.filter(r => r.eligible).length
          const status = row.excluded ? '已排除' : chosen ? '已确认候选' : row.search ? available ? '待人工确认' : '本页无可用组合' : '待检索'
          return <tr key={o.id} data-observation-id={o.id} className={active === o.id ? 'is-active' : ''} onClick={event => {
            if (event.target instanceof Element && event.target.closest('input, select, button, [popover], a, summary')) return
            setActive(o.id)
          }}>
            <td><button type="button" className="vision-observation-id" aria-pressed={active === o.id} title={o.id}
              onClick={() => { setActive(o.id); previewHost.current?.scrollIntoView({ block: 'nearest' }) }}>{o.id}</button></td>
            <td>{o.confidence}</td>
            <ObservationFeatureCells id={o.id} features={row.features} disabled={locked}
              onChange={features => edit(o.id, { features, search: undefined, index: undefined })} />
            <td><input aria-label={o.id + ' 确认可见数量'} type="number" min="1" max="100" value={row.quantity}
              disabled={locked || generationSubmitted} onChange={e => edit(o.id, { quantity: e.target.value })} /></td>
            <td className="vision-cell-ellipsis" title={chosen?.source.part_num}>{chosen?.source.part_num || '—'}</td>
            <td>{chosen?.source.color_id ?? '—'}</td>
            <td className="vision-cell-ellipsis" title={chosen ? 'RB ' + chosen.source.part_num + ' / ' + chosen.source.color_id + ' → LDraw ' + chosen.target?.part + ' / ' + chosen.target?.color
              : row.search ? '本页可用 ' + available + '；Catalog 全局匹配 ' + row.search.catalogTotal + '，可继续翻页检查。' : status}>
              <span className="vision-review-badge">{status}</span>
            </td>
            <td className="vision-cell-ellipsis" title={'可见凸点 ' + (o.visible_studs ?? 'Unknown') + ' · ' + o.occlusion}>{o.visible_studs ?? 'Unknown'} · {o.occlusion}</td>
            <td><input type="checkbox" aria-label={o.id + ' 明确排除'} checked={row.excluded} disabled={locked || generationSubmitted}
              onChange={e => edit(o.id, { excluded: e.target.checked })} /></td>
            <td><input aria-label={o.id + ' 排除原因'} title={row.reason} value={row.reason} placeholder={row.excluded ? '请填写排除原因' : '—'}
              disabled={locked || !row.excluded} onChange={e => edit(o.id, { reason: e.target.value })} /></td>
            <td><ObservationActions observationId={o.id} actions={[
              { label: '检索候选并检查能力', disabled: locked, run: () => { void action('Catalog / Geometry 检查', () => find(o.id)) } },
              { label: '查看候选 / Geometry', disabled: !row.search, run: () => { setActive(o.id); candidateHost.current?.scrollIntoView({ block: 'nearest' }) } },
              { label: '查看详情', run: () => setDetailId(o.id) },
            ]} /></td>
          </tr>
        })}
      </ObservationTable>
      {search && <div className="brick-reverse-candidates" ref={candidateHost}>
        <h3>{active} · Catalog 候选 / Geometry Capability</h3>
        <p>Catalog 全局匹配 {search.catalogTotal} · 第 {search.page} 页 · 本页源范围内可用组合 {search.rows.filter(r => r.eligible).length}。0 个可用不代表后续页为空。</p>
        <div className="brick-actions"><button disabled={locked || search.page <= 1} onClick={() => void action('上一页', () => find(active, search.page - 1))}>上一页</button>
          <button disabled={locked || search.page * search.pageSize >= search.catalogTotal} onClick={() => void action('下一页', () => find(active, search.page + 1))}>下一页</button></div>
        {search.imageError && <p>{search.imageError}</p>}
        {search.rows.map((r, index) => <div className="brick-reverse-candidate" key={r.source.part_num + ':' + r.source.color_id}>
          <CatalogPhoto media={search.images[r.source.part_num]} name={r.name} />
          <div><strong>{r.name}</strong><div>RB {r.source.part_num} / Color {r.source.color_id}</div>
            <small>Catalog 严格匹配 · 官方 LDraw 候选 {r.partCandidates.join(', ') || '无'} · 颜色映射 {r.colorCandidates.join(', ') || '无'}<br />本地文件及依赖可用：{r.partCandidateChecks.filter(c => c.local.available).map(c => c.part).join(', ') || '无'} · 已有几何能力定义：{r.partCandidateChecks.filter(c => c.supported).map(c => c.part).join(', ') || '无'}</small>
            <div>{r.target ? 'LDraw ' + r.target.part + ' / ' + r.target.color : 'Mapping / Geometry 未通过'}</div>
            {!r.sourceAllowed && <small>未证明属于当前虚拟库存，不可选择。</small>}
            {r.errors.length > 0 && <small>{r.errors.join('；')}</small>}
            <button type="button" disabled={locked || !r.eligible} onClick={() => edit(active, { index, excluded: false })}>人工确认此组合</button>
            <details><summary>Catalog / Mapping / 本地资源 / 几何证据</summary><pre>{JSON.stringify(r, null, 2)}</pre></details>
          </div>
        </div>)}
      </div>}
      <fieldset disabled={locked || generationSubmitted}>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确认所有候选、数量与排除项；允许生成 Approximation，不能保证原作品一致。</label>
        <button type="button" disabled={!confirmed || !allReviewed} onClick={() => void action('生成近似方案', async () => {
          await saveReview()
          const choices = record.analysis!.observations.filter(o => !rows[o.id].excluded).map(o => ({ observationId: o.id, searchId: rows[o.id].search!.id, index: rows[o.id].index, quantity: Number(rows[o.id].quantity) }))
          const excluded = record.analysis!.observations.filter(o => rows[o.id].excluded).map(o => ({ observationId: o.id, reason: rows[o.id].reason }))
          const value = await post<Artifact>('generate', { analysisId: record.id, model: record.model, choices, excluded, confirmApproximation: true })
          setArtifact(value); setGenerationSubmitted(true)
          if (value.generation) await onComplete(value.generation)
        })}>3. 生成并验证 Approximation（调用模型）</button>
      </fieldset>
      <button type="button" disabled={locked} onClick={() => void action('读取生成结果', async () => {
        const value = await requestJson<Artifact>('/api/brick-reverse/attempt/' + record.id, {}, '读取 Reverse 生成')
        setArtifact(value); setGenerationSubmitted(true)
        if (value.generation) await onComplete(value.generation)
      })}>读取已提交生成结果（不调用模型）</button>
    </>}
    {generationSubmitted && <p className="brick-help">此 Analysis 已提交生成；可以继续保存审核或读取已有方案。原有防重复生成保护仍生效，不覆盖 Artifact。</p>}
    {artifact && <div role="status"><p>Approximation · {artifact.status} · {artifact.error || artifact.generation?.error?.message || '请在 Viewer 与原图对比；Validator 不验证外观相似度。'}</p>
      <button onClick={() => download(artifact, 'reverse-design-' + artifact.id)}>下载 Reverse Artifact</button>
      <details><summary>确认、Geometry Snapshot、Design Hash 与诊断</summary><pre>{JSON.stringify(artifact, null, 2)}</pre></details></div>}
    {detailId && <ObservationModal title={'Reverse Observation ' + detailId} data={{
      observation: record?.analysis?.observations.find(o => o.id === detailId),
      review: rows[detailId],
      relations: record?.analysis?.relations,
    }} onClose={() => setDetailId('')} />}
    {busy && <p role="status">{busy}… 不自动重试。</p>}
    {error && <p className="brick-error" role="alert">{error}</p>}
  </section>
}

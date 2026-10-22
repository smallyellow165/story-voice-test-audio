import { useRef, useState } from 'react'
import { ModelSelector } from '../model-selector'
import { CatalogPhoto } from '../catalog-photo'
import type { Media } from '../catalog-photo'
import { prepareInventoryImage } from '../brick-vision/upload'
import { bboxStyle } from '../brick-vision/observation-view.mjs'
import { catalogShapes, featureEditor, readFeatureEditor } from '../brick-vision/catalog-features.mjs'
import type { CatalogFeatures, FeatureEditor } from '../brick-vision/catalog-features.mjs'
import { requestJson } from '../brick-inventory/api.mjs'
import { loadSessions } from '../brick-inventory/storage'
import { newSessionId } from '../brick-inventory/inventory'
import type { SessionInventory } from '../brick-inventory/inventory'
import { AvailableInventory } from './AvailableInventory'
import type { GenerationResult, InventoryRow } from './design-types'
import './reverse.css'

type Observation = CatalogFeatures & { id: string; quantity: number; confidence: number; bbox: number[] | null; evidence: string; occlusion: string; visible_studs: number | null }
type Analysis = { id: string; kind: string; status: string; model: string; provider: string; modelVersion?: string; source: { kind: string }; image: { mimeType: string; imageBase64: string };
  error?: { message: string }; analysis: { appearance: string; unknowns: string[]; observations: Observation[]; relations: unknown[] } | null }
type Candidate = { partCandidates: string[]; colorCandidates: string[]; partCandidateChecks: { part: string; supported: boolean; local: { available: boolean } }[]; source: { part_num: string; color_id: number }; name: string; eligible: boolean; sourceAllowed: boolean; target: { part: string; color: string } | null; errors: string[] }
type Search = { id: string; features: CatalogFeatures; page: number; pageSize: number; catalogTotal: number; rows: Candidate[]; images: Record<string, Media>; imageError: string | null }
type Draft = { features: FeatureEditor; quantity: string; excluded: boolean; reason: string; search?: Search; index?: number }
type Artifact = { id: string; status: string; generation: GenerationResult | null; error?: string; designHash: string | null }
type Model = { id: string; label: string; provider: 'gemini' | 'openai' }
type Props = { inventory: InventoryRow[]; onQuantity(row: InventoryRow, quantity: number): void; models: Model[]; model: string;
  onModel(model: string): void; disabled: boolean; onBusy(busy: boolean): void; onComplete(result: GenerationResult): Promise<void> }
const post = <T,>(action: string, body: unknown) => requestJson<T>('/api/brick-reverse/' + action, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000),
}, 'Reverse ' + action)

export function ReverseAssemblyPanel({ inventory, onQuantity, models, model, onModel, disabled, onBusy, onComplete }: Props) {
  const [source, setSource] = useState('virtual'), [sessions, setSessions] = useState<SessionInventory[]>([]), [sessionId, setSessionId] = useState('')
  const [image, setImage] = useState<Awaited<ReturnType<typeof prepareInventoryImage>> | null>(null)
  const [record, setRecord] = useState<Analysis | null>(null), [rows, setRows] = useState<Record<string, Draft>>({})
  const [active, setActive] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const [recordId, setRecordId] = useState(''), [submitted, setSubmitted] = useState(false)
  const [confirmed, setConfirmed] = useState(false), [artifact, setArtifact] = useState<Artifact | null>(null)
  const [generationSubmitted, setGenerationSubmitted] = useState(false)
  const gate = useRef(false)
  const requestId = useRef(newSessionId())
  const locked = disabled || !!busy
  const observation = record?.analysis?.observations.find(o => o.id === active)
  const draft = rows[active], search = draft?.search
  function reset() {
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
    if (value.kind !== 'reverse-analysis') throw new Error('请选择 Reverse Analysis 记录 ID。')
    setRecord(value); setRecordId(value.id); setSubmitted(true); setArtifact(null); setGenerationSubmitted(false); setConfirmed(false)
    setRows(Object.fromEntries((value.analysis?.observations || []).map(o => [o.id, { features: featureEditor(o), quantity: String(o.quantity), excluded: false, reason: '' }])))
    setActive(value.analysis?.observations[0]?.id || '')
    if (value.status !== 'complete') setError(value.error?.message || '分析尚未完成；可稍后读取相同记录，不会再次调用模型。')
  }
  function edit(id: string, patch: Partial<Draft>) {
    setConfirmed(false)
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
  const preview = record?.image || image
  return <section className="brick-reverse" aria-label="Reverse Assembly">
    <h2>Reverse · Reference → Approximation</h2>
    <p className="brick-help">分析照片和生成方案分别由你点击，各调用一次模型。候选检索不调用模型。单张照片不能保证精确复原；隐藏结构保持 Unknown。</p>
    <fieldset disabled={locked || submitted}>
      <label>Part Source<select value={source} onChange={e => { setSource(e.target.value); reset() }}>
        <option value="virtual">Virtual Inventory · 当前虚拟库存</option><option value="today">Today's Inventory · 已保存真实库存</option><option value="full">Full Catalog · 全部 DUPLO</option>
      </select></label>
      {source === 'virtual' && <AvailableInventory inventory={inventory} total={inventory.reduce((n, r) => n + r.quantity, 0)} onQuantity={onQuantity} />}
      {source === 'today' && <>
        <button type="button" onClick={() => { try { setSessions(loadSessions(localStorage)); setError('') } catch (e) { setError(String(e)) } }}>读取保存库存（不调用模型）</button>
        <label>已保存库存<select value={sessionId} onChange={e => setSessionId(e.target.value)}><option value="">请选择</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.updated_at} · {s.id}</option>)}</select></label>
      </>}
      <ModelSelector models={models} value={{ id: model, provider: models.find(m => m.id === model)?.provider || '' }} onChange={m => onModel(m.id)} />
      <label>成品图片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {
        const file = e.target.files?.[0]; setImage(null)
        if (file) void action('压缩图片', async () => { setImage(await prepareInventoryImage(file)) })
      }} /></label>
      <small title={image ? JSON.stringify(image.compression) : '自动按 EXIF 方向处理，最长边 1024px，JPEG 80%；压缩失败不发送原图。'}>ⓘ 图片压缩信息</small>
      <button type="button" disabled={!image || !model || source === 'today' && !sessionId} onClick={() => void action('分析照片', async () => {
        const selected = source === 'today' ? sessions.find(s => s.id === sessionId) : undefined
        if (source === 'today' && !selected) throw new Error('请先选择已保存库存。')
        setSubmitted(true); setRecordId(requestId.current)
        acceptAnalysis(await post<Analysis>('analyze', { ...image, model, requestId: requestId.current,
          source: source === 'virtual' ? { kind: source, inventory } : source === 'today' ? { kind: source, session: selected } : { kind: source } }))
      })}>1. 分析照片（调用模型）</button>
    </fieldset>
    <button type="button" disabled={locked} onClick={reset}>新建分析 / 允许再次识别</button>
    <div className="brick-reverse-recovery">
      <label>Analysis ID<input value={recordId} disabled={locked} onChange={e => setRecordId(e.target.value)} /></label>
      <button type="button" disabled={locked || !recordId} onClick={() => void action('读取分析', async () => acceptAnalysis(await requestJson<Analysis>('/api/brick-reverse/record/' + recordId, {}, '读取 Reverse 分析')))}>读取记录（不调用模型）</button>
    </div>
    {preview && <div className="brick-reverse-photo">
      <img src={'data:' + preview.mimeType + ';base64,' + preview.imageBase64} alt="Reverse 实际发送图片" />
      {record?.analysis?.observations.map(o => {
        const style = bboxStyle(o.bbox)
        return style && <button type="button" key={o.id} style={style} className={active === o.id ? 'is-active' : ''} onClick={() => setActive(o.id)}>{o.id}</button>
      })}
    </div>}
    {record && <>
      <p>{record.status} · {record.provider} · {record.model} / {record.modelVersion || '未返回'} · Source {record.source.kind}</p>
      <button type="button" onClick={() => download(record, 'reverse-analysis-' + record.id)}>下载完整分析诊断 / Raw Trace 路径</button>
      <details><summary>原始分析、关系与 Unknown</summary><pre>{JSON.stringify(record.analysis || record.error, null, 2)}</pre></details>
    </>}
    {record?.analysis && <>
      <p>{record.analysis.appearance}</p>
      <label>Observation<select disabled={locked} value={active} onChange={e => setActive(e.target.value)}>{record.analysis.observations.map(o =>
        <option key={o.id} value={o.id}>{o.id} · {rows[o.id]?.excluded ? '已排除' : rows[o.id]?.index !== undefined ? '已确认候选' : '待确认'} · {o.confidence}</option>)}</select></label>
      {observation && draft && <fieldset disabled={locked || generationSubmitted}>
        <p>{observation.id} · 可见凸点 {observation.visible_studs ?? 'Unknown'} · {observation.occlusion}</p>
        <div className="brick-reverse-fields">
          <label>RB Color ID<input value={draft.features.color} placeholder="Unknown" onChange={e => edit(active, { features: { ...draft.features, color: e.target.value }, search: undefined, index: undefined })} /></label>
          <label>整体尺寸<input value={draft.features.size} placeholder="Unknown / 2x4" onChange={e => edit(active, { features: { ...draft.features, size: e.target.value }, search: undefined, index: undefined })} /></label>
          <label>Shape<select value={draft.features.shape} onChange={e => edit(active, { features: { ...draft.features, shape: e.target.value }, search: undefined, index: undefined })}><option value="">Unknown</option>{catalogShapes.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Print<select value={draft.features.print} onChange={e => edit(active, { features: { ...draft.features, print: e.target.value }, search: undefined, index: undefined })}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label>确认可见数量<input type="number" min="1" max="100" value={draft.quantity} onChange={e => edit(active, { quantity: e.target.value })} /></label>
        </div>
        <button type="button" onClick={() => void action('Catalog / Geometry 检查', () => find(active))}>2. 检索候选并检查能力</button>
        <label><input type="checkbox" checked={draft.excluded} onChange={e => edit(active, { excluded: e.target.checked })} />明确排除此 Observation</label>
        {draft.excluded && <label>排除原因<input value={draft.reason} onChange={e => edit(active, { reason: e.target.value })} /></label>}
        {draft.index !== undefined && search && <p>已确认：RB {search.rows[draft.index].source.part_num} / {search.rows[draft.index].source.color_id} → LDraw {search.rows[draft.index].target?.part} / {search.rows[draft.index].target?.color}</p>}
      </fieldset>}
      {search && <div className="brick-reverse-candidates">
        <p>Catalog 全局匹配 {search.catalogTotal} · 第 {search.page} 页 · 本页源范围内可用组合 {search.rows.filter(r => r.eligible).length}。0 个可用不代表后续页为空。</p>
        <div className="brick-actions"><button disabled={locked || search.page <= 1 || generationSubmitted} onClick={() => void action('上一页', () => find(active, search.page - 1))}>上一页</button>
          <button disabled={locked || search.page * search.pageSize >= search.catalogTotal || generationSubmitted} onClick={() => void action('下一页', () => find(active, search.page + 1))}>下一页</button></div>
        {search.imageError && <p>{search.imageError}</p>}
        {search.rows.map((r, index) => <div className="brick-reverse-candidate" key={r.source.part_num + ':' + r.source.color_id}>
          <CatalogPhoto media={search.images[r.source.part_num]} name={r.name} />
          <div><strong>{r.name}</strong><div>RB {r.source.part_num} / Color {r.source.color_id}</div>
            <small>Catalog 严格匹配 · 官方 LDraw 候选 {r.partCandidates.join(', ') || '无'} · 颜色映射 {r.colorCandidates.join(', ') || '无'}<br />本地文件及依赖可用：{r.partCandidateChecks.filter(c => c.local.available).map(c => c.part).join(', ') || '无'} · 已有几何能力定义：{r.partCandidateChecks.filter(c => c.supported).map(c => c.part).join(', ') || '无'}</small>
            <div>{r.target ? 'LDraw ' + r.target.part + ' / ' + r.target.color : 'Mapping / Geometry 未通过'}</div>
            {!r.sourceAllowed && <small>未证明属于当前虚拟库存，不可选择。</small>}
            {r.errors.length > 0 && <small>{r.errors.join('；')}</small>}
            <button type="button" disabled={locked || generationSubmitted || !r.eligible} onClick={() => edit(active, { index, excluded: false })}>人工确认此组合</button>
            <details><summary>Catalog / Mapping / 本地资源 / 几何证据</summary><pre>{JSON.stringify(r, null, 2)}</pre></details>
          </div>
        </div>)}
      </div>}
      <fieldset disabled={locked || generationSubmitted}>
        <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确认所有候选、数量与排除项；允许生成 Approximation，不能保证原作品一致。</label>
        <button type="button" disabled={!confirmed || !allReviewed} onClick={() => void action('生成近似方案', async () => {
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
    {artifact && <div role="status"><p>Approximation · {artifact.status} · {artifact.error || artifact.generation?.error?.message || '请在 Viewer 与原图对比；Validator 不验证外观相似度。'}</p>
      <button onClick={() => download(artifact, 'reverse-design-' + artifact.id)}>下载 Reverse Artifact</button>
      <details><summary>确认、Geometry Snapshot、Design Hash 与诊断</summary><pre>{JSON.stringify(artifact, null, 2)}</pre></details></div>}
    {busy && <p role="status">{busy}… 不自动重试。</p>}
    {error && <p className="brick-error" role="alert">{error}</p>}
  </section>
}

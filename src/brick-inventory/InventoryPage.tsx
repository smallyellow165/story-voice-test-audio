import { CatalogGeometryEvidence } from '../brick-vision/CatalogGeometryEvidence'
import type { CatalogBodyMetadata } from '../brick-vision/CatalogGeometryEvidence'
import { ExplorerWorkspace } from './ExplorerWorkspace'
import { CatalogPhoto as Photo } from '../catalog-photo'
import type { Media } from '../catalog-photo'
import { useEffect, useRef, useState } from 'react'
import { addItem, itemKey, MAX_QUANTITY, newSessionId, parseSession, setQuantity } from './inventory'
import type { InventoryItem, SessionInventory } from './inventory'
import { loadSessions, saveSession } from './storage'
import { GamePreparation } from './GamePreparation'
import { catalogFeatureParams, catalogSearchParams } from '../brick-vision/catalog-features.mjs'
import type { ObservationCatalogSearch } from '../brick-vision/types'
import { PartExplorerRecognition } from './PartExplorerRecognition'
import { ThreeColumnLayout } from '../three-column-layout'
import './inventory.css'
import './workbench.css'

type Color = { id: number; name: string; rgb: string }
type FeatureCheck = { feature: string; expected: unknown; actual: unknown; status: 'matched' | 'mismatched' | 'unknown'; source: string; evidence: string }
type Part = { part_num: string; name: string; part_cat_id: number; colors: Color[];
  ldraw?: Record<string, unknown>;
  catalog_geometry?: CatalogBodyMetadata; category_name?: string; features?: Record<string, unknown>; checks?: FeatureCheck[];
  counts?: { matched: number; mismatched: number; unknown: number }; eligible?: boolean }
type Results = { items: Part[]; total: number; page: number; page_size: number;
  prefilter_total?: number; performance?: Record<string, number>;
  matched_total?: number; fully_matched_total?: number; eligible_total?: number; excluded_total?: number;
  geometry_report?: { unknown_total: number; mismatched_total: number; excluded_examples: unknown[] }; criteria?: Record<string, unknown>; schema?: { database: string; source: string; used_columns: unknown[] } }
const errors: Record<string, string> = {
  rebrickable_catalog_disabled: '请在 Application Server 启用 REBRICKABLE_CATALOG_LOCAL=1。',
  rebrickable_catalog_unavailable: 'Backend Catalog 处理失败，请查看 Backend 日志中的异常类型。',
  rebrickable_catalog_database_connection_failed: 'Backend 无法建立 MySQL 连接，请查看 Backend 数据库错误日志。',
  rebrickable_catalog_database_query_failed: 'Backend 的 MySQL 查询失败，请查看 Backend 数据库错误日志。',
  application_server_unavailable: '无法连接 Application Server，请检查服务和 APPLICATION_SERVER_URL。',
  application_server_configuration_error: 'APPLICATION_SERVER_URL 格式或目标地址不符合本地 Catalog 要求。',
  application_server_timeout: '等待 Application Server 超过 25 秒；尚不能判定是数据库慢查询还是其他 Backend 处理耗时。未自动重试。',
  application_server_network_error: 'Test Audio 到 Application Server 的网络请求失败，请查看下方传输错误码。',
  application_server_response_interrupted: 'Application Server 响应读取中断，未收到完整内容。',
  application_server_empty_response: 'Application Server 返回了空响应。',
  application_server_invalid_json: 'Application Server 返回的响应不是完整有效的 JSON。',
  application_server_invalid_response: 'Application Server 返回的 JSON 格式错误，需要对象。',
  catalog_request_failed: 'Backend API 返回错误，请核对请求参数、HTTP 状态及 Backend 日志。',
  unknown_duplo_part_or_color: '数据库中没有这个 DUPLO 型号或颜色组合。',
  invalid_feature_size: '尺寸请填写 2×4 或 2×4×0.5；各维度须大于 0 且不超过 100。',
  invalid_feature_shape: '请选择支持的名称形状特征。',
  invalid_feature_print: '印花请选择未知、有或无。',
}
async function api<T>(route: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  let response: Response
  try { response = await fetch(`/api/brick-catalog/${route}?${new URLSearchParams(params)}`, { signal }) }
  catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`Catalog /${route} · 浏览器未收到 Test Audio 响应；请检查页面与 Test Audio 服务之间的连接。`)
  }
  const data = await response.json().catch(() => { throw new Error(`Catalog /${route} · HTTP ${response.status}：Test Audio 未返回完整 JSON；请确认使用 npm run dev 的入口。`) })
  if (!response.ok) {
    const diagnostics = data?.diagnostics
    const stage = typeof diagnostics?.stage === 'string' && /^[a-z_]+$/.test(diagnostics.stage) ? diagnostics.stage : 'catalog_api'
    const upstream = Number.isInteger(diagnostics?.upstreamStatus) ? ` · Backend HTTP ${diagnostics.upstreamStatus}` : ''
    const code = typeof diagnostics?.errorCode === 'string' && /^[A-Z0-9_]{1,60}$/.test(diagnostics.errorCode) ? ` · ${diagnostics.errorCode}` : ''
    throw new Error(`Catalog /${route} · ${stage} · HTTP ${response.status}${upstream}${code}：${errors[data?.detail] || 'Catalog 请求失败。'}`)
  }
  return data
}
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。' }
function Swatch({ color }: { color?: Color }) {
  return <span className="inventory-swatch" aria-hidden style={{ background: color && /^[0-9a-f]{6}$/i.test(color.rgb) ? `#${color.rgb}` : '#eee' }} />
}
function PartRow({ part, image, initialColor, initialQuantity = '1', reviewing = false, onAdd }: {
  part: Part; image?: Media; initialColor: string; initialQuantity?: string; reviewing?: boolean; onAdd: (item: InventoryItem) => void
}) {
  const [color, setColor] = useState(part.colors.find(c => String(c.id) === initialColor)?.id ?? (reviewing ? undefined : part.colors[0]?.id))
  const [quantity, setAmount] = useState(initialQuantity)
  const [specificImage, setSpecificImage] = useState<Media | undefined>()
  const [specific, setSpecific] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const showColor = async () => {
    if (color === undefined) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setSpecific(true); setSpecificImage({ status: 'loading', url: null }); setError('')
    try { setSpecificImage(await api<Media>('color-image', { part_num: part.part_num, color_id: String(color) }, controller.signal)) }
    catch (e) { if (!controller.signal.aborted) { setError(message(e)); setSpecificImage({ status: 'api_error', url: null }) } }
  }
  return <article className="inventory-part-row">
    <Photo media={specific ? specificImage : image} name={part.name} />
    <div className="inventory-part-identity"><small title={specific ? '所选颜色图片' : '型号示意图，颜色以选择为准'}>{specific ? '所选颜色图片' : '型号示意图，颜色以选择为准'}</small>
    <h3 title={part.name}>{part.name}</h3><a title={`${part.part_num} · Rebrickable`} href={`https://rebrickable.com/parts/${encodeURIComponent(part.part_num)}/`} target="_blank" rel="noreferrer">{part.part_num} · Rebrickable ↗</a>
      <CatalogGeometryEvidence geometry={part.catalog_geometry} checks={part.checks} />
      {part.ldraw && <details><summary>LDraw 可加载性（非 Assembly 验证）</summary><pre>{JSON.stringify(part.ldraw, null, 2)}</pre></details>}
      {part.checks && <details className="inventory-feature-evidence"><summary>匹配 {part.counts?.matched} · 不匹配 {part.counts?.mismatched} · 未知 {part.counts?.unknown}</summary>
        <p>类别：{part.category_name || '未知'}（数据库）</p>
        <ul>{part.checks.map(check => <li key={check.feature}>
          <strong>{check.feature}</strong>：{check.status === 'matched' ? '匹配' : check.status === 'mismatched' ? '不匹配' : '未知'}；
          要求 {JSON.stringify(check.expected)}，记录 {JSON.stringify(check.actual)}；
          来源 {check.source === 'database' ? '数据库明确记录' : check.source === 'name' || check.source === 'rebrickable-name-nominal' ? '名称标称尺寸 / 特征（非物理验证）' : check.source === 'ldraw-reviewed-body' ? '已审核 LDraw 主体坐标' : '未知'}。
          <div>{check.evidence}</div>
        </li>)}</ul>
        <details><summary>全部特征与来源</summary><pre>{JSON.stringify(part.features, null, 2)}</pre></details>
      </details>}
      {error && <p role="alert" className="inventory-error" title={error}>{error}</p>}
      {(image?.cache_warning || specificImage?.cache_warning) && <small title="图片元数据未能写入缓存。">图片元数据未能写入缓存。</small>}
    </div>
    <div className="inventory-part-controls"><label>颜色 <span className="inventory-color-select"><Swatch color={part.colors.find(c => c.id === color)} />
      <select value={color ?? ''} disabled={!part.colors.length} onChange={event => {
        request.current?.abort(); setColor(Number(event.target.value)); setSpecific(false); setSpecificImage(undefined); setError('')
      }}>
        {reviewing && part.colors.length > 0 && <option value="" disabled>请选择颜色</option>}
        {!part.colors.length && <option value="">没有已知颜色记录</option>}
        {part.colors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></span></label>
    <button type="button" className="inventory-secondary" title="查看所选颜色图片" disabled={color === undefined || specificImage?.status === 'loading'} onClick={() => void showColor()}>查看图片</button>
    <div className="inventory-add"><label>数量<input type="number" min="1" max={MAX_QUANTITY} step="1" value={quantity} onChange={event => setAmount(event.target.value)} /></label>
      <button type="button" disabled={color === undefined} onClick={() => {
        try { if (color !== undefined) { onAdd({ part_num: part.part_num, color_id: color, quantity: Number(quantity) }); setError('') } }
        catch (e) { setError(message(e)) }
      }}>{reviewing ? '确认候选' : '加入库存'}</button></div></div>
  </article>
}

export function InventoryPage() {
  const [geometryHost, setGeometryHost] = useState<HTMLDivElement | null>(null)
  const [candidatePortalHost, setCandidatePortalHost] = useState<HTMLDivElement | null>(null)
  const [hasGeometry, setHasGeometry] = useState(false)
  const [rightTab, setRightTab] = useState<'catalog' | 'confirmed'>('catalog')
  const [recognitionResultsHost, setRecognitionResultsHost] = useState<HTMLDivElement | null>(null)
  const [visionWorkspaceHost, setVisionWorkspaceHost] = useState<HTMLDivElement | null>(null)
  const [catalogReview, setCatalogReview] = useState<ObservationCatalogSearch | null>(null)
  const [catalogRequestKey, setCatalogRequestKey] = useState('')
  const [resultReviewKey, setResultReviewKey] = useState('')
  const catalogHost = useRef<HTMLElement | null>(null)
  const [search, setSearch] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState<Record<string, string>>({})
  const [requireLdraw, setRequireLdraw] = useState(false)
  const [partialDimensions, setPartialDimensions] = useState<Record<string, string>>({})
  const [featureSize, setFeatureSize] = useState(''), [featureShape, setFeatureShape] = useState('')
  const [featurePrint, setFeaturePrint] = useState('unknown')
  const [category, setCategory] = useState('')
  const [colorFilter, setColorFilter] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [filters, setFilters] = useState<{ categories: { id: number; name: string }[]; colors: Color[] }>({ categories: [], colors: [] })
  const [result, setResult] = useState<Results | null>(null)
  const [images, setImages] = useState<Record<string, Media>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [catalogError, setCatalogError] = useState('')
  const [filterError, setFilterError] = useState('')
  const [imageError, setImageError] = useState('')
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [name, setName] = useState('今天的积木')
  const [id, setId] = useState('')
  const [saved, setSaved] = useState<SessionInventory[]>([])
  const [selected, setSelected] = useState('')
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const [storageError, setStorageError] = useState('')

  useEffect(() => {
    try { setSaved(loadSessions(localStorage)) } catch (e) { setStorageError(message(e)) }
  }, [])
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  useEffect(() => {
    const controller = new AbortController(); setFilterError('')
    api<typeof filters>('filters', {}, controller.signal).then(setFilters).catch(e => { if (!controller.signal.aborted) setFilterError(message(e)) })
    return () => controller.abort()
  }, [refresh])
  useEffect(() => {
    const controller = new AbortController()
    setResultReviewKey(''); setLoading(true); setCatalogError(''); setImageError(''); setResult(null); setImages({})
    const params: Record<string, string> = { ...submittedQuery, page: String(page), page_size: '24' }
    for (const key of Object.keys(params)) if (params[key] === '') delete params[key]
    void (async () => {
      try {
        const exact = catalogReview?.method === 'part' ? catalogReview.partNumber : undefined
        const selection = exact ? await api<{ items: Part[] }>('selection', { part_nums: exact }, controller.signal) : null
        if (selection && (!Array.isArray(selection.items) || !selection.items.every(p => Array.isArray(p.colors)))) throw new Error('Catalog selection 缺少有效型号或颜色数据。')
        const exactItems = selection?.items.filter(p => p.part_num === exact)
        const data = exactItems ? { items: exactItems, total: exactItems.length, page: 1, page_size: 24 } as Results
          : await api<Results>('parts', params, controller.signal)
        if (controller.signal.aborted) return
        setResult(data); setResultReviewKey(catalogRequestKey); setLoading(false)
        catalogReview?.onResults?.(data.items.length)
        setNames(old => ({ ...old, ...Object.fromEntries(data.items.map(p => [p.part_num, p.name])) }))
        if (!data.items.length) return
        try {
          const photos = await api<{ images: Record<string, Media> }>('images', { part_nums: data.items.map(p => p.part_num).join(',') }, controller.signal)
          if (!controller.signal.aborted) setImages(photos.images)
        } catch (e) {
          if (!controller.signal.aborted) {
            setImageError(message(e)); setImages(Object.fromEntries(data.items.map(p => [p.part_num, { status: 'api_error', url: null }])))
          }
        }
      } catch (e) { if (!controller.signal.aborted) { setCatalogError(message(e)); setLoading(false); catalogReview?.onResults?.(null) } }
    })()
    return () => controller.abort()
  }, [submittedQuery, page, refresh, catalogRequestKey])

  const changeItems = (next: InventoryItem[]) => { setItems(next); setDirty(true); setNotice('') }
  const total = items.reduce((sum, row) => sum + row.quantity, 0)
  const canReplace = () => !dirty || window.confirm('当前库存尚未保存，确定放弃这些修改吗？')
  const load = async () => {
    if (!selected || !canReplace()) return
    try {
      const sessions = loadSessions(localStorage)
      const session = sessions.find(s => s.id === selected)
      if (!session) throw new Error('这份库存已不存在，请刷新保存列表。')
      setSaved(sessions); setId(session.id); setName(session.name); setItems(session.items); setDirty(false); setStorageError(''); setNotice('已加载，可继续编辑。')
      const partNums = [...new Set(session.items.map(row => row.part_num))]
      // Restore labels from the catalog; labels are not part of inventory truth.
      for (let offset = 0; offset < partNums.length; offset += 100) {
        const data = await api<{ items: { part_num: string; name: string }[] }>('selection', { part_nums: partNums.slice(offset, offset + 100).join(',') })
        setNames(old => ({ ...old, ...Object.fromEntries(data.items.map(p => [p.part_num, p.name])) }))
      }
    } catch (e) { setStorageError(message(e)) }
  }
  const snapshot = (): SessionInventory => parseSession({ schema_version: 1, id: id || newSessionId(), name, updated_at: new Date().toISOString(), items })
  return <ThreeColumnLayout className="brick-inventory-page inventory-workbench" defaultSizes={['25%', '45%', '30%']}
        left={<>
          <header className="inventory-source-header"><div><p className="inventory-eyebrow">IMAGE → RECOGNITION → MATCH</p><h1>LEGO Part Explorer</h1><p>识别图片中的构件、分析几何、匹配 Catalog 并确认零件。当前 Catalog 范围为 DUPLO。</p></div>
            <nav className="inventory-navigation"><a href="#session-inventory" onClick={() => setRightTab('confirmed')}>今天的库存 · {total} 块 ↓</a><a href={`${import.meta.env.BASE_URL}brick-test.html`}>AI Design Lab ↗</a></nav></header>
          <h2 className="inventory-panel-title">Source</h2>
    <PartExplorerRecognition geometryHost={geometryHost} catalogHost={candidatePortalHost} onGeometryPresence={setHasGeometry} onShowCatalog={target => { setRightTab('catalog'); requestAnimationFrame(() => (target === 'search' ? catalogHost.current : candidatePortalHost)?.scrollIntoView({ block: 'start' })) }} onStrategyChange={() => setCatalogReview(null)} workspaceHost={visionWorkspaceHost} resultsHost={recognitionResultsHost} onSearchCatalog={request => {
      setRightTab('catalog')
      const params = catalogFeatureParams(request.features)
      setCatalogReview(request); setCatalogRequestKey(request.key); setResult(null); setLoading(true)
      const { color: requestedColor, ...featureParams } = params
      setSubmittedQuery(request.method === 'part' ? {} : { ...params, search: request.method === 'manual' ? request.partNumber || '' : '' })
      setRequireLdraw(false)
      const completeSize = request.features.size ?? ([request.features.width_studs, request.features.depth_studs, request.features.height_brick_units].every(n => n != null) ? [request.features.width_studs, request.features.depth_studs, request.features.height_brick_units].join('×') : '')
      setPartialDimensions(completeSize ? {} : Object.fromEntries(Object.entries(featureParams).filter(([key]) => ['width', 'depth', 'height'].includes(key))))
      setSearch(request.method === 'features' || !request.method ? '' : request.partNumber || ''); setFeatureSize(completeSize); setFeatureShape(request.features.shape ?? '')
      setFeaturePrint(request.features.print); setColorFilter(requestedColor ?? ''); setCategory(''); setPage(1)
      requestAnimationFrame(() => catalogHost.current?.scrollIntoView({ block: 'start' }))
    }} onApply={recognized => {
      const next = recognized.reduce((draft, item) => addItem(draft, item), items)
      changeItems(next); setNotice('图片草稿已加入编辑器，请核对并点击保存库存。')
    }} />
    <a href={`${import.meta.env.BASE_URL}brick-vision.html`}>打开独立 Step Image Confirmation 测试页 ↗</a>
        </>}
        center={<ExplorerWorkspace hasGeometry={hasGeometry} matchingHost={setVisionWorkspaceHost} geometryHost={setGeometryHost} />}
        right={<section className="explorer-right">
          <div className="explorer-right-tabs" role="tablist" aria-label="Catalog 与确认零件" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 'catalog' : event.key === 'End' ? 'confirmed' : rightTab === 'catalog' ? 'confirmed' : 'catalog'
            setRightTab(next)
            event.currentTarget.querySelector<HTMLButtonElement>('#explorer-tab-' + next)?.focus()
          }}>
            <button id="explorer-tab-catalog" type="button" role="tab" aria-controls="explorer-catalog" aria-selected={rightTab === 'catalog'} tabIndex={rightTab === 'catalog' ? 0 : -1} onClick={() => setRightTab('catalog')}>Catalog Search</button>
            <button id="explorer-tab-confirmed" type="button" role="tab" aria-controls="explorer-confirmed" aria-selected={rightTab === 'confirmed'} tabIndex={rightTab === 'confirmed' ? 0 : -1} onClick={() => setRightTab('confirmed')}>Confirmed Parts · {total}</button>
          </div>
          <div id="explorer-catalog" className="explorer-right-scroll" role="tabpanel" aria-labelledby="explorer-tab-catalog" hidden={rightTab !== 'catalog'}>
            <div ref={setCandidatePortalHost} />
      <section ref={catalogHost} className="inventory-catalog" aria-label="DUPLO Catalog">
        <h2>找积木</h2>
        {catalogReview && <p role="status">为 {catalogReview.observationId} 选择候选：确认后填写审核行，不直接加入库存。
          <button type="button" onClick={() => setCatalogReview(null)}>退出候选选择</button></p>}
        <div className="catalog-filter-area">
          <div className="catalog-filter-grid">
        <form id="catalog-search" className="catalog-filter-fields" aria-label="Catalog Search" onSubmit={e => {
          e.preventDefault(); setCatalogReview(current => current?.method === 'manual' ? current : null); setPage(1)
          setSubmittedQuery(catalogSearchParams({ search, category, color: colorFilter, shape: featureShape, printed: featurePrint,
            requireLdraw, size: featureSize, axes: partialDimensions }))
        }}>
          <label className="inventory-search">Part Number / Name<input value={search} maxLength={100} placeholder="搜索型号或名称，多个型号用英文逗号分隔" onChange={e => setSearch(e.target.value)} /></label>
          <label>Category / 分类<select value={category} onChange={e => setCategory(e.target.value)}><option value="">全部 DUPLO 分类</option>{filters.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Color / 颜色<select value={colorFilter} onChange={e => setColorFilter(e.target.value)}><option value="">全部颜色</option>{filters.colors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Size / Width × Depth × Height<input value={featureSize} maxLength={24} placeholder="例如 2×4×0.5；也支持 2×4" onChange={e => { setFeatureSize(e.target.value); setPartialDimensions({}) }} />{Object.keys(partialDimensions).length > 0 && <small>审核中的已知维度：{JSON.stringify(partialDimensions)}；输入 Size 可替换</small>}</label>
            <label>Shape / 形状<select value={featureShape} onChange={e => setFeatureShape(e.target.value)}>
              <option value="">未知 / 不限制</option><option value="brick">Brick</option><option value="curved_top">Curved Top</option><option value="arch">Arch</option><option value="slope">Slope</option>
            </select></label>
            <label>Print / 印花<select value={featurePrint} onChange={e => setFeaturePrint(e.target.value)}><option value="unknown">未知 / 不限制</option><option value="yes">有明确印花证据</option><option value="no">明确基础款 / 无印花证据</option></select></label>
          </form>
          <div className="catalog-filter-actions">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input style={{ width: 'auto' }} type="checkbox" checked={requireLdraw} onChange={e => setRequireLdraw(e.target.checked)} /> Require LDraw</label>
            <button type="submit" form="catalog-search">Search</button>
          </div>
          </div>
          <p className="inventory-note">Search 同时应用全部已填条件（Strict AND）；未填条件不限制。尺寸单位 Stud × Stud × Brick，来自明确的 Catalog 名称标称尺寸或已审核主体 Profile；未知或冲突不能满足尺寸条件。名称尺寸不是实物几何验证。Require LDraw 默认关闭；开启时要求至少一个官方数据库 Mapping 的本地模型及引用可加载，不要求 Profile，也不代表 Assembly 验证。修改条件后点击 Search；分页沿用上次提交条件。</p>
        </div>
        <p className="inventory-note">仅显示名称以 DUPLO 开头的零件；分类可能包含其他系列，但此处已排除。颜色来自现有零件关联记录。</p>
        {(catalogError || filterError) && <div role="alert" className="inventory-error">{catalogError || filterError} <button onClick={() => setRefresh(n => n + 1)}>重新加载</button></div>}
        {imageError && <p role="alert" className="inventory-error">{imageError}</p>}
        {loading && <p role="status">正在读取 Catalog…</p>}
        {result && <><div className="inventory-pagination"><span>共 {result.total} 个型号 · 第 {page} / {Math.max(1, Math.ceil(result.total / result.page_size))} 页</span>
          <button disabled={page <= 1} onClick={() => setPage(n => n - 1)}>上一页</button><button disabled={page * result.page_size >= result.total} onClick={() => setPage(n => n + 1)}>下一页</button></div>
          {result.geometry_report && <div className="inventory-feature-summary">
            <p>几何条件 Unknown 排除 {result.geometry_report.unknown_total}；尺寸不符排除 {result.geometry_report.mismatched_total}（可能重叠）。Mapping 来自 rb_part_mappings；Unknown 不代表 Catalog 中不存在该规格。</p>
            <details><summary>几何排除原因与示例（最多 12 项）</summary><pre>{JSON.stringify(result.geometry_report, null, 2)}</pre></details>
          </div>}
          {result.criteria && <div className="inventory-feature-summary"><p>SQL 预筛选 {result.prefilter_total}；严格匹配 {result.eligible_total}；解析复核排除（不匹配或未知）{result.excluded_total}。未填写条件不参与筛选；无结果时不自动放宽条件，不自动选择型号。</p>
            <details><summary>查询条件 / 实际 MySQL 字段 / 耗时</summary><pre>{JSON.stringify({ criteria: result.criteria, schema: result.schema, performance: result.performance }, null, 2)}</pre></details>
          </div>}
          {result.items.length === 0 ? <p role="status">没有匹配记录，请调整搜索或筛选条件。</p> : <div className="inventory-grid">{result.items.map(part => <PartRow key={`${catalogReview?.key ?? "manual"}:${part.part_num}:${submittedQuery.color ?? ''}`} part={part} image={images[part.part_num]} initialColor={submittedQuery.color ?? ''} initialQuantity={catalogReview?.quantity} reviewing={!!catalogReview}
            onAdd={item => {
              if (catalogReview) {
                if (resultReviewKey !== catalogReview.key || (!catalogReview.method || catalogReview.method === 'features') && part.eligible !== true) throw new Error('候选已过期，请从 Observation 重新检索。')
                if (!part.colors.some(c => c.id === item.color_id) || (catalogReview.features.color_id !== null && item.color_id !== catalogReview.features.color_id)) throw new Error('所选颜色不符合本次检索条件；请修改 Observation 特征后重新检索。')
                addItem([], item)
                catalogReview.onChoose(item, { part, criteria: result.criteria })
                setCatalogReview(null); visionWorkspaceHost?.scrollIntoView({ block: 'start' }); return
              }
              const next = addItem(items, item); changeItems(next); setNotice(`已加入 ${item.quantity} 块 ${part.part_num}。`) }} />)}</div>}
        </>}
        <footer>零件资料与图片来自 <a href="https://rebrickable.com/" target="_blank" rel="noreferrer">Rebrickable</a>。图片缺失时仍可按型号和颜色选择；示意图不代表所选颜色。</footer>
      </section>
          </div>
          <div id="explorer-confirmed" className="explorer-right-scroll" role="tabpanel" aria-labelledby="explorer-tab-confirmed" hidden={rightTab !== 'confirmed'}>
      <div ref={setRecognitionResultsHost} />
      <aside id="session-inventory" className="inventory-session" aria-label="Session Inventory">
        <h2>已确认零件 / 库存 <span>{total} 块</span></h2>
        <label>库存名称<input value={name} maxLength={80} onChange={e => { setName(e.target.value); setDirty(true) }} /></label>
        <p>{items.length} 种型号 / 颜色组合 · {dirty ? '尚未保存' : '无未保存修改'}</p>
        <div className="inventory-actions"><button onClick={() => {
          try { const session = snapshot(); const sessions = saveSession(localStorage, session); setSaved(sessions); setId(session.id); setSelected(session.id); setDirty(false); setStorageError(''); setNotice('已保存在此浏览器。') }
          catch (e) { setStorageError(message(e)) }
        }}>保存库存</button><button className="inventory-secondary" onClick={() => { if (canReplace()) { setId(''); setSelected(''); setItems([]); setName('今天的积木'); setDirty(false); setNotice('已新建空库存。') } }}>新建</button>
          <button className="inventory-secondary" onClick={() => {
            try {
            const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'duplo-session-inventory.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
            } catch (e) { setStorageError(message(e)) }
          }}>导出 JSON</button></div>
        {id && !dirty && <p><a href={import.meta.env.BASE_URL + 'brick-test.html?sessionId=' + encodeURIComponent(id)}>在 Design Lab 使用此零件集合自由创作 →</a></p>}
        <label>重新加载已保存库存<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">选择一份库存</option>{saved.map(s => <option key={s.id} value={s.id}>{s.name} · {new Date(s.updated_at).toLocaleString()}</option>)}</select></label>
        <button disabled={!selected} className="inventory-secondary" onClick={() => void load()}>加载并继续编辑</button>
        <p className="inventory-note">保存在当前浏览器和地址下，不会同步到其他设备。离开前请保存；可导出 JSON 备份。</p>
        {storageError && <p role="alert" className="inventory-error">{storageError}</p>}
        <p role="status" aria-live="polite">{notice}</p>
        {items.length === 0 && <p className="inventory-empty">从 Catalog 加入今天拿出来的积木。</p>}
        <ul className="inventory-items">{items.map(row => {
          const key = itemKey(row), color = filters.colors.find(c => c.id === row.color_id)
          return <li key={key}><strong>{names[row.part_num] || row.part_num}</strong><small>{row.part_num}</small><span><Swatch color={color} /> {color?.name || `颜色 ${row.color_id}`}</span>
            <div className="inventory-quantity"><button aria-label={`减少 ${row.part_num} ${color?.name || row.color_id}`} onClick={() => changeItems(setQuantity(items, key, row.quantity - 1))}>−</button><output>{row.quantity}</output>
              <button disabled={row.quantity >= MAX_QUANTITY} aria-label={`增加 ${row.part_num} ${color?.name || row.color_id}`} onClick={() => changeItems(setQuantity(items, key, row.quantity + 1))}>＋</button>
              <button className="inventory-secondary" onClick={() => changeItems(setQuantity(items, key, 0))}>删除</button></div></li>
        })}</ul>
      </aside>
          <details><summary>可选：从已保存库存准备游戏</summary><GamePreparation /></details>
          </div>
        </section>}
      />
}

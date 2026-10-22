import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addItem, newSessionId } from '../brick-inventory/inventory'
import type { InventoryItem } from '../brick-inventory/inventory'
import { requestJson } from '../brick-inventory/api.mjs'
import { prepareInventoryImage, recognizeImage, downloadVision } from './upload'
import type { VisionResult } from './types'
import { ObservationPreview } from './ObservationPreview'
import { ObservationModal } from './ObservationModal'
import { bboxStyle, observationDescription } from './observation-view.mjs'
import './review.css'

type DraftRow = { id: string; selected: boolean; part: string; color: string; quantity: string }
type ModelStatus = { model: string; openaiApiKeyConfigured: boolean; models: { id: string; label: string; provider: 'gemini' | 'openai' }[] }
export function InventoryImagePanel({ onApply, workspaceHost }: { onApply(items: InventoryItem[]): void; workspaceHost?: HTMLElement | null }) {
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
  function restoreResult(next: VisionResult) {
    setResult(next); setApplied(false); setValidation(null)
    setRows((next.matches || []).map(m => ({ id: m.observation.id, selected: m.status === 'matched',
      part: m.item?.part_num ?? m.observation.candidates[0]?.part_num ?? '',
      color: String(m.item?.color_id ?? m.observation.candidates[0]?.color_id ?? ''), quantity: String(m.observation.quantity || 1) })))
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
      if (!controller.signal.aborted) { setModels(status.models); setModel(status.model); setProvider('gemini'); setOpenaiConfigured(status.openaiApiKeyConfigured) }
    }).catch(e => { if (!controller.signal.aborted) setModelError(String(e)) })
    return () => controller.abort()
  }, [configRevision])
  async function recognize() {
    if (!file || !prepared || lock.current || !models.some(m => m.id === model && m.provider === provider)) return
    lock.current = true; setBusy(true); setError(''); setResult(null); setRows([]); setValidation(null)
    try {
      const next = await recognizeImage(prepared, requestId.current, undefined, model, provider)
      restoreResult(next)
    } catch (e) { setError(String(e)) } finally { setBusy(false); lock.current = false }
  }
  async function apply() {
    if (lock.current || applied) return
    lock.current = true; setBusy(true); setError('')
    try {
      const items = rows.filter(r => r.selected).reduce<InventoryItem[]>((items, r) => {
        if (!r.color.trim() || !r.quantity.trim()) throw new Error('请填写颜色 ID 和数量')
        return addItem(items, { part_num: r.part.trim(), color_id: Number(r.color), quantity: Number(r.quantity) })
      }, [])
      if (!items.length) throw new Error('请勾选确认的积木；不确定项可修改后再勾选。')
      const checked = await requestJson<{ valid: boolean }>('/api/brick-vision/validate', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }, '库存草稿 Catalog / Mapping 检查')
      setValidation(checked)
      if (!checked.valid) throw new Error('草稿仍有无效型号、颜色或 Mapping；请查看校验详情并修改。')
      if (window.confirm('将勾选的积木加入当前库存编辑器？不会自动保存，原有积木会保留。')) { onApply(items); setApplied(true) }
    } catch (e) { setError(String(e)) } finally { setBusy(false); lock.current = false }
  }
  const matches = new Map((result?.matches || []).map(m => [m.observation.id, m]))
  const visibleObservations = rows.flatMap(row => { const m = matches.get(row.id); return m ? [m.observation] : [] })
  const selectBox = (id: string) => {
    setActiveId(id)
    const row = [...(tableHost.current?.querySelectorAll<HTMLTableRowElement>('tr[data-observation-id]') || [])].find(r => r.dataset.observationId === id)
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const review = <div className="inventory-vision-review">
    {result && <>
      <p>{result.status} · Provider {result.provider} · 模型 {result.model} / {result.modelVersion || '未返回'} · HTTP {result.httpStatus ?? 'SDK 未提供'} · {result.elapsedMs} ms · {result.finishReason}</p>
      {result.error && <p role="alert">{result.error.stage}：{result.error.message}</p>}
      {!!rows.length && <>
        <p>短描述来自原始 Evidence；编辑字段是人工草稿，Mapping 状态对应原始识别。修改后仍需校验，遗漏积木可通过下方 Catalog 添加。</p>
        <div className="inventory-review-table" ref={tableHost}><table className="vision-observation-table"><thead><tr>
          <th>选择</th><th>ID / 模型状态</th><th>形状 / 颜色</th><th>Part Number</th><th>RB Color ID</th><th>数量</th><th>Confidence</th><th>Mapping Status</th><th>详情</th><th>删除</th>
        </tr></thead><tbody>
          {rows.map(row => {
            const match = matches.get(row.id)
            if (!match) return null
            const observation = match.observation
            const modified = row.part !== (match.item?.part_num ?? observation.candidates[0]?.part_num ?? '')
              || row.color !== String(match.item?.color_id ?? observation.candidates[0]?.color_id ?? '') || row.quantity !== String(observation.quantity || 1)
            return <tr key={row.id} data-observation-id={row.id} className={activeId === row.id ? 'is-active' : ''} onClick={() => setActiveId(row.id)}>
              <td><input type="checkbox" aria-label={row.id + ' 加入库存'} checked={row.selected} disabled={busy || applied} onChange={e => setRows(rows.map(r => r.id === row.id ? { ...r, selected: e.target.checked } : r))} /></td>
              <td><button type="button" className="vision-observation-id" aria-pressed={activeId === row.id} onClick={() => { setActiveId(row.id); previewHost.current?.scrollIntoView({ block: 'nearest' }) }}>{row.id}</button><small>模型 {observation.status}</small>{!bboxStyle(observation.bbox) && <small>无有效 BBox</small>}</td>
              <td title={observation.evidence}>{observationDescription(observation.evidence)}</td>
              {(['part', 'color', 'quantity'] as const).map(key => <td key={key}><input aria-label={row.id + ' ' + (key === 'part' ? 'Part Number' : key === 'color' ? 'RB Color ID' : '数量')} value={row[key]} disabled={busy || applied} onChange={e => setRows(rows.map(r => r.id === row.id ? { ...r, [key]: e.target.value } : r))} /></td>)}
              <td>{observation.confidence}</td>
              <td title={match.reason}>{match.status}<small>原始匹配{modified ? ' · 草稿已修改，待校验' : ''}</small></td>
              <td><button onClick={() => setDetail({ kind: 'observation', id: row.id })}>详情</button></td>
              <td><button disabled={busy || applied} onClick={e => { e.stopPropagation(); setRows(rows.filter(r => r.id !== row.id)); if (activeId === row.id) setActiveId('') }}>删除</button></td>
            </tr>
          })}
        </tbody></table></div>
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
    <label>Provider / 模型<select value={`${provider}:${model}`} disabled={busy || !models.length} onChange={e => {
      const chosen = models.find(m => `${m.provider}:${m.id}` === e.target.value)
      if (lock.current || !chosen || (chosen.id === model && chosen.provider === provider)) return
      setModel(chosen.id); setProvider(chosen.provider); requestId.current = newSessionId(); setResult(null); setRows([]); setApplied(false); setValidation(null); setError('')
    }}>{!models.length && <option value="gemini:">正在读取模型配置…</option>}{models.map(m => <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>{m.provider} · {m.label} · {m.id}</option>)}</select></label>
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
      data={detail.kind === 'observation' ? { original: matches.get(detail.id), reviewDraft: rows.find(r => r.id === detail.id), draftValidation: validation } : detail.kind === 'validation' ? validation : result}
      onClose={() => setDetail(null)} />}
  </section>
}

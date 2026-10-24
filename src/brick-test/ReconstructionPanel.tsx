import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../brick-inventory/api.mjs'
import type { Artifact, History, HistoryItem, Restored } from './reverse-types'
import type { GenerationResult } from './design-types'

export function ReconstructionPanel({ disabled, onBusy, onComplete, onReference }: {
  disabled: boolean; onBusy(busy: boolean): void; onComplete(result: GenerationResult): Promise<void>
  onReference(value: Restored | null): void
}) {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [id, setId] = useState(() => new URL(location.href).searchParams.get('analysisId') || '')
  const [saved, setSaved] = useState<Restored | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const gate = useRef(false)
  async function action(work: () => Promise<void>) {
    if (gate.current || disabled) return
    gate.current = true; setBusy(true); onBusy(true); setError('')
    try { await work() } catch (e) { setError(String(e)) }
    finally { gate.current = false; setBusy(false); onBusy(false) }
  }
  async function refresh() {
    const value = await requestJson<History>('/api/brick-reverse/history', {}, 'Part Explorer 分析列表')
    setHistory(value.items)
    if (value.warnings.length) setError(value.warnings.join('；'))
  }
  useEffect(() => {
    const controller = new AbortController()
    void requestJson<History>('/api/brick-reverse/history', { signal: controller.signal }, 'Part Explorer 分析列表').then(value => {
      if (!controller.signal.aborted) { setHistory(value.items); setError(value.warnings.join('；')) }
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [])
  const observations = saved?.analysis.analysis?.observations || []
  async function loadReference(target: string) {
    await action(async () => {
      setSaved(null); onReference(null)
      const value = await requestJson<Restored>('/api/brick-reverse/restore/' + encodeURIComponent(target), {}, '加载已保存参考分析')
      if (value.analysis.status !== 'complete' || !value.analysis.analysis) throw new Error('分析未完成或缺少分析结果。')
      setSaved(value); onReference(value)
    })
  }
  const autoLoaded = useRef(false)
  useEffect(() => {
    if (!disabled && !autoLoaded.current && id) { autoLoaded.current = true; void loadReference(id) }
  }, [disabled])
  function downloadArtifact() {
    if (!saved?.artifact) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved.artifact, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'reverse-design-' + saved.artifact.id + '.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const locked = disabled || busy
  return <section className="brick-reconstruction">
    <h2>已有参考分析（可选）</h2>
    <p>读取 Part Explorer 已保存的完整分析与人工确认，不重新识别图片。只有点击生成才调用模型。</p>
    <label>参考分析<select value={id} disabled={locked} onChange={e => { setId(e.target.value); setSaved(null); onReference(null) }}>
      <option value="">选择已保存分析</option>
      {id && !history.some(h => h.id === id) && <option value={id}>{id}</option>}
      {history.map(h => <option key={h.id} value={h.id}>{h.createdAt} · {h.analysis_mode || 'catalog_match'} · {h.model} · {h.appearance || h.status}</option>)}
    </select></label>
    <div className="brick-actions"><button disabled={locked} onClick={() => void action(refresh)}>刷新列表</button>
      <button disabled={locked || !id} onClick={() => void loadReference(id)}>加载完整参考（不调用模型）</button></div>
    {saved && <>
      <p>Analysis {saved.analysis.id} · 审核保存于 {saved.updatedAt || '尚无审核草稿'} · 生成状态 {saved.generationStatus}</p>
      {saved.analysis.image?.imageBase64 && <img style={{ width: '100%', maxHeight: 260, objectFit: 'contain' }}
        src={'data:' + saved.analysis.image.mimeType + ';base64,' + saved.analysis.image.imageBase64} alt="已保存参考作品" />}
      <p>{saved.analysis.analysis?.appearance}</p>
      <ul>{observations.map(o => {
        const r = saved.rows[o.id], candidate = r?.index === undefined ? undefined : r.search?.rows[r.index]
        return <li key={o.id}>{o.id}: {r?.excluded ? '已排除：' + r.reason : candidate ? candidate.source.part_num + ' / Color ' + candidate.source.color_id + ' × ' + r.quantity + (candidate.eligible ? '' : '（当前 Assembly 不支持）') : '待在 Part Explorer 确认'}</li>
      })}</ul>
      <p><a href={import.meta.env.BASE_URL + 'brick-inventory.html?analysisId=' + encodeURIComponent(saved.analysis.id)}>在 Part Explorer 查看或修改识别与匹配 →</a></p>
      <details><summary>Geometry / Relations / Evidence / Source / Geometry Snapshot</summary><pre>{JSON.stringify({
        image_reference: saved.analysis.image_reference, source: saved.analysis.source,
        observations: saved.analysis.analysis, review: saved.rows, artifact: saved.artifact,
      }, null, 2)}</pre></details>
      {saved.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      <p>参考图片及已保存审核将交给下方同一个 Generate；当前积木清单决定可用零件。未确认观察仅作为不确定证据。</p>
      <button disabled={locked} onClick={() => void action(async () => {
        const artifact = await requestJson<Artifact>('/api/brick-reverse/attempt/' + saved.analysis.id, {}, '读取已有 Assembly Artifact')
        setSaved({ ...saved, artifact, generationStatus: artifact.status })
        if (artifact.generation) await onComplete(artifact.generation)
      })}>读取 / 显示已有生成结果（不调用模型）</button>
      {saved.artifact && <details><summary>已保存 Artifact / Raw Trace</summary><button onClick={downloadArtifact}>下载 Artifact</button><pre>{JSON.stringify(saved.artifact, null, 2)}</pre></details>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}

import { useEffect, useRef, useState } from 'react'
import { requestJson } from '../brick-inventory/api.mjs'
import { ModelSelector } from '../model-selector'
import type { Artifact, History, HistoryItem, Model, Restored } from './reverse-types'
import type { GenerationResult } from './design-types'

export function ReconstructionPanel({ models, model, onModel, disabled, onBusy, onComplete }: {
  models: Model[]; model: string; onModel(id: string): void; disabled: boolean
  onBusy(busy: boolean): void; onComplete(result: GenerationResult): Promise<void>
}) {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [id, setId] = useState(() => new URL(location.href).searchParams.get('analysisId') || '')
  const [saved, setSaved] = useState<Restored | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false)
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
  const ready = saved?.analysis.status === 'complete' && observations.length > 0 && observations.every(o => {
    const r = saved.rows[o.id]
    if (!r) return false
    if (r.excluded) return !!r.reason.trim()
    return r.index !== undefined && !!r.search?.rows[r.index]?.eligible && Number.isSafeInteger(Number(r.quantity)) && Number(r.quantity) > 0 && Number(r.quantity) <= 100
  }) && observations.some(o => !saved.rows[o.id]?.excluded)
  function downloadArtifact() {
    if (!saved?.artifact) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved.artifact, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'reverse-design-' + saved.artifact.id + '.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const locked = disabled || busy
  return <section className="brick-reconstruction">
    <h2>参考作品重建 · Assembly Reconstruction</h2>
    <p>读取 Part Explorer 已保存的完整分析与人工确认，不重新识别图片。只有点击生成才调用模型。</p>
    <label>参考分析<select value={id} disabled={locked} onChange={e => { setId(e.target.value); setSaved(null); setConfirmed(false) }}>
      <option value="">选择已保存分析</option>
      {id && !history.some(h => h.id === id) && <option value={id}>{id}</option>}
      {history.map(h => <option key={h.id} value={h.id}>{h.createdAt} · {h.analysis_mode || 'catalog_match'} · {h.model} · {h.appearance || h.status}</option>)}
    </select></label>
    <div className="brick-actions"><button disabled={locked} onClick={() => void action(refresh)}>刷新列表</button>
      <button disabled={locked || !id} onClick={() => void action(async () => {
        setSaved(null); setConfirmed(false)
        setSaved(await requestJson<Restored>('/api/brick-reverse/restore/' + encodeURIComponent(id), {}, '加载已保存参考分析'))
      })}>加载完整参考（不调用模型）</button></div>
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
      {!ready && <p>需在 Part Explorer 保存每项的候选确认或明确排除，且保留的零件必须通过现有 Mapping / Assembly 能力检查。几何观察可独立保存；不自动补全型号或忽略不支持的零件。</p>}
      <ModelSelector models={models} value={{ id: model, provider: models.find(m => m.id === model)?.provider || '' }} disabled={locked || !models.length} onChange={m => onModel(m.id)} />
      <label><input type="checkbox" checked={confirmed} disabled={locked || !ready || saved.generationStatus !== 'none'} onChange={e => setConfirmed(e.target.checked)} />确认使用已保存的零件及空间参考生成 Approximation，不保证精确复原。</label>
      <button disabled={locked || !ready || !confirmed || !models.some(m => m.id === model) || saved.generationStatus !== 'none'} onClick={() => void action(async () => {
        const snapshot = saved
        setSaved({ ...snapshot, generationStatus: 'submitted' })
        const choices = observations.filter(o => !snapshot.rows[o.id].excluded).map(o => {
          const r = snapshot.rows[o.id]
          return { observationId: o.id, searchId: r.search!.id, index: r.index, quantity: Number(r.quantity) }
        })
        const excluded = observations.filter(o => snapshot.rows[o.id].excluded).map(o => ({ observationId: o.id, reason: snapshot.rows[o.id].reason }))
        const artifact = await requestJson<Artifact>('/api/brick-reverse/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysisId: snapshot.analysis.id, model, choices, excluded, confirmApproximation: true }), signal: AbortSignal.timeout(240000) }, '参考作品生成')
        setSaved({ ...snapshot, artifact, generationStatus: artifact.status })
        if (artifact.generation) await onComplete(artifact.generation)
      })}>生成并验证 Approximation（调用模型）</button>
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

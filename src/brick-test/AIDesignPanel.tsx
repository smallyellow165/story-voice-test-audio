import { ReverseAssemblyPanel } from './ReverseAssemblyPanel'
import { ModelSelector } from '../model-selector'
import { AvailableInventory } from './AvailableInventory'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { COLORS, PARTS } from './catalog'
import { designLimits } from '../brick-design-validation.mjs'
import type { Brick } from './catalog'
import type { GenerationResult, InventoryRow } from './design-types'

type Run = { id: string; createdAt: string; request: { model: string; description: string; inventory: InventoryRow[] }; httpStatus: number | null; result: GenerationResult }
type Props = {
  stepsHost: HTMLDivElement | null
  disabled: boolean
  manualRevision: number
  onGeneratingChange: (busy: boolean) => void
  onApply: (bricks: Brick[]) => Promise<boolean>
}
const endpoint = '/api/brick-test/generate'

export function AIDesignPanel({ stepsHost, disabled, manualRevision, onGeneratingChange, onApply }: Props) {
  const [mode, setMode] = useState<'creative' | 'reverse'>('creative')
  const [reverseOpened, setReverseOpened] = useState(false)
  const [inventory, setInventory] = useState<InventoryRow[]>(() => PARTS.flatMap((part) => COLORS.map((color) => ({ part: part.id, color: color.code, quantity: part.id === '3437' ? 2 : part.id === '3011' ? 1 : ['1', '14'].includes(color.code) ? 1 : 0 }))))
  const [description, setDescription] = useState('设计一个孩子容易认出来的小动物，造型简单，给出简短的中文搭建指导。')
  const [status, setStatus] = useState<{ model: string; models: { id: string; label: string; provider: 'gemini' | 'openai' }[]; apiKeyConfigured: boolean; providers: { gemini: boolean; openai: boolean } } | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [statusError, setStatusError] = useState('')
  const [statusRetry, setStatusRetry] = useState(0)
  const [running, setRunning] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [applied, setApplied] = useState<{ runId: string; step: number } | null>(null)
  const [viewError, setViewError] = useState('')
  const requestLock = useRef(false)
  const viewLock = useRef(false)
  const requestController = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const sceneRevision = useRef(manualRevision)
  sceneRevision.current = manualRevision
  const run = runs.find((item) => item.id === selectedId) || runs[0]
  const result = run?.result
  const design = result?.ok && result.validation?.valid ? result.design : undefined
  const shownStep = applied?.runId === run?.id ? applied?.step : undefined
  const total = inventory.reduce((sum, row) => sum + row.quantity, 0)
  const selectedProvider = status?.models.find(item => item.id === selectedModel)?.provider
  const selectedConfigured = !!selectedProvider && !!status?.providers[selectedProvider]
  const inputValid = inventory.every((row) => Number.isInteger(row.quantity) && row.quantity >= 0 && row.quantity <= 100) && total >= designLimits.minBricks && total <= 100 && description.trim().length > 0 && description.length <= 500

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestController.current?.abort() }
  }, [])
  useEffect(() => { setApplied(null); setViewError('') }, [manualRevision])
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    let active = true
    setStatus(null); setStatusError('')
    fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('模型 API 不可用，请用 npm run dev 启动现有 Test Audio 服务；dev:brick 只提供本地 Viewer。')
      const value = await response.json()
      if (typeof value.model !== 'string' || typeof value.apiKeyConfigured !== 'boolean' || typeof value.providers?.gemini !== 'boolean' || typeof value.providers?.openai !== 'boolean' || !Array.isArray(value.models) || !value.models.length || !value.models.every((item: { id?: unknown; label?: unknown; provider?: unknown }) => item && typeof item.id === 'string' && typeof item.label === 'string' && ['gemini', 'openai'].includes(String(item.provider))) || !value.models.some((item: { id: string }) => item.id === value.model)) throw new Error('模型状态响应无效。')
      if (active) { setStatus(value); setSelectedModel((previous) => value.models.some((item: { id: string }) => item.id === previous) ? previous : value.model) }
    }).catch((error) => { if (active) setStatusError(error.name === 'AbortError' ? '读取模型配置超时，请检查服务后重试。' : error.message) })
      .finally(() => clearTimeout(timeout))
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [statusRetry])

  async function applyRun(target: Run, count: number) {
    if (viewLock.current || !mounted.current) return
    const value = target.result
    if (!value.ok || !value.validation?.valid || !value.design) return
    viewLock.current = true
    const revision = sceneRevision.current
    setViewError('')
    try {
      const ordered = value.design.steps.map((step) => {
        const brick = value.design!.bricks.find((item) => item.id === step.brickId)
        if (!brick) throw new Error('步骤引用了缺失的积木，拒绝显示。')
        return brick
      })
      const ok = await onApply(ordered.slice(0, count))
      if (!mounted.current || revision !== sceneRevision.current) return
      if (ok) setApplied({ runId: target.id, step: count })
      else setViewError('设计已通过服务端验证，但 Viewer 未能应用；原场景保留。检查模型加载错误后可再次显示，无需重新生成。')
    } catch (error) {
      if (mounted.current && revision === sceneRevision.current) setViewError(error instanceof Error ? error.message : String(error))
    } finally { viewLock.current = false }
  }

  async function generate(event: FormEvent) {
    event.preventDefault()
    if (requestLock.current || disabled || !inputValid || !selectedConfigured || !status?.models.some((item) => item.id === selectedModel)) return
    requestLock.current = true
    setRunning(true); onGeneratingChange(true); setViewError('')
    const snapshot = { model: selectedModel, description, inventory: inventory.map((row) => ({ ...row })) }
    const controller = new AbortController()
    requestController.current = controller
    const timeout = setTimeout(() => controller.abort(), 195000)
    let responseBody: GenerationResult
    let httpStatus: number | null = null
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot), signal: controller.signal })
      httpStatus = response.status
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('服务端未返回 JSON，请确认使用 npm run dev。')
      responseBody = await response.json()
      if (typeof responseBody?.ok !== 'boolean') throw new Error('生成接口返回格式无效。')
      if (!response.ok && responseBody.ok) throw new Error('生成接口状态与结果不一致，拒绝应用。')
    } catch (error) {
      responseBody = { ok: false, model: snapshot.model, rawOutput: null, error: { code: 'CLIENT_REQUEST', message: error instanceof Error && error.name === 'AbortError' ? '等待生成超时；服务端可能仍在处理。未自动重试，当前场景保留。' : error instanceof Error ? error.message : String(error) } }
    } finally { clearTimeout(timeout) }
    try {
      if (!mounted.current) return
      const saved: Run = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), request: snapshot, httpStatus, result: responseBody }
      setRuns((previous) => [saved, ...previous]); setSelectedId(saved.id)
      if (responseBody.ok && responseBody.design && responseBody.validation?.valid) await applyRun(saved, responseBody.design.steps.length)
    } finally {
      requestLock.current = false
      requestController.current = null
      if (mounted.current) { setRunning(false); onGeneratingChange(false) }
    }
  }

  function download() {
    if (!run) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `duplo-design-${run.id}.json`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section className="brick-panel brick-ai" aria-label="AI 积木设计">
    <div className="brick-actions" aria-label="Design mode">
      <button type="button" disabled={disabled || running} aria-pressed={mode === 'creative'} onClick={() => setMode('creative')}>Creative</button>
      <button type="button" disabled={disabled || running} aria-pressed={mode === 'reverse'} onClick={() => { setReverseOpened(true); setMode('reverse') }}>Reverse</button>
    </div>
    {reverseOpened && <div hidden={mode !== 'reverse'}><ReverseAssemblyPanel inventory={inventory}
      onQuantity={(row, quantity) => setInventory(items => items.map(item => item === row ? { ...item, quantity } : item))}
      models={status?.models || []} model={selectedModel} onModel={setSelectedModel} disabled={disabled}
      onBusy={value => { setRunning(value); onGeneratingChange(value) }} onComplete={async value => {
        const saved: Run = { id: crypto.randomUUID(), createdAt: new Date().toISOString(),
          request: { model: value.model || selectedModel, description: value.requestInput?.description || 'Reverse Approximation', inventory: value.requestInput?.inventory || [] },
          httpStatus: value.httpStatus ?? null, result: value }
        setRuns(previous => [saved, ...previous]); setSelectedId(saved.id)
        if (value.ok && value.validation?.valid && value.design) await applyRun(saved, value.design.steps.length)
      }} /></div>}
    <div hidden={mode !== 'creative'}>
    <h2>AI Design · 虚拟库存 → 造型</h2>
    <p className="brick-help">每次生成自由设计一个 {designLimits.minBricks}–{designLimits.maxBricks} 块、最多四层的造型。一次点击只请求一次模型；通过库存、连接及步骤校验后才替换场景。</p>
    <form onSubmit={generate}>
      <fieldset disabled={disabled || running}>
        <AvailableInventory inventory={inventory} total={total} onQuantity={(row, quantity) => {
          setInventory(items => items.map(item => item === row ? { ...item, quantity } : item))
        }} />
        <ModelSelector models={status?.models || []}
          value={{ provider: selectedProvider || '', id: selectedModel }} disabled={!status} onChange={chosen => setSelectedModel(chosen.id)} />
        <label>想搭什么？<textarea required maxLength={500} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="brick-actions"><button className="brick-primary" type="submit" disabled={!inputValid || !selectedConfigured || !selectedModel}>{running ? 'Generating…' : 'Generate'}</button></div>
      </fieldset>
    </form>
    <p className="brick-help" role="status">{running ? '正在等待所选模型并验证设计，请勿重复提交。' : status ? `配置模型：${selectedModel} · ${selectedConfigured ? 'API Key 已配置' : '缺少服务端 ' + (selectedProvider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY')}` : '正在读取服务端配置…'}</p>
    {!inputValid && <p className="brick-help">库存总量需为 {designLimits.minBricks}–100 块，每项为非负整数；请填写造型描述。</p>}
    {statusError && <div className="brick-error" role="alert">{statusError}</div>}
    <button type="button" disabled={disabled || running} onClick={() => setStatusRetry((value) => value + 1)}>刷新模型配置（不生成）</button>
    </div>
    {!!runs.length && <div className="brick-ai-result">
      <label>本页生成记录<select disabled={running || disabled} value={run.id} onChange={(event) => { setSelectedId(event.target.value); setViewError('') }}>{runs.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleTimeString()} · {item.request.model} · {item.result.ok ? item.result.design?.name || '已验证' : '失败'}</option>)}</select></label>
      <div className={`brick-validation ${result?.ok ? 'is-valid' : 'is-invalid'}`} role="status"><strong>{result?.ok ? `Valid · ${result.approximation ? 'Approximation · ' : ''}${design?.name}` : '生成失败 · Invalid'}</strong><p>{result?.error?.message || '库存、完整几何、逐步顺序及基础难度限制已通过。'}</p><p>Provider：{result?.provider || '未返回'} · 请求模型：{result?.model || '未知'} · 返回版本：{result?.modelVersion || '未返回'} · {result?.elapsedMs ?? '—'} ms</p></div>
      <p>结束原因：{result?.finishReason || '未返回'} · 阻止原因：{result?.blockReason || '无 / 未返回'}</p>
      <p>Token：输入 {result?.usageMetadata?.promptTokenCount ?? result?.usageMetadata?.input_tokens ?? '未返回'} · 推理 {result?.usageMetadata?.thoughtsTokenCount ?? result?.usageMetadata?.output_tokens_details?.reasoning_tokens ?? '未返回'} · 输出 {result?.usageMetadata?.candidatesTokenCount ?? result?.usageMetadata?.output_tokens ?? '未返回'} · 总计 {result?.usageMetadata?.totalTokenCount ?? result?.usageMetadata?.total_tokens ?? '未返回'}</p>
      {result?.generationSettings && <p className="brick-help">推理与输出合计上限：{result.generationSettings.maxOutputTokens ?? 'Provider 默认'} · 推理级别：{result.generationSettings.thinkingConfig?.thinkingLevel || result.generationSettings.reasoning?.effort || '服务默认'}。级别不保证固定的 JSON 预留额度。</p>}
      {!!result?.validation?.issues.length && <ul className="brick-ai-issues">{result.validation.issues.map((issue, index) => <li key={index}><code>{issue.code}</code> {issue.message}</li>)}</ul>}
      {design && stepsHost && createPortal(<div className="brick-build-steps">
        <p>{shownStep === undefined ? '当前场景未应用这份设计。' : `当前显示：${shownStep} / ${design.steps.length} 步`}</p>
        <div className="brick-actions">
          <button disabled={disabled || running} onClick={() => void applyRun(run, 0)}>从空场景开始</button>
          <button disabled={disabled || running || shownStep === undefined || shownStep <= 0} onClick={() => void applyRun(run, Math.max(0, (shownStep || 0) - 1))}>上一步</button>
          <button disabled={disabled || running || shownStep === undefined || shownStep >= design.steps.length} onClick={() => void applyRun(run, Math.min(design.steps.length, (shownStep || 0) + 1))}>下一步</button>
          <button disabled={disabled || running} onClick={() => void applyRun(run, design.steps.length)}>显示完整造型</button>
        </div>
        <ol>{design.steps.map((step, index) => <li key={step.brickId} className={shownStep === index + 1 ? 'is-current' : ''}><button disabled={disabled || running} onClick={() => void applyRun(run, index + 1)}>查看第 {index + 1} 步</button> <strong>{step.brickId}</strong>：{step.instruction}</li>)}</ol>
      </div>, stepsHost)}
      {viewError && <div className="brick-error" role="alert">{viewError}</div>}
      {!!result?.validation?.usage.length && <details open><summary>完整设计的库存消耗（生成时快照）</summary><table><thead><tr><th>型号 / 颜色</th><th>可用</th><th>使用</th><th>剩余</th></tr></thead><tbody>{result.validation.usage.filter((row) => row.available || row.used).map((row) => <tr key={`${row.part}:${row.color}`}><td>{row.part} / {COLORS.find((color) => color.code === row.color)?.label || row.color}</td><td>{row.available}</td><td>{row.used}</td><td>{row.remaining}</td></tr>)}</tbody></table></details>}
      <details><summary>原始输出与完整诊断</summary><p className="brick-help">本页列表刷新后消失；完整调用诊断另存于服务端，路径见下方 JSON，也可下载保存。失败结果不应用到场景。</p><button onClick={download}>下载本次诊断 JSON</button><h3>LLM 原始可见输出</h3><pre>{result?.rawOutput ?? '本次没有取得模型输出。'}</pre><h3>请求快照、模型信息与 Validator 报告</h3><pre>{JSON.stringify(run, null, 2)}</pre></details>
    </div>}
    <p className="brick-help">库存按每次独立设计计算，不会自动扣减。基础限制不等于儿童适用性或抗倾倒认证；请人工检查造型与指导。</p>
  </section>
}

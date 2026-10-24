import { assessDesignDisplay, selectDisplayCandidate } from '../brick-design-display.mjs'
import { validPosition } from './part-geometry'
import { ServerImagePicker } from '../brick-vision/ServerImagePicker'
import type { PreparedSourceImage } from '../brick-vision/ServerImagePicker'
import type { SessionInventory } from '../brick-inventory/inventory'
import type { Restored } from './reverse-types'
import { ReconstructionPanel } from './ReconstructionPanel'
import { SavedPartsInput } from './SavedPartsInput'
import { ModelSelector } from '../model-selector'
import { AvailableInventory } from './AvailableInventory'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { COLORS, PARTS } from './catalog'
import { designLimits } from '../brick-design-validation.mjs'
import type { Brick } from './catalog'
import type { GenerationResult, InventoryRow, DesignReport } from './design-types'

type Run = { id: string; createdAt: string; request: { model: string; description: string; inventory: InventoryRow[]; session?: SessionInventory; reference?: unknown; maxRepairAttempts?: number }; httpStatus: number | null; result: GenerationResult }
type Props = {
  stepsHost: HTMLDivElement | null
  disabled: boolean
  manualRevision: number
  onGeneratingChange: (busy: boolean) => void
  onApply: (bricks: Brick[], report: DesignReport | null) => Promise<boolean>
}
const endpoint = '/api/brick-test/generate'
type DesignMode = 'creative' | 'reverse'
type ModelChoice = { provider: 'gemini' | 'openai'; id: string }
const modelStorageKey = (mode: DesignMode) => 'story-voice-test-audio:ai-design:model:' + mode
function readModelChoice(mode: DesignMode): ModelChoice | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(modelStorageKey(mode)) || 'null')
    return value && ['gemini', 'openai'].includes(value.provider) && typeof value.id === 'string'
      ? { provider: value.provider, id: value.id } : null
  } catch { return null }
}
function resolveModelChoice(choice: ModelChoice | null, models: ModelChoice[], defaultId: string): ModelChoice {
  const selected = models.find(item => item.id === choice?.id && item.provider === choice?.provider)
    || models.find(item => item.id === defaultId)!
  return { provider: selected.provider, id: selected.id }
}

export function AIDesignPanel({ stepsHost, disabled, manualRevision, onGeneratingChange, onApply }: Props) {
  const [inventory, setInventory] = useState<InventoryRow[]>(() => PARTS.flatMap((part) => COLORS.map((color) => ({ part: part.id, color: color.code, quantity: part.id === '3437' ? 2 : part.id === '3011' ? 1 : ['2300', '87084'].includes(part.id) && ['1', '14'].includes(color.code) ? 1 : 0 }))))
  const [description, setDescription] = useState('设计一个孩子容易认出来的小动物，造型简单，给出简短的中文搭建指导。')
  const [status, setStatus] = useState<{ model: string; models: { id: string; label: string; provider: 'gemini' | 'openai' }[]; apiKeyConfigured: boolean; providers: { gemini: boolean; openai: boolean } } | null>(null)
  const [modelChoices, setModelChoices] = useState<Record<DesignMode, ModelChoice | null>>({ creative: null, reverse: null })
  const [generationMode, setGenerationMode] = useState<DesignMode>(() => new URL(location.href).searchParams.has('analysisId') ? 'reverse' : 'creative')
  const selectedModel = modelChoices[generationMode]?.id || ''
  const [inventorySource, setInventorySource] = useState<'saved' | 'virtual'>(() => (new URL(location.href).searchParams.has('sessionId') || new URL(location.href).searchParams.has('analysisId')) ? 'saved' : 'virtual')
  const [session, setSession] = useState<SessionInventory | null>(null)
  const [referenceSource, setReferenceSource] = useState<'analysis' | 'image'>(() => new URL(location.href).searchParams.has('analysisId') ? 'analysis' : 'image')
  const [referenceAnalysis, setReferenceAnalysis] = useState<Restored | null>(null)
  const [referenceImage, setReferenceImage] = useState<PreparedSourceImage | null>(null)
  const [preparingReference, setPreparingReference] = useState(false)
  const [allowRepair, setAllowRepair] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [statusRetry, setStatusRetry] = useState(0)
  const [running, setRunning] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [history, setHistory] = useState<{ id: string; createdAt: string; model: string; valid: boolean; name: string }[]>([])
  const historyBoot = useRef(false)
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
  const displayedCandidate = selectDisplayCandidate(result)
  const design = displayedCandidate?.design
  const displayReport = displayedCandidate?.validation
  const shownStep = applied?.runId === run?.id ? applied?.step : undefined
  const total = inventory.reduce((sum, row) => sum + row.quantity, 0)
  const selectedProvider = status?.models.find(item => item.id === selectedModel)?.provider
  const selectedConfigured = !!selectedProvider && !!status?.providers[selectedProvider]
  const virtualValid = inventory.every((row) => Number.isInteger(row.quantity) && row.quantity >= 0 && row.quantity <= 100) && total >= designLimits.minBricks && total <= 100 && description.trim().length > 0 && description.length <= 500
  const inputValid = (inventorySource === 'saved' ? !!session?.items.length && session.items.reduce((sum, r) => sum + r.quantity, 0) >= designLimits.minBricks && session.items.reduce((sum, r) => sum + r.quantity, 0) <= 100 : virtualValid)
    && description.trim().length > 0 && description.length <= 500
    && (generationMode === 'creative' || (referenceSource === 'analysis' ? !!referenceAnalysis : !!referenceImage))


  function selectModel(targetMode: DesignMode, id: string) {
    const model = status?.models.find(item => item.id === id)
    if (!model) return
    const choice: ModelChoice = { provider: model.provider, id: model.id }
    setModelChoices(previous => ({ ...previous, [targetMode]: choice }))
    try { window.localStorage.setItem(modelStorageKey(targetMode), JSON.stringify(choice)) }
    catch { /* Storage may be unavailable; keep the selection for this session. */ }
  }
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
      if (active) {
        const savedCreative = readModelChoice('creative'), savedReverse = readModelChoice('reverse')
        setStatus(value)
        setModelChoices(previous => ({
          creative: resolveModelChoice(previous.creative || savedCreative, value.models, value.model),
          reverse: resolveModelChoice(previous.reverse || savedReverse, value.models, value.model),
        }))
      }
    }).catch((error) => { if (active) setStatusError(error.name === 'AbortError' ? '读取模型配置超时，请检查服务后重试。' : error.message) })
      .finally(() => clearTimeout(timeout))
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [statusRetry])

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/brick-test/generations', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('读取生成历史失败')
      const data = await response.json()
      if (!controller.signal.aborted) setHistory(previous => [...previous, ...data.items.filter((item: { id: string }) => !previous.some(p => p.id === item.id))])
    }).catch(e => { if (!controller.signal.aborted) setViewError(String(e)) })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (disabled || historyBoot.current) return
    historyBoot.current = true
    const id = new URL(location.href).searchParams.get('generationId')
    if (id) void restoreRun(id)
  }, [disabled])
  async function restoreRun(id: string) {
    if (!id || requestLock.current || disabled) return
    requestLock.current = true; setRunning(true); onGeneratingChange(true); setViewError('')
    try {
      const response = await fetch('/api/brick-test/generations/' + encodeURIComponent(id), { signal: AbortSignal.timeout(30000) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || '读取生成记录失败')
      if (!mounted.current) return
      const saved: Run = { id: value.id, createdAt: value.createdAt, request: { model: value.model,
        description: value.requestInput?.description || '', inventory: value.requestInput?.inventory || [] }, httpStatus: value.httpStatus ?? null, result: value }
      setRuns(previous => [saved, ...previous.filter(r => r.result.id !== value.id)]); setSelectedId(saved.id)
      await applyRun(saved)
    } catch (e) { if (mounted.current) setViewError(String(e)) }
    finally { requestLock.current = false; if (mounted.current) { setRunning(false); onGeneratingChange(false) } }
  }

  async function applyRun(target: Run, count?: number) {
    if (viewLock.current || !mounted.current) return
    const value = selectDisplayCandidate(target.result)
    if (!value?.design) { setViewError(target.result.display?.issues.join('；') || '没有可解析且坐标有效的候选，当前场景保留。'); return }
    const display = assessDesignDisplay(value.design, { PARTS, COLORS, validPosition })
    if (!display.renderable) { setViewError(display.issues.join('；')); return }
    viewLock.current = true
    const revision = sceneRevision.current
    setViewError('')
    try {
      const ordered = count === undefined ? value.design.bricks : value.design.steps.map((step) => {
        const brick = value.design!.bricks.find((item) => item.id === step.brickId)
        if (!brick) throw new Error('步骤引用了缺失的积木，拒绝显示。')
        return brick
      })
      const ok = await onApply(count === undefined ? ordered : ordered.slice(0, count), value.validation || null)
      if (!mounted.current || revision !== sceneRevision.current) return
      if (ok) {
        setApplied({ runId: target.id, step: count ?? value.design.bricks.length })
        if (target.result.id) { const url = new URL(location.href); url.searchParams.set('generationId', target.result.id); window.history.replaceState(window.history.state, '', url) }
      }
      else setViewError('Viewer 未能加载该候选；原场景保留。检查模型加载错误后可再次显示，无需重新生成。')
    } catch (error) {
      if (mounted.current && revision === sceneRevision.current) setViewError(error instanceof Error ? error.message : String(error))
    } finally { viewLock.current = false }
  }

  async function generate(event: FormEvent) {
    event.preventDefault()
    if (requestLock.current || disabled || preparingReference || !inputValid || !selectedConfigured || !status?.models.some((item) => item.id === selectedModel)) return
    requestLock.current = true
    setRunning(true); onGeneratingChange(true); setViewError('')
    const snapshot = { model: selectedModel, description, inventory: inventory.map((row) => ({ ...row })),
      ...(inventorySource === 'saved' && session ? { session } : {}), maxRepairAttempts: allowRepair ? 1 : 0,
      ...(generationMode === 'reverse' ? { reference: referenceSource === 'analysis'
        ? { analysisId: referenceAnalysis!.analysis.id }
        : { image: { mimeType: referenceImage!.mimeType, imageBase64: referenceImage!.imageBase64 } } } : {}),
    }
    const controller = new AbortController()
    requestController.current = controller
    const timeout = setTimeout(() => controller.abort(), (allowRepair ? 480000 : 280000))
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
      if (responseBody.id) setHistory(previous => [{ id: responseBody.id!, createdAt: responseBody.createdAt || saved.createdAt,
        model: responseBody.model || selectedModel, valid: responseBody.ok, name: typeof responseBody.design?.name === 'string' ? responseBody.design.name : '' }, ...previous.filter(r => r.id !== responseBody.id)])
      await applyRun(saved)
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
    <div className="brick-creative-design">
    <h2>AI Design · 积木清单 → 搭建设计</h2>
    <p className="brick-help">同一生成器支持自由设计和参考图重建。生成 {designLimits.minBricks}–{designLimits.maxBricks} 块、高度按清单中的已审核零件确定（硬上限八层）的候选，完整造型和每一步均须通过现有连接、碰撞及库存校验。</p>
    <label>生成模式<select disabled={disabled || running || preparingReference} value={generationMode} onChange={e => setGenerationMode(e.target.value as DesignMode)}>
      <option value="creative">自由生成</option><option value="reverse">参考图生成</option>
    </select></label>
    <label>积木清单来源<select disabled={disabled || running} value={inventorySource} onChange={e => setInventorySource(e.target.value as 'saved' | 'virtual')}>
      <option value="saved">Part Explorer 已保存清单</option><option value="virtual">现有虚拟库存编辑器</option>
    </select></label>
    <div hidden={inventorySource !== 'saved'}><SavedPartsInput disabled={disabled || running} onSession={setSession} /></div>
    {inventorySource === 'saved' && session && <><p>{session.name} · 共 {session.items.reduce((n, r) => n + r.quantity, 0)} 块</p>
      <ul>{session.items.map(r => <li key={r.part_num + ':' + r.color_id}>{r.part_num} / RB Color {r.color_id} × {r.quantity}</li>)}</ul></>}
    <div hidden={generationMode !== 'reverse'}>
      <label>参考来源<select disabled={disabled || running || preparingReference} value={referenceSource} onChange={e => setReferenceSource(e.target.value as 'analysis' | 'image')}>
        <option value="image">服务器图片 / Upload</option><option value="analysis">Part Explorer 已有分析与原图</option>
      </select></label>
      <div hidden={referenceSource !== 'image'}><ServerImagePicker disabled={disabled || running} onChange={setReferenceImage} onBusy={setPreparingReference} /></div>
      {referenceSource === 'image' && referenceImage && <img style={{ width: '100%', maxHeight: 260, objectFit: 'contain' }} src={'data:' + referenceImage.mimeType + ';base64,' + referenceImage.imageBase64} alt="生成参考图片" />}
      <div hidden={referenceSource !== 'analysis'}><ReconstructionPanel disabled={disabled || running} onReference={setReferenceAnalysis}
        onBusy={setPreparingReference} onComplete={async value => {
          if (value.design) value = { ...value, display: assessDesignDisplay(value.design, { PARTS, COLORS, validPosition }) }
          const saved: Run = { id: crypto.randomUUID(), createdAt: new Date().toISOString(),
            request: { model: value.model || selectedModel, description: value.requestInput?.description || 'Reference Approximation', inventory: value.requestInput?.inventory || [] },
            httpStatus: value.httpStatus ?? null, result: value }
          setRuns(previous => [saved, ...previous]); setSelectedId(saved.id)
          await applyRun(saved)
        }} /></div>
    </div>
    <form onSubmit={generate}>
      <fieldset disabled={disabled || running || preparingReference}>
        {inventorySource === 'virtual' && <AvailableInventory inventory={inventory} total={total} onQuantity={(row, quantity) => {
          setInventory(items => items.map(item => item === row ? { ...item, quantity } : item))
        }} />}
        <ModelSelector models={status?.models || []}
          value={{ provider: selectedProvider || '', id: selectedModel }} disabled={!status} onChange={chosen => selectModel(generationMode, chosen.id)} />
        <label>想搭什么？<textarea required maxLength={500} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label><input type="checkbox" checked={allowRepair} onChange={e => setAllowRepair(e.target.checked)} />校验失败时允许最多一次 LLM Repair（可能额外计费）</label>
        <div className="brick-actions"><button className="brick-primary" type="submit" disabled={!inputValid || !selectedConfigured || !selectedModel}>{running ? 'Generating…' : 'Generate'}</button></div>
      </fieldset>
    </form>
    <p className="brick-help" role="status">{running ? '正在检查清单、等待模型并验证候选；如已授权，校验失败时最多修正一次。请勿重复提交。' : status ? `配置模型：${selectedModel} · ${selectedConfigured ? 'API Key 已配置' : '缺少服务端 ' + (selectedProvider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY')}` : '正在读取服务端配置…'}</p>
    {!inputValid && <p className="brick-help">请选择有效清单（总量 {designLimits.minBricks}–100 块）并填写 Prompt；参考图模式还需加载图片或已有分析。</p>}
    {statusError && <div className="brick-error" role="alert">{statusError}</div>}
    <button type="button" disabled={disabled || running} onClick={() => setStatusRetry((value) => value + 1)}>刷新模型配置（不生成）</button>
    </div>
    <label>已保存调用（加载即显示，不调用模型）<select disabled={running || disabled} value={run?.result.id || ''} onChange={e => void restoreRun(e.target.value)}>
      <option value="">选择生成 / Repair 记录</option>
      {history.map(h => <option key={h.id} value={h.id}>{h.createdAt} · {h.model} · {h.valid ? 'Valid' : 'Invalid / 失败'} · {h.name}</option>)}
    </select></label>
    {viewError && !runs.length && <p role="alert">{viewError}</p>}
    {!!runs.length && <div className="brick-ai-result">
      <label>本页生成记录<select disabled={running || disabled} value={run.id} onChange={(event) => { setSelectedId(event.target.value); setViewError(''); const selected = runs.find(r => r.id === event.target.value); if (selected) void applyRun(selected) }}>{runs.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleTimeString()} · {item.request.model} · {item.result.ok ? item.result.design?.name || '已验证' : '失败'}</option>)}</select></label>
      <div className={`brick-validation ${displayReport?.valid ? 'is-valid' : 'is-invalid'}`} role="status"><strong>{displayReport ? (displayReport.valid ? 'Valid' : 'Invalid · ' + displayReport.issues.length + ' 项错误') : '无法显示生成结果'}</strong><p>{result?.error?.message || '库存、完整几何、逐步顺序及基础难度限制已通过。'}</p><p>Provider：{result?.provider || '未返回'} · 请求模型：{result?.model || '未知'} · 返回版本：{result?.modelVersion || '未返回'} · {result?.elapsedMs ?? '—'} ms</p></div>
      {!!result?.priorAttempts?.length && <p>已执行一次 Repair；初次请求及校验错误见完整诊断中的 priorAttempts，费用与耗时需计入两次调用。</p>}
      {displayedCandidate && <p>选用候选：{displayedCandidate.id || displayedCandidate.tracePath} {displayedCandidate !== result ? '（Repair 无可显示结果，保留上次候选；未宣称修正成功）' : ''}</p>}
      <p>Trace 保存状态：{result?.wireStatus || '未捕获网络调用'}<br />记录：{result?.tracePath || '未保存'}<br />Raw Request：{result?.rawRequestPath || '未保存'}<br />Raw Response：{result?.rawResponsePath || '未取得响应或保存失败'}</p>
      <p>结束原因：{result?.finishReason || '未返回'} · 阻止原因：{result?.blockReason || '无 / 未返回'}</p>
      <p>Token：输入 {result?.usageMetadata?.promptTokenCount ?? result?.usageMetadata?.input_tokens ?? '未返回'} · 推理 {result?.usageMetadata?.thoughtsTokenCount ?? result?.usageMetadata?.output_tokens_details?.reasoning_tokens ?? '未返回'} · 输出 {result?.usageMetadata?.candidatesTokenCount ?? result?.usageMetadata?.output_tokens ?? '未返回'} · 总计 {result?.usageMetadata?.totalTokenCount ?? result?.usageMetadata?.total_tokens ?? '未返回'}</p>
      {result?.generationSettings && <p className="brick-help">推理与输出合计上限：{result.generationSettings.maxOutputTokens ?? 'Provider 默认'} · 推理级别：{result.generationSettings.thinkingConfig?.thinkingLevel || result.generationSettings.reasoning?.effort || '服务默认'}。级别不保证固定的 JSON 预留额度。</p>}
      {!!displayReport?.issues.length && <ul className="brick-ai-issues">{displayReport.issues.map((issue, index) => <li key={index}><code>{issue.code}</code> {issue.message}</li>)}</ul>}
      {design && displayedCandidate?.ok && displayReport?.valid && stepsHost && createPortal(<div className="brick-build-steps">
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
      {!!displayReport?.usage.length && <details open><summary>完整设计的库存消耗（生成时快照）</summary><table><thead><tr><th>型号 / 颜色</th><th>可用</th><th>使用</th><th>剩余</th></tr></thead><tbody>{displayReport.usage.filter((row) => row.available || row.used).map((row) => <tr key={`${row.part}:${row.color}`}><td>{row.part} / {COLORS.find((color) => color.code === row.color)?.label || row.color}</td><td>{row.available}</td><td>{row.used}</td><td>{row.remaining}</td></tr>)}</tbody></table></details>}
      <details><summary>原始输出与完整诊断</summary><p className="brick-help">完整调用诊断保存在服务端；可通过已保存调用重新加载。Invalid 可查看，但不代表合法 Assembly。</p><button onClick={download}>下载本次诊断 JSON</button><h3>LLM 原始可见输出</h3><pre>{result?.rawOutput ?? '本次没有取得模型输出。'}</pre><h3>请求快照、模型信息与 Validator 报告</h3><pre>{JSON.stringify(run, null, 2)}</pre></details>
    </div>}
    <p className="brick-help">库存按每次独立设计计算，不会自动扣减。基础限制不等于儿童适用性或抗倾倒认证；请人工检查造型与指导。</p>
  </section>
}

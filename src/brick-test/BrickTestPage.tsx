import {InspectorContext,type InspectorStep} from './SpatialInspector'
import { assessDesignDisplay } from '../brick-design-display.mjs'
import { validPosition } from './part-geometry'
import type { DesignReport } from './design-types'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { COLORS, PARTS, BODY_LDU, exampleBricks } from './catalog'
import type { Brick } from './catalog'
import { connectionCandidates, validateAssembly } from './assembly'
import type { Candidate, Validation } from './assembly'
import { BrickViewer } from './viewer'
import { AIDesignPanel } from './AIDesignPanel'
import { SpatialAssemblyPanel, type SpatialPreview } from './SpatialAssemblyPanel'
import { ThreeColumnLayout } from '../three-column-layout'
import './brick-test.css'

const PAGE_SIZE = 24
const initialBrick = (): Brick => ({ id: crypto.randomUUID(), part: '3437', color: '4', x: 0, z: 0, layer: 0, rotation: 0 })
const batchAt = (brick: Brick, quantity: number): Brick[] => Array.from({ length: quantity }, (_, i) => ({ ...brick, id: `${brick.id}:${i}`, layer: brick.layer + i * (PARTS.find(p => p.id === brick.part)!.geometry.bodySizeLdu.y / BODY_LDU) }))
const inWorkspace = (brick: Brick) => Math.abs(brick.x) <= 20 && Math.abs(brick.z) <= 20 && brick.layer <= 20
const inputError = (reason: string): Validation => ({ valid: false, code: 'INPUT', reason, brickIds: [], connections: [] })

export function BrickTestPage({ libraryUrl = `${import.meta.env.BASE_URL}brick-ldraw/` }: { libraryUrl?: string }) {
  const [workflow, setWorkflow] = useState(() => new URL(location.href).searchParams.get('workflow') === 'spatial' ? 'spatial' : 'generator')
  const [inspectorHost,setInspectorHost]=useState<HTMLDivElement|null>(null)
  const [rightTab,setRightTab]=useState(() => {const value=new URL(location.href).searchParams.get('rightTab');return value==='editor'||value==='inspector'?value:workflow==='spatial'?'inspector':'editor'})
  const [inspectorStep,setInspectorStep]=useState<InspectorStep>(()=>{const p=new URL(location.href).searchParams;const step=p.get('inspectorStep');return step==='planning'||step==='geometry'||step==='refinement'?step:p.get('spatialPreview')==='refinement'||p.has('refinementId')?'refinement':p.has('geometryId')?'geometry':'planning'})
  function chooseTab(tab:string){setRightTab(tab);const u=new URL(location.href);u.searchParams.set('rightTab',tab);window.history.replaceState(null,'',u)}
  function inspect(step:InspectorStep,open=false){setInspectorStep(step);const u=new URL(location.href);u.searchParams.set('inspectorStep',step);if(open){setRightTab('inspector');u.searchParams.set('rightTab','inspector')}window.history.replaceState(null,'',u)}
  const [stepsHost, setStepsHost] = useState<HTMLDivElement | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<BrickViewer | null>(null)
  const operation = useRef(0)
  const locked = useRef(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatedReport, setGeneratedReport] = useState<DesignReport | null>(null)
  const [aiMode, setAiMode] = useState(false)
  const [highlightIds,setHighlightIds]=useState<string[]>([])
  const [spatialPreview,setSpatialPreview] = useState<SpatialPreview|null>(null)
  const [spatialLoaded,setSpatialLoaded] = useState(false)
  const [spatialLoadError,setSpatialLoadError] = useState('')
  const [sceneRevision,setSceneRevision] = useState(0)
  const [manualRevision, setManualRevision] = useState(0)
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [attempt, setAttempt] = useState<Validation | null>(null)
  const [bricks, setBricks] = useState<Brick[]>([])
  const [part, setPart] = useState('3437')
  const [color, setColor] = useState('4')
  const [quantity, setQuantity] = useState(1)
  const [x, setX] = useState(0)
  const [z, setZ] = useState(0)
  const [layer, setLayer] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [page, setPage] = useState(0)
  const [previewRetry, setPreviewRetry] = useState(0)
  const draft = useMemo<Brick>(() => ({ id: '__preview__', part, color, x, z, layer, rotation }), [part, color, x, z, layer, rotation])
  const quantityOK = Number.isInteger(quantity) && quantity >= 1 && quantity <= 20 && bricks.length + quantity <= 100
  const proposed = useMemo(() => quantityOK ? batchAt(draft, quantity) : [], [draft, quantity, quantityOK])
  const currentValidation = useMemo(() => validateAssembly(bricks), [bricks])
  const proposedValidation = useMemo(() => {
    if (!quantityOK) return inputError('每次添加 1–20 块，场景最多 100 块')
    if (!proposed.every(inWorkspace)) return inputError('此页面范围为 X/Z −20…20，层高 0…20')
    return validateAssembly([...bricks, ...proposed])
  }, [bricks, proposed, quantityOK])

  // All candidates represent the entire requested stack, not only its first brick.
  const candidates = useMemo(() => {
    if (!quantityOK) return []
    const seed = { id: '__candidate__', part, color, rotation, x: 0, z: 0, layer: 0 }
    return connectionCandidates(bricks, seed).filter((candidate) => {
      const batch = batchAt(candidate.brick, quantity)
      return batch.every(inWorkspace) && validateAssembly([...bricks, ...batch]).valid
    })
  }, [bricks, part, color, rotation, quantity, quantityOK])

  // A changed assembly/model/orientation gets a fresh legal suggestion.
  // Manual edits do not change candidates and can intentionally show Invalid.
  useEffect(() => {
    setPage(0)
    setAttempt(null)
    const first = candidates[0]
    if (first) { setX(first.brick.x); setZ(first.brick.z); setLayer(first.brick.layer) }
  }, [candidates])

  const selected = candidates.find((candidate) => candidate.brick.x === x && candidate.brick.z === z && candidate.brick.layer === layer)
  const pages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE))
  const pageIndex = Math.min(page, pages - 1)
  const visibleCandidates = useMemo(() => candidates.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE), [candidates, pageIndex])
  function selectCandidate(candidate: Candidate) {
    setX(candidate.brick.x); setZ(candidate.brick.z); setLayer(candidate.brick.layer)
    setAttempt(null)
  }

  useEffect(() => {
    if (!host.current) return
    const token = ++operation.current
    let engine: BrickViewer | undefined
    locked.current = true
    setBusy(true); setReady(false); setError(''); setBricks([])
    try {
      engine = new BrickViewer(host.current, libraryUrl, (message) => {
        ++operation.current
        locked.current = false
        engine?.clearPreview(); engine?.clearCandidates()
        setError(message); setReady(false); setBusy(false)
      })
      viewer.current = engine
      const initial = [initialBrick()]
      engine.replace(initial).then((applied) => {
        if (operation.current === token && applied) setBricks(initial)
      }).catch((reason) => {
        if (operation.current === token) setError(String(reason.message || reason))
      }).finally(() => {
        if (operation.current === token) { locked.current = false; setBusy(false); setReady(true) }
      })
    } catch (reason) {
      setError(`无法初始化 WebGL 2 Viewer：${String(reason)}`)
      locked.current = false
      setBusy(false)
    }
    return () => {
      ++operation.current
      engine?.dispose()
      viewer.current = null
    }
  }, [libraryUrl])

  useEffect(() => {
    const engine = viewer.current
    if (!engine) return
    if (!ready || busy || generating || aiMode || workflow === 'spatial') { engine.clearCandidates(); engine.clearPreview(); return }
    engine.showCandidates(visibleCandidates, selected?.key || null, (key) => {
      const candidate = visibleCandidates.find((item) => item.key === key)
      if (candidate) selectCandidate(candidate)
    })
    return () => engine.clearCandidates()
  }, [visibleCandidates, selected?.key, ready, busy, generating, aiMode, workflow, sceneRevision])

  useEffect(() => {
    const engine = viewer.current
    if (!engine) return
    let active = true
    setPreviewError('')
    engine.clearPreview()
    if (ready && !busy && !generating && !aiMode && workflow !== 'spatial' && proposedValidation.valid) {
      engine.showPreview(proposed).catch((reason) => {
        if (active) setPreviewError(`预览模型加载失败：${String(reason.message || reason)}`)
      })
    }
    return () => { active = false; engine.clearPreview() }
  }, [proposed, proposedValidation.valid, ready, busy, previewRetry, generating, aiMode, workflow, sceneRevision])

  // Spatial previews never commit to the manual inventory. The same renderer
  // switches content; manual bricks and Generator report retain their own state.
  useEffect(() => {
    if (!ready || !viewer.current) return
    let active = true
    const engine = viewer.current
    engine.clearPreview(); engine.clearCandidates();setSpatialLoaded(false);setSpatialLoadError('')
    if(workflow==='spatial')engine.reset()
    const next = workflow === 'spatial' ? spatialPreview?.bricks || [] : bricks
    void engine.replace(next).then(ok => {
      if (!active) return
      if (!ok) {setSpatialLoadError('Viewer 未完整加载');return}
      if (workflow === 'spatial') {setSpatialLoaded(true);engine.fit({x:-0.85,y:0.8,z:2.2})}
      else setSceneRevision(v=>v+1)
    }).catch(e => {if(active){setError(String(e));setSpatialLoadError(String(e))}})
    return () => {active=false}
  }, [workflow,spatialPreview,ready])

  useEffect(()=>{viewer.current?.highlight(workflow==='spatial'?highlightIds:[])},[highlightIds,workflow,spatialLoaded])

  async function commit(next: Brick[], generated = false, report: DesignReport | null = null, spatial = false) {
    if (!viewer.current || locked.current || !ready || (generating && !generated)) return false
    const validation = validateAssembly(next)
    if (!generated) setAttempt(validation)
    if (spatial && !validation.valid) { setError(validation.reason); return false }
    if (generated && !spatial) {
      const display = assessDesignDisplay({ bricks: next }, { PARTS, COLORS, validPosition })
      if (next.length && !display.renderable) { setError(display.issues.join("；")); return false }
    } else if (!validation.valid) return false
    if (next.length > 100) { setAttempt(inputError('场景最多 100 块')); return false }
    const token = ++operation.current
    locked.current = true
    setBusy(true); setError('')
    viewer.current.clearPreview(); viewer.current.clearCandidates()
    try {
      const applied = await viewer.current.replace(next)
      if (token !== operation.current || !applied) return false
      setBricks(next)
      setAttempt(null); setGeneratedReport(generated ? report : null)
      setAiMode(generated)
      if (!generated) {
        setManualRevision((value) => value + 1)
        const url = new URL(location.href); url.searchParams.delete('generationId'); window.history.replaceState(window.history.state, '', url)
      }
      return true
    } catch (reason) {
      if (token === operation.current) setError(reason instanceof Error ? reason.message : String(reason))
      return false
    } finally {
      if (token === operation.current) { locked.current = false; setBusy(false) }
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!proposedValidation.valid) { setAttempt(proposedValidation); return }
    await commit([...bricks, ...proposed.map((brick) => ({ ...brick, id: crypto.randomUUID() }))])
  }

  function reset() {
    if (generating) return
    ++operation.current
    locked.current = false
    viewer.current?.reset()
    const url = new URL(location.href); url.searchParams.delete('generationId'); window.history.replaceState(window.history.state, '', url)
    setBricks([]); setError(''); setAttempt(null); setPreviewError(''); setBusy(false)
    setGeneratedReport(null); setAiMode(false); setManualRevision((value) => value + 1)
    setX(0); setZ(0); setLayer(0); setRotation(0); setQuantity(1)
  }

  const inventory = [...bricks.reduce((map, brick) => {
    const key = `${brick.part}:${brick.color}`
    const row = map.get(key) || { part: brick.part, color: brick.color, count: 0 }
    row.count++
    map.set(key, row)
    return map
  }, new Map<string, { part: string; color: string; count: number }>()).values()]
  const numberValue = (value: number) => Number.isFinite(value) ? value : ''

  return <InspectorContext.Provider value={{host:inspectorHost,step:inspectorStep,select:inspect,highlightIds,highlight:setHighlightIds}}><main className="brick-page">
    <ThreeColumnLayout className="brick-workbench" defaultSizes={['25%', '48%', '27%']}
      left={<>
    <header className="brick-header">
      <div><span className="brick-eyebrow">PLAY LAB / 03</span><h1>DUPLO AI Design Lab</h1><p>从你的库存出发，生成造型，再一步一步搭起来。</p></div>
      <a href={`${import.meta.env.BASE_URL}brick-profile-debug.html`} target="_blank" rel="noreferrer">Geometry Profile Debug ↗</a>
      <span className="brick-badge">LDraw · AI Generator V3</span>
      <a href={`${import.meta.env.BASE_URL}brick-inventory.html`}>LEGO Part Explorer ↗</a>
    </header>
    <label className="brick-panel">设计工作流<select aria-label="设计工作流" disabled={busy || generating} value={workflow} onChange={e => {
      setWorkflow(e.target.value);chooseTab(e.target.value==='spatial'?'inspector':'editor')
      const url = new URL(location.href); url.searchParams.set('workflow', e.target.value); window.history.replaceState(null, '', url)
    }}><option value="generator">Generator V3 · 自由 / 参考图生成</option><option value="spatial">Spatial Assembly · 已审核照片复原</option></select></label>
    {workflow === 'spatial'
      ? <SpatialAssemblyPanel onPreview={value=>{setHighlightIds([]);setSpatialPreview(value)}} manualRevision={manualRevision} disabled={!ready || busy} onBusy={setGenerating} />
      : <AIDesignPanel stepsHost={stepsHost} disabled={!ready || busy} manualRevision={manualRevision} onGeneratingChange={setGenerating} onApply={(next, report) => commit(next, true, report)} />}
      </>}
      center={<>
    {aiMode && workflow!=='spatial' && <div className="brick-ai-mode">正在查看 AI 设计 / 搭建步骤，候选预览已隐藏。<button disabled={busy || generating} onClick={() => { setAiMode(false); setManualRevision((value) => value + 1) }}>返回手动编辑</button></div>}
      <section className="brick-stage-panel" aria-label="积木场景">
        {workflow==='spatial'&&<div data-testid="spatial-scene-provenance" className={'spatial-state '+(spatialLoadError?'failed':!spatialLoaded?'running':!spatialPreview?'idle':spatialPreview.layoutKind==='diagnostic'||!spatialPreview.geometry.valid?'failed':spatialPreview.review.includes('Requires Review')?'review':'success')}>
          {spatialLoadError?'预览失败：'+spatialLoadError:!spatialLoaded?'正在加载当前只读预览…':spatialPreview?<><strong>{spatialPreview.label} · {spatialPreview.review} · {spatialPreview.layoutKind==='diagnostic'?'Layout Invalid · 仅诊断':'Geometry '+(spatialPreview.geometry.valid?'Valid':'Invalid')}</strong><p>{spatialPreview.geometry.reason} · 只读；未验证物理稳定性或 Build Order。</p><details><summary>当前积木与连接诊断</summary><pre>{JSON.stringify({bricks:spatialPreview.bricks,geometry:spatialPreview.geometry},null,2)}</pre></details></>:'等待 Geometry Execution 或选择已保存布局；当前无三维结果。'}
        </div>}
        {workflow==='spatial'&&spatialPreview&&<small className="brick-help">LDraw 几何预览；通过基础几何映射的印花未渲染，具体印花型号以审核快照为准。</small>}
        <div className="brick-stage-toolbar"><span>{workflow==='spatial'?(spatialLoaded?spatialPreview?.bricks.length||0:0):bricks.length} 块{workflow==='spatial'?'只读预览':'已添加'}</span><button disabled={!ready || busy} onClick={() => viewer.current?.fit()}>适合视图</button></div>
        {workflow!=='spatial' && generatedReport && <div className={"brick-validation " + (generatedReport.valid ? "is-valid" : "is-invalid")} role="status">
          <strong>{generatedReport.valid ? "Valid" : "Invalid · " + generatedReport.issues.length + " 项错误"}</strong>
          {!generatedReport.valid && <ul>{generatedReport.issues.slice(0, 3).map((issue, i) => <li key={i}>{issue.code}：{issue.message}</li>)}</ul>}
        </div>}
        <div className="brick-stage" ref={host} />
        {workflow!=='spatial' && !aiMode && !generating && <div className="brick-candidate-pages">
          <button disabled={!ready || busy || pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>上一组位置</button>
          <span>场景候选 {pageIndex + 1} / {pages} · 每组最多 {PAGE_SIZE} 点</span>
          <button disabled={!ready || busy || pageIndex + 1 >= pages} onClick={() => setPage(pageIndex + 1)}>下一组位置</button>
        </div>}
        <div className="brick-status" role="status" aria-live="polite">{workflow==='spatial' ? '只读预览 · 拖动旋转 · 滚轮缩放 · 右键平移' : busy ? '正在读取真实模型及子文件…' : aiMode ? 'AI 设计查看 · 拖动旋转 · 滚轮缩放 · 右键平移' : generating ? '正在生成新设计，当前场景保留' : '点击蓝点吸附预览 · 拖动旋转 · 滚轮缩放 · 右键平移'}</div>
        {(error || previewError) && <div className="brick-error" role="alert"><strong>模型加载失败</strong><p>{error || previewError}</p><small>检查本地 LDraw 库和 Network 请求。几何规则 Valid 不代表模型已加载；失败不会写入清单。</small><button disabled={!ready || busy} onClick={() => { setError(''); setPreviewRetry((value) => value + 1) }}>重试预览</button></div>}
        {attempt && !attempt.valid && <div className="brick-error" role="alert"><strong>操作被拒绝 · Invalid</strong><p>{attempt.reason}</p><small>已保留原组合。</small></div>}
      </section>
        <div className="brick-steps-host" ref={setStepsHost} />
      </>}
      right={<>
      <div className="brick-right-tabs" role="tablist" aria-label="右栏工具">
        <button role="tab" id="editor-tab" aria-controls="editor-panel" aria-selected={rightTab==='editor'} onClick={()=>chooseTab('editor')}>Brick Editor</button>
        <button role="tab" id="inspector-tab" aria-controls="inspector-panel" aria-selected={rightTab==='inspector'} onClick={()=>chooseTab('inspector')}>Inspector</button>
      </div>
      <div id="inspector-panel" role="tabpanel" aria-labelledby="inspector-tab" hidden={rightTab!=='inspector'} className="spatial-inspector brick-spatial">
        <h2>Inspector</h2>
        <nav aria-label="Inspector 阶段">{(['planning','geometry','refinement'] as const).map((step,i)=><button key={step} aria-pressed={inspectorStep===step} onClick={()=>inspect(step)}>{i+1} · {step==='planning'?'Plan':step==='geometry'?'Geometry':'Refinement'}</button>)}</nav>
        {workflow!=='spatial'&&<p>切换到 Spatial Assembly 查看计划、几何诊断及审核详情。</p>}
        <div ref={setInspectorHost}/>
      </div>
      <div id="editor-panel" role="tabpanel" aria-labelledby="editor-tab" hidden={rightTab!=='editor'}>
      <aside className="brick-panel">
        <h2>添加积木</h2>
        <form onSubmit={add}>
          <fieldset disabled={workflow==='spatial' || !ready || busy || generating || aiMode}>
            <label>Brick 型号<select value={part} onChange={(event) => setPart(event.target.value)}>{PARTS.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.id}.dat</option>)}</select></label>
            <label>颜色<select value={color} onChange={(event) => setColor(event.target.value)}>{COLORS.map((item) => <option key={item.code} value={item.code}>{item.label} · LDraw {item.code}</option>)}</select></label>
            <div className="brick-fields">
              <label>向上堆叠数量<input type="number" required min="1" max="20" step="1" value={numberValue(quantity)} onChange={(event) => setQuantity(event.target.valueAsNumber)} /></label>
              <label>旋转<select value={rotation} onChange={(event) => setRotation(Number(event.target.value))}>{[0, 90, 180, 270].map((value) => <option key={value} value={value}>{value}°</option>)}</select></label>
            </div>
            <label>合法候选 · {candidates.length} 个<select value={selected?.key || ''} onChange={(event) => {
              const index = candidates.findIndex((candidate) => candidate.key === event.target.value)
              if (index >= 0) { selectCandidate(candidates[index]); setPage(Math.floor(index / PAGE_SIZE)) }
            }}><option value="" disabled>{candidates.length ? '手动位置 / 请选择候选' : '没有可用位置'}</option>{candidates.map((candidate, index) => <option key={candidate.key} value={candidate.key}>#{index + 1} X {candidate.brick.x} / Z {candidate.brick.z} / 层 {candidate.brick.layer} · {candidate.contactCount} 点</option>)}</select></label>
            <p className="brick-help">点击场景蓝点选择，橙点为当前选择。半透明积木为真实模型的吸附预览，未计入清单。候选按首块接合点数排序。</p>
            <details className="brick-manual"><summary>手动坐标 / 验证非法位置</summary>
              <div className="brick-fields">
                <label>X · 16 mm<input type="number" required step="any" value={numberValue(x)} onChange={(event) => { setX(event.target.valueAsNumber); setAttempt(null) }} /></label>
                <label>Z · 16 mm<input type="number" required step="any" value={numberValue(z)} onChange={(event) => { setZ(event.target.valueAsNumber); setAttempt(null) }} /></label>
              </div>
              <label>底部层高 · 19.2 mm<input type="number" required step="any" value={numberValue(layer)} onChange={(event) => { setLayer(event.target.valueAsNumber); setAttempt(null) }} /></label>
            </details>
            <div className={`brick-validation ${proposedValidation.valid ? 'is-valid' : 'is-invalid'}`} role="status">
              <strong>待添加：{proposedValidation.valid ? 'Valid' : 'Invalid'}</strong><p>{proposedValidation.reason}</p>
            </div>
            <button className="brick-primary" type="submit" disabled={!proposedValidation.valid}>确认添加 {numberValue(quantity)} 块</button>
          </fieldset>
        </form>
        <div className="brick-actions"><button disabled={workflow==='spatial' || !ready || busy || generating} onClick={() => void commit(exampleBricks())}>载入阶梯示例</button><button disabled={workflow==='spatial' || !ready || generating} onClick={reset}>Reset</button></div>
        <p className="brick-help">Reset 清空已提交组合，保留第一块的地面候选预览。本轮仅正放、整格、从下向上拼装；不保证抗倾倒。</p>
      </aside>
      <section className="brick-panel brick-inventory">
        <div className="brick-inventory-title"><h2>{workflow==='spatial'?'手动 Brick 清单（保留，非当前预览）':'当前 Brick 清单'}</h2><span>{bricks.length} / 100</span></div>
        <div className={`brick-validation ${(generatedReport?.valid ?? currentValidation.valid) ? 'is-valid' : 'is-invalid'}`}><strong>当前组合：{(generatedReport?.valid ?? currentValidation.valid) ? 'Valid' : 'Invalid'}</strong><p>{generatedReport && !generatedReport.valid ? generatedReport.issues.map(i => i.code + '：' + i.message).join('；') : currentValidation.reason}</p></div>
        {inventory.length ? <table><thead><tr><th>型号</th><th>颜色</th><th>数量</th></tr></thead><tbody>{inventory.map((row) => <tr key={`${row.part}:${row.color}`}><td>{row.part}.dat <small>{PARTS.find((item) => item.id === row.part)?.label}</small></td><td>{COLORS.find((item) => item.code === row.color)?.label} <small>#{row.color}</small></td><td>{row.count}</td></tr>)}</tbody></table> : <p className="brick-help">确认添加后，成功加载的积木显示在这里。</p>}
        {!!bricks.length && <details><summary>查看位置 / 删除单块</summary><ul className="brick-instance-list">{bricks.map((brick, index) => <li key={brick.id}><span>{index + 1}. {brick.part} · {COLORS.find((item) => item.code === brick.color)?.label}<small>X {brick.x} / Z {brick.z} / 层 {brick.layer} / {brick.rotation}°</small></span><button disabled={workflow==='spatial' || busy || !ready || generating || aiMode} aria-label={`删除第 ${index + 1} 块积木`} onClick={() => void commit(bricks.filter((item) => item.id !== brick.id))}>删除</button></li>)}</ul></details>}
      </section>
    <footer className="brick-footer">几何验证采用限定的 DUPLO 接合模型，未模拟摩擦、重心、承重或装配运动路径。几何数据来自 LDraw.org 官方库；许可见原始 .dat 文件及 CAreadme.txt。{workflow === 'spatial' ? 'Spatial Plan 与 Geometry Result 按当前链接恢复；手动编辑不自动保存。' : '刷新后重置。'}</footer>
      </div></>}
    />
  </main></InspectorContext.Provider>
}

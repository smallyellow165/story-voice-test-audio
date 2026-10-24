import { useEffect, useRef, useState } from 'react'
import { InventoryImagePanel } from '../brick-vision/InventoryImagePanel'
import { ReverseRecognitionPanel } from '../brick-test/ReverseAssemblyPanel'
import { PARTS, COLORS } from '../brick-test/catalog'
import { requestJson } from './api.mjs'
import type { InventoryItem } from './inventory'
import { parseExplorerScene, resolveSceneHistory, selectSceneModel } from './explorer-scene.mjs'
import type { ExplorerScene } from './explorer-scene.mjs'
import type { History } from '../brick-test/reverse-types'
import type { VisionHistoryItem } from '../brick-vision/types'
import type { ObservationCatalogSearch } from '../brick-vision/types'
import type { Model } from '../brick-test/reverse-types'
import type { InventoryRow } from '../brick-test/design-types'

type Strategy = 'loose' | 'geometry_only' | 'catalog_match'
const preferenceKey = 'story-voice-test-audio:ai-design:model:reverse'
export function PartExplorerRecognition({ workspaceHost, geometryHost, onGeometryPresence, onApply, onReset, onSearchCatalog, onStrategyChange }: {
  geometryHost: HTMLElement | null; onGeometryPresence(value: boolean): void
  workspaceHost: HTMLElement | null
  onStrategyChange(): void; onApply(items: InventoryItem[]): boolean | void; onReset(items: InventoryItem[]): boolean | void; onSearchCatalog(request: ObservationCatalogSearch): void
}) {
  const [scene] = useState(() => parseExplorerScene(location.href))
  const [boot, setBoot] = useState<{ ready: boolean; scene: ExplorerScene; strategy: Strategy; looseHistory?: VisionHistoryItem[]; reverseHistory?: History }>({ ready: !scene.analysisId, scene, strategy: scene.strategy || 'loose' })
  const [strategy, setStrategy] = useState<Strategy>(scene.strategy || 'loose')
  const [startupWarning, setStartupWarning] = useState('')
  const [urlModelWarning, setUrlModelWarning] = useState('')
  const modelBootApplied = useRef(false)
  const [modelsReady, setModelsReady] = useState(false)
  const [assembledMode, setAssembledMode] = useState<'geometry_only' | 'catalog_match'>(scene.strategy === 'catalog_match' ? 'catalog_match' : 'geometry_only')
  const [assembledOpened, setAssembledOpened] = useState(() => strategy !== 'loose')
  const [busy, setBusy] = useState(false), [looseBusy, setLooseBusy] = useState(false), [dirty, setDirty] = useState(false)
  const [models, setModels] = useState<Model[]>([]), [model, setModel] = useState('')
  const [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [inventory, setInventory] = useState<InventoryRow[]>(() => PARTS.flatMap(part => COLORS.map(color => ({ part: part.id, color: color.code, quantity: part.id === '3437' ? 2 : part.id === '3011' ? 1 : ['1', '14'].includes(color.code) ? 1 : 0 }))))
  useEffect(() => {
    if (!scene.analysisId) return
    const controller = new AbortController()
    void Promise.allSettled([
      requestJson<{ records: VisionHistoryItem[] }>('/api/brick-vision/history', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }, '识别历史'),
      requestJson<History>('/api/brick-reverse/history', { signal: controller.signal }, '识别历史'),
    ]).then(([loose, reverse]) => {
      if (controller.signal.aborted) return
      const looseHistory = loose.status === 'fulfilled' && Array.isArray(loose.value.records) ? loose.value.records : []
      const reverseHistory = reverse.status === 'fulfilled' && Array.isArray(reverse.value.items) ? reverse.value : { items: [], warnings: [] }
      const resolved = resolveSceneHistory(scene, looseHistory, reverseHistory.items)
      setStrategy(resolved.strategy)
      if (resolved.strategy !== 'loose') { setAssembledMode(resolved.strategy); setAssembledOpened(true) }
      setStartupWarning(resolved.warning + (loose.status === 'rejected' || reverse.status === 'rejected' ? ' 部分历史列表不可用；可稍后手动刷新。' : ''))
      setBoot({ ready: true, scene: { ...scene, analysisId: resolved.analysisId }, strategy: resolved.strategy, looseHistory, reverseHistory })
    })
    return () => controller.abort()
  }, [scene])
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void requestJson<{ model: string; models: Model[] }>('/api/brick-test/generate', { signal: controller.signal }, 'Shared Model Registry').then(value => {
      if (controller.signal.aborted) return
      let selected = value.model
      try {
        const saved = JSON.parse(localStorage.getItem(preferenceKey) || 'null')
        selected = value.models.find(m => m.id === saved?.id && m.provider === saved?.provider)?.id || value.model
      } catch { /* Use Registry default. */ }
      const choice = selectSceneModel(value.models, selected, modelBootApplied.current ? undefined : scene)
      modelBootApplied.current = true
      setModels(value.models); setModel(choice.id); setUrlModelWarning(choice.warning)
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)) }).finally(() => { if (!controller.signal.aborted) setModelsReady(true) })
    return () => controller.abort()
  }, [retry])
  if (!boot.ready) return <p role="status">正在定位 URL 指定的识别历史…</p>
  return <>
    {[...scene.warnings, startupWarning, urlModelWarning].filter(Boolean).map((warning, index) => <p role="status" key={index}>{warning}</p>)}
    <label>识别策略<select value={strategy} disabled={busy || looseBusy || dirty} onChange={event => {
      const next = event.target.value as Strategy
      if (next !== 'loose') { setAssembledOpened(true); setAssembledMode(next) }
      onStrategyChange(); setStrategy(next)
    }}>
      <option value="loose">散装积木识别</option>
      <option value="geometry_only">成品几何识别</option>
      <option value="catalog_match">成品目录识别</option>
    </select></label>
    {dirty && <p>请保存审核或新建分析后再切换 Strategy。</p>}
    <div hidden={strategy !== 'loose'}><InventoryImagePanel active={strategy === 'loose'} onBusy={setLooseBusy}
      initialScene={boot.strategy === 'loose' ? boot.scene : undefined} initialHistory={boot.looseHistory}
      workspaceHost={workspaceHost || undefined} onApply={onApply} onReset={onReset} onSearchCatalog={onSearchCatalog} /></div>
    <div hidden={strategy === 'loose'}>
      {error && <p role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>重新读取模型配置</button></p>}
      {assembledOpened && <ReverseRecognitionPanel initialScene={boot.strategy !== 'loose' ? boot.scene : undefined} initialHistory={boot.reverseHistory}
        modelsReady={modelsReady} onRestoreModel={id => { if (models.some(m => m.id === id)) setModel(id) }} inventory={inventory}
        onQuantity={(row, quantity) => setInventory(items => items.map(item => item === row ? { ...item, quantity } : item))}
        models={models} model={model} onModel={id => {
          const selected = models.find(m => m.id === id)
          if (!selected) return
          setModel(id)
          try { localStorage.setItem(preferenceKey, JSON.stringify({ provider: selected.provider, id })) } catch { /* Session selection remains. */ }
        }} disabled={false} onBusy={setBusy} onDirty={setDirty}
        analysisMode={assembledMode} onAnalysisMode={mode => { setAssembledMode(mode); setStrategy(mode); onStrategyChange() }}
        active={strategy !== 'loose'} geometryHost={geometryHost} onGeometryPresence={onGeometryPresence} onSearchCatalog={onSearchCatalog} workspaceHost={workspaceHost} onApply={onApply} onReset={onReset} />}
    </div>
  </>
}

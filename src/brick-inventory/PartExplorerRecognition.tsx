import { useEffect, useState } from 'react'
import { InventoryImagePanel } from '../brick-vision/InventoryImagePanel'
import { ReverseRecognitionPanel } from '../brick-test/ReverseAssemblyPanel'
import { PARTS, COLORS } from '../brick-test/catalog'
import { requestJson } from './api.mjs'
import type { InventoryItem } from './inventory'
import type { ObservationCatalogSearch } from '../brick-vision/types'
import type { Model } from '../brick-test/reverse-types'
import type { InventoryRow } from '../brick-test/design-types'

type Strategy = 'loose' | 'geometry_only' | 'catalog_match'
const preferenceKey = 'story-voice-test-audio:ai-design:model:reverse'
export function PartExplorerRecognition({ workspaceHost, geometryHost, onGeometryPresence, resultsHost, onApply, onSearchCatalog, onStrategyChange }: {
  geometryHost: HTMLElement | null; onGeometryPresence(value: boolean): void
  workspaceHost: HTMLElement | null; resultsHost: HTMLElement | null
  onStrategyChange(): void; onApply(items: InventoryItem[]): void; onSearchCatalog(request: ObservationCatalogSearch): void
}) {
  const [strategy, setStrategy] = useState<Strategy>(() => new URL(location.href).searchParams.has('analysisId') ? 'geometry_only' : 'loose')
  const [assembledMode, setAssembledMode] = useState<'geometry_only' | 'catalog_match'>('geometry_only')
  const [assembledOpened, setAssembledOpened] = useState(() => strategy !== 'loose')
  const [busy, setBusy] = useState(false), [looseBusy, setLooseBusy] = useState(false), [dirty, setDirty] = useState(false)
  const [models, setModels] = useState<Model[]>([]), [model, setModel] = useState('')
  const [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [inventory, setInventory] = useState<InventoryRow[]>(() => PARTS.flatMap(part => COLORS.map(color => ({ part: part.id, color: color.code, quantity: part.id === '3437' ? 2 : part.id === '3011' ? 1 : ['1', '14'].includes(color.code) ? 1 : 0 }))))
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
      setModels(value.models); setModel(selected)
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [retry])
  return <>
    <label>Prompt Strategy<select value={strategy} disabled={busy || looseBusy || dirty} onChange={event => {
      const next = event.target.value as Strategy
      if (next !== 'loose') { setAssembledOpened(true); setAssembledMode(next) }
      onStrategyChange(); setStrategy(next)
    }}>
      <option value="loose">Loose Parts</option>
      <option value="geometry_only">Assembled Geometry</option>
      <option value="catalog_match">Assembled Catalog</option>
    </select></label>
    {dirty && <p>请保存审核或新建分析后再切换 Strategy。</p>}
    <div hidden={strategy !== 'loose'}><InventoryImagePanel active={strategy === 'loose'} onBusy={setLooseBusy}
      workspaceHost={workspaceHost || undefined} onApply={onApply} onSearchCatalog={onSearchCatalog} /></div>
    <div hidden={strategy === 'loose'}>
      {error && <p role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>重新读取模型配置</button></p>}
      {assembledOpened && <ReverseRecognitionPanel inventory={inventory}
        onQuantity={(row, quantity) => setInventory(items => items.map(item => item === row ? { ...item, quantity } : item))}
        models={models} model={model} onModel={id => {
          const selected = models.find(m => m.id === id)
          if (!selected) return
          setModel(id)
          try { localStorage.setItem(preferenceKey, JSON.stringify({ provider: selected.provider, id })) } catch { /* Session selection remains. */ }
        }} disabled={false} onBusy={setBusy} onDirty={setDirty}
        analysisMode={assembledMode} onAnalysisMode={mode => { setAssembledMode(mode); setStrategy(mode); onStrategyChange() }}
        active={strategy !== 'loose'} geometryHost={geometryHost} onGeometryPresence={onGeometryPresence} onSearchCatalog={onSearchCatalog} workspaceHost={workspaceHost} resultsHost={resultsHost} onApply={onApply} />}
    </div>
  </>
}

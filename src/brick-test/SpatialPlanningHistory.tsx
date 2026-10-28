import { useEffect, useState } from 'react'
import { InfoHint } from '../brick-vision/InfoHint'
type Run = { id: string; createdAt: string; status: string }
type Scope = { planId: string; selectionKey: string; identity: Record<string, unknown>; eligible: boolean; choice: { selectedSpatialPlanId: string | null; revision: number } }
export function SpatialPlanningHistory({ runs, loadedId, disabled, onLoad }: { runs: Run[]; loadedId?: string; disabled: boolean; onLoad(id: string): void }) {
  const [scopes, setScopes] = useState<Record<string, Scope>>({}), [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const ids = [...new Set([...runs.map(r => r.id), ...(loadedId ? [loadedId] : [])])].sort().join(',')
  useEffect(() => { const refresh = () => setRevision(n => n + 1); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh) }, [])
  useEffect(() => {
    const controller = new AbortController()
    setScopes({}); setErrors({}); setError('')
    void Promise.all(ids.split(',').filter(Boolean).map(async id => {
      try {
        const response = await fetch('/api/brick-spatial/plan-choice/' + id, { signal: controller.signal }), data = await response.json()
        if (!response.ok) throw Error(data.error)
        if (data.planId !== id) throw Error('Spatial 返回身份不一致')
        return { id, data: data as Scope }
      } catch (e) { return { id, error: String(e) } }
    })).then(results => {
      if (controller.signal.aborted) return
      setScopes(Object.fromEntries(results.filter(r => r.data).map(r => [r.id, r.data!])))
      setErrors(Object.fromEntries(results.filter(r => r.error).map(r => [r.id, r.error!])))
    })
    return () => controller.abort()
  }, [ids, revision])
  const scope = loadedId ? scopes[loadedId] : undefined
  const selected = scope?.choice.selectedSpatialPlanId
  async function select() {
    if (!scope || saving) return
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/brick-spatial/plan-choice/' + scope.planId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selectionKey: scope.selectionKey, expectedRevision: scope.choice.revision }) })
      const data = await response.json()
      if (!response.ok) throw Error(data.error)
      setScopes(current => Object.fromEntries(Object.entries(current).map(([id, old]) => [id, old.selectionKey === data.selectionKey ? { ...old, choice: data.choice } : old])))
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }
  return <div className="spatial-planning-history">
    <div className="vision-history-line"><label htmlFor="spatial-run-history">Spatial Planning History</label><InfoHint label="Spatial Planning History">选择后自动加载查看。Select 只采用当前结果；不同 Review、Mapping 或实际输入快照的选择相互独立。</InfoHint></div>
    <select id="spatial-run-history" aria-label="Spatial Plan history" value={loadedId || ''} disabled={disabled || saving} onChange={e => { if (e.target.value) onLoad(e.target.value) }}>
      <option value="">选择历史计划（不调用模型）</option>
      {loadedId && !runs.some(r => r.id === loadedId) && <option value={loadedId}>当前查看 · {loadedId.slice(0, 8)}</option>}
      {runs.map(r => <option key={r.id} value={r.id}>{r.createdAt} · {r.id.slice(0, 8)} · {r.status}{scopes[r.id]?.choice.selectedSpatialPlanId === r.id ? ' · Selected' : ''}{errors[r.id] ? ' · 输入身份无法确认' : ''}</option>)}
    </select>
    {loadedId && <>
      <div className="vision-history-line"><span title={loadedId}>当前查看：{loadedId.slice(0, 8)}</span><span title={selected || ''}>此输入的 Selected：{scope ? selected?.slice(0, 8) || '尚未选择' : '尚未确认'}</span>
        <button type="button" disabled={disabled || saving || !scope?.eligible || selected === loadedId} onClick={() => void select()}>{selected === loadedId ? 'Selected' : saving ? '保存中…' : 'Select'}</button>
        <InfoHint label="Selected Spatial">人工采用决定，不代表 Geometry 或 Build Plan 被选中，也不改变历史来源。并发冲突需重新读取后再次明确选择。</InfoHint>
      </div>
      {scope && <details><summary>规划输入范围 · {Object.values(scopes).filter(s => s.selectionKey === scope.selectionKey).length} 次运行</summary><pre>{JSON.stringify({ selectionKey: scope.selectionKey, ...scope.identity }, null, 2)}</pre></details>}
      {scope && !scope.eligible && <p role="status">此记录未满足正式 Spatial 校验条件，只能查看。</p>}
      {errors[loadedId] && <p role="alert">{errors[loadedId]}</p>}
    </>}
    {(error || Object.keys(errors).length > 0) && <div role="alert">{error}<details><summary>选择状态诊断 · {Object.keys(errors).length} 条</summary><pre>{JSON.stringify(errors, null, 2)}</pre></details><button type="button" disabled={saving || disabled} onClick={() => setRevision(n => n + 1)}>重新读取选择状态</button></div>}
  </div>
}

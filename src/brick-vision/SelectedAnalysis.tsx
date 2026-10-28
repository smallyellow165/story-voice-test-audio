import { InfoHint } from './InfoHint'
import { useEffect, useState } from 'react'

export type Choice = { imageId: string; selectedAnalysisId: string | null; analysisKind: 'reverse' | 'inventory' | null; revision: number }
type Props = { imageId: string; analysisKind: 'reverse' | 'inventory'; loadedId?: string; loadedImageId?: string; complete: boolean; disabled: boolean; onChoice?(choice: Choice | null): void }

export function SelectedAnalysis(props: Props) {
  // A new image or loaded run owns a fresh request/state lifetime.
  return props.imageId ? <ChoiceControl key={`${props.imageId}/${props.analysisKind}/${props.loadedId}`} {...props} /> : null
}
function ChoiceControl({ imageId, analysisKind, loadedId, loadedImageId, complete, disabled, onChoice }: Props) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { onChoice?.(choice) }, [choice, onChoice])
  useEffect(() => { const update = () => setRefresh(n => n + 1); window.addEventListener('focus', update); return () => window.removeEventListener('focus', update) }, [])
  const endpoint = `/api/brick-source-images/${encodeURIComponent(imageId)}/selected-analysis`
  useEffect(() => {
    const controller = new AbortController()
    setChoice(null); setError('')
    void fetch(endpoint, { signal: controller.signal }).then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      if (body.imageId !== imageId) throw new Error('选择关系与图片不一致')
      setChoice(body)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [endpoint, imageId, refresh])
  const selected = !!loadedId && choice?.selectedAnalysisId === loadedId && choice.analysisKind === analysisKind
  async function select() {
    if (!choice || saving) return
    setSaving(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId: loadedId, analysisKind, expectedRevision: choice.revision }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setChoice(body)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }
  return <div className="selected-analysis" aria-label="Selected Analysis">
    <div className="vision-history-line"><strong>Selected Analysis{loadedImageId && loadedImageId !== imageId ? '（筛选图片）' : ''}</strong>
      <InfoHint label="Selected Analysis">加载只切换查看内容；Select 才正式采用当前 Analysis，不修改 Review 或下游结果。</InfoHint>
      <span title={choice?.selectedAnalysisId || ''}>{choice ? choice.selectedAnalysisId ? choice.selectedAnalysisId.slice(0, 8) : '尚未选择' : error ? '状态不可用' : '读取中…'}</span>
      <button type="button" disabled={disabled || saving || !choice || !complete || !loadedId || loadedImageId !== imageId || selected}
        onClick={() => void select()}>{selected ? 'Selected' : saving ? '保存中…' : 'Select'}</button>
    </div>
    {error && <p role="alert">{error} <button type="button" disabled={disabled || saving} onClick={() => setRefresh(n => n + 1)}>重新读取选择状态</button></p>}
  </div>
}

import { useEffect, useState } from 'react'

type Choice = { imageId: string; selectedAnalysisId: string | null; analysisKind: 'reverse' | 'inventory' | null; revision: number }
type Props = { imageId: string; analysisKind: 'reverse' | 'inventory'; loadedId?: string; loadedImageId?: string; complete: boolean; disabled: boolean }

export function SelectedAnalysis(props: Props) {
  // A new image or loaded run owns a fresh request/state lifetime.
  return props.imageId ? <ChoiceControl key={`${props.imageId}/${props.analysisKind}/${props.loadedId}`} {...props} /> : null
}
function ChoiceControl({ imageId, analysisKind, loadedId, loadedImageId, complete, disabled }: Props) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)
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
    <p><strong>{selected ? 'Selected · 已加载正式采用的 Analysis' : 'Selected Analysis'}</strong><br />
      {choice ? choice.selectedAnalysisId ? `${choice.analysisKind} · ${choice.selectedAnalysisId}` : '此图片尚未选择 Analysis' : error ? '选择状态不可用' : '正在读取选择状态'}
    </p>
    <button type="button" disabled={disabled || saving || !choice || !complete || !loadedId || loadedImageId !== imageId || selected}
      onClick={() => void select()}>{selected ? 'Selected' : saving ? '保存选择…' : 'Select · 采用已加载的 Analysis'}</button>
    <button type="button" disabled={disabled || saving} onClick={() => setRefresh(n => n + 1)}>刷新选择状态</button>
    <p>先 Load 并检查结果，再 Select。选择表示你的明确采用；不会修改识别结果或审核。</p>
    {error && <p role="alert">{error}</p>}
  </div>
}

import { useEffect, useState, useRef } from 'react'
import { InfoHint } from './InfoHint'
import type { Choice } from './SelectedAnalysis'
type Node = { key: string; stage: string; id: string; parent: string | null; analysisId: string; status: string; evidence: Record<string, unknown>; href: string | null }
type History = { imageId: string; nodes: Node[]; unassociated: { stage: string; id: string; reason: string; references: unknown }[]; unassociatedScope: string }
type Props = { imageId: string; choice: Choice | null; loadedId?: string; disabled: boolean; onLoad(id: string): void }
const short = (id: string) => id.includes('/') ? id.slice(id.indexOf('/') + 1) : id.slice(0, 8)
const labels: Record<string, string> = { 'Current Review': '当前 Review', 'Review input': '使用的 Review 版本', 'Mapping Review': 'Mapping Review 快照', Spatial: 'Spatial Plan', Request: '执行请求' }
export function WorkflowHistory(props: Props) {
  return props.imageId ? <HistoryForImage key={props.imageId} {...props} /> : null
}
function HistoryForImage({ imageId, choice, loadedId, disabled, onLoad }: Props) {
  const [history, setHistory] = useState<History | null>(null), [error, setError] = useState('')
  const [revision, setRevision] = useState(0), [expanded, setExpanded] = useState<string | null>(null)
  const selected = choice?.imageId === imageId && choice.analysisKind === 'reverse' ? choice.selectedAnalysisId : null
  const lastSelected = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (choice?.imageId !== imageId) return
    if (lastSelected.current !== selected) { lastSelected.current = selected; setExpanded(selected) }
  }, [choice, imageId, selected])
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void fetch('/api/brick-source-images/' + encodeURIComponent(imageId) + '/workflow-history', { signal: controller.signal })
      .then(async r => { const body = await r.json(); if (!r.ok) throw Error(body.error); if (body.imageId !== imageId) throw Error('Workflow History 图片身份不一致'); return body as History })
      .then(body => { if (!controller.signal.aborted) setHistory(body) })
      .catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [imageId, revision, loadedId])
  return <section className="workflow-history" aria-label="Workflow History">
    <div className="vision-history-line"><strong>Workflow History</strong><InfoHint label="Workflow History">仅沿明确 ID 和已核对的 hash 展示来源。Selected 只决定当前关注的 Analysis，不改变历史关联。历史 Review 版本不等于当前 Review。状态来自保存记录；打开 Viewer 时仍由原有 Validator 复核。</InfoHint></div>
    {error && <p role="alert">{error}{history ? '（下方保留上次读取结果）' : ''} <button type="button" onClick={() => setRevision(n => n + 1)}>重新读取</button></p>}
    {!history && !error && <p role="status">正在读取关联证据…</p>}
    {history && <>
      {!history.nodes.some(n => n.stage === 'Analysis') && <p>尚无可验证的成品 Analysis 关联记录。</p>}
      {history.nodes.filter(n => n.stage === 'Analysis').map(a => {
        const children = history.nodes.filter(n => n.parent === a.key)
        return <div key={a.key} className="workflow-analysis">
          <button type="button" className="workflow-toggle" aria-expanded={expanded === a.id} onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
            {expanded === a.id ? '▾' : '▸'} Analysis {short(a.id)} · {a.status}{a.id === selected ? ' · Selected' : ''}{a.id === loadedId ? ' · 当前加载' : ''}
          </button>
          {expanded === a.id && <>
            <button type="button" disabled={disabled} onClick={() => onLoad(a.id)}>查看 Analysis / Review</button>
            <details><summary>Analysis 来源证据</summary><pre>{JSON.stringify({ id: a.id, ...a.evidence }, null, 2)}</pre></details>
            {!children.length && <p>尚无关联记录。</p>}
            {children.map(child => <WorkflowHistoryBranch key={child.key} node={child} history={history} disabled={disabled} onLoad={onLoad} />)}
          </>}
        </div>
      })}
      {!!history.unassociated.length && <details className="vision-history-diagnostics"><summary>未关联 / 证据缺失：{history.unassociated.length} 条（全局）</summary><p>{history.unassociatedScope}</p>
        <ul>{history.unassociated.map((r, i) => <li key={i}>{r.stage} · {short(r.id)} · {r.reason}<details><summary>引用详情</summary><pre>{JSON.stringify(r, null, 2)}</pre></details></li>)}</ul>
      </details>}
    </>}
  </section>
}

export function WorkflowHistoryBranch({ node, history, disabled, onLoad }: { node: Node; history: History; disabled: boolean; onLoad(id: string): void }) {
    const children = history.nodes.filter(n => n.parent === node.key)
    // Initial expansion reveals saved Build Plans without forcing unsuccessful
    // branches or ten equivalent candidate rows to be permanently expanded.
    const hasSavedBuild = (key: string): boolean => history.nodes.some(n => n.parent === key && (n.stage === 'Build Plan' || hasSavedBuild(n.key)))
    const href = node.href?.startsWith('/') ? node.href : node.href ? import.meta.env.BASE_URL + node.href : null
    return <details key={node.key} open={hasSavedBuild(node.key)} className="workflow-branch">
      <summary>{labels[node.stage] || node.stage} · <span title={node.id}>{short(node.id)}</span> · {node.status}</summary>
      <div className="vision-history-line">
        {href && <a href={href} target="_blank" rel="noreferrer">打开已有记录 ↗</a>}
        {node.stage === 'Current Review' && <button type="button" disabled={disabled} onClick={() => onLoad(node.analysisId)}>查看当前 Review</button>}
      </div>
      <details><summary>引用证据</summary><pre>{JSON.stringify({ id: node.id, parent: node.parent, ...node.evidence }, null, 2)}</pre></details>
      {children.map(child => <WorkflowHistoryBranch key={child.key} node={child} history={history} disabled={disabled} onLoad={onLoad} />)}
    </details>
  }

import { useState } from 'react'
import type { OutputValidation } from './reverse-types'
export type AnchorRevisionOperation = { path: string; action: 'replace' | 'remove'; anchorId: string; reason: string; confirmed: boolean }
export function AnchorRevisionForm({ report, disabled, onSubmit }: { report: OutputValidation; disabled: boolean; onSubmit(operation: AnchorRevisionOperation): void }) {
  const issues = report.issues.filter(i => /^\$\.observations\[\d+\]\.dimensions\.(width_studs|depth_studs|height_brick_units)\.anchor_ids\[\d+\]$/.test(i.path) && Array.isArray(i.expected))
  const [path, setPath] = useState(issues[0]?.path || ''), [action, setAction] = useState<'replace' | 'remove'>('replace')
  const [anchorId, setAnchor] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false)
  if (!issues.length) return null
  return <fieldset disabled={disabled}>
    <legend>人工修订 Anchor · Revision Pending（尚未提交）</legend>
    <label>错误引用<select aria-label="修订字段" value={path} onChange={e => { setPath(e.target.value); setConfirmed(false) }}>{issues.map(i => <option key={i.path} value={i.path}>{i.path} · {String(i.actual)}</option>)}</select></label>
    <label>修订方式<select aria-label="修订方式" value={action} onChange={e => {setAction(e.target.value as 'replace' | 'remove'); setConfirmed(false)}}><option value="replace">替换为已声明 Anchor</option><option value="remove">移除非法引用，保留尺寸与全部证据</option></select></label>
    {action === 'replace' && <label>目标 Anchor<select aria-label="目标 Anchor" value={anchorId} onChange={e => {setAnchor(e.target.value); setConfirmed(false)}}><option value="">请人工选择</option>{report.anchors?.map(a => <option key={a.observation_id} value={a.observation_id}>{a.observation_id}</option>)}</select></label>}
    <details><summary>已声明 Anchor 的证据</summary>{report.anchors?.map(a => <p key={a.observation_id}>{a.observation_id} · {a.evidence} · Confidence {a.confidence}</p>)}</details>
    <label>证据审核与修订理由<textarea aria-label="修订理由" value={reason} maxLength={2000} onChange={e => {setReason(e.target.value); setConfirmed(false)}} /></label>
    <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对证据，确认此项修订；不代表型号或颜色已审核</label>
    <p>保存独立修订，保留原始失败记录。只修改选中的引用；其他校验错误仍会阻止恢复。</p>
    <button type="button" disabled={!path || !reason.trim() || !confirmed || action === 'replace' && !anchorId} onClick={() => onSubmit({path, action, anchorId, reason, confirmed})}>确认修订并严格校验</button>
  </fieldset>
}

import { useEffect, useState } from 'react'
import { loadSessions } from '../brick-inventory/storage'
import type { SessionInventory } from '../brick-inventory/inventory'

export function SavedPartsInput({ disabled, onSession }: { disabled: boolean; onSession(session: SessionInventory | null): void }) {
  const [sessions, setSessions] = useState<SessionInventory[]>([])
  const [id, setId] = useState(() => new URL(location.href).searchParams.get('sessionId') || '')
  const [error, setError] = useState('')
  function load(target: string) {
    setId(target); onSession(null)
    try {
      const values = loadSessions(localStorage); setSessions(values)
      const session = values.find(s => s.id === target)
      if (target && !session) throw new Error('保存的清单不存在；请选择当前浏览器中的清单。')
      onSession(session || null); setError('')
    } catch (e) { setError(String(e)) }
  }
  useEffect(() => { load(id) }, [])
  return <div>
    <label>当前已保存清单<select value={id} disabled={disabled} onChange={e => load(e.target.value)}>
      <option value="">选择清单</option>
      {id && !sessions.some(s => s.id === id) && <option value={id}>{id}（不可读取）</option>}
      {sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.updated_at}</option>)}
    </select></label>
    <button type="button" disabled={disabled} onClick={() => load(id)}>重新加载保存的清单</button>
    <p className="brick-help">Generate 前使用现有 Mapping / Assembly 检查全部零件；不支持的零件会阻止模型调用，不自动替换或删减。</p>
    {error && <p role="alert">{error}</p>}
  </div>
}

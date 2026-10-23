import { PARTS, COLORS } from './catalog'
import { useEffect, useState } from 'react'
import { loadSessions } from '../brick-inventory/storage'
import { postBrickGame } from '../brick-inventory/api.mjs'
import type { SessionInventory } from '../brick-inventory/inventory'
import type { InventoryReview } from '../brick-game-contract'
import type { InventoryRow } from './design-types'

export function SavedPartsInput({ disabled, onInventory }: { disabled: boolean; onInventory(rows: InventoryRow[]): void }) {
  const [sessions, setSessions] = useState<SessionInventory[]>([])
  const [id, setId] = useState(() => new URL(location.href).searchParams.get('sessionId') || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const refresh = () => { try { setSessions(loadSessions(localStorage)); setError('') } catch (e) { setError(String(e)) } }
  useEffect(refresh, [])
  return <details><summary>使用 Part Explorer 已保存的零件集合</summary>
    <label>Saved Parts<select value={id} disabled={disabled || busy} onChange={e => setId(e.target.value)}>
      <option value="">选择已保存库存</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.updated_at}</option>)}
    </select></label>
    <button disabled={disabled || busy} onClick={refresh}>刷新列表</button>
    <button disabled={disabled || busy || !id} onClick={async () => {
      setBusy(true); setError('')
      try {
        const session = loadSessions(localStorage).find(s => s.id === id)
        if (!session) throw new Error('保存的零件集合不存在。')
        const review = await postBrickGame('review', { session }) as InventoryReview
        if (!review.mapping.rows.length || review.mapping.rows.some(r => !r.target || r.errors.length)) throw new Error('存在当前 Assembly 不支持或映射未确认的零件；未替换创作库存。请在 Part Explorer 查看并准备可用集合。')
        const merged = new Map<string, InventoryRow>()
        for (const r of review.mapping.rows) {
          const target = r.target!
          const key = target.part + ':' + target.color
          merged.set(key, { part: target.part, color: target.color, quantity: (merged.get(key)?.quantity || 0) + r.source.quantity })
        }
        const rows = PARTS.flatMap(part => COLORS.map(color => ({ part: part.id, color: color.code,
          quantity: merged.get(part.id + ':' + color.code)?.quantity || 0 })))
        if ([...merged.keys()].some(key => !rows.some(row => row.part + ':' + row.color === key))) throw new Error('映射中含当前 Creative 库存编辑器不支持的型号或颜色；未忽略任何零件，也未替换库存。')
        onInventory(rows)
      } catch (e) { setError(String(e)) } finally { setBusy(false) }
    }}>检查映射并用于 Creative（不调用模型）</button>
    <p>自由创作使用零件集合；重建参考作品请加载下方完整 Analysis，不用库存替代空间信息。</p>
    {error && <p role="alert">{error}</p>}
  </details>
}

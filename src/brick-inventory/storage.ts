import { parseSession } from './inventory.ts'
import type { SessionInventory } from './inventory.ts'

const KEY = 'duplo.session-inventories.v1'
export function loadSessions(storage: Pick<Storage, 'getItem'>): SessionInventory[] {
  const raw = storage.getItem(KEY)
  if (raw === null) return []
  const list: unknown = JSON.parse(raw)
  if (!Array.isArray(list)) throw new Error('保存的库存列表损坏；请先导出或备份浏览器数据。')
  return list.map(parseSession)
}

export function saveSession(storage: Pick<Storage, 'getItem' | 'setItem'>, session: SessionInventory): SessionInventory[] {
  const valid = parseSession(session)
  // Read again before saving so another tab's other sessions are retained.
  const sessions = loadSessions(storage).filter(row => row.id !== valid.id)
  sessions.unshift(valid)
  storage.setItem(KEY, JSON.stringify(sessions)) // Quota/privacy errors propagate to UI.
  return sessions
}

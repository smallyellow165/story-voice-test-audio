// Canonical Rebrickable inventory. No rendering, storage, LDraw or game imports.
// Rebrickable color_id is NOT the LDraw color used by the experimental Generator.
export type InventoryItem = { part_num: string; color_id: number; quantity: number }
export type SessionInventory = { schema_version: 1; id: string; name: string; updated_at: string; items: InventoryItem[] }
export const MAX_QUANTITY = 999
export const MAX_ROWS = 500

export function newSessionId(): string {
  // randomUUID requires a secure context; LAN HTTP on a phone may lack it.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function validateItems(input: unknown): InventoryItem[] {
  if (!Array.isArray(input) || input.length > MAX_ROWS) throw new Error('库存最多保存 500 种型号与颜色组合。')
  const seen = new Set<string>()
  return input.map(row => {
    if (!row || typeof row !== 'object' || Object.keys(row).sort().join(',') !== 'color_id,part_num,quantity'
        || typeof row.part_num !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(row.part_num)
        || !Number.isSafeInteger(row.color_id) || row.color_id < 0
        || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > MAX_QUANTITY) {
      throw new Error('库存格式错误：需要有效型号、Rebrickable 颜色 ID 和 1–999 的整数数量。')
    }
    const key = itemKey(row)
    if (seen.has(key)) throw new Error('库存中存在重复的型号与颜色组合。')
    seen.add(key)
    return { part_num: row.part_num, color_id: row.color_id, quantity: row.quantity }
  })
}

export function itemKey(item: Pick<InventoryItem, 'part_num' | 'color_id'>) {
  return `${item.part_num}:${item.color_id}`
}

export function addItem(items: InventoryItem[], item: InventoryItem): InventoryItem[] {
  validateItems([item])
  const key = itemKey(item)
  const present = items.some(row => itemKey(row) === key)
  return validateItems(present ? items.map(row => itemKey(row) === key ? { ...row, quantity: row.quantity + item.quantity } : row) : [...items, item])
}

export function setQuantity(items: InventoryItem[], key: string, quantity: number): InventoryItem[] {
  if (quantity === 0) return items.filter(row => itemKey(row) !== key)
  return validateItems(items.map(row => itemKey(row) === key ? { ...row, quantity } : row))
}

export function parseSession(input: unknown): SessionInventory {
  const value = input as SessionInventory
  if (!value || value.schema_version !== 1 || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)
      || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80
      || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) {
    throw new Error('无法读取这份 Session Inventory，原有保存数据未被修改。')
  }
  return { schema_version: 1, id: value.id, name: value.name.trim(), updated_at: value.updated_at, items: validateItems(value.items) }
}

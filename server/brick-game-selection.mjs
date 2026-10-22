// Select only explicitly confirmed source rows from an existing Mapping Review.
// This does not resolve mappings or alter the saved Session Inventory.
export function selectGameInventory(review, selection) {
  if (!Array.isArray(selection) || !selection.length) throw new Error('请明确选择本次生成使用的库存。')
  const seen = new Set(), merged = new Map()
  for (const item of selection) {
    const key = JSON.stringify([item?.part_num, item?.color_id])
    if (seen.has(key)) throw new Error('本次库存选择包含重复项目。')
    seen.add(key)
    const source = review.session.items.find(s => s.part_num === item?.part_num && s.color_id === item?.color_id)
    const row = review.mapping.rows.find(r => r.source.part_num === item?.part_num && r.source.color_id === item?.color_id)
    if (!source || !row?.target || row.errors.length || row.source.quantity !== source.quantity)
      throw new Error('选择包含原库存外或当前不可用于游戏的项目。')
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > source.quantity)
      throw new Error('选择数量必须为正整数，且不能超过原库存。')
  }
  // Source order makes retries and artifact consistency checks deterministic.
  const items = [], excluded = []
  for (const row of review.mapping.rows) {
    const item = selection.find(s => s.part_num === row.source.part_num && s.color_id === row.source.color_id)
    const quantity = item?.quantity || 0
    if (quantity) {
      items.push({ ...row.source, quantity })
      const { part, color } = row.target
      const key = part + ':' + color
      merged.set(key, { part, color, quantity: (merged.get(key)?.quantity || 0) + quantity })
    }
    if (quantity < row.source.quantity) excluded.push({ ...row.source, quantity: row.source.quantity - quantity,
      reasons: row.errors.length ? [...row.errors] : [quantity ? '用户减少本次使用数量' : '用户未选择用于本次生成'] })
  }
  return { items, inventory: [...merged.values()], excluded }
}

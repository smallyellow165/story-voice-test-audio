// Interpret existing strict search evidence; matching stays in the Catalog API.
export function uniqueCatalogIdentity(result, colorId) {
  if (!result || !Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.items)) throw new Error('Catalog 候选响应格式错误')
  if (result.total === 0) return { status: 'none' }
  if (result.total > 1) return { status: 'multiple' }
  const part = result.items[0]
  if (result.items.length !== 1 || !part || part.eligible !== true || typeof part.part_num !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(part.part_num) || !Array.isArray(part.colors)
    || !Array.isArray(part.checks) || !part.checks.length || !part.checks.every(c => c.status === 'matched')) throw new Error('Catalog 未提供有效的严格匹配证据')
  if (part.colors.some(c => !Number.isSafeInteger(c.id) || c.id < 0)) throw new Error('Catalog 颜色数据无效')
  const colors = [...new Set(part.colors.map(c => c.id))].filter(id => colorId === null || id === colorId)
  if (!colors.length) return { status: 'none' }
  if (colors.length !== 1) return { status: 'multiple' }
  return { status: 'filled', part: part.part_num, color: String(colors[0]) }
}

export function hasConfirmedIdentity(row) {
  // Only current field values matter, never their origin or confirmation history.
  return !!(row.part.trim() && row.color.trim())
}

export function completeCatalogIdentity(row, identity) {
  const part = row.part.trim(), color = row.color.trim()
  if ((part && part !== identity.part)
    || (color && (!/^\d+$/.test(color) || Number(color) !== Number(identity.color)))) {
    throw new Error('唯一候选与已有确认型号或颜色不一致；未修改任何字段，请人工选择。')
  }
  // Preserve nonempty input exactly, including its formatting.
  return { part: part ? row.part : identity.part, color: color ? row.color : identity.color }
}

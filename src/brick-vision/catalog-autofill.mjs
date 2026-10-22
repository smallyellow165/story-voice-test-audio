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
  // Protect partial manual edits too. Existing filled values need no repeat query.
  return !!(row.confirmation || row.part.trim() || row.color.trim())
}

// Display safety only; never grants Assembly validity or export/game eligibility.
export function assessDesignDisplay(design, rules) {
  const issues = []
  if (!design || typeof design !== 'object' || !Array.isArray(design.bricks)
      || !design.bricks.length || design.bricks.length > 100) return { renderable: false, issues: ['需要 1–100 个可显示零件。'] }
  const ids = new Set()
  for (const [index, b] of design.bricks.entries()) {
    if (!b || typeof b.id !== 'string' || !b.id.trim() || ids.has(b.id)) issues.push('零件 ' + (index + 1) + ' 的 ID 缺失或重复。')
    if (b) ids.add(b.id)
    const profile = rules.PARTS.find(p => p.id === b?.part)
    if (!profile || !rules.COLORS.some(c => c.code === b?.color)) issues.push('零件 ' + (index + 1) + ' 的型号或颜色未知。')
    if (!b || !rules.validPosition(b) || !profile?.geometry.rotations.includes(b.rotation)) issues.push('零件 ' + (index + 1) + ' 的坐标或旋转无效。')
  }
  return { renderable: issues.length === 0, issues }
}
// A failed repair must not discard the previous inspectable candidate.
export function selectDisplayCandidate(result) {
  if (result?.display?.renderable && result.design) return result
  return [...(result?.priorAttempts || [])].reverse().find(r => r.display?.renderable && r.design) || null
}

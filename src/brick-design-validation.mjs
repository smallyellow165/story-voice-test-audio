// Shared by the server Generator and browser game. Geometry stays in V2.
export const designLimits = Object.freeze({ minBricks: 2, maxBricks: 12, maxLayer: 3, maxCoordinate: 6, minSupportFraction: 0.5 })
const pairKey = (part, color) => `${part}:${color}`
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const record = (value) => value && typeof value === 'object' && !Array.isArray(value)

export function validateBrickDesign(design, inventory, rules) {
  const report = { valid: false, issues: [], assembly: null, steps: [], usage: [] }
  const issue = (code, message, extra = {}) => report.issues.push({ code, message, ...extra })
  if (!record(design) || !boundedText(design.name, 80) || !Array.isArray(design.bricks) || !Array.isArray(design.steps)) {
    issue('SCHEMA', '输出需包含造型名称、bricks 和 steps 数组。')
    return report
  }
  if (design.bricks.length < designLimits.minBricks || design.bricks.length > designLimits.maxBricks) issue('BRICK_COUNT', `造型必须使用 ${designLimits.minBricks}–${designLimits.maxBricks} 块积木。`)
  // Reject unbounded model output before passing it to geometric routines.
  if (design.steps.length > 12) issue('STEP_COUNT', '步骤不能超过 12 步。')
  if (design.bricks.length > 12 || design.steps.length > 12) return report
  const ids = new Set()
  const counts = new Map()
  for (const brick of design.bricks) {
    if (!record(brick) || typeof brick.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(brick.id) || !rules.PARTS.some((p) => p.id === brick.part) || !rules.COLORS.some((c) => c.code === brick.color) || ![brick.x, brick.z, brick.layer].every(Number.isSafeInteger) || ![0, 90, 180, 270].includes(brick.rotation)) {
      issue('BRICK_SCHEMA', '积木字段无效：检查 ID、真实型号/颜色、整数坐标和直角旋转。')
      continue
    }
    if (ids.has(brick.id)) issue('DUPLICATE_ID', `积木 ID 重复：${brick.id}`)
    ids.add(brick.id)
    if (Math.abs(brick.x) > 6 || Math.abs(brick.z) > 6 || brick.layer < 0 || brick.layer > 3) issue('CHILD_LIMIT', '造型中心坐标需在 ±6 内，底部层高需在 0–3 内。', { brickId: brick.id })
    const key = pairKey(brick.part, brick.color)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const available = new Map(inventory.map((row) => [pairKey(row.part, row.color), row.quantity]))
  const keys = new Set([...available.keys(), ...counts.keys()])
  for (const key of keys) {
    const [part, color] = key.split(':')
    const used = counts.get(key) || 0
    const quantity = available.get(key) || 0
    report.usage.push({ part, color, available: quantity, used, remaining: quantity - used })
    if (used > quantity) issue('INVENTORY_EXCEEDED', `${part} / 颜色 ${color} 使用 ${used} 块，库存仅 ${quantity} 块。`)
  }
  if (report.issues.some((item) => ['BRICK_SCHEMA', 'DUPLICATE_ID', 'CHILD_LIMIT'].includes(item.code))) return report
  report.assembly = rules.validateAssembly(design.bricks)
  if (!report.assembly.valid) issue('GEOMETRY', report.assembly.reason)
  const byId = new Map(design.bricks.map((brick) => [brick.id, brick]))
  const placed = new Set()
  const prefix = []
  if (design.steps.length !== design.bricks.length) issue('STEP_COUNT', '每块积木必须恰好有一个搭建步骤。')
  for (const [index, step] of design.steps.entries()) {
    if (!record(step) || !boundedText(step.instruction, 180) || !byId.has(step.brickId) || placed.has(step.brickId)) {
      issue('STEP_SCHEMA', '步骤需引用未放置的积木，并包含 1–180 字指导。', { step: index + 1 })
      continue
    }
    const brick = byId.get(step.brickId)
    placed.add(step.brickId)
    prefix.push(brick)
    const validation = rules.validateAssembly(prefix)
    report.steps.push({ step: index + 1, brickId: brick.id, validation })
    if (!validation.valid) issue('BUILD_ORDER', `第 ${index + 1} 步：${validation.reason}`, { step: index + 1, brickId: brick.id })
    if (validation.valid && brick.layer > 0) {
      const supported = validation.connections.filter((link) => link.upperId === brick.id).reduce((count, link) => count + link.points.length, 0)
      const required = Math.ceil(rules.footprint(brick).length * designLimits.minSupportFraction)
      if (supported < required) issue('CHILD_SUPPORT', `第 ${index + 1} 步仅 ${supported} 个下方接合点，至少需要 ${required} 个。`, { step: index + 1, brickId: brick.id })
    }
  }
  if (placed.size !== design.bricks.length) issue('MISSING_STEPS', '搭建步骤未覆盖全部积木。')
  report.valid = report.issues.length === 0
  return report
}


// Resolve explicit Rebrickable external IDs. Never infer identity from matching
// numbers, names, RGB proximity or an inventory used in a previous experiment.
import { inspectBrickModel } from './brick-library.mjs'

export async function resolveInventoryMapping(session, metadata, rules, inspectModel = inspectBrickModel) {
  const merged = new Map()
  const checked = new Map()
  const rows = []
  for (const source of session.items) {
    const p = metadata.parts[source.part_num], c = metadata.colors[source.color_id]
    const errors = []
    const partCandidates = Array.isArray(p?.external_ids?.LDraw) ? [...new Set(p.external_ids.LDraw.map(String))] : []
    const colorCandidates = Array.isArray(c?.external_ids?.LDraw?.ext_ids) ? [...new Set(c.external_ids.LDraw.ext_ids.map(String))] : []
    if (p?.status !== 'available') errors.push(`零件映射数据不可用：${p?.status || 'missing'} ${p?.message || ''}`)
    if (c?.status !== 'available') errors.push(`颜色映射数据不可用：${c?.status || 'missing'} ${c?.message || ''}`)
    if (!p?.known_colors?.includes(source.color_id)) errors.push('数据库未确认此型号与颜色组合')
    const partCandidateChecks = []
    for (const part of partCandidates) {
      const capability = rules.geometrySupport(part)
      const supported = capability.supported
      if (!checked.has(part)) checked.set(part, await inspectModel(part))
      const local = checked.get(part)
      const reasons = [...capability.reasons, ...local.errors]
      partCandidateChecks.push({ part, supported, capability, local, eligible: supported && local.available, reasons })
    }
    const eligible = partCandidateChecks.filter(candidate => candidate.eligible)
    if (!eligible.length) errors.push('没有有效的 LDraw 零件候选；请查看候选检查原因')
    else if (eligible.length > 1) errors.push(`多个有效的 LDraw 零件候选：${eligible.map(c => c.part).join(', ')}；未自动选择`)
    if (colorCandidates.length !== 1) errors.push('LDraw 颜色映射缺失或不唯一')
    const part = eligible.length === 1 ? eligible[0].part : null, color = colorCandidates[0]
    if (colorCandidates.length === 1 && !rules.COLORS.some(c => c.code === color)) errors.push(`现有 Generator 不支持 LDraw 颜色 ${color}`)
    const target = errors.length ? null : { part, color, colorName: rules.COLORS.find(c => c.code === color).label }
    if (target) {
      const key = `${part}:${color}`
      const old = merged.get(key)
      merged.set(key, { part, color, quantity: (old?.quantity || 0) + source.quantity })
    }
    rows.push({ source, sourcePartName: p?.name || null, sourceColorName: c?.name || null,
      partCandidates, partCandidateChecks, colorCandidates, target, errors,
      evidence: { part: p, color: c } })
  }
  const valid = rows.length > 0 && rows.every(row => row.errors.length === 0)
  return { valid, rows, inventory: valid ? [...merged.values()] : [],
    issues: valid ? [] : ['全部库存必须完成明确映射；未删除失败行或替换颜色。'] }
}

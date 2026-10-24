import { selectGameInventory } from './brick-game-selection.mjs'
import { parseSession } from '../src/brick-inventory/inventory.ts'
import { validateImage } from './brick-vision.mjs'

// Input preparation only. Both paths call the existing Generator V3 afterwards.
export async function prepareDesignGeneration(body, { reviewInventory, restoreAnalysis }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('生成输入无效。')
  const input = { model: body.model, description: body.description, inventory: body.inventory, maxRepairAttempts: body.maxRepairAttempts, selectedProfileId: body.selectedProfileId, generationMode: body.generationMode }
  let source
  if (body.session !== undefined) {
    const session = parseSession(body.session)
    const review = await reviewInventory({ session })
    const rows = review.mapping.rows
    if (!rows.length || rows.some(r => !r.target || r.errors.length)) {
      const failures = rows.filter(r => !r.target || r.errors.length).map(r => r.source.part_num + ' / ' + r.source.color_id + ': ' + r.errors.join('; '))
      throw new Error('清单尚不能用于 Assembly；未丢弃或替换零件。' + failures.join(' | '))
    }
    input.inventory = selectGameInventory(review, session.items).inventory
    source = { session, reviewId: review.id, mapping: rows }
  }
  let reference
  if (body.reference !== undefined) {
    const ref = body.reference
    if (!ref || typeof ref !== 'object' || (!!ref.analysisId === !!ref.image)) throw new Error('请选择已保存分析或参考图片。')
    if (ref.analysisId) {
      if (!/^[a-f0-9-]{36}$/.test(ref.analysisId)) throw new Error('参考分析 ID 无效。')
      const saved = await restoreAnalysis(ref.analysisId)
      if (saved.analysis.status !== 'complete' || !saved.analysis.analysis) throw new Error('参考分析尚未完成。')
      reference = { ...(saved.analysis.image?.imageBase64 ? { image: validateImage(saved.analysis.image) } : {}), context: {
        analysisId: saved.analysis.id, image_reference: saved.analysis.image_reference,
        observations: saved.analysis.analysis, source: saved.analysis.source,
        savedReviewAt: saved.updatedAt, review: saved.updatedAt ? Object.fromEntries(Object.entries(saved.rows).map(([id, r]) => {
          const selected = r.index === undefined ? null : r.search?.rows[r.index]
          return [id, { features: r.features, quantity: r.quantity, excluded: r.excluded, reason: r.reason,
            confirmedPart: selected?.sourceAllowed ? selected.source : null, target: selected?.sourceAllowed ? selected.target : null }]
        })) : null,
        geometrySnapshot: saved.artifact?.geometrySnapshot || null,
        instruction: 'Visual observations are uncertain reference evidence, never validated assembly. Current inventory is authoritative; do not invent parts or hidden structure.',
      } }
    } else reference = { image: validateImage(ref.image), context: { instruction: 'Reconstruct the visible shape, colors and proportions using only the current inventory. Hidden structure remains uncertain.' } }
  }
  return { input, reference, source }
}

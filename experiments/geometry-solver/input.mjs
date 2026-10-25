// Uses the existing saved official Mapping review, never a same-ID guess or new mapping table.
export function inputFromSavedAnalysis(analysis, trace, hints = {}) {
  if (analysis.status !== 'complete' || !analysis.analysis?.observations?.length) throw new Error('Completed analysis required')
  if (trace.reference?.analysisId !== analysis.id) throw new Error('Trace is not associated with this analysis')
  const mapping = trace.inventorySource?.mapping
  if (!Array.isArray(mapping) || !Array.isArray(trace.requestInput?.inventory)) throw new Error('Saved official inventory mapping and inventory required')
  const observations = analysis.analysis.observations.map(o => {
    const review = trace.reference.review?.[o.id]
    if (!review || review.excluded || !review.confirmedPart || Number(review.quantity) !== 1) throw new Error('Each experiment observation needs one confirmed, non-excluded part: '+o.id)
    const source = review.confirmedPart
    const matches = mapping.filter(m => m.source.part_num === source.part_num && m.source.color_id === source.color_id)
    if (matches.length !== 1) throw new Error('Missing or ambiguous saved mapping: '+o.id)
    const m = matches[0], target = m.target
    if (!target || m.errors?.length || m.evidence?.part?.source !== 'rb_part_mappings'
      || !m.evidence.part.mappings?.some(r => r.ext_system === 'LD' && r.part_num === source.part_num && r.ext_id === target.part)
      || !m.partCandidateChecks?.some(c => c.part === target.part && c.eligible && c.local?.available)) throw new Error('No verified saved official mapping/local part evidence: '+o.id)
    return { id: o.id, part: target.part, color: target.color,
      evidence: { observation: o, confirmedPart: source, mapping: { source: m.evidence.part.source, records: m.evidence.part.mappings, target, reviewId: trace.inventorySource.reviewId } } }
  })
  return { observations, inventory: trace.requestInput.inventory, relations: analysis.analysis.relations || [], hints,
    provenance: { analysisId: analysis.id, traceId: trace.id, mappingSource: 'saved official rb_part_mappings review; no live DB/API query',
      note: 'Uses saved confirmed identities and authoritative mapping snapshot. Does not consume LLM design/bricks/steps.' } }
}

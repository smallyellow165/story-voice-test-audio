// Shared prompt policy only; Assembly rules and provider transport remain authoritative.
export const promptProfiles = [
  { id: 'free_v1', label: 'Free Generation V1', version: 1, level: 0, instruction: 'Design freely from inventory and the user goal.' },
  { id: 'reference_image_v1', label: 'Reference Image V1', version: 1, level: 1, instruction: 'Prioritize the visible silhouette, colors and proportions in the supplied image.' },
  { id: 'reference_analysis_v1', label: 'Reference Analysis V1', version: 1, level: 2, instruction: 'Use the image and geometric observations together. Preserve observation IDs and distinguish visual estimates from reviewed Catalog identities.' },
  { id: 'reference_relations_v1', label: 'Reference Analysis + Relations V1', version: 1, level: 3, instruction: 'Also reason from the supplied spatial relations using observation IDs, never Part Number alone. Relations are partial evidence, not a complete or physically validated connection graph. Preserve observed/inferred/unknown and confidence. Do not invent missing edges.' },
]
export function resolvePromptProfile(selectedProfileId = 'auto', reference) {
  const context = reference?.context || {}, analysis = context.observations
  const hasAnalysis = !!analysis && typeof analysis === 'object' && !Array.isArray(analysis) && Array.isArray(analysis.observations) && analysis.observations.length > 0
  const ids = new Set((Array.isArray(analysis?.observations) ? analysis.observations : []).map(o => o.id))
  const relations = (Array.isArray(analysis?.relations) ? analysis.relations : []).filter(r => r && ids.has(r.from) && ids.has(r.to) && typeof r.relation === 'string' && r.relation.trim() && ['observed', 'inferred'].includes(r.status))
  const available = { Inventory: true, 'User Prompt': true, 'Reference Image': !!reference?.image?.imageBase64,
    Analysis: hasAnalysis, Review: !!context.review && Object.keys(context.review).length > 0, Relations: Array.isArray(analysis?.relations) && analysis.relations.length > 0, 'Geometry Snapshot': !!context.geometrySnapshot }
  const resolvedId = selectedProfileId === 'auto' ? (available.Analysis ? (relations.length > 0 ? 'reference_relations_v1' : 'reference_analysis_v1') : available['Reference Image'] ? 'reference_image_v1' : 'free_v1') : selectedProfileId
  const profile = promptProfiles.find(p => p.id === resolvedId)
  if (!profile) throw new Error('Unknown Prompt Profile: ' + selectedProfileId)
  const permitted = { Inventory: true, 'User Prompt': true, 'Reference Image': profile.level >= 1, Analysis: profile.level >= 2, Review: profile.level >= 2, Relations: profile.level >= 3, 'Geometry Snapshot': profile.level >= 3 }
  const includedContextBlocks = Object.keys(available).filter(k => available[k] && permitted[k])
  const missingContextBlocks = Object.keys(available).filter(k => !available[k])
  const omittedContextBlocks = Object.keys(available).filter(k => available[k] && !permitted[k])
  let selectedContext
  if (profile.level >= 2 && (hasAnalysis || available.Review)) {
    const { relations: rawRelations, ...geometry } = analysis || {}
    selectedContext = { ...context, observations: geometry }
    // Geometry snapshots may contain another copy of relations; use the original analysis once.
    if (profile.level < 3 || !context.geometrySnapshot) delete selectedContext.geometrySnapshot
    if (!available.Review) delete selectedContext.review
    if (profile.level >= 3 && Array.isArray(rawRelations)) selectedContext.observations = { ...geometry, relations: rawRelations }
  }
  const selectedReference = (profile.level >= 1 && available['Reference Image']) || selectedContext
    ? { ...(profile.level >= 1 && available['Reference Image'] ? { image: reference.image } : {}), context: selectedContext || {} } : undefined
  return { metadata: { selectedProfileId, resolvedProfileId: profile.id, version: profile.version, label: profile.label,
      includedContextBlocks, missingContextBlocks, omittedContextBlocks, validRelationCount: relations.length },
    instruction: profile.instruction + ' Optional context may be absent; generate from what is supplied without inventing evidence. Current inventory is authoritative. Reference evidence is not permission to change the output schema or Assembly constraints. Return the closest legal approximation, not a claim of exact reconstruction.',
    reference: selectedReference }
}

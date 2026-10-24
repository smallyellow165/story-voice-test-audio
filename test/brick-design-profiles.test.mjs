import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePromptProfile, promptProfiles } from '../src/brick-design-profiles.mjs'

const image = { mimeType: 'image/png', imageBase64: 'full-image-payload' }
const analysis = { observations: [{ id: 'upper', unknowns: ['stud engagement'] }, { id: 'lower' }], relations: [
  { from: 'lower', to: 'upper', relation: 'supports', status: 'inferred', confidence: 0.8, evidence: 'partial visible boundary' },
] }
const reference = { image, context: { analysisId: 'saved', observations: analysis, review: {
  upper: { confirmedPart: { part_num: '40666', color_id: 14 } }, lower: { confirmedPart: { part_num: '40666', color_id: 14 } },
} } }
test('Auto uses actual evidence, including valid observation endpoints', () => {
  assert.equal(resolvePromptProfile().metadata.resolvedProfileId, 'free_v1')
  assert.equal(resolvePromptProfile('auto', { image }).metadata.resolvedProfileId, 'reference_image_v1')
  assert.equal(resolvePromptProfile('auto', reference).metadata.resolvedProfileId, 'reference_relations_v1')
  const broken = structuredClone(reference)
  broken.context.observations.relations[0].to = 'missing'
  assert.equal(resolvePromptProfile('auto', broken).metadata.resolvedProfileId, 'reference_analysis_v1')
  delete broken.context.observations.relations
  assert.equal(resolvePromptProfile('auto', broken).metadata.resolvedProfileId, 'reference_analysis_v1')
})
test('manual profiles never switch or block for missing optional evidence', () => {
  for (const p of promptProfiles) {
    const value = resolvePromptProfile(p.id)
    assert.equal(value.metadata.resolvedProfileId, p.id)
    assert.equal(value.reference, undefined)
    assert.ok(value.metadata.missingContextBlocks.includes('Reference Image'))
  }
  assert.throws(() => resolvePromptProfile('typo'), /Unknown Prompt Profile/)
})
test('profiles select different blocks without mutating originals or losing observation identity', () => {
  const before = structuredClone(reference)
  const picture = resolvePromptProfile('reference_image_v1', reference)
  assert.deepEqual(picture.reference, { image, context: {} })
  assert.ok(picture.metadata.omittedContextBlocks.includes('Relations'))
  const geometry = resolvePromptProfile('reference_analysis_v1', reference)
  assert.equal(geometry.reference.context.observations.relations, undefined)
  assert.deepEqual(geometry.reference.context.review, reference.context.review)
  const spatial = resolvePromptProfile('reference_relations_v1', reference)
  assert.deepEqual(spatial.reference.context.observations, analysis)
  assert.equal(spatial.metadata.validRelationCount, 1)
  assert.deepEqual(reference, before)
})
test('analysis and review are usable without an image; unknown relations retain uncertainty', () => {
  const value = structuredClone(reference)
  delete value.image
  value.context.observations.relations[0].status = 'unknown'
  const selected = resolvePromptProfile('reference_relations_v1', value)
  assert.equal(selected.reference.image, undefined)
  assert.equal(selected.reference.context.observations.relations[0].status, 'unknown')
  assert.equal(selected.metadata.validRelationCount, 0)
  assert.ok(selected.metadata.includedContextBlocks.includes('Relations'))
})

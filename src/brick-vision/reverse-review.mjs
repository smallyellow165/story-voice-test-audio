import { featureEditor } from './catalog-features.mjs'
// Project only known horizontal dimensions into the existing 2D Catalog filter.
// Height, visual color and evidence remain in the original observation, never validated by this projection.
export function reverseFeatureEditor(observation) {
  const editor = featureEditor(observation)
  const width = observation.dimensions?.width_studs?.value
  const depth = observation.dimensions?.depth_studs?.value
  if (!editor.size && Number.isSafeInteger(width) && width > 0 && width < 100
    && Number.isSafeInteger(depth) && depth > 0 && depth < 100) editor.size = width + 'x' + depth
  return editor
}

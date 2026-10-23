import { featureEditor } from './catalog-features.mjs'
// Copy known dimensions into an independent human-review draft.
// Only width/depth project to the existing Catalog size filter; height is never validated by that query.
export function reverseFeatureEditor(observation) {
  const editor = featureEditor(observation)
  const width = observation.dimensions?.width_studs?.value
  const depth = observation.dimensions?.depth_studs?.value
  if (!editor.size && Number.isSafeInteger(width) && width > 0 && width < 100
    && Number.isSafeInteger(depth) && depth > 0 && depth < 100) editor.size = width + 'x' + depth
  if (observation.dimensions) {
    for (const key of ['width_studs', 'depth_studs', 'height_brick_units']) {
      const dimension = observation.dimensions[key]
      editor[key] = dimension?.status !== 'unknown' && dimension?.value != null ? String(dimension.value) : ''
    }
    editor.size = editor.width_studs && editor.depth_studs ? editor.width_studs + 'x' + editor.depth_studs : ''
  }
  return editor
}

import { featureEditor } from './catalog-features.mjs'
// Resolve explicit body-color names against the existing Catalog palette.
// No RGB guessing, LDraw color IDs, or separate hard-coded color dictionary.
export function geometryColorId(description, colors = []) {
  if (typeof description !== 'string') return null
  const normalize = value => value.trim().toLowerCase().replace(/\s+/g, ' ')
  const text = normalize(description).replace(/[.!]$/, '')
  const match = name => {
    const ids = [...new Set(colors.filter(c => Number.isSafeInteger(c.id) && c.id >= 0 && normalize(c.name) === name).map(c => c.id))]
    return ids.length === 1 ? ids[0] : null
  }
  const exact = match(text)
  if (exact !== null) return exact
  const pieces = text.split(/,\s*(?:with\s+)?|\s+with\s+/)
  if (pieces.length > 2) return null
  if (pieces.length === 2) {
    const lighting = pieces[1]
    const explicitLighting = /\b(shaded|shadow|shadowed|reflection|reflective|highlight|highlights)\b/.test(lighting)
    const darkSurface = /\b(darker|dark)\b/.test(lighting) && /\b(face|side|surface)\b/.test(lighting)
      && !colors.some(c => (' ' + lighting.replace(/[^a-z ]/g, ' ') + ' ').includes(' ' + normalize(c.name) + ' '))
    if (!(explicitLighting || darkSurface)
      || /\b(or|and|possibly|maybe|uncertain|print|printed|pattern|stripe|stripes|body|base|studs)\b/.test(lighting)) return null
  }
  const body = pieces[0]
  const canonical = match(body)
  if (canonical !== null) return canonical
  // A brightness adjective is not a new hue. Prefer an exact Catalog name
  // first so names such as Bright Light Yellow never collapse to Yellow.
  return body.startsWith('bright ') ? match(body.slice(7)) : null
}

// Initialize a new independent review; never apply this to a saved review.
export function reverseFeatureEditor(observation, colors = []) {
  const editor = featureEditor(observation)
  if (observation.dimensions && observation.color_id == null) {
    const color = geometryColorId(observation.color, colors)
    if (color !== null) editor.color = String(color)
  }
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

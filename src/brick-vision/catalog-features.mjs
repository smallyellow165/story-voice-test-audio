// Parameter contract for the existing /brick-catalog/candidates API.
// No candidate matching, identity inference or Evidence parsing lives here.
export const catalogShapes = ['brick', 'curved_top', 'arch', 'slope']
export const catalogPrints = ['yes', 'no', 'unknown']
export const visionFeatureProperties = {
  color_id: { type: 'INTEGER', nullable: true },
  size: { type: 'STRING', nullable: true },
  shape: { type: 'STRING', enum: catalogShapes, nullable: true },
  print: { type: 'STRING', enum: catalogPrints },
}

export function validateCatalogFeatures(value) {
  if (!value || !(value.color_id === null || (Number.isSafeInteger(value.color_id) && value.color_id >= 0))
    || !(value.size === null || (typeof value.size === 'string' && /^[1-9]\d?[x×][1-9]\d?$/.test(value.size)))
    || !(value.shape === null || catalogShapes.includes(value.shape))
    || !catalogPrints.includes(value.print)) throw new Error('结构化特征无效：颜色须为 RB Color ID/null，尺寸为整体尺寸/null，形状须为 Catalog 枚举/null，印花为 yes/no/unknown。')
  return value
}

export function catalogFeatureParams(features) {
  validateCatalogFeatures(features)
  const params = {}
  if (features.color_id !== null) params.color = String(features.color_id)
  if (features.size !== null) params.size = features.size
  if (features.shape !== null) params.shape = features.shape
  if (features.print !== 'unknown') params.printed = features.print
  return params
}

export function featureEditor(observation) {
  // Missing fields remain empty. Never derive them from old IDs or Evidence.
  return { color: observation.color_id == null ? '' : String(observation.color_id),
    size: observation.size ?? '', shape: observation.shape ?? '', print: observation.print ?? 'unknown' }
}

export function readFeatureEditor(editor) {
  const color = editor.color.trim()
  if (color && !/^\d+$/.test(color)) throw new Error('特征颜色请输入非负整数 RB Color ID，未知请留空。')
  const features = { color_id: color ? Number(color) : null, size: editor.size.trim() || null,
    shape: editor.shape || null, print: editor.print }
  return validateCatalogFeatures(features)
}

export function createObservationDraft(observation) {
  return { id: observation.id, selected: false, part: '', color: '', quantity: String(observation.quantity),
    features: featureEditor(observation), confirmation: null }
}

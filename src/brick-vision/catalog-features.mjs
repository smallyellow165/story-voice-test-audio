// Parameter contract for the existing /brick-catalog/candidates API.
// No candidate matching, identity inference or Evidence parsing lives here.
export const catalogShapes = ['brick', 'curved_top', 'arch', 'slope']
export const catalogPrints = ['yes', 'no', 'unknown']

// A submitted snapshot, independent of subsequent edits and pagination.
export function catalogSearchParams({ search = '', category = '', color = '', size = '', shape = '', printed = 'unknown', requireLdraw = false, axes = {} }) {
  const params = { search: search.trim(), category, color, shape, printed, require_ldraw: String(requireLdraw),
    ...(size.trim() ? { size: size.trim() } : Object.fromEntries(['width', 'depth', 'height'].filter(k => axes[k]).map(k => [k, axes[k]]))) }
  return Object.fromEntries(Object.entries(params).filter(([key, value]) => value !== '' && !(key === 'printed' && value === 'unknown')))
}
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
  validateCatalogQuery(features)
  const params = {}
  if (features.color_id !== null) params.color = String(features.color_id)
  if (features.size !== null) params.size = features.size
  if (features.shape !== null) params.shape = features.shape
  if (features.print !== 'unknown') params.printed = features.print
  for (const [field, param] of [['width_studs', 'width'], ['depth_studs', 'depth'], ['height_brick_units', 'height']])
    if (features[field] != null) params[param] = String(features[field])
  return params
}

export function featureEditor(observation) {
  // Missing fields remain empty. Never derive them from old IDs or Evidence.
  return { color: observation.color_id == null ? '' : String(observation.color_id),
    size: observation.size ?? '', width_studs: observation.width_studs != null ? String(observation.width_studs) : observation.size?.split(/[x×]/)[0] ?? '', depth_studs: observation.depth_studs != null ? String(observation.depth_studs) : observation.size?.split(/[x×]/)[1] ?? '', height_brick_units: observation.height_brick_units != null ? String(observation.height_brick_units) : '', partNumber: '', shape: observation.shape ?? '', print: observation.print ?? 'unknown' }
}

export function readFeatureEditor(editor) {
  validateReviewDimensions(editor)
  const color = editor.color.trim()
  if (color && !/^\d+$/.test(color)) throw new Error('特征颜色请输入非负整数 RB Color ID，未知请留空。')
  const features = { color_id: color ? Number(color) : null, size: editor.size.trim() || null,
    shape: editor.shape || null, print: editor.print }
  const keys = ['width_studs', 'depth_studs', 'height_brick_units']
  const known = Object.fromEntries(keys.filter(key => editor[key]?.trim()).map(key => [key, Number(editor[key])]))
  const useGeometry = known.height_brick_units != null || Boolean(editor.width_studs) !== Boolean(editor.depth_studs)
    || [known.width_studs, known.depth_studs].some(n => n != null && !Number.isInteger(n))
  if (!useGeometry && known.width_studs != null && known.depth_studs != null) features.size = known.width_studs + 'x' + known.depth_studs
  return validateCatalogQuery(useGeometry ? { ...features, size: null, ...known } : features)
}

export function createObservationDraft(observation) {
  return { id: observation.id, selected: false, part: '', color: '', quantity: String(observation.quantity),
    features: featureEditor(observation), confirmation: null }
}

// Review dimensions are independent of the immutable Vision observation.
export function editDimension(editor, key, value) {
  const next = { ...editor, [key]: value }
  next.size = next.width_studs && next.depth_studs ? next.width_studs + 'x' + next.depth_studs : ''
  return next
}
export function validateReviewDimensions(editor) {
  if (editor.partNumber != null && (typeof editor.partNumber !== 'string' || editor.partNumber.length > 100))
    throw new Error('Part Number 草稿格式无效。')
  for (const key of ['width_studs', 'depth_studs', 'height_brick_units']) {
    const value = editor[key]
    if (value != null && value !== '' && (typeof value !== 'string' || !Number.isFinite(Number(value)) || Number(value) <= 0))
      throw new Error('尺寸须为正数（可含小数），Unknown 请留空。')
  }
}

// Search-only extension. The Vision response schema remains unchanged.
export function validateCatalogQuery(value) {
  validateCatalogFeatures(value)
  let axes = false
  for (const key of ['width_studs', 'depth_studs', 'height_brick_units']) {
    if (value[key] == null) continue
    axes = true
    if (!Number.isFinite(value[key]) || value[key] <= 0 || value[key] > 100) throw new Error('Catalog 尺寸必须大于 0 且不超过 100。')
  }
  if (axes && value.size !== null) throw new Error('请勿混用 Size 与独立三维查询字段。')
  return value
}

// Build a fresh form snapshot; never inherit fields from a previous search.
export function observationCatalogFields(features) {
  const params = catalogFeatureParams(features)
  const dimensions = [params.width, params.depth, params.height]
  const size = params.size || (dimensions.every(Boolean) ? dimensions.join('×')
    : params.width && params.depth && !params.height ? params.width + '×' + params.depth : '')
  return { search: '', category: '', color: params.color || '', size,
    shape: params.shape || '', printed: params.printed || 'unknown', requireLdraw: false,
    axes: size ? {} : Object.fromEntries(['width', 'depth', 'height'].filter(k => params[k]).map(k => [k, params[k]])) }
}

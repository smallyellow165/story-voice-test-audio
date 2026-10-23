export type CatalogFeatures = {
  color_id: number | null; size: string | null
  shape: 'brick' | 'curved_top' | 'arch' | 'slope' | null
  print: 'yes' | 'no' | 'unknown'
}
export type FeatureEditor = { color: string; size: string; shape: string; print: string; width_studs?: string; depth_studs?: string; height_brick_units?: string; partNumber?: string }
export const catalogShapes: readonly NonNullable<CatalogFeatures['shape']>[]
export const catalogPrints: readonly CatalogFeatures['print'][]
export const visionFeatureProperties: Record<string, unknown>
export function validateCatalogFeatures(value: unknown): CatalogFeatures
export function catalogFeatureParams(features: CatalogFeatures): Record<string, string>
export function featureEditor(observation: Partial<CatalogFeatures>): FeatureEditor
export function readFeatureEditor(editor: FeatureEditor): CatalogFeatures
export function createObservationDraft(observation: Partial<CatalogFeatures> & { id: string; quantity: number }): {
  id: string; selected: boolean; part: string; color: string; quantity: string
  features: FeatureEditor; confirmation: null
}

export function editDimension(editor: FeatureEditor, key: 'width_studs' | 'depth_studs' | 'height_brick_units', value: string): FeatureEditor
export function validateReviewDimensions(editor: FeatureEditor): void

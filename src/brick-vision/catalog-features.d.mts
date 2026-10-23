export type CatalogFeatures = {
  color_id: number | null; size: string | null
  shape: 'brick' | 'curved_top' | 'arch' | 'slope' | null
  print: 'yes' | 'no' | 'unknown'
}
export type CatalogQuery = CatalogFeatures & { width_studs?: number; depth_studs?: number; height_brick_units?: number }
export type FeatureEditor = { color: string; size: string; shape: string; print: string; width_studs?: string; depth_studs?: string; height_brick_units?: string; partNumber?: string }
export const catalogShapes: readonly NonNullable<CatalogFeatures['shape']>[]
export const catalogPrints: readonly CatalogFeatures['print'][]
export const visionFeatureProperties: Record<string, unknown>
export function validateCatalogFeatures(value: unknown): CatalogFeatures
export function catalogFeatureParams(features: CatalogQuery): Record<string, string>
export function catalogSearchParams(fields: { search?: string; category?: string; color?: string; size?: string; shape?: string; printed?: string; requireLdraw?: boolean; axes?: Record<string, string> }): Record<string, string>
export function featureEditor(observation: Partial<CatalogQuery>): FeatureEditor
export function readFeatureEditor(editor: FeatureEditor): CatalogQuery
export function createObservationDraft(observation: Partial<CatalogFeatures> & { id: string; quantity: number }): {
  id: string; selected: boolean; part: string; color: string; quantity: string
  features: FeatureEditor; confirmation: null
}

export function editDimension(editor: FeatureEditor, key: 'width_studs' | 'depth_studs' | 'height_brick_units', value: string): FeatureEditor
export function validateReviewDimensions(editor: FeatureEditor): void

export function validateCatalogQuery(value: unknown): CatalogQuery

export type CatalogSearchFields = { search: string; category: string; color: string; size: string; shape: string; printed: string; requireLdraw: boolean; axes: Record<string, string> }
export function observationCatalogFields(features: CatalogQuery): CatalogSearchFields

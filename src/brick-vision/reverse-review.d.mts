import type { CatalogFeatures, FeatureEditor } from './catalog-features.mjs'
export type CatalogReviewColor = { id: number; name: string }
export function geometryColorId(description: unknown, colors?: readonly CatalogReviewColor[]): number | null
export function reverseFeatureEditor(observation: Partial<CatalogFeatures> & { color?: string; dimensions?: { width_studs: { value: number | null; status?: string }; height_brick_units?: { value: number | null; status?: string }; depth_studs: { value: number | null; status?: string } } }, colors?: readonly CatalogReviewColor[]): FeatureEditor

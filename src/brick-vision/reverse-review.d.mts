import type { CatalogFeatures, FeatureEditor } from './catalog-features.mjs'
export function reverseFeatureEditor(observation: Partial<CatalogFeatures> & { dimensions?: { width_studs: { value: number | null; status?: string }; height_brick_units?: { value: number | null; status?: string }; depth_studs: { value: number | null; status?: string } } }): FeatureEditor

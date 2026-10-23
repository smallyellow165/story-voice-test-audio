import type { CatalogFeatures, FeatureEditor } from './catalog-features.mjs'
export function reverseFeatureEditor(observation: Partial<CatalogFeatures> & { dimensions?: { width_studs: { value: number | null }; depth_studs: { value: number | null } } }): FeatureEditor

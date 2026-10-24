export type ExplorerStrategy = 'loose' | 'geometry_only' | 'catalog_match'
export type SceneImageSelection = { source: 'server_library' | 'upload'; name: string }
export type ExplorerScene = { strategy?: ExplorerStrategy; imageSource?: SceneImageSelection['source']; image?: string; analysisId?: string; provider?: string; model?: string; warnings: string[] }
export type SceneLink = { strategy: ExplorerStrategy; imageSource?: SceneImageSelection['source']; image?: string; analysisId?: string; provider?: string; model?: string }
export function parseExplorerScene(href: string): ExplorerScene
export function resolveSceneHistory(scene: ExplorerScene, loose: readonly { id: string }[], assembled: readonly { id: string; analysis_mode?: string }[]): { strategy: ExplorerStrategy; analysisId?: string; warning: string }
export function selectSceneModel(models: readonly { id: string; provider: string }[], fallback: string, scene?: Pick<ExplorerScene, 'provider' | 'model'>): { id: string; warning: string }
export function buildExplorerSceneLink(href: string, scene: SceneLink): string

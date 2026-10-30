import { workModeNames } from './studio-terms.ts'
import { validate, vertices } from './geometry.ts'
import type { Assembly, Profile, Tile, WorkMode } from './geometry.ts'
// V1 always means Connected Construction. No guessing from the current graph.
export const workMode = (a: Assembly): WorkMode => a.schemaVersion === 1 ? 'connected-construction' : a.mode
export function checkArtwork(a: Assembly, profiles: readonly Profile[]) {
  const geometry = validate(a.instances, profiles), mode = workMode(a)
  return { geometry, mode, ready: a.instances.length > 0 && geometry.draftValid && (mode === 'flat-mosaic' || geometry.valid) }
}
export const modeLabel = (mode: WorkMode) => workModeNames[mode]
export function componentPlacement(tile: Tile, previous: Tile[], profiles: readonly Profile[]) {
  if (!previous.length) return '先放好第一块，位置见画布。'
  const center = (t: Tile) => { const vs = vertices(t, profiles); return [vs.reduce((s,v)=>s+v[0],0)/vs.length, vs.reduce((s,v)=>s+v[1],0)/vs.length] }
  const c = center(tile), near = [...previous].sort((a,b)=>Math.hypot(...center(a).map((v,i)=>v-c[i]))-Math.hypot(...center(b).map((v,i)=>v-c[i])) || a.id.localeCompare(b.id))[0]
  const n = center(near), dx=c[0]-n[0], dy=c[1]-n[1]
  const direction=(Math.abs(dx)>.15?(dx>0?'右':'左'):'')+(Math.abs(dy)>.15?(dy>0?'上':'下'):'')
  return `在第 ${previous.findIndex(t=>t.id===near.id)+1} 块的${direction || '附近'}${direction?'方':''}独立放置，按画布轮廓保持位置；这里没有磁吸连接。`
}

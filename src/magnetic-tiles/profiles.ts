import data from './profiles.json' with { type: 'json' }
import { profileIssues } from './geometry.ts'
import type { Profile } from './geometry.ts'
export const profiles = data.profiles as Profile[]
if (data.schemaVersion !== 1 || profiles.some(p => profileIssues(p).length)) throw Error('磁力片 Profile 数据无效')

// Derived presentation/recognition facts; vertices remain the only size definition.
export function profileSpec(p: Profile) {
  return { ...p, edges: p.vertices.map((a, i) => {
    const b = p.vertices[(i + 1) % p.vertices.length], id = `e${i}`
    return { id, from: i, to: (i + 1) % p.vertices.length, length: Math.hypot(b[0]-a[0], b[1]-a[1]), connectable: p.connectableEdges.includes(id) }
  }) }
}
export const profileKey = (p: Profile) => `${p.id}@${p.version}`
if (!profiles.length || new Set(profiles.map(profileKey)).size !== profiles.length || profiles.some(p => p.id === 'unknown')) throw Error('磁力片 Catalog 身份重复、为空或使用保留 ID')
export const profileSizeLabel = (p: Profile) => '边长 ' + profileSpec(p).edges.map(e => Number(e.length.toFixed(6))).join(' / ')
export function profileViewBox(p: Profile) {
  const xs=p.vertices.map(v=>v[0]), ys=p.vertices.map(v=>-v[1])
  return `${Math.min(...xs)-.15} ${Math.min(...ys)-.15} ${Math.max(...xs)-Math.min(...xs)+.3} ${Math.max(...ys)-Math.min(...ys)+.3}`
}

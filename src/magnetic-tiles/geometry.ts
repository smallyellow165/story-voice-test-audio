// Planar, zero-thickness geometry only. This is not a contract for future 3D joints.
export type Vec = [number, number]
export type Profile = { id: string; version: number; name: string; vertices: Vec[]; connectableEdges: string[] }
export type Pose = { x: number; y: number; angleRad: number }
export type Tile = { id: string; profileId: string; profileVersion: number; color: string; pose: Pose }
export type WorkMode = 'connected-construction' | 'flat-mosaic'
export type Assembly = { id: string; revision: number; name: string; instances: Tile[] } & ({ schemaVersion: 1; mode?: never } | { schemaVersion: 2; mode: WorkMode })
export type Edge = { tileId: string; id: string; a: Vec; b: Vec; length: number; enabled: boolean }
export type Connection = { a: { tileId: string; edgeId: string }; b: { tileId: string; edgeId: string } }
export type Issue = { code: string; message: string; tileIds: string[] }
export type Report = { draftValid: boolean; valid: boolean; issues: Issue[]; connections: Connection[]; components: string[][] }
// Geometry tolerance in relative world units. Never use pointer/screen tolerance here.
export const EPS = 1e-7
export const MAX_TILES = 100
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const point = (p: unknown): p is Vec => Array.isArray(p) && p.length === 2 && p.every(n => finite(n) && Math.abs(n) <= 100)
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0]
export const distance = (a: Vec, b: Vec) => Math.hypot(...sub(a, b))
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
export function profileIssues(p: Profile): string[] {
  if (!p || !/^[a-z][a-z0-9-]*$/.test(p.id) || !Number.isSafeInteger(p.version) || p.version < 1
    || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.vertices) || p.vertices.length < 3 || p.vertices.length > 16
    || !p.vertices.every(point) || !Array.isArray(p.connectableEdges)) return ['Profile 结构无效']
  const v = p.vertices, errors: string[] = []
  // All other vertices must lie strictly left of every directed edge. This also
  // rejects self-intersecting stars, repeated vertices and collinear corners.
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length], length = distance(a, b)
    if (length < 1e-4 || v.some((q, j) => j !== i && j !== (i + 1) % v.length && cross(sub(b, a), sub(q, a)) / length <= EPS)) {
      errors.push('顶点必须组成逆时针严格凸多边形'); break
    }
  }
  if (new Set(p.connectableEdges).size !== p.connectableEdges.length || p.connectableEdges.some(e => !v.some((_, i) => e === `e${i}`))) errors.push('可连接边引用无效或重复')
  return errors
}
export function profileFor(tile: Tile, profiles: readonly Profile[]) {
  return profiles.find(p => p.id === tile.profileId && p.version === tile.profileVersion)
}
export function transform(v: Vec, pose: Pose): Vec {
  const c = Math.cos(pose.angleRad), s = Math.sin(pose.angleRad)
  return [v[0] * c - v[1] * s + pose.x, v[0] * s + v[1] * c + pose.y]
}
export function vertices(tile: Tile, profiles: readonly Profile[]): Vec[] {
  const p = profileFor(tile, profiles)
  if (!p) throw Error('找不到指定版本的 Profile')
  return p.vertices.map(v => transform(v, tile.pose))
}
export function edges(tile: Tile, profiles: readonly Profile[]): Edge[] {
  const p = profileFor(tile, profiles)!, v = vertices(tile, profiles)
  return v.map((a, i) => ({ tileId: tile.id, id: `e${i}`, a, b: v[(i + 1) % v.length], length: distance(a, v[(i + 1) % v.length]), enabled: p.connectableEdges.includes(`e${i}`) }))
}
export function overlaps(a: Vec[], b: Vec[]) {
  // SAT distinguishes positive interior overlap from boundary contact.
  const bounds = (v: Vec[], axis: Vec) => { const d = v.map(p => dot(p, axis)); return [Math.min(...d), Math.max(...d)] }
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const d = sub(poly[(i + 1) % poly.length], poly[i]), l = Math.hypot(...d), axis: Vec = [-d[1] / l, d[0] / l]
    const x = bounds(a, axis), y = bounds(b, axis)
    if (Math.min(x[1], y[1]) - Math.max(x[0], y[0]) <= EPS) return false
  }
  return true
}
export const matched = (a: Edge, b: Edge) => Math.abs(a.length - b.length) <= EPS && distance(a.a, b.b) <= EPS && distance(a.b, b.a) <= EPS
function partialContact(a: Edge, b: Edge) {
  const d = sub(a.b, a.a), axis: Vec = [d[0] / a.length, d[1] / a.length]
  if (Math.abs(cross(axis, sub(b.a, a.a))) > EPS || Math.abs(cross(axis, sub(b.b, a.a))) > EPS) return false
  const x = dot(sub(b.a, a.a), axis), y = dot(sub(b.b, a.a), axis)
  return Math.min(a.length, Math.max(x, y)) - Math.max(0, Math.min(x, y)) > EPS
}
export function validate(instances: readonly Tile[], profiles: readonly Profile[]): Report {
  const issues: Issue[] = [], connections: Connection[] = []
  const fail = (code: string, message: string, tileIds: string[] = []) => issues.push({ code, message, tileIds })
  const keys = new Set<string>()
  for (const p of profiles) {
    const k = `${p.id}@${p.version}`
    if (keys.has(k)) fail('PROFILE', 'Profile 身份重复')
    keys.add(k)
    for (const message of profileIssues(p)) fail('PROFILE', message)
  }
  if (!Array.isArray(instances) || instances.length > MAX_TILES) return { draftValid: false, valid: false, issues: [{ code: 'INPUT', message: `最多 ${MAX_TILES} 块`, tileIds: [] }], connections, components: [] }
  const ids = new Set<string>()
  for (const t of instances) {
    if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 100 || ids.has(t.id)) { fail('IDENTITY', '实例 ID 缺失或重复'); continue }
    ids.add(t.id)
    if (!profileFor(t, profiles)) fail('PROFILE', '缺少指定版本的 Profile', [t.id])
    if (!t.pose || ![t.pose.x, t.pose.y, t.pose.angleRad].every(finite) || Math.abs(t.pose.x) > 1000 || Math.abs(t.pose.y) > 1000 || Math.abs(t.pose.angleRad) > Math.PI * 2) fail('POSE', '位姿无效或超出范围', [t.id])
    if (typeof t.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(t.color)) fail('COLOR', '颜色必须为六位十六进制', [t.id])
    if (Object.keys(t).some(k => !['id', 'profileId', 'profileVersion', 'color', 'pose'].includes(k)) || (t.pose && Object.keys(t.pose).some(k => !['x', 'y', 'angleRad'].includes(k)))) fail('INPUT', '实例不允许缩放或未定义字段', [t.id])
  }
  if (issues.length) return { draftValid: false, valid: false, issues, connections, components: [] }
  const polygons = instances.map(t => vertices(t, profiles)), allEdges = instances.map(t => edges(t, profiles)), occupied = new Set<string>()
  for (let i = 0; i < instances.length; i++) for (let j = i + 1; j < instances.length; j++) {
    const pair = [instances[i].id, instances[j].id]
    if (overlaps(polygons[i], polygons[j])) fail('OVERLAP', '零件内部重叠', pair)
    for (const a of allEdges[i]) for (const b of allEdges[j]) {
      if (a.enabled && b.enabled && matched(a, b)) {
        for (const e of [a, b]) {
          const k = JSON.stringify([e.tileId, e.id])
          if (occupied.has(k)) fail('EDGE_OCCUPIED', '一条边被重复占用', pair)
          occupied.add(k)
        }
        connections.push({ a: { tileId: a.tileId, edgeId: a.id }, b: { tileId: b.tileId, edgeId: b.id } })
      } else if (partialContact(a, b)) fail('EDGE_CONTACT', '边接触必须是可连接的等长整边；不支持部分边拼接', pair)
    }
  }
  const graph = new Map(instances.map(t => [t.id, new Set<string>()]))
  for (const c of connections) { graph.get(c.a.tileId)!.add(c.b.tileId); graph.get(c.b.tileId)!.add(c.a.tileId) }
  const unseen = new Set(ids), components: string[][] = []
  while (unseen.size) {
    const queue = [unseen.values().next().value!], component: string[] = []; unseen.delete(queue[0])
    for (const id of queue) { component.push(id); for (const next of graph.get(id)!) if (unseen.delete(next)) queue.push(next) }
    components.push(component.sort())
  }
  const draftValid = issues.length === 0
  if (!instances.length) fail('EMPTY', '还没有磁力片')
  else if (components.length > 1) fail('DISCONNECTED', `${components.length} 个未连接组件；可以保存草稿`)
  return { draftValid, valid: draftValid && instances.length > 0 && components.length === 1, issues, connections, components }
}
export function alignEdge(tile: Tile, own: Edge, target: Edge, profiles: readonly Profile[]): Tile {
  const p = profileFor(tile, profiles)!, index = Number(own.id.slice(1)), a = p.vertices[index], b = p.vertices[(index + 1) % p.vertices.length]
  const d = sub(target.a, target.b), v = sub(b, a), angleRad = wrapAngle(Math.atan2(d[1], d[0]) - Math.atan2(v[1], v[0]))
  const rotated = transform(a, { x: 0, y: 0, angleRad })
  return { ...tile, pose: { x: target.b[0] - rotated[0], y: target.b[1] - rotated[1], angleRad } }
}
export type Snap = { tile: Tile; key: string; target: Edge; own: Edge; score: number; contactCount: number }
const midpoint = (edge: Edge): Vec => [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2]
const SNAP_ANGLE = Math.PI / 4
export function findSnap(tile: Tile, others: readonly Tile[], profiles: readonly Profile[], captureDistance: number, previousKey?: string): Snap | null {
  // UX capture thresholds never participate in validate(). Rotation is measured
  // separately: endpoint displacement otherwise silently reduces the angle limit
  // as the canvas is zoomed in (even when the two edge centres coincide).
  if (!Number.isFinite(captureDistance) || captureDistance <= 0) return null
  const candidates: Snap[] = []
  const targets = others.flatMap(other => edges(other, profiles).filter(e => e.enabled))
  for (const own of edges(tile, profiles).filter(e => e.enabled)) for (const target of targets) {
    if (Math.abs(own.length - target.length) > EPS) continue
    const key = JSON.stringify([own.id, target.tileId, target.id]), retained = key === previousKey
    const delta = Math.abs(wrapAngle(Math.atan2(target.a[1] - target.b[1], target.a[0] - target.b[0]) - Math.atan2(own.b[1] - own.a[1], own.b[0] - own.a[0])))
    if (delta > SNAP_ANGLE * (retained ? 1.2 : 1) + EPS) continue
    const separation = distance(midpoint(own), midpoint(target))
    // Cap the screen radius relative to edge length at extreme zoom-out, so a
    // whole neighbouring tile cannot become a magnetic capture zone.
    const radius = Math.min(captureDistance, own.length * .3)
    if (separation > radius * (retained ? 1.4 : 1)) continue
    const aligned = alignEdge(tile, own, target, profiles)
    const report = validate([...others, aligned], profiles)
    if (!report.draftValid) continue
    const contactCount = report.connections.filter(c => c.a.tileId === tile.id || c.b.tileId === tile.id).length
    candidates.push({ tile: aligned, target, own, key, contactCount,
      score: separation / radius + .35 * delta / SNAP_ANGLE })
  }
  if (!candidates.length) return null
  const bestScore = Math.min(...candidates.map(c => c.score))
  // Prefer a genuinely closing placement only among similarly close candidates.
  // Use a fixed shortlist rather than a non-transitive approximate comparator.
  const close = candidates.filter(c => c.score <= bestScore + .1)
  close.sort((a, b) => b.contactCount - a.contactCount || a.score - b.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const best = close[0], previous = candidates.find(c => c.key === previousKey)
  // Keep small pointer noise from toggling previews, but allow a materially
  // closer candidate (or a similarly close multi-edge closure) to take over.
  if (previous && previous.score <= bestScore + .2 && previous.contactCount >= best.contactCount) return previous
  return best
}
export function rotateTile(tile: Tile, delta: number, profiles: readonly Profile[]): Tile {
  const v = profileFor(tile, profiles)!.vertices, center: Vec = [v.reduce((s, p) => s + p[0], 0) / v.length, v.reduce((s, p) => s + p[1], 0) / v.length]
  const before = transform(center, tile.pose), angleRad = wrapAngle(tile.pose.angleRad + delta), after = transform(center, { x: 0, y: 0, angleRad })
  return { ...tile, pose: { x: before[0] - after[0], y: before[1] - after[1], angleRad } }
}

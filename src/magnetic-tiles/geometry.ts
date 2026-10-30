import type { Parameters } from './parametric-profile.ts'
// Planar, zero-thickness geometry only. This is not a contract for future 3D joints.
export type Vec = [number, number]
export type Profile = { id: string; version: number; name: string; vertices: Vec[]; connectableEdges: string[]; parametric?: Parameters; geometrySource?: string; sizeEvidence?: { status: 'estimated'; source: string } }
// Reflect local X before rotating. Missing mirrored means false for every historical pose.
export type Pose = { x: number; y: number; angleRad: number; mirrored?: boolean }
export type Tile = { id: string; profileId: string; profileVersion: number; color: string; pose: Pose }
export type WorkMode = 'connected-construction' | 'flat-mosaic'
export type Assembly = { id: string; revision: number; name: string; instances: Tile[] } & ({ schemaVersion: 1; mode?: never } | { schemaVersion: 2; mode: WorkMode })
export type Edge = { tileId: string; id: string; a: Vec; b: Vec; length: number; enabled: boolean }
export type EdgeContact = { aRange: Vec; bRange: Vec; start: Vec; end: Vec; length: number }
export type Connection = { a: { tileId: string; edgeId: string }; b: { tileId: string; edgeId: string }; contact?: EdgeContact }
export const connectionModel = 'segmented-edge-v1' as const
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
  const c = Math.cos(pose.angleRad), s = Math.sin(pose.angleRad), x=pose.mirrored?-v[0]:v[0]
  return [x * c - v[1] * s + pose.x, x * s + v[1] * c + pose.y]
}
export function vertices(tile: Tile, profiles: readonly Profile[]): Vec[] {
  const p = profileFor(tile, profiles)
  if (!p) throw Error('找不到指定版本的 Profile')
  return p.vertices.map(v => transform(v, tile.pose))
}
export function edges(tile: Tile, profiles: readonly Profile[]): Edge[] {
  const p = profileFor(tile, profiles)!, v = vertices(tile, profiles)
  // Edge IDs retain the original local vertex pair. Reverse direction on reflection
  // so the polygon interior remains on the left; matched() still requires opposed ends.
  return v.map((v0, i) => {const v1=v[(i+1)%v.length],a=tile.pose.mirrored?v1:v0,b=tile.pose.mirrored?v0:v1;return { tileId: tile.id, id: `e${i}`, a, b, length: distance(a,b), enabled: p.connectableEdges.includes(`e${i}`) }})
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
// Ranges are normalized along each canonical directed edge; endpoints are world coordinates.
// Canonical edges keep interiors to the left, including mirrored tiles.
export function edgeContact(a:Edge,b:Edge):EdgeContact|null {
 const u=sub(a.b,a.a).map(x=>x/a.length) as Vec,v=sub(b.b,b.a).map(x=>x/b.length) as Vec
 if([b.a,b.b].some(p=>Math.abs(cross(u,sub(p,a.a)))>EPS)||[a.a,a.b].some(p=>Math.abs(cross(v,sub(p,b.a)))>EPS))return null
 const x=dot(sub(b.a,a.a),u),y=dot(sub(b.b,a.a),u),lo=Math.max(0,Math.min(x,y)),hi=Math.min(a.length,Math.max(x,y))
 if(hi-lo<=EPS)return null
 const start:Vec=[a.a[0]+u[0]*lo,a.a[1]+u[1]*lo],end:Vec=[a.a[0]+u[0]*hi,a.a[1]+u[1]*hi]
 const ba=dot(sub(start,b.a),v)/b.length,bb=dot(sub(end,b.a),v)/b.length
 return {aRange:[lo/a.length,hi/a.length],bRange:[Math.max(0,Math.min(ba,bb)),Math.min(1,Math.max(ba,bb))],start,end,length:hi-lo}
}
export const opposingEdges=(a:Edge,b:Edge)=>dot(sub(a.b,a.a),sub(b.b,b.a))<0
export function connectionSegment(c:Connection,tiles:readonly Tile[],profiles:readonly Profile[]):EdgeContact{
 const a=edges(tiles.find(t=>t.id===c.a.tileId)!,profiles).find(e=>e.id===c.a.edgeId)!,b=edges(tiles.find(t=>t.id===c.b.tileId)!,profiles).find(e=>e.id===c.b.edgeId)!
 return edgeContact(a,b)!
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
    if(t.pose&&'mirrored' in t.pose&&typeof t.pose.mirrored!=='boolean')fail('POSE', 'mirrored 必须是布尔值', [t.id])
    if (typeof t.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(t.color)) fail('COLOR', '颜色必须为六位十六进制', [t.id])
    if (Object.keys(t).some(k => !['id', 'profileId', 'profileVersion', 'color', 'pose'].includes(k)) || (t.pose && Object.keys(t.pose).some(k => !['x', 'y', 'angleRad', 'mirrored'].includes(k)))) fail('INPUT', '实例不允许缩放或未定义字段', [t.id])
  }
  if (issues.length) return { draftValid: false, valid: false, issues, connections, components: [] }
  const polygons = instances.map(t => vertices(t, profiles)), allEdges = instances.map(t => edges(t, profiles)), occupied = new Map<string,Vec[]>()
  for (let i = 0; i < instances.length; i++) for (let j = i + 1; j < instances.length; j++) {
    const pair = [instances[i].id, instances[j].id]
    if (overlaps(polygons[i], polygons[j])) fail('OVERLAP', '零件内部重叠', pair)
    for (const a of allEdges[i]) for (const b of allEdges[j]) {
      const contact=edgeContact(a,b)
      if(!contact)continue
      if (a.enabled && b.enabled && opposingEdges(a,b)) {
        for (const [e,range] of [[a,contact.aRange],[b,contact.bRange]] as const) {
          const k=JSON.stringify([e.tileId,e.id]),interval:Vec=[range[0]*e.length,range[1]*e.length],prior=occupied.get(k)??[]
          if(prior.some(p=>Math.min(p[1],interval[1])-Math.max(p[0],interval[0])>EPS))fail('EDGE_OCCUPIED','同一边上的连接区间被重复占用',pair)
          occupied.set(k,[...prior,interval])
        }
        // Preserve historical full-edge Connection shape; partial contacts carry explicit intervals.
        connections.push({a:{tileId:a.tileId,edgeId:a.id},b:{tileId:b.tileId,edgeId:b.id},...(!matched(a,b)?{contact}:{})})
      } else fail('EDGE_CONTACT','正长度边接触必须启用连接边，且两块内部位于接触线的相反侧',pair)
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
  const p = profileFor(tile, profiles)!, index = Number(own.id.slice(1)), a = p.vertices[tile.pose.mirrored?(index+1)%p.vertices.length:index], b = p.vertices[tile.pose.mirrored?index:(index+1)%p.vertices.length]
  const d = sub(target.a, target.b), v = sub([tile.pose.mirrored?-b[0]:b[0],b[1]], [tile.pose.mirrored?-a[0]:a[0],a[1]]), angleRad = wrapAngle(Math.atan2(d[1], d[0]) - Math.atan2(v[1], v[0]))
  const rotated = transform(a, { ...tile.pose, x: 0, y: 0, angleRad })
  return { ...tile, pose: { ...tile.pose, x: target.b[0] - rotated[0], y: target.b[1] - rotated[1], angleRad } }
}
// own.a maps to target.a + offset * targetUnit; own.b points backwards.
export function alignEdgeAt(tile:Tile,own:Edge,target:Edge,offset:number,profiles:readonly Profile[]):Tile{
 const aligned=alignEdge(tile,own,target,profiles),u=sub(target.b,target.a).map(x=>x/target.length) as Vec,shift=offset-target.length
 return {...aligned,pose:{...aligned.pose,x:aligned.pose.x+u[0]*shift,y:aligned.pose.y+u[1]*shift}}
}
export function segmentAlignments(tile:Tile,own:Edge,target:Edge,profiles:readonly Profile[],reference:Vec[]=vertices(tile,profiles),hints:Vec[]=[]):{tile:Tile;offset:number;contact:EdgeContact}[]{
 if(!own.enabled||!target.enabled)return []
 const base=alignEdge(tile,own,target,profiles),u=sub(target.b,target.a).map(x=>x/target.length) as Vec,center=(v:Vec[]):Vec=>[v.reduce((n,p)=>n+p[0],0)/v.length,v.reduce((n,p)=>n+p[1],0)/v.length]
 const ideal=target.length+dot(sub(center(reference),center(vertices(base,profiles))),u)
 const offsets=[target.length,own.length,(target.length+own.length)/2,ideal]
 for(const p of hints){const delta=sub(p,target.a),t=dot(delta,u);if(Math.abs(cross(u,delta))<=EPS&&t>=-EPS&&t<=target.length+EPS)offsets.push(t,t+own.length)}
 const unique=new Set<string>(),out=[]
 for(const offset of offsets){const k=offset.toFixed(9);if(unique.has(k)||offset<=EPS||offset>=target.length+own.length-EPS)continue;unique.add(k)
  const placed=alignEdgeAt(tile,own,target,offset,profiles),contact=edgeContact(edges(placed,profiles).find(e=>e.id===own.id)!,target)
  if(contact)out.push({tile:placed,offset,contact})
 }
 return out
}
export type Snap = { tile: Tile; key: string; target: Edge; own: Edge; score: number; contactCount: number;contactLength:number;coverageCount:number }
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
    const baseKey = JSON.stringify([own.id, target.tileId, target.id]), retained = previousKey?.startsWith(baseKey)??false
    const delta = Math.abs(wrapAngle(Math.atan2(target.a[1] - target.b[1], target.a[0] - target.b[0]) - Math.atan2(own.b[1] - own.a[1], own.b[0] - own.a[0])))
    if (delta > SNAP_ANGLE * (retained ? 1.2 : 1) + EPS) continue
    const radius = Math.min(captureDistance,Math.min(own.length,target.length)*.3)
    for(const proposal of segmentAlignments(tile,own,target,profiles,vertices(tile,profiles),others.flatMap(t=>vertices(t,profiles)))){
      const aligned=proposal.tile,alignedOwn=edges(aligned,profiles).find(e=>e.id===own.id)!,separation=distance(midpoint(own),midpoint(alignedOwn)),key=baseKey+':'+proposal.offset.toFixed(7)
      if(separation>radius*(retained?1.4:1))continue
      const report=validate([...others,aligned],profiles)
      if(!report.draftValid)continue
      const contactCount=report.connections.filter(c=>c.a.tileId===tile.id||c.b.tileId===tile.id).length
      const contactLength=report.connections.filter(c=>c.a.tileId===tile.id||c.b.tileId===tile.id).reduce((n,c)=>n+connectionSegment(c,[...others,aligned],profiles).length,0)
      const coverageCount=report.connections.filter(c=>c.a.tileId===tile.id||c.b.tileId===tile.id).filter(c=>{const a=edges([...others,aligned].find(t=>t.id===c.a.tileId)!,profiles).find(e=>e.id===c.a.edgeId)!,b=edges([...others,aligned].find(t=>t.id===c.b.tileId)!,profiles).find(e=>e.id===c.b.edgeId)!;return Math.abs(connectionSegment(c,[...others,aligned],profiles).length-Math.min(a.length,b.length))<=EPS}).length
      candidates.push({tile:aligned,target,own,key,contactCount,contactLength,coverageCount,score:separation/radius+.35*delta/SNAP_ANGLE})
    }
  }
  if (!candidates.length) return null
  const bestScore = Math.min(...candidates.map(c => c.score))
  // Prefer closing/full-coverage placements within a small UX score band.
  // This retains full-edge capture under pointer noise while allowing intentional slides.
  // Use a fixed shortlist rather than a non-transitive approximate comparator.
  const close = candidates.filter(c => c.score <= bestScore + .35 + EPS)
  close.sort((a, b) => b.coverageCount-a.coverageCount || b.contactCount - a.contactCount || (Math.abs(b.contactLength-a.contactLength)>EPS?b.contactLength-a.contactLength:0) || a.score - b.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const best = close[0], previous = candidates.find(c => c.key === previousKey)
  // Keep small pointer noise from toggling previews, but allow a materially
  // closer candidate (or a similarly close multi-edge closure) to take over.
  if (previous && previous.score <= bestScore + .2 && previous.contactCount >= best.contactCount && previous.coverageCount>=best.coverageCount) return previous
  return best
}
export function rotateTile(tile: Tile, delta: number, profiles: readonly Profile[]): Tile {
  const v = profileFor(tile, profiles)!.vertices, center: Vec = [v.reduce((s, p) => s + p[0], 0) / v.length, v.reduce((s, p) => s + p[1], 0) / v.length]
  const before = transform(center, tile.pose), angleRad = wrapAngle(tile.pose.angleRad + delta), after = transform(center, { ...tile.pose, x: 0, y: 0, angleRad })
  return { ...tile, pose: { ...tile.pose, x: before[0] - after[0], y: before[1] - after[1], angleRad } }
}

// Flip around the tile centroid, independently of world rotation or translation.
export function mirrorTile(tile:Tile,profiles:readonly Profile[]):Tile{
 const local=profileFor(tile,profiles)!.vertices,center:Vec=[local.reduce((n,v)=>n+v[0],0)/local.length,local.reduce((n,v)=>n+v[1],0)/local.length],before=transform(center,tile.pose),pose={...tile.pose,mirrored:!tile.pose.mirrored},after=transform(center,pose)
 return {...tile,pose:{...pose,x:pose.x+before[0]-after[0],y:pose.y+before[1]-after[1]}}
}
// Avoid duplicate reflection domains only when both footprint AND enabled edges
// can be represented by an existing rigid rotation of the same Profile.
export function mirrorVariants(p:Profile):boolean[]{
 const base:Tile={id:'symmetry',profileId:p.id,profileVersion:p.version,color:'#000000',pose:{x:0,y:0,angleRad:0}},catalog=[p],target=vertices({...base,pose:{...base.pose,mirrored:true}},catalog),source=vertices(base,catalog),length=distance(source[0],source[1])
 for(let j=0;j<target.length;j++)for(const direction of [-1,1]){
  const a=target[j],b=target[(j+direction+target.length)%target.length];if(Math.abs(distance(a,b)-length)>EPS)continue
  const angleRad=wrapAngle(Math.atan2(b[1]-a[1],b[0]-a[0])-Math.atan2(source[1][1]-source[0][1],source[1][0]-source[0][0])),origin=transform(source[0],{x:0,y:0,angleRad}),tile={...base,pose:{x:a[0]-origin[0],y:a[1]-origin[1],angleRad}},vs=vertices(tile,catalog)
  if(vs.every(v=>target.some(q=>distance(v,q)<=EPS))&&edges(tile,catalog).every(e=>edges({...base,pose:{...base.pose,mirrored:true}},catalog).some(q=>q.enabled===e.enabled&&((distance(e.a,q.a)<=EPS&&distance(e.b,q.b)<=EPS)||(distance(e.a,q.b)<=EPS&&distance(e.b,q.a)<=EPS)))))return [false]
 }
 return [false,true]
}

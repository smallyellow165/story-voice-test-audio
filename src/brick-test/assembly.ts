import { PARTS } from './catalog.ts'
import type { Brick } from './catalog.ts'
import { STUD_LDU, BODY_LDU, geometryIssues, validPosition } from './part-geometry.ts'
import type { PartDefinition, Point3, Box3, Connector } from './part-geometry.ts'

export type Cell = { x: number; z: number }
export type Connection = { lowerId: string; upperId: string; points: Cell[] }
export type Validation = {
  valid: boolean
  code: 'VALID' | 'INPUT' | 'PART' | 'GRID' | 'ROTATION' | 'DUPLICATE_ID' | 'COLLISION' | 'UNSUPPORTED' | 'DISCONNECTED'
  reason: string; brickIds: string[]; connections: Connection[]
}
export type Candidate = { key: string; brick: Brick; contactCount: number }
const invalid = (code: Validation['code'], reason: string, brickIds: string[] = []): Validation => ({ valid: false, code, reason, brickIds, connections: [] })
const EPS = 1e-7
const equal = (a: number, b: number) => Math.abs(a - b) < EPS
function rotate(p: Point3, angle: number): Point3 {
  switch (angle) {
    case 0: return { ...p }
    case 90: return { x: p.z, y: p.y, z: -p.x }
    case 180: return { x: -p.x, y: p.y, z: -p.z }
    case 270: return { x: -p.z, y: p.y, z: p.x }
    default: throw new Error('不支持的旋转')
  }
}
function world(p: Point3, b: Brick): Point3 {
  const r = rotate(p, b.rotation)
  return { x: r.x + Math.round(b.x * STUD_LDU), y: r.y + Math.round(b.layer * BODY_LDU), z: r.z + Math.round(b.z * STUD_LDU) }
}
function overlaps(a: Box3, b: Box3) {
  return a.min.x < b.max.x - EPS && a.max.x > b.min.x + EPS
    && a.min.y < b.max.y - EPS && a.max.y > b.min.y + EPS
    && a.min.z < b.max.z - EPS && a.max.z > b.min.z + EPS
}

// One geometry algorithm; default application and tests bind different reviewed data.
export function createAssemblyRules(definitions: readonly PartDefinition[]) {
  const profiles = new Map(definitions.map(p => [p.id, p.geometry]))
  if (profiles.size !== definitions.length) throw new Error('Duplicate part geometry ID')
  const faults = new Map(definitions.map(p => [p.id, geometryIssues(p.geometry)]))
  function checkBrick(brick: Brick): Validation | null {
    if (!brick || typeof brick !== 'object' || typeof brick.id !== 'string' || !brick.id.trim()) return invalid('INPUT', '积木需要非空字符串 ID')
    const g = profiles.get(brick.part)
    if (!g || faults.get(brick.part)!.length) return invalid('PART', '缺少可用几何/连接描述：' + brick.part, [brick.id])
    if (!g.rotations.includes(brick.rotation)) return invalid('ROTATION', '该零件不支持此旋转', [brick.id])
    if (!validPosition(brick)) return invalid('GRID', 'X/Z 必须位于半凸点网格；底部高度必须为非负整数 LDU（layer × 48）', [brick.id])
    return null
  }
  function dimensions(part: string, rotation: number) {
    const g = profiles.get(part)
    if (!g || !g.rotations.includes(rotation)) throw new Error('未知几何或旋转')
    const p = rotate(g.bodySizeLdu, rotation)
    return { width: Math.abs(p.x) / STUD_LDU, depth: Math.abs(p.z) / STUD_LDU }
  }
  function connectors(brick: Brick, face: 'top' | 'bottom'): Connector[] {
    const error = checkBrick(brick)
    if (error) throw new Error(error.reason)
    return profiles.get(brick.part)![face].map(p => ({ ...p, ...world(p, brick) }))
  }
  function collisionBoxes(brick: Brick): Box3[] {
    return profiles.get(brick.part)!.collision.boxes.map(box => {
      // Quarter turns preserve axis-aligned boxes. Opposite corners suffice.
      const a = world(box.min, brick), b = world(box.max, brick)
      return { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
        max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) } }
    })
  }
  // Kept as the shared support-count interface. These are bottom connector cells,
  // NOT body occupancy. Existing rectangular profiles yield the same cells as V1.
  function footprint(brick: Brick): Cell[] {
    return connectors(brick, 'bottom').map(p => ({ x: p.x / STUD_LDU - 0.5, z: p.z / STUD_LDU - 0.5 }))
  }
  function validateAssembly(bricks: readonly Brick[]): Validation {
    if (!Array.isArray(bricks)) return invalid('INPUT', '组合必须为积木数组')
    const ids = new Set<string>()
    for (const b of bricks) {
      const error = checkBrick(b)
      if (error) return error
      if (ids.has(b.id)) return invalid('DUPLICATE_ID', '重复积木 ID：' + b.id, [b.id])
      ids.add(b.id)
    }
    const boxes = bricks.map(collisionBoxes)
    for (let i = 0; i < bricks.length; i++) for (let j = i + 1; j < bricks.length; j++) {
      if (boxes[i].some(a => boxes[j].some(b => overlaps(a, b))))
        return invalid('COLLISION', '砖体碰撞包络冲突：' + bricks[i].id + ' / ' + bricks[j].id, [bricks[i].id, bricks[j].id])
    }
    const tops = bricks.map(b => connectors(b, 'top'))
    const bottoms = bricks.map(b => connectors(b, 'bottom'))
    const mates = (t: Connector, p: Connector) => t.type === p.type && t.direction === 'up' && p.direction === 'down'
      && equal(t.x, p.x) && equal(t.y, p.y) && equal(t.z, p.z)
      && p.radiusLdu >= t.radiusLdu && p.depthLdu >= t.depthLdu
    const studBox = (t: Connector): Box3 => ({ min: { x: t.x - t.radiusLdu, y: t.y, z: t.z - t.radiusLdu },
      max: { x: t.x + t.radiusLdu, y: t.y + t.depthLdu, z: t.z + t.radiusLdu } })
    // Do not let an unmatched stud penetrate a body just because nominal boxes touch.
    // Only an explicitly compatible bottom socket exempts its mating stud volume.
    for (let i = 0; i < bricks.length; i++) for (let j = i + 1; j < bricks.length; j++) {
      for (const [lower, other] of [[i, j], [j, i]]) for (const t of tops[lower]) {
        if (boxes[other].some(b => overlaps(studBox(t), b)) && !bottoms[other].some(p => mates(t, p)))
          return invalid('COLLISION', '凸点包络与未配对的实体相交', [bricks[lower].id, bricks[other].id])
      }
      if (tops[i].some(a => tops[j].some(b => overlaps(studBox(a), studBox(b)))))
        return invalid('COLLISION', '凸点碰撞包络相交', [bricks[i].id, bricks[j].id])
    }
    const connections: Connection[] = []
    const graph = new Map(bricks.map(b => [b.id, new Set<string>()]))
    for (const upper of bricks) {
      if (equal(upper.layer, 0)) continue
      const bottom = connectors(upper, 'bottom'), supported = new Set<number>()
      for (const [i, lower] of bricks.entries()) {
        if (lower.id === upper.id) continue
        const points: Cell[] = []
        for (const [j, p] of bottom.entries()) if (tops[i].some(t => mates(t, p))) {
          if (supported.has(j)) return invalid('COLLISION', '同一底部接口不能由两个零件占用', [upper.id, lower.id])
          supported.add(j); points.push({ x: p.x / STUD_LDU, z: p.z / STUD_LDU })
        }
        if (points.length) {
          connections.push({ lowerId: lower.id, upperId: upper.id, points })
          graph.get(lower.id)!.add(upper.id); graph.get(upper.id)!.add(lower.id)
        }
      }
      if (!supported.size) return invalid('UNSUPPORTED', '积木 ' + upper.id + ' 没有方向、类型与位置吻合的底部连接', [upper.id])
    }
    if (bricks.length) {
      const seen = new Set<string>(), queue = [bricks[0].id]
      for (let i = 0; i < queue.length; i++) {
        if (seen.has(queue[i])) continue
        seen.add(queue[i]); graph.get(queue[i])!.forEach(id => { if (!seen.has(id)) queue.push(id) })
      }
      if (seen.size !== bricks.length) return invalid('DISCONNECTED', '存在未连接积木；地面或侧面接触不算连接', bricks.filter(b => !seen.has(b.id)).map(b => b.id))
    }
    const count = connections.reduce((n, c) => n + c.points.length, 0)
    return { valid: true, code: 'VALID', reason: '几何连接合法 · ' + count + ' 个接合点；保守碰撞包络，未评估物理稳定性', brickIds: [], connections }
  }
  function validatePlacement(bricks: readonly Brick[], brick: Brick) { return Array.isArray(bricks) ? validateAssembly([...bricks, brick]) : invalid('INPUT', '组合必须为积木数组') }
  function connectionCandidates(bricks: readonly Brick[], draft: Brick): Candidate[] {
    if (!validateAssembly(bricks).valid || checkBrick(draft) || bricks.some(b => b.id === draft.id)) return []
    const origin = { ...draft, x: 0, z: 0, layer: 0 }
    if (!bricks.length) return [{ key: '0,0,0', brick: origin, contactCount: 0 }]
    const offsets = connectors(origin, 'bottom'), translations = new Map<string, Brick>()
    for (const lower of bricks) for (const top of connectors(lower, 'top')) for (const bottom of offsets) {
      if (top.type !== bottom.type) continue
      const x = (top.x - bottom.x) / STUD_LDU, z = (top.z - bottom.z) / STUD_LDU, layer = (top.y - bottom.y) / BODY_LDU
      const brick = { ...draft, x, z, layer }
      if (checkBrick(brick)) continue
      translations.set([x, z, layer].join(','), brick)
    }
    const result: Candidate[] = []
    for (const [key, brick] of translations) {
      const report = validatePlacement(bricks, brick)
      if (!report.valid) continue
      const contactCount = report.connections.filter(c => c.upperId === brick.id).reduce((n, c) => n + c.points.length, 0)
      if (contactCount) result.push({ key, brick, contactCount })
    }
    return result.sort((a, b) => b.contactCount - a.contactCount || a.brick.layer - b.brick.layer || a.brick.x - b.brick.x || a.brick.z - b.brick.z)
  }
  return { dimensions, footprint, connectors, validateAssembly, validatePlacement, connectionCandidates }
}
export const { dimensions, footprint, connectors, validateAssembly, validatePlacement, connectionCandidates } = createAssemblyRules(PARTS)

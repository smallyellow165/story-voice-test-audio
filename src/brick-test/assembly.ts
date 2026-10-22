import { PARTS } from './catalog.ts'
import type { Brick } from './catalog.ts'

// Pure product geometry. No DOM, Three.js, randomness, network or mutable state.
export type Cell = { x: number; z: number }
export type Connection = { lowerId: string; upperId: string; points: Cell[] }
export type Validation = {
  valid: boolean
  code: 'VALID' | 'INPUT' | 'PART' | 'GRID' | 'ROTATION' | 'DUPLICATE_ID' | 'COLLISION' | 'UNSUPPORTED' | 'DISCONNECTED'
  reason: string
  brickIds: string[]
  connections: Connection[]
}
export type Candidate = { key: string; brick: Brick; contactCount: number }
const invalid = (code: Validation['code'], reason: string, brickIds: string[] = []): Validation => ({ valid: false, code, reason, brickIds, connections: [] })
const cellKey = (x: number, z: number, layer: number) => `${x},${z},${layer}`

export function dimensions(part: string, rotation: number): { width: number; depth: number } {
  const definition = PARTS.find((item) => item.id === part)
  if (!definition) throw new Error(`不支持型号 ${part}`)
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('仅支持 0/90/180/270° 旋转')
  return rotation % 180 === 0 ? { width: definition.length, depth: definition.depth } : { width: definition.depth, depth: definition.length }
}

function checkBrick(brick: Brick): Validation | null {
  if (!brick || typeof brick !== 'object' || typeof brick.id !== 'string' || !brick.id.trim()) return invalid('INPUT', '积木需要非空字符串 ID')
  if (!PARTS.some((item) => item.id === brick.part)) return invalid('PART', `不支持型号 ${brick.part}`, [brick.id])
  if (![0, 90, 180, 270].includes(brick.rotation)) return invalid('ROTATION', '仅支持正放与 0/90/180/270° 旋转', [brick.id])
  // All supported footprints have even dimensions. Integral centers align
  // their half-integral stud positions; half-stud offsets do NOT connect.
  if (![brick.x, brick.z, brick.layer].every((value) => Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000) || brick.layer < 0) {
    return invalid('GRID', 'X/Z 与层高必须为整数网格坐标，层高不能小于 0（坐标绝对值上限 1000000）', [brick.id])
  }
  return null
}

// A cell is one stud pitch of nominal body occupancy. Its connector is at
// (x + .5, z + .5); bottom interfaces and top studs share the same XZ footprint.
export function footprint(brick: Brick): Cell[] {
  const error = checkBrick(brick)
  if (error) throw new Error(error.reason)
  const { width, depth } = dimensions(brick.part, brick.rotation)
  const cells: Cell[] = []
  for (let x = brick.x - width / 2; x < brick.x + width / 2; x++) {
    for (let z = brick.z - depth / 2; z < brick.z + depth / 2; z++) cells.push({ x, z })
  }
  return cells
}

function occupancy(bricks: readonly Brick[]) {
  const occupied = new Map<string, string>()
  for (const brick of bricks) for (const cell of footprint(brick)) occupied.set(cellKey(cell.x, cell.z, brick.layer), brick.id)
  return occupied
}

export function validateAssembly(bricks: readonly Brick[]): Validation {
  if (!Array.isArray(bricks)) return invalid('INPUT', '组合必须为积木数组')
  const ids = new Set<string>()
  const occupied = new Map<string, string>()
  const cells = new Map<string, Cell[]>()
  for (const brick of bricks) {
    const error = checkBrick(brick)
    if (error) return error
    if (ids.has(brick.id)) return invalid('DUPLICATE_ID', `重复积木 ID：${brick.id}`, [brick.id])
    ids.add(brick.id)
    const footprintCells = footprint(brick)
    cells.set(brick.id, footprintCells)
    for (const cell of footprintCells) {
      const key = cellKey(cell.x, cell.z, brick.layer)
      const other = occupied.get(key)
      if (other !== undefined) return invalid('COLLISION', `砖体占位冲突：${other} 与 ${brick.id}（层 ${brick.layer}）`, [other, brick.id])
      occupied.set(key, brick.id)
    }
  }
  const connections: Connection[] = []
  const graph = new Map(bricks.map((brick) => [brick.id, new Set<string>()]))
  for (const brick of bricks) {
    if (brick.layer === 0) continue
    const supports = new Map<string, Cell[]>()
    for (const cell of cells.get(brick.id)!) {
      const lowerId = occupied.get(cellKey(cell.x, cell.z, brick.layer - 1))
      if (lowerId === undefined) continue
      const points = supports.get(lowerId) || []
      points.push({ x: cell.x + 0.5, z: cell.z + 0.5 })
      supports.set(lowerId, points)
    }
    if (!supports.size) return invalid('UNSUPPORTED', `积木 ${brick.id} 没有与下方相邻层对齐的接合点`, [brick.id])
    for (const [lowerId, points] of supports) {
      connections.push({ lowerId, upperId: brick.id, points })
      graph.get(lowerId)!.add(brick.id)
      graph.get(brick.id)!.add(lowerId)
    }
  }
  // One connected assembly, not several unrelated piles sharing the floor.
  if (bricks.length) {
    const seen = new Set<string>()
    const queue = [bricks[0].id]
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      if (seen.has(id)) continue
      seen.add(id)
      graph.get(id)!.forEach((neighbor) => { if (!seen.has(neighbor)) queue.push(neighbor) })
    }
    if (seen.size !== bricks.length) return invalid('DISCONNECTED', '存在未连接的独立积木；地面或侧面接触不算积木连接', bricks.filter((brick) => !seen.has(brick.id)).map((brick) => brick.id))
  }
  const count = connections.reduce((sum, connection) => sum + connection.points.length, 0)
  return { valid: true, code: 'VALID', reason: bricks.length ? `几何连接合法 · ${count} 个接合点；未评估物理稳定性` : '空场景，可放置第一块地面积木', brickIds: [], connections }
}

export function validatePlacement(bricks: readonly Brick[], brick: Brick): Validation {
  if (!Array.isArray(bricks)) return invalid('INPUT', '组合必须为积木数组')
  return validateAssembly([...bricks, brick])
}

// Enumerate every upward attachment for the chosen orientation. Align each
// bottom connector with each exposed top connector, deduplicate translations,
// reject occupied body cells. No viewport truncation occurs in the core.
export function connectionCandidates(bricks: readonly Brick[], draft: Brick): Candidate[] {
  if (!validateAssembly(bricks).valid || checkBrick(draft) || bricks.some((brick) => brick.id === draft.id)) return []
  const origin = { ...draft, x: 0, z: 0, layer: 0 }
  if (!bricks.length) return [{ key: '0,0,0', brick: origin, contactCount: 0 }]
  const occupied = occupancy(bricks)
  const offsets = footprint(origin)
  const translations = new Map<string, Brick>()
  for (const lower of bricks) {
    const layer = lower.layer + 1
    for (const top of footprint(lower)) {
      if (occupied.has(cellKey(top.x, top.z, layer))) continue
      for (const bottom of offsets) {
        const x = top.x - bottom.x
        const z = top.z - bottom.z
        if (Math.abs(x) > 1_000_000 || Math.abs(z) > 1_000_000 || layer > 1_000_000) continue
        const key = cellKey(x, z, layer)
        if (!translations.has(key)) translations.set(key, { ...draft, x, z, layer })
      }
    }
  }
  const candidates: Candidate[] = []
  for (const [key, brick] of translations) {
    const cells = footprint(brick)
    if (cells.some((cell) => occupied.has(cellKey(cell.x, cell.z, brick.layer)))) continue
    const contactCount = cells.filter((cell) => occupied.has(cellKey(cell.x, cell.z, brick.layer - 1))).length
    if (contactCount) candidates.push({ key, brick, contactCount })
  }
  return candidates.sort((a, b) => b.contactCount - a.contactCount || a.brick.layer - b.brick.layer || a.brick.x - b.brick.x || a.brick.z - b.brick.z)
}

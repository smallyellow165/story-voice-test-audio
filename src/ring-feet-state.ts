import { pointInPolygon, type Point } from './ring-feet-geometry.ts'

export type FootRing = { id: string; polygon: Point[] }
export type FootRingState = {
  ringId: string | null
  status: 'IN' | 'OUT' | 'UNKNOWN' | 'AMBIGUOUS'
  matchingRingIds: string[]
  point: Point | null
}

export function usableRing(ring: FootRing): boolean {
  const p = ring.polygon
  return p.length >= 3 && p.every(v => v.length === 2 && v.every(Number.isFinite))
    && Math.abs(p.reduce((sum, a, i) => {
      const b = p[(i + 1) % p.length]!
      return sum + a[0] * b[1] - b[0] * a[1]
    }, 0)) > 0
}

// All points/polygons use the same camera raster. No target or game rule.
export function locateFoot(point: Point | null, rings: readonly FootRing[] | null): FootRingState {
  const valid = rings?.filter(usableRing) ?? []
  const base = { ringId: null, matchingRingIds: [], point }
  if (!point || !point.every(Number.isFinite) || !rings || (rings.length > 0 && valid.length === 0)) {
    return { ...base, status: 'UNKNOWN' }
  }
  const matchingRingIds = valid.filter(r => pointInPolygon(point, r.polygon)).map(r => r.id)
  if (matchingRingIds.length > 1) return { ...base, matchingRingIds, status: 'AMBIGUOUS' }
  if (matchingRingIds.length === 1) return { ...base, matchingRingIds, ringId: matchingRingIds[0]!, status: 'IN' }
  // An unlocalized ring prevents claiming that the foot is outside every ring.
  return { ...base, status: valid.length === rings.length ? 'OUT' : 'UNKNOWN' }
}

export function locateFeet(left: Point | null, right: Point | null, rings: readonly FootRing[] | null) {
  const leftFoot = locateFoot(left, rings), rightFoot = locateFoot(right, rings)
  return { leftFootRingId: leftFoot.ringId, rightFootRingId: rightFoot.ringId, leftFoot, rightFoot }
}

import { toPixels, bboxPixels, type Point as NormalizedPoint, type Bbox } from './ring-llm-coordinates.ts'
import type { Point } from './ring-feet-geometry.ts'

export type RingStrategy = 'gemini' | 'opencv'
export type DisplayRing = {
  id: string
  polygon: Point[]
  bbox?: ReturnType<typeof bboxPixels>
  center?: NormalizedPoint
  color?: string
  confidence?: number
  explanation?: string
}
export type RingDetectionResult = {
  strategy: RingStrategy
  width: number
  height: number
  rings: DisplayRing[]
  active: DisplayRing | null
  rawJson: string
  source: unknown
  model?: string
  candidateCount: number
}
type GeminiRing = {
  id: string; center: NormalizedPoint; bbox: Bbox; polygon: NormalizedPoint[]
  colorGuess: string; confidence: number; explanation: string
}
export type GeminiRings = { rings: GeminiRing[]; model: string; rawJson: string }
export type LegacyRing = { detected: boolean; width: number; height: number; polygon: Point[]; color?: string; candidate_count: number }

const area = (polygon: Point[]) => Math.abs(polygon.reduce((sum, p, i) => {
  const next = polygon[(i + 1) % polygon.length]!
  return sum + p[0] * next[1] - next[0] * p[1]
}, 0)) / 2

export function adaptGeminiRings(data: GeminiRings, width: number, height: number): RingDetectionResult {
  const rings = data.rings.map(r => ({
    id: r.id,
    polygon: r.polygon.map(p => { const pixel = toPixels(p, width, height); return [pixel.x, pixel.y] as Point }),
    bbox: bboxPixels(r.bbox, width, height), center: toPixels(r.center, width, height),
    color: r.colorGuess, confidence: r.confidence, explanation: r.explanation,
  }))
  // Display all rings; the unchanged single-ring game uses the largest supplied
  // inner polygon. Never manufacture a gameplay polygon from a bounding box.
  const active = rings.filter(r => r.polygon.length >= 3 && area(r.polygon) > 0)
    .reduce<DisplayRing | null>((best, r) => !best || area(r.polygon) > area(best.polygon) ? r : best, null)
  return { strategy: 'gemini', width, height, rings, active, rawJson: data.rawJson,
    source: data, model: data.model, candidateCount: rings.length }
}

export function adaptLegacyRing(data: LegacyRing, width: number, height: number): RingDetectionResult {
  if (data.width !== width || data.height !== height) throw new Error('返回坐标尺寸不一致')
  if (data.detected && (!Array.isArray(data.polygon) || data.polygon.length < 3
    || data.polygon.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))) {
    throw new Error('返回的 polygon 无效')
  }
  const active = data.detected ? { id: 'opencv-ring', polygon: data.polygon, color: data.color } : null
  return { strategy: 'opencv', width, height, rings: active ? [active] : [], active,
    rawJson: JSON.stringify(data, null, 2), source: data, candidateCount: data.candidate_count }
}

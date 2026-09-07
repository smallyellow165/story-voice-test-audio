/** Coordinates refer to the entire uploaded raster, including any UI in it.
 * CSS scales image and overlays together because both are in one canvas.
 * DPR must not be applied to normalized coordinates a second time.
 */
export type Point = { x: number; y: number }
export type Bbox = { xMin: number; yMin: number; xMax: number; yMax: number }
export function toPixels(p: Point, width: number, height: number): Point {
  return { x: p.x * width, y: p.y * height }
}
export function bboxPixels(b: Bbox, width: number, height: number) {
  const p = toPixels({ x: b.xMin, y: b.yMin }, width, height)
  return { ...p, width: (b.xMax - b.xMin) * width, height: (b.yMax - b.yMin) * height }
}
export function fromClient(client: Point, rect: { left: number; top: number; width: number; height: number }): Point {
  return { x: (client.x - rect.left) / rect.width, y: (client.y - rect.top) / rect.height }
}

import { afterEach, describe, expect, it } from 'vitest'
import { Vector3, OrthographicCamera } from 'three'
import { parseAssembly3D, serializeAssembly3D } from '../../src/magnetic-tiles/three-d/assembly.ts'
import { validateAssembly3D } from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import { adaptProfile } from '../../src/magnetic-tiles/three-d/profile-adapter.ts'
import { createViewerModel, componentCount } from '../../src/magnetic-tiles/three-d/viewer-model.ts'
import { createFrameGeometry, createCenterGeometry, disposeMagnet3DCaches, disposeShapeResources } from '../../src/magnetic-tiles/three-d/vendor/components/magnet3d/primitives.tsx'
import { computeFitCamera, applyFitResult, pieceWorldVertices } from '../../src/magnetic-tiles/three-d/vendor/components/magnet3d/cameraUtils.ts'
import rightAngle from '../../src/magnetic-tiles/three-d/examples/right-angle.json' with { type: 'json' }
import cube from '../../src/magnetic-tiles/three-d/examples/closed-cube.json' with { type: 'json' }
import mixed from '../../src/magnetic-tiles/three-d/examples/mixed-profiles.json' with { type: 'json' }

afterEach(() => disposeMagnet3DCaches())
describe('snapshot-driven viewer', () => {
  for (const example of [rightAngle, cube, mixed]) it(`loads validated real ${example.id} geometry and preserves every pose`, () => {
    const a = parseAssembly3D(JSON.stringify(example)), before = serializeAssembly3D(a)
    expect(validateAssembly3D(a).valid).toBe(true)
    const items = createViewerModel(a)
    for (const item of items) {
      expect(item.transform.position.toArray()).toEqual(item.piece.pose.position)
      expect(item.transform.quaternion.toArray()).toEqual(item.piece.pose.quaternion)
      expect(item.color).toBe(item.piece.color)
      expect(item.shape.id).toBe(`${item.piece.profileId}@${item.piece.profileVersion}`)
    }
    expect(serializeAssembly3D(a)).toBe(before)
    expect(serializeAssembly3D(parseAssembly3D(before))).toBe(before)
    if (a.id === 'closed-cube') { expect(a.pieces).toHaveLength(6); expect(a.connections).toHaveLength(12); expect(componentCount(a)).toBe(1) }
    if (a.id === 'mixed-profiles') { expect(componentCount(a)).toBe(2); expect(items.find(p => p.id === 'free-triangle-v2')!.shape.thickness).toBe(.08) }
  })
  it('renders an intentionally inconsistent saved pose without solving it', () => {
    const a = parseAssembly3D(JSON.stringify(rightAngle)); a.pieces[1].pose.position = [10, -4, 3]
    expect(validateAssembly3D(a).valid).toBe(false)
    expect(createViewerModel(a)[1].transform.position.toArray()).toEqual([10, -4, 3])
  })
  it('preserves triangle centroid XY and exact outer thickness when extruding', () => {
    const items = createViewerModel(parseAssembly3D(JSON.stringify(mixed)))
    for (const item of items) {
      const frame = createFrameGeometry(item.shape); frame.computeBoundingBox()
      const xs = item.shape.vertices.map(p => p.x), ys = item.shape.vertices.map(p => p.y)
      expect(frame.boundingBox!.min.x).toBeCloseTo(Math.min(...xs), 6)
      expect(frame.boundingBox!.max.x).toBeCloseTo(Math.max(...xs), 6)
      expect(frame.boundingBox!.min.y).toBeCloseTo(Math.min(...ys), 6)
      expect(frame.boundingBox!.max.y).toBeCloseTo(Math.max(...ys), 6)
      expect(frame.boundingBox!.min.z).toBeCloseTo(-item.shape.thickness / 2, 6)
      expect(frame.boundingBox!.max.z).toBeCloseTo(item.shape.thickness / 2, 6)
      const center = createCenterGeometry(item.shape); center.computeBoundingBox()
      expect(center.boundingBox!.min.z).toBeGreaterThanOrEqual(-item.shape.thickness / 2 - 1e-8)
      expect(center.boundingBox!.max.z).toBeLessThanOrEqual(item.shape.thickness / 2 + 1e-8)
    }
  })
  it('isolates same-ID snapshots with different geometry/thickness and releases only the old one', () => {
    const s = structuredClone(parseAssembly3D(JSON.stringify(mixed)).profiles[0]); const a = adaptProfile(s).shape
    s.thickness = .14; s.profile.vertices = s.profile.vertices.map(v => [v[0] * 2, v[1] * 2])
    const b = adaptProfile(s).shape, ga = createFrameGeometry(a), gb = createFrameGeometry(b)
    expect(a.id).toBe(b.id); expect(ga).not.toBe(gb)
    ga.computeBoundingBox(); gb.computeBoundingBox()
    expect(gb.boundingBox!.max.x - gb.boundingBox!.min.x).toBeCloseTo(2)
    expect(gb.boundingBox!.max.z - gb.boundingBox!.min.z).toBeCloseTo(.14)
    let disposedA = 0, disposedB = 0; ga.addEventListener('dispose', () => disposedA++); gb.addEventListener('dispose', () => disposedB++)
    disposeShapeResources([a]); expect(disposedA).toBe(1); expect(disposedB).toBe(0)
    expect(createFrameGeometry(b)).toBe(gb)
  })
  it('retains optional colors in the existing Assembly3D format and rejects invalid colors', () => {
    const a = parseAssembly3D(JSON.stringify(rightAngle)); delete a.pieces[0].color
    expect(createViewerModel(a)[0].color).toBe('#55b8ac')
    expect(parseAssembly3D(serializeAssembly3D(a)).pieces[0].color).toBeUndefined()
    a.pieces[0].color = 'invalid'; expect(() => serializeAssembly3D(a)).toThrow(/color/)
  })
  for (const [w, h] of [[320, 640], [1400, 400]]) it(`fits all components and exact stored transforms at ${w}x${h}`, () => {
    const a = parseAssembly3D(JSON.stringify(mixed)); a.pieces[2].pose.position = [30, -5, 11]
    const items = createViewerModel(a), worldVertices = items.flatMap(p => pieceWorldVertices(p.shape, p.transform.position, p.transform.quaternion))
    const camera = new OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, .001, 100)
    camera.position.set(5, 3, 7); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
    const original = camera.position.clone(), quaternion = camera.quaternion.clone()
    const fitted = computeFitCamera({ camera, worldVertices, size: { width: w, height: h }, preferredView: 'current' })!
    expect(camera.position).toEqual(original); expect(camera.quaternion.toArray()).toEqual(quaternion.toArray())
    expect(1 - Math.abs(fitted.quaternion.dot(quaternion))).toBeLessThan(1e-10)
    applyFitResult(camera, fitted); camera.updateMatrixWorld()
    for (const point of worldVertices) {
      const ndc = point.clone().project(camera)
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(.760001); expect(Math.abs(ndc.y)).toBeLessThanOrEqual(.760001)
      expect(ndc.z).toBeGreaterThan(-1); expect(ndc.z).toBeLessThan(1)
    }
    expect(camera.getWorldDirection(new Vector3()).length()).toBeCloseTo(1)
  })
})

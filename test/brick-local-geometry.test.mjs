import test from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { Matrix4, Vector3 } from 'three'
import { inspectBrickModel, brickLibraryRoot } from '../server/brick-library.mjs'
import { geometrySupport } from '../src/brick-test/catalog.ts'

// Real local resource integration checks. No model, network, database or writes.
const library = brickLibraryRoot()
async function available(t, part) {
  try { await access(library + '/parts/' + part + '.dat'); return true }
  catch { t.skip('Install/configure the existing local LDraw library to run this resource check'); return false }
}
const positions = points => points.map(p => p.map(v => Math.round(v * 1e6) / 1e6).join(',')).sort()
test('87084 actual stud instances agree with the shared nominal profile and Viewer transform', async t => {
  if (!await available(t, '87084')) return
  const report = await inspectBrickModel('87084', library, { extractGeometry: true })
  assert.equal(report.available, true, report.errors.join('; '))
  const g = geometrySupport('87084').geometry
  const top = report.extraction.primitives.filter(p => p.file === 'p/stud7.dat')
  assert.equal(top.length, 6)
  const transform = new Matrix4().makeTranslation(g.ldraw.offsetLdu.x, g.ldraw.offsetLdu.y, g.ldraw.offsetLdu.z)
    .multiply(new Matrix4().makeRotationX(g.ldraw.rotationX))
  assert.deepEqual(positions(top.map(p => new Vector3(...p.origin).applyMatrix4(transform).toArray())),
    positions(g.top.map(p => [p.x, p.y, p.z])))
  for (const bound of g.sourceFiles) assert.ok(report.sourceFiles.some(f => f.path === bound.path && f.sha256 === bound.sha256), bound.path)
  assert.deepEqual(report.extraction.meshBounds, { min: [-60, -11, -40], max: [60, 48, 40] })
})
test('98223 original-entry redirect preserves four modeled studs with a reviewed original-entry profile', async t => {
  if (!await available(t, '98223')) return
  const report = await inspectBrickModel('98223', library, { extractGeometry: true })
  assert.equal(report.available, true, report.errors.join('; '))
  assert.deepEqual(report.entryReferences[0].matrix, [0, 0, 1, 0, 1, 0, -1, 0, 0])
  assert.deepEqual(positions(report.extraction.primitives.filter(p => p.file === 'p/stud7.dat').map(p => p.origin)),
    positions([[-20, 0, -20], [-20, 0, 20], [20, 0, -20], [20, 0, 20]]))
  assert.equal(report.extraction.status, 'needs-review')
  assert.equal(geometrySupport('98223').supported, true)
  assert.equal(geometrySupport('98223b').supported, false)
})

for (const [part, count, bounds] of [
  ['4066a', 2, { min: [-40, -11, -20], max: [40, 96, 20] }],
  ['40666', 8, { min: [-80, -11, -40], max: [80, 24, 40] }],
]) test(part + ' local mesh, source bindings and Viewer transform agree with reviewed profile', async t => {
  if (!await available(t, part)) return
  const report = await inspectBrickModel(part, library, { extractGeometry: true })
  assert.equal(report.available, true, report.errors.join('; '))
  const g = geometrySupport(part).geometry
  const studs = report.extraction.primitives.filter(p => p.file === 'p/stud7.dat')
  assert.equal(studs.length, count)
  const transform = new Matrix4().makeTranslation(g.ldraw.offsetLdu.x, g.ldraw.offsetLdu.y, g.ldraw.offsetLdu.z)
    .multiply(new Matrix4().makeRotationX(g.ldraw.rotationX))
  assert.deepEqual(positions(studs.map(p => new Vector3(...p.origin).applyMatrix4(transform).toArray())), positions(g.top.map(p => [p.x, p.y, p.z])))
  for (const bound of g.sourceFiles) assert.ok(report.sourceFiles.some(f => f.path === bound.path && f.sha256 === bound.sha256), bound.path)
  assert.deepEqual(report.extraction.meshBounds, bounds)
})

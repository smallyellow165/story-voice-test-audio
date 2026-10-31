import { describe, expect, it } from 'vitest'
import * as a from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import { profiles } from '../../src/magnetic-tiles/profiles.ts'
import { parseAssembly3D, serializeAssembly3D, toEnginePose } from '../../src/magnetic-tiles/three-d/assembly.ts'
import { validateAssembly3D } from '../../src/magnetic-tiles/three-d/engine-adapter.ts'
import { editorProject } from '../../src/magnetic-tiles/three-d/editor-project.ts'
import { buildPortUsage, computeSnapTransform, findBestSnapCandidate, findCompatibleTargets, getDisplayTransforms, portsCompatible } from '../../src/magnetic-tiles/three-d/vendor/editor/snap.ts'
import { DRAFT_3D_KEY, loadDraft3D, saveDraft3D } from '../../src/magnetic-tiles/three-d/draft-storage.ts'
import cube from '../../src/magnetic-tiles/three-d/examples/closed-cube.json' with { type: 'json' }
const snapshot = { profile: profiles[0], thickness: .05 }
function pair() {
  const first = a.addPieceAction(a.createInitialHistory(), snapshot, '#ef795d')
  const second = a.addPieceAction(first.history, snapshot, '#55b8ac', [1.3, .025, 0])
  return { h: second.history, base: first.pieceId, child: second.pieceId,
    c: { pieceA: first.pieceId, portA: 'e0-p0', pieceB: second.pieceId, portB: 'e0-p0', dihedralDeg: 90, flip: false } }
}
describe('Assembly3D upstream editor boundary', () => {
  it('keeps versioned snapshots and independent copies with no aliasing', () => {
    const { h, base } = pair(), copied = a.duplicatePieceAction(h, base)
    expect(copied.history.current.pieces).toHaveLength(3)
    expect(copied.history.current.profiles).toHaveLength(1)
    expect(copied.newId).not.toBe(base)
    copied.history.current.pieces[2].pose.position[0] = 10
    expect(h.current.pieces[0].pose.position[0]).toBe(0)
    const v2 = { profile: { ...structuredClone(profiles[0]), version: 2, vertices: profiles[0].vertices.map(v => [v[0] * 2, v[1] * 2] as [number, number]) }, thickness: .08 }
    const next = a.addPieceAction(h, v2, '#b895cf')
    expect(next.history.current.profiles).toHaveLength(2)
    expect(editorProject(next.history.current).shapes.get('square@2')!.edges[0].length).toBe(2)
    expect(next.history.current.pieces[2].profileVersion).toBe(2)
    expect(() => a.addPieceAction(h, { ...snapshot, thickness: .1 }, '#b895cf')).toThrow(/不同/)
  })
  it('snap is one undoable pose+constraint transaction and preserves the fixed base', () => {
    const { h, base, child, c } = pair(), before = structuredClone(h.current)
    const snapped = a.createConnectionAction(h, c, true)
    expect(snapped.past.length).toBe(h.past.length + 1)
    expect(snapped.current.pieces.find(p => p.id === base)!.pose).toEqual(before.pieces.find(p => p.id === base)!.pose)
    expect(snapped.current.pieces.find(p => p.id === child)!.pose).not.toEqual(before.pieces.find(p => p.id === child)!.pose)
    expect(validateAssembly3D(snapped.current)).toEqual({ valid: true, issues: [] })
    expect(a.undo(snapped).current).toEqual(before)
    expect(a.redo(a.undo(snapped)).current).toEqual(snapped.current)
    expect(h.current).toEqual(before)
  })
  it('constraint-only creation, angle changes and deletion do not solve stored poses', () => {
    const { h, c } = pair(), before = structuredClone(h.current.pieces)
    let next = a.createConnectionAction(h, c)
    expect(next.current.pieces).toEqual(before)
    expect(validateAssembly3D(next.current).valid).toBe(false)
    next = a.createConnectionAction(h, c, true)
    const poses = structuredClone(next.current.pieces)
    next = a.updateConnectionAction(next, 0, { dihedralDeg: -90 })
    expect(next.current.pieces).toEqual(poses)
    expect(validateAssembly3D(next.current).issues.some(i => i.code === 'loop-dihedral-error')).toBe(true)
    next = a.removeConnectionAction(next, 0)
    expect(next.current.pieces).toEqual(poses)
  })
  it('manual pose edits keep connections and report actual invalid geometry', () => {
    const { h, c, child } = pair(), snapped = a.createConnectionAction(h, c, true)
    const moved = a.setPieceTransformAction(snapped, child, { position: [0, .025, 0], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] })
    expect(moved.current.connections).toEqual(snapped.current.connections)
    const report = validateAssembly3D(moved.current)
    expect(report.valid).toBe(false)
    expect(report.issues.some(i => i.code === 'intersection')).toBe(true)
    expect(a.undo(moved).current).toEqual(snapped.current)
  })
  it('explicit solving affects only the selected component, retaining unrelated invalid poses', () => {
    const { h, c, base } = pair()
    const p = a.createConnectionAction(h, c).current
    p.pieces.push({ ...structuredClone(p.pieces[0]), id: 'unrelated-a', pose: { position: [10, 8, 2], quaternion: [0, 0, 0, 1] } },
      { ...structuredClone(p.pieces[1]), id: 'unrelated-b', pose: { position: [18, 12, 4], quaternion: [0, 0, 0, 1] } })
    p.connections.push({ ...c, pieceA: 'unrelated-a', pieceB: 'unrelated-b' })
    const expected = structuredClone(p.pieces.slice(2)), solved = a.solveComponent(p, base)
    expect(solved.pieces.slice(2)).toEqual(expected)
    expect(validateAssembly3D(solved).valid).toBe(false)
  })
  it('deletes incident constraints and restores cube pose/connection state with undo', () => {
    const original = parseAssembly3D(JSON.stringify(cube)), h = a.createInitialHistory(original)
    expect(h.current.pieces).toHaveLength(6); expect(h.current.connections).toHaveLength(12)
    const deleted = a.deletePieceAction(h, original.pieces[0].id)
    expect(deleted.current.pieces).toHaveLength(5); expect(deleted.current.connections).toHaveLength(8)
    expect(a.undo(deleted).current).toEqual(original)
    expect(a.redo(a.undo(deleted)).current).toEqual(deleted.current)
    const wrong = a.updateConnectionAction(h, 0, { dihedralDeg: 45 })
    expect(validateAssembly3D(wrong.current).valid).toBe(false)
  })
  it('updates explicit Profile thickness and color while preserving poses and Registry', () => {
    const { h, base, c } = pair(), before = structuredClone(profiles)
    let next = a.setProfileThicknessAction(h, 'square@1', .12)
    next = a.setPieceColorAction(next, base, '#123456')
    expect(next.current.pieces.map(p => p.pose)).toEqual(h.current.pieces.map(p => p.pose))
    expect(next.current.profiles[0].thickness).toBe(.12)
    expect(next.current.pieces[0].color).toBe('#123456')
    expect(profiles).toEqual(before)
    expect(() => a.setProfileThicknessAction(h, 'square@1', -1)).toThrow()
    expect(() => a.updateConnectionAction(a.createConnectionAction(h, c), 0, { dihedralDeg: 999 })).toThrow()
  })
  it('deduplicates no-op commits and batches multiple edits into one history entry', () => {
    const { h, base } = pair()
    expect(a.setPieceTransformAction(h, base, h.current.pieces[0].pose)).toBe(h)
    const next = a.commitBatch(h, [p => { p.pieces[0].color = '#123456'; return p }, p => { p.pieces[0].pose.position[0] = 2; return p }])
    expect(next.past.length).toBe(h.past.length + 1)
    expect(a.undo(next).current).toEqual(h.current)
  })
})
describe('reused snap functions resolve actual Profile geometry and poses', () => {
  it('reads poses without solving and computes exact compatible port snaps', () => {
    const { h, c, child, base } = pair(), project = editorProject(h.current)
    expect(getDisplayTransforms(project)[child].position.toArray()).toEqual(h.current.pieces[1].pose.position)
    expect(findCompatibleTargets({ pieceId: child, portId: 'e0-p0' }, project).length).toBe(4)
    const snap = computeSnapTransform(base, 'e0-p0', child, 'e0-p0', 90, false, project)!
    const next = a.createConnectionAction(h, c, true)
    expect(snap.position.toArray()).toEqual(next.current.pieces[1].pose.position)
    const near = toEnginePose(next.current.pieces[1].pose); near.position.x += .05
    expect(findBestSnapCandidate(child, project, [{ dihedralDeg: 90, flip: false }], near)?.connection).toBeDefined()
    const used = editorProject(next.current)
    expect(buildPortUsage(used).has(`${base}:e0-p0`)).toBe(true)
    expect(findCompatibleTargets({ pieceId: child, portId: 'e0-p0' }, used)).toEqual([])
    expect(portsCompatible({ length: 1 }, { length: 1.04 })).toBe(false)
  })
})
describe('3D Draft snapshot persistence', () => {
  function storage() { const map = new Map<string,string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } } }
  it('saves invalid geometry and restores every pose/constraint without running a solver', () => {
    const { h, c } = pair(), draft = a.createConnectionAction(h, c).current, store = storage()
    expect(validateAssembly3D(draft).valid).toBe(false)
    const raw = saveDraft3D(store, draft, null)
    expect(loadDraft3D(store)).toEqual({ raw, assembly: draft })
    expect(store.map.size).toBe(1); expect(store.map.has(DRAFT_3D_KEY)).toBe(true)
    expect(serializeAssembly3D(draft)).toBe(raw)
  })
  it('refuses stale saves, corrupted reads and quota failures without rewriting existing data', () => {
    const { h } = pair(), store = storage(), raw = saveDraft3D(store, h.current, null)
    store.setItem(DRAFT_3D_KEY, raw + ' ')
    expect(() => saveDraft3D(store, h.current, raw)).toThrow(/其他页面/)
    store.setItem(DRAFT_3D_KEY, '{broken')
    expect(() => loadDraft3D(store)).toThrow(); expect(store.getItem(DRAFT_3D_KEY)).toBe('{broken')
    expect(() => saveDraft3D({ getItem: () => null, setItem: () => { throw Error('quota') } }, h.current, null)).toThrow(/quota/)
  })
})

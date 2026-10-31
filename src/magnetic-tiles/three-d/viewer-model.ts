import { Euler, Quaternion } from 'three'
import { assertAssembly3D, toEnginePose } from './assembly.ts'
import type { Assembly3D } from './assembly.ts'
import { createShapeCatalog, profileKey3D } from './profile-adapter.ts'

export const DEFAULT_PIECE_COLOR = '#55b8ac'
/** Rendering boundary: only the exact snapshots and stored poses, no solver. */
export function createViewerModel(assembly: Assembly3D) {
  assertAssembly3D(assembly)
  const catalog = createShapeCatalog(assembly.profiles)
  return assembly.pieces.map(piece => {
    const adapted = catalog.get(profileKey3D({ id: piece.profileId, version: piece.profileVersion }))!
    return { id: piece.id, piece, profile: assembly.profiles.find(s => profileKey3D(s.profile) === adapted.key)!,
      shape: adapted.shape, transform: toEnginePose(piece.pose), color: piece.color ?? DEFAULT_PIECE_COLOR }
  })
}
export type ViewerPiece = ReturnType<typeof createViewerModel>[number]
export function rotationDegrees(quaternion: [number, number, number, number]) {
  const e = new Euler().setFromQuaternion(new Quaternion(...quaternion), 'XYZ')
  return [e.x, e.y, e.z].map(n => n * 180 / Math.PI)
}
export function componentCount(assembly: Assembly3D) {
  const pending = new Set(assembly.pieces.map(p => p.id)); let count = 0
  while (pending.size) {
    count++; const queue = [pending.values().next().value!]; pending.delete(queue[0])
    while (queue.length) {
      const id = queue.shift()!
      for (const c of assembly.connections) {
        const next = c.pieceA === id ? c.pieceB : c.pieceB === id ? c.pieceA : undefined
        if (next && pending.delete(next)) queue.push(next)
      }
    }
  }
  return count
}

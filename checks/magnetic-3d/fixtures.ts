import { Quaternion, Vector3 } from 'three'
import type { Connection, PhysicalModel, PieceTransform } from '../../src/magnetic-tiles/three-d/vendor/engine/types.ts'
import { squareShape } from '../../src/magnetic-tiles/three-d/vendor/engine/shapes.ts'
import type { Assembly3D, Pose3D } from '../../src/magnetic-tiles/three-d/assembly.ts'
import { profiles } from '../../src/magnetic-tiles/profiles.ts'

export const identityPose = (): Pose3D => ({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] })
export const pose = (x = 0, y = 0, z = 0): PieceTransform => ({ position: new Vector3(x, y, z), quaternion: new Quaternion() })
export function model(ids: string[], connections: Connection[], buildMode: 'flat' | 'solid' = 'solid'): PhysicalModel {
  return { id: 'fixture', name: 'fixture', theme: 'other', difficulty: 'easy', ageRange: '', minAge: 0, maxAge: 0,
    estimatedTime: '', coverImage: '', description: '', buildMode,
    parts: [{ id: 'square', name: 'square', shape: 'square', count: ids.length, color: 'red' }], skills: [], parentTips: [],
    pieces: ids.map((id, i) => ({ id, partId: 'square', isRoot: i === 0 })), connections,
    steps: [{ id: 1, title: 'all', description: '', parentGuide: '', addedPieceIds: ids, addedConnections: connections }] }
}
export function assemblyFixture(): Assembly3D {
  return { kind: 'magnetic-assembly-3d', schemaVersion: 1, id: 'test', revision: 0,
    profiles: [{ profile: structuredClone(profiles[0]), thickness: .05 }],
    pieces: ['a', 'b', 'free'].map((id, i) => ({ id, profileId: 'square', profileVersion: 1,
      pose: { position: [i * 4, 2, 3], quaternion: [0, 0, 0, 1] } })),
    connections: [{ pieceA: 'a', pieceB: 'b', portA: 'e0-p0', portB: 'e0-p0', dihedralDeg: 90 }] }
}

/** Independently specified cube faces. Connections are derived from expected
 * shared endpoints, never from the solver under test. +Z is up for this fixture. */
export function cubeFixture() {
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
  const transforms: Record<string, PieceTransform> = {
    bottom: pose(), top: pose(0, 0, 1),
    front: { position: new Vector3(0, -.5, .5), quaternion: qx },
    back: { position: new Vector3(0, .5, .5), quaternion: qx.clone() },
    right: { position: new Vector3(.5, 0, .5), quaternion: qy },
    left: { position: new Vector3(-.5, 0, .5), quaternion: qy.clone() },
  }
  const ids = Object.keys(transforms), connections: Connection[] = []
  const point = (p: { x: number; y: number }, tf: PieceTransform) => new Vector3(p.x, p.y, 0).applyQuaternion(tf.quaternion).add(tf.position)
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j], ta = transforms[a], tb = transforms[b]
    for (const pa of squareShape.ports) for (const pb of squareShape.ports) for (const flip of [false, true]) {
      const a0 = point(pa.p0, ta), a1 = point(pa.p1, ta), b0 = point(flip ? pb.p1 : pb.p0, tb), b1 = point(flip ? pb.p0 : pb.p1, tb)
      if (a0.distanceTo(b0) > 1e-8 || a1.distanceTo(b1) > 1e-8) continue
      const na = new Vector3(0, 0, 1).applyQuaternion(ta.quaternion), nb = new Vector3(0, 0, 1).applyQuaternion(tb.quaternion)
      const angle = Math.atan2(new Vector3().crossVectors(na, nb).dot(a1.sub(a0).normalize()), na.dot(nb)) * 180 / Math.PI
      connections.push({ pieceA: a, pieceB: b, portA: pa.portId, portB: pb.portId, dihedralDeg: angle, flip })
    }
  }
  return { transforms, model: model(ids, connections) }
}

import { Quaternion, Vector3 } from 'three'
import { createShapeCatalog, profileKey3D } from './profile-adapter.ts'
import type { ProfileSnapshot3D } from './profile-adapter.ts'
import type { Connection, PieceTransform } from './vendor/engine/types.ts'

/** Position of the area centroid; quaternion [x,y,z,w], local XY, local +Z normal. */
export type Pose3D = { position: [number, number, number]; quaternion: [number, number, number, number] }
export type Piece3D = { id: string; profileId: string; profileVersion: number; pose: Pose3D; color?: string }
export type Assembly3D = {
  kind: 'magnetic-assembly-3d'; schemaVersion: 1; id: string; revision: number
  profiles: ProfileSnapshot3D[]; pieces: Piece3D[]; connections: Connection[]
}
const fail = (message: string): never => { throw Error(message) }
const identifier = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(s) && !['__proto__', 'constructor', 'prototype'].includes(s)
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('Invalid 3D document fields')
}
export function assertPose3D(pose: Pose3D): void {
  object(pose, ['position', 'quaternion'])
  for (const [tuple, size] of [[pose.position, 3], [pose.quaternion, 4]] as const) {
    if (!Array.isArray(tuple) || tuple.length !== size || !tuple.every(n => typeof n === 'number' && Number.isFinite(n))) fail('Invalid finite 3D pose')
  }
  if (Math.abs(Math.hypot(...pose.quaternion) - 1) > 1e-6) fail('3D quaternion must be unit length')
}
export function toEnginePose(pose: Pose3D): PieceTransform {
  return { position: new Vector3(...pose.position), quaternion: new Quaternion(...pose.quaternion) }
}
export function fromEnginePose(pose: PieceTransform): Pose3D {
  return { position: [pose.position.x, pose.position.y, pose.position.z], quaternion: [pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w] }
}

/** Strict structural checks. Geometrically invalid drafts can still be persisted. */
export function assertAssembly3D(a: Assembly3D): void {
  object(a, ['kind', 'schemaVersion', 'id', 'revision', 'profiles', 'pieces', 'connections'])
  if (a.kind !== 'magnetic-assembly-3d' || a.schemaVersion !== 1 || !identifier(a.id) || !Number.isSafeInteger(a.revision) || a.revision < 0 ||
      !Array.isArray(a.profiles) || !Array.isArray(a.pieces) || !Array.isArray(a.connections)) fail('Unsupported 3D assembly')
  for (const s of a.profiles) {
    object(s, ['profile', 'thickness', 'scale', 'ports'])
    for (const p of s.ports ?? []) object(p, ['edgeId', 'ranges'])
  }
  const catalog = createShapeCatalog(a.profiles), ids = new Set<string>()
  const shapes = new Map(a.pieces.map(p => {
    object(p, ['id', 'profileId', 'profileVersion', 'pose', 'color'])
    if (p.color !== undefined && (typeof p.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p.color))) fail('Invalid 3D piece color: expected #RRGGBB')
    if (!identifier(p.id) || ids.has(p.id)) fail('Duplicate or invalid 3D piece ID')
    if (typeof p.profileId !== 'string' || !Number.isSafeInteger(p.profileVersion) || p.profileVersion < 1) fail('Invalid 3D Profile reference')
    ids.add(p.id); assertPose3D(p.pose)
    const adapted = catalog.get(profileKey3D({ id: p.profileId, version: p.profileVersion })) ?? fail(`Missing exact 3D Profile version for ${p.id}`)
    return [p.id, adapted.shape] as const
  }))
  for (const c of a.connections) {
    object(c, ['pieceA', 'pieceB', 'portA', 'portB', 'dihedralDeg', 'flip'])
    if (c.pieceA === c.pieceB || !shapes.get(c.pieceA)?.ports.some(p => p.portId === c.portA) ||
        !shapes.get(c.pieceB)?.ports.some(p => p.portId === c.portB) || !Number.isFinite(c.dihedralDeg) ||
        Math.abs(c.dihedralDeg) > 180 || (c.flip !== undefined && typeof c.flip !== 'boolean')) fail('Invalid 3D connection reference or angle')
  }
}
export function serializeAssembly3D(assembly: Assembly3D): string {
  assertAssembly3D(assembly)
  return JSON.stringify(assembly)
}
export function parseAssembly3D(json: string): Assembly3D {
  const value: unknown = JSON.parse(json)
  assertAssembly3D(value as Assembly3D)
  return value as Assembly3D
}

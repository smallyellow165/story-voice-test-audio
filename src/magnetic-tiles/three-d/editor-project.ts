import type { Assembly3D, Pose3D } from './assembly.ts'
import { createShapeCatalog, profileKey3D } from './profile-adapter.ts'
import type { AdaptedProfile } from './profile-adapter.ts'
import type { Connection, ShapeDef } from './vendor/engine/types.ts'

// Derived view for the upstream Canvas/Snap. Never persisted or used as history.
export type EditorProject = {
  id: string
  parts: { id: string; shape: string; color: string; name: string }[]
  pieces: { id: string; partId: string }[]
  connections: Connection[]
  transforms: Record<string, Pose3D>
  shapes: ReadonlyMap<string, ShapeDef>
}
export type Selection = { kind: 'none' } | { kind: 'piece'; id: string } | { kind: 'connection'; index: number }
export type SerializableTransform = Pose3D
export function editorProject(a: Assembly3D, catalog: ReadonlyMap<string, AdaptedProfile> = createShapeCatalog(a.profiles)): EditorProject {
  return {
    id: a.id, parts: a.pieces.map(p => {
      const key = profileKey3D({ id: p.profileId, version: p.profileVersion })
      return { id: p.id, shape: key, color: p.color ?? '#55b8ac', name: a.profiles.find(s => profileKey3D(s.profile) === key)!.profile.name }
    }), pieces: a.pieces.map(p => ({ id: p.id, partId: p.id })), connections: a.connections,
    transforms: Object.fromEntries(a.pieces.map(p => [p.id, p.pose])),
    shapes: new Map([...catalog].map(([key, item]) => [key, item.shape])),
  }
}

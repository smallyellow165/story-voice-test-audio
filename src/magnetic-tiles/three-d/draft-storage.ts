import { assertAssembly3D, parseAssembly3D, serializeAssembly3D } from './assembly.ts'
import type { Assembly3D } from './assembly.ts'

// Same localStorage snapshot pattern as Studio storage.ts/build-storage.ts, separate key.
export const DRAFT_3D_KEY = 'magnetic-tiles.assembly3d-draft.v1'
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>
export function loadDraft3D(storage: Pick<Storage, 'getItem'>): { raw: string | null; assembly: Assembly3D | null } {
  const raw = storage.getItem(DRAFT_3D_KEY)
  return { raw, assembly: raw === null ? null : parseAssembly3D(raw) }
}
export function saveDraft3D(storage: DraftStorage, assembly: Assembly3D, expected: string | null): string {
  assertAssembly3D(assembly) // Structural check only: invalid geometry drafts are allowed.
  if (storage.getItem(DRAFT_3D_KEY) !== expected) throw Error('3D 草稿已被其他页面更新。请先导出当前草稿，再重新加载已保存草稿。')
  const raw = serializeAssembly3D(assembly)
  storage.setItem(DRAFT_3D_KEY, raw)
  return raw
}

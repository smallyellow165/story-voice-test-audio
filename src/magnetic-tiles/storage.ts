import { validate } from './geometry.ts'
import type { Assembly, Profile } from './geometry.ts'
export const STORAGE_KEY = 'magnetic-tiles.playground.v1'
export type Workspace = { schemaVersion: 1; current: Assembly; saved: Assembly[] }
export const emptyAssembly = (): Assembly => ({ schemaVersion: 1, id: crypto.randomUUID(), revision: 0, name: '我的磁力片作品', instances: [] })
export function parseAssembly(value: unknown, profiles: readonly Profile[]): Assembly {
  const a = value as Assembly
  if (!a || a.schemaVersion !== 1 || typeof a.id !== 'string' || !a.id || a.id.length > 100 || !Number.isSafeInteger(a.revision) || a.revision < 0
    || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80 || !Array.isArray(a.instances)
    || Object.keys(a).some(k => !['schemaVersion', 'id', 'revision', 'name', 'instances'].includes(k))) throw Error('Assembly 格式或版本无效')
  const report = validate(a.instances, profiles)
  if (!report.draftValid) throw Error(report.issues.map(i => i.message).join('；'))
  return structuredClone(a)
}
export function loadWorkspace(storage: Pick<Storage, 'getItem'>, profiles: readonly Profile[]): Workspace | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (raw === null) return null
  const w = JSON.parse(raw)
  if (w.schemaVersion !== 1 || !Array.isArray(w.saved) || w.saved.length > 50) throw Error('工作区存档格式无效')
  return { schemaVersion: 1, current: parseAssembly(w.current, profiles), saved: w.saved.map((a: unknown) => parseAssembly(a, profiles)) }
}
export function saveWorkspace(storage: Pick<Storage, 'setItem'>, workspace: Workspace, profiles: readonly Profile[]) {
  const value = { schemaVersion: 1, current: parseAssembly(workspace.current, profiles), saved: workspace.saved.map(a => parseAssembly(a, profiles)) }
  if (value.saved.length > 50) throw Error('最多保存 50 个作品，请导出备份')
  storage.setItem(STORAGE_KEY, JSON.stringify(value))
}

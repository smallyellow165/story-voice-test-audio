import type { Assembly } from './geometry.ts'
import { canonical } from './build-plan.ts'

// Loading/undo may change revision without changing the editable contents.
// IDs, modes, names, pieces, colors and poses still participate in this comparison.
export function sameAssemblyContents(a: Assembly, b: Assembly): boolean {
  return canonical({ ...a, revision: 0 }) === canonical({ ...b, revision: 0 })
}
export function assemblySaveStatus(assembly: Assembly, saved: readonly Assembly[]) {
  const snapshot = saved.find(s => s.id === assembly.id)
  return !snapshot ? '未保存草稿 · 尚无已保存作品快照'
    : sameAssemblyContents(assembly, snapshot) ? '已保存作品 · 编辑内容与已保存快照一致'
    : '未保存草稿 · 当前编辑内容与已保存快照不同'
}

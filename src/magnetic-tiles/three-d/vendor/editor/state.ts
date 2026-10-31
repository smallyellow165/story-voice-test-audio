// Adapted MIT upstream snapshot history and piece/connection mutations.
// Source and exact differences: third_party/3D_Magnetic_Pieces/EDITOR.md.
import type { Assembly3D, Pose3D } from '../../assembly.ts'
import { assertAssembly3D } from '../../assembly.ts'
import { canonical } from '../../../build-plan.ts'
import { profileKey3D } from '../../profile-adapter.ts'
import type { ProfileSnapshot3D } from '../../profile-adapter.ts'
import { solveAssembly3D } from '../../engine-adapter.ts'
import type { Connection } from '../engine/types.ts'
import { uniqueId, uid } from './id.ts'

export interface EditorHistory { past: Assembly3D[]; current: Assembly3D; future: Assembly3D[] }
export const MAX_HISTORY = 100
export function createEmptyProject(): Assembly3D {
  return { kind: 'magnetic-assembly-3d', schemaVersion: 1, id: uid('draft'), revision: 0, profiles: [], pieces: [], connections: [] }
}
export function createInitialHistory(assembly = createEmptyProject()): EditorHistory {
  assertAssembly3D(assembly)
  return { past: [], current: structuredClone(assembly), future: [] }
}
function cloneProject(p: Assembly3D): Assembly3D {
  // P0-4: structuredClone 比 JSON 往返快 5-10x,且不丢 Date/Map 等结构(此处数据全可序列化,但保留语义更稳)。
  // 老旧环境(无 structuredClone,如非现代浏览器)降级到 JSON 方式。
  if (typeof structuredClone === 'function') {
    return structuredClone(p);
  }
  return JSON.parse(JSON.stringify(p)) as Assembly3D;
}

/** 在执行 mutation 前调用:把当前快照压栈。 */
function pushHistory(h: EditorHistory): EditorHistory {
  const past = [...h.past, cloneProject(h.current)].slice(-MAX_HISTORY);
  return { ...h, past, future: [] };
}

/** 上游保留工具：修改 current 但不入栈；宿主几何编辑使用 commit。 */
export function updateCurrent(h: EditorHistory, updater: (p: Assembly3D) => Assembly3D): EditorHistory {
  // P0-四.7: 克隆 current 后再传给 updater,避免 updater 中的 in-place mutation
  // 在 React Strict Mode(double-invocation)下污染原始状态。
  return { ...h, current: updater(cloneProject(h.current)) };
}

/** 修改 current 并入栈(用于用户主动操作)。 */
export function commit(h: EditorHistory, updater: (p: Assembly3D) => Assembly3D): EditorHistory {
  const next = pushHistory(h);
  // P0-四.7: 克隆 current 后再传给 updater,避免 in-place mutation 污染 h.current。
  // React Strict Mode 下 updater 会被调用两次:第一次 mutation 会改变 h.current,
  // 第二次 pushHistory 会 clone 已被污染的 h.current → past 条目值错误,撤销无效。
  const current = updater(cloneProject(next.current));
  assertAssembly3D(current);
  if (canonical(current) === canonical(h.current)) return h;
  return { ...next, current: { ...current, revision: h.current.revision + 1 } };
}

/**
 * P0-2: 批量提交 — 只 push 一次历史,依次执行多个 updater。
 * 用于一次用户操作需要多步 mutation 的场景，
 * 避免每个 updater 各 push 一条历史,导致撤销需要按多次。
 */
export function commitBatch(h: EditorHistory, updaters: ((p: Assembly3D) => Assembly3D)[]): EditorHistory {
  const next = pushHistory(h);
  let current = cloneProject(next.current);
  for (const u of updaters) {
    current = u(current);
  }
  assertAssembly3D(current);
  if (canonical(current) === canonical(h.current)) return h;
  return { ...next, current: { ...current, revision: h.current.revision + 1 } };
}

export function undo(h: EditorHistory): EditorHistory {
  if (h.past.length === 0) return h;
  const past = [...h.past];
  const prev = past.pop()!;
  return {
    past,
    current: prev,
    future: [h.current, ...h.future].slice(0, MAX_HISTORY),
  };
}

export function redo(h: EditorHistory): EditorHistory {
  if (h.future.length === 0) return h;
  const future = [...h.future];
  const next = future.shift()!;
  return {
    past: [...h.past, h.current].slice(-MAX_HISTORY),
    current: next,
    future,
  };
}

export function canUndo(h: EditorHistory): boolean {
  return h.past.length > 0;
}

export function canRedo(h: EditorHistory): boolean {
  return h.future.length > 0;
}

/** 替换整个 current(用于新建 / 打开 / 导入)。清空历史。 */
export function replaceProject(_h: EditorHistory, project: Assembly3D): EditorHistory {
  return { past: [], current: cloneProject(project), future: [] };
}


export function addPieceAction(h: EditorHistory, snapshot: ProfileSnapshot3D, color: string, placePosition?: [number, number, number]) {
  const pieceId = uniqueId('piece', h.current.pieces.map(p => p.id))
  const history = commit(h, p => {
    const key = profileKey3D(snapshot.profile), existing = p.profiles.find(s => profileKey3D(s.profile) === key)
    if (existing && canonical(existing) !== canonical(snapshot)) throw Error('该 Profile 版本已有不同的快照/厚度配置；请使用原配置或明确修改快照厚度。')
    if (!existing) p.profiles.push(structuredClone(snapshot))
    p.pieces.push({ id: pieceId, profileId: snapshot.profile.id, profileVersion: snapshot.profile.version, color,
      pose: { position: placePosition ?? [0, snapshot.thickness * (snapshot.scale ?? 1) / 2, 0],
        quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] } })
    return p
  })
  return { history, pieceId }
}
export function deletePieceAction(h: EditorHistory, pieceId: string): EditorHistory {
  return commit(h, p => {
    p.pieces = p.pieces.filter(piece => piece.id !== pieceId)
    p.connections = p.connections.filter(c => c.pieceA !== pieceId && c.pieceB !== pieceId)
    return p
  })
}
export function duplicatePieceAction(h: EditorHistory, pieceId: string) {
  const newId = uniqueId('piece', h.current.pieces.map(p => p.id))
  const history = commit(h, p => {
    const src = p.pieces.find(piece => piece.id === pieceId)
    if (!src) throw Error('找不到要复制的零件')
    const copy = structuredClone(src); copy.id = newId; copy.pose.position[0] += 1
    p.pieces.push(copy); return p
  })
  return { history, newId }
}
export function setPieceColorAction(h: EditorHistory, pieceId: string, color: string): EditorHistory {
  return commit(h, p => { const piece = p.pieces.find(piece => piece.id === pieceId); if (piece) piece.color = color; return p })
}
export function setPieceTransformAction(h: EditorHistory, pieceId: string, pose: Pose3D): EditorHistory {
  return commit(h, p => { const piece = p.pieces.find(piece => piece.id === pieceId); if (piece) piece.pose = structuredClone(pose); return p })
}
export function setProfileThicknessAction(h: EditorHistory, key: string, thickness: number): EditorHistory {
  return commit(h, p => { const s = p.profiles.find(s => profileKey3D(s.profile) === key); if (!s) throw Error('缺少 Profile 快照'); s.thickness = thickness; return p })
}
// Resolve only the chosen connected component. Unrelated drafts/free poses stay exact.
export function solveComponent(p: Assembly3D, root: string): Assembly3D {
  if (!p.pieces.some(piece => piece.id === root)) throw Error('请选择求解固定片')
  const members = new Set([root]), queue = [root]
  while (queue.length) {
    const id = queue.shift()!
    for (const c of p.connections) {
      const next = c.pieceA === id ? c.pieceB : c.pieceB === id ? c.pieceA : undefined
      if (next && !members.has(next)) { members.add(next); queue.push(next) }
    }
  }
  const subset = { ...p, pieces: p.pieces.filter(piece => members.has(piece.id)), connections: p.connections.filter(c => members.has(c.pieceA)) }
  const solved = solveAssembly3D(subset, [root]), poses = new Map(solved.pieces.map(piece => [piece.id, piece.pose]))
  return { ...p, pieces: p.pieces.map(piece => poses.has(piece.id) ? { ...piece, pose: poses.get(piece.id)! } : piece) }
}
export function solveComponentAction(h: EditorHistory, root: string): EditorHistory {
  return commit(h, p => solveComponent(p, root))
}
export function createConnectionAction(h: EditorHistory, connection: Connection, solve = false): EditorHistory {
  return commit(h, p => { p.connections.push(structuredClone(connection)); return solve ? solveComponent(p, connection.pieceA) : p })
}
export function removeConnectionAction(h: EditorHistory, index: number): EditorHistory {
  return commit(h, p => { p.connections.splice(index, 1); return p })
}
export function updateConnectionAction(h: EditorHistory, index: number, patch: Partial<Connection>): EditorHistory {
  return commit(h, p => { if (!p.connections[index]) throw Error('连接不存在'); Object.assign(p.connections[index], patch); return p })
}

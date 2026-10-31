// MIT upstream editor/state history + step mutations, adapted to Tutorial3D.
import type { Tutorial3D } from "../../tutorial.ts"
import { assertTutorial3D, syncStepConnections } from "../../tutorial.ts"
import { canonical } from "../../../build-plan.ts"
import type { BuildStepV2, StepCamera, PieceEntranceConfig, EntranceType, EasingName } from "../components/tutorial/types.ts"
export type EditorHistory = { past: Tutorial3D[]; current: Tutorial3D; future: Tutorial3D[] }
export const MAX_HISTORY = 100
export function createInitialHistory(current: Tutorial3D): EditorHistory { assertTutorial3D(current); return { past: [], current: structuredClone(current), future: [] } }
function cloneProject(p: Tutorial3D): Tutorial3D {
  // P0-4: structuredClone 比 JSON 往返快 5-10x,且不丢 Date/Map 等结构(此处数据全可序列化,但保留语义更稳)。
  // 老旧环境(无 structuredClone,如非现代浏览器)降级到 JSON 方式。
  if (typeof structuredClone === 'function') {
    return structuredClone(p);
  }
  return JSON.parse(JSON.stringify(p)) as Tutorial3D;
}

/** 在执行 mutation 前调用:把当前快照压栈。 */
function pushHistory(h: EditorHistory): EditorHistory {
  const past = [...h.past, cloneProject(h.current)].slice(-MAX_HISTORY);
  return { ...h, past, future: [] };
}

/** 修改 current 但不入栈(用于自动同步 transforms / updatedAt 等派生字段)。 */
export function updateCurrent(h: EditorHistory, updater: (p: Tutorial3D) => Tutorial3D): EditorHistory {
  // P0-四.7: 克隆 current 后再传给 updater,避免 updater 中的 in-place mutation
  // 在 React Strict Mode(double-invocation)下污染原始状态。
  const current=updater(cloneProject(h.current));
  if(canonical(current.assembly)!==canonical(h.current.assembly))throw Error('Source snapshot is immutable');
  syncStepConnections(current);assertTutorial3D(current);
  return { ...h, current };
}

/** 修改 current 并入栈(用于用户主动操作)。 */
export function commit(h: EditorHistory, updater: (p: Tutorial3D) => Tutorial3D): EditorHistory {
  const next = pushHistory(h);
  // P0-四.7: 克隆 current 后再传给 updater,避免 in-place mutation 污染 h.current。
  // React Strict Mode 下 updater 会被调用两次:第一次 mutation 会改变 h.current,
  // 第二次 pushHistory 会 clone 已被污染的 h.current → past 条目值错误,撤销无效。
  const current = updater(cloneProject(next.current));
  if (canonical(current.assembly) !== canonical(h.current.assembly)) throw Error('Source snapshot is immutable');
  syncStepConnections(current); assertTutorial3D(current);
  if(canonical(current) === canonical(h.current)) return h;
  return { ...next, current: { ...current, revision: h.current.revision + 1 } };
}

/**
 * P0-2: 批量提交 — 只 push 一次历史,依次执行多个 updater。
 * 用于一次用户操作需要多步 mutation 的场景(如断开连接+移动零件+移出步骤),
 * 避免每个 updater 各 push 一条历史,导致撤销需要按多次。
 */
export function commitBatch(h: EditorHistory, updaters: ((p: Tutorial3D) => Tutorial3D)[]): EditorHistory {
  const next = pushHistory(h);
  let current = cloneProject(next.current);
  for (const u of updaters) {
    current = u(current);
  }
  if (canonical(current.assembly) !== canonical(h.current.assembly)) throw Error('Source snapshot is immutable');
  syncStepConnections(current); assertTutorial3D(current);
  if(canonical(current) === canonical(h.current)) return h;
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
export function replaceProject(_h: EditorHistory, project: Tutorial3D): EditorHistory {
  return { past: [], current: cloneProject(project), future: [] };
}

export function addStepAction(h: EditorHistory): { history: EditorHistory; stepId: number } {
  let stepId = 1;
  const history = commit(h, (p) => {
    stepId = p.steps.length > 0 ? Math.max(...p.steps.map((s) => s.id)) + 1 : 1;
    const step: BuildStepV2 = {
      id: stepId,
      title: `步骤 ${stepId}`,
      description: '',
      parentGuide: '',
      addedPieceIds: [],
      addedConnections: [],
    };
    p.steps.push(step);
    return p;
  });
  return { history, stepId };
}

/** 删除步骤。 */
export function deleteStepAction(h: EditorHistory, stepId: number): EditorHistory {
  return commit(h, (p) => {
    p.steps = p.steps.filter((s) => s.id !== stepId);
    return p;
  });
}

/** 调整步骤顺序(把 from 移到 to)。 */
export function moveStepAction(h: EditorHistory, fromIndex: number, toIndex: number): EditorHistory {
  return commit(h, (p) => {
    if (fromIndex < 0 || fromIndex >= p.steps.length) return p;
    const clamped = Math.max(0, Math.min(p.steps.length - 1, toIndex));
    const [moved] = p.steps.splice(fromIndex, 1);
    p.steps.splice(clamped, 0, moved);
    return p;
  });
}

/** 更新步骤字段。 */
export function updateStepAction(
  h: EditorHistory,
  stepId: number,
  patch: Partial<Pick<BuildStepV2,
    'title' | 'description' | 'parentGuide' | 'addedPieceIds'
    | 'hint' | 'focusPoints' | 'highlightMs' | 'snapFeedback' | 'annotations'
  >>,
): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    if (patch.title !== undefined) step.title = patch.title;
    if (patch.description !== undefined) step.description = patch.description;
    if (patch.parentGuide !== undefined) step.parentGuide = patch.parentGuide;
    if (patch.addedPieceIds !== undefined) step.addedPieceIds = [...patch.addedPieceIds];
    if (patch.hint !== undefined) step.hint = patch.hint;
    if (patch.focusPoints !== undefined) step.focusPoints = [...patch.focusPoints];
    if (patch.highlightMs !== undefined) step.highlightMs = patch.highlightMs;
    if (patch.snapFeedback !== undefined) step.snapFeedback = patch.snapFeedback;
    if (patch.annotations !== undefined) step.annotations = { ...patch.annotations };
    return p;
  });
}

/** 把零件加入指定步骤的新增列表(去重)。 */
export function addPieceToStepAction(h: EditorHistory, stepId: number, pieceId: string): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    for (const other of p.steps) if (other.id !== stepId) { other.addedPieceIds = other.addedPieceIds.filter(id => id !== pieceId); if(other.entrance) delete other.entrance[pieceId]; if(other.annotations) delete other.annotations[pieceId]; }
    if (!step.addedPieceIds.includes(pieceId)) step.addedPieceIds.push(pieceId);
    return p;
  });
}

/** 把多片零件批量加入指定步骤(去重)。P1: 教学编排支持多选统一加入。 */
export function addPiecesToStepAction(h: EditorHistory, stepId: number, pieceIds: string[]): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    for (const pid of pieceIds) {
      if (!step.addedPieceIds.includes(pid)) step.addedPieceIds.push(pid);
    }
    return p;
  });
}

/** 把零件从指定步骤移除(同时清理其 entrance 配置)。P1: 教学编排支持移出步骤。 */
export function removePieceFromStepAction(h: EditorHistory, stepId: number, pieceId: string): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    step.addedPieceIds = step.addedPieceIds.filter((id) => id !== pieceId);
    if (step.entrance && step.entrance[pieceId]) {
      delete step.entrance[pieceId];
      if (Object.keys(step.entrance).length === 0) delete step.entrance;
    }
    if (step.annotations && step.annotations[pieceId]) {
      delete step.annotations[pieceId];
      if (Object.keys(step.annotations).length === 0) delete step.annotations;
    }
    return p;
  });
}

export function setStepCameraAction(
  h: EditorHistory,
  stepId: number,
  camera: StepCamera | null,
): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    if (camera === null) {
      delete step.camera;
    } else {
      step.camera = { ...camera };
    }
    return p;
  });
}

/** 把当前编辑器视图(相机位置/target/zoom)保存为本步镜头。 */
export function captureCurrentViewAsStepCameraAction(
  h: EditorHistory,
  stepId: number,
  view: { position: [number, number, number]; target: [number, number, number]; zoom: number },
  transitionMs: number = 800,
): EditorHistory {
  return setStepCameraAction(h, stepId, {
    position: [...view.position],
    target: [...view.target],
    zoom: view.zoom,
    transitionMs,
  });
}

/** 设置步骤内某片零件的入场动画配置。传 null 清除该零件的 entrance(回退到默认)。 */
export function setPieceEntranceAction(
  h: EditorHistory,
  stepId: number,
  pieceId: string,
  config: PieceEntranceConfig | null,
): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    if (config === null) {
      if (step.entrance) {
        delete step.entrance[pieceId];
        if (Object.keys(step.entrance).length === 0) delete step.entrance;
      }
    } else {
      if (!step.entrance) step.entrance = {};
      step.entrance[pieceId] = { ...config };
    }
    return p;
  });
}

/** 批量设置步骤内多片零件的入场类型(快速给同批零件统一设置 drop/side/fade 等)。 */
export function batchSetEntranceTypeAction(
  h: EditorHistory,
  stepId: number,
  pieceIds: string[],
  type: EntranceType,
): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    if (!step.entrance) step.entrance = {};
    pieceIds.forEach((pid, idx) => {
      const existing = step.entrance![pid];
      step.entrance![pid] = {
        type,
        delayMs: idx * 150,
        durationMs: existing?.durationMs ?? 800,
        easing: existing?.easing ?? 'easeOutCubic',
        startOffset: existing?.startOffset,
        startRotation: existing?.startRotation,
      };
    });
    return p;
  });
}

/** 设置步骤内某片零件的入场参数(局部更新,保留其他字段)。 */
export function patchPieceEntranceAction(
  h: EditorHistory,
  stepId: number,
  pieceId: string,
  patch: Partial<Pick<PieceEntranceConfig, 'type' | 'delayMs' | 'durationMs' | 'easing' | 'startOffset' | 'startRotation'>>,
): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    if (!step.entrance) step.entrance = {};
    const existing = step.entrance[pieceId] ?? {
      type: 'drop' as EntranceType,
      delayMs: 0,
      durationMs: 800,
      easing: 'easeOutCubic' as EasingName,
    };
    step.entrance[pieceId] = {
      type: patch.type ?? existing.type,
      delayMs: patch.delayMs ?? existing.delayMs,
      durationMs: patch.durationMs ?? existing.durationMs,
      easing: patch.easing ?? existing.easing,
      startOffset: patch.startOffset ?? existing.startOffset,
      startRotation: patch.startRotation ?? existing.startRotation,
    };
    return p;
  });
}

/** 设置步骤的提示文字。 */
export function setStepHintAction(h: EditorHistory, stepId: number, hint: string): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    if (hint.trim() === '') delete step.hint;
    else step.hint = hint;
    return p;
  });
}

/** 设置步骤的观察重点列表。 */
export function setStepFocusPointsAction(h: EditorHistory, stepId: number, points: string[]): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    const filtered = points.map((s) => s.trim()).filter((s) => s.length > 0);
    if (filtered.length === 0) delete step.focusPoints;
    else step.focusPoints = filtered;
    return p;
  });
}

/** 设置步骤内某片零件的标注文字。传空串清除。 */
export function setPieceAnnotationAction(
  h: EditorHistory,
  stepId: number,
  pieceId: string,
  text: string,
): EditorHistory {
  return commit(h, (p) => {
    const step = p.steps.find((s) => s.id === stepId);
    if (!step) return p;
    if (text.trim() === '') {
      if (step.annotations) {
        delete step.annotations[pieceId];
        if (Object.keys(step.annotations).length === 0) delete step.annotations;
      }
    } else {
      if (!step.annotations) step.annotations = {};
      step.annotations[pieceId] = text;
    }
    return p;
  });
}


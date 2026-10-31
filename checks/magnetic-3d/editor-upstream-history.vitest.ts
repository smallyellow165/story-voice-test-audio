// Original upstream ID and history assertions; Profile/color arguments adapted.
import { describe, it, expect } from 'vitest'
import { createInitialHistory, addPieceAction, undo, redo, canUndo, canRedo } from '../../src/magnetic-tiles/three-d/vendor/editor/state.ts'
import { uid, uniqueId } from '../../src/magnetic-tiles/three-d/vendor/editor/id.ts'
import { profiles } from '../../src/magnetic-tiles/profiles.ts'
const snapshot = { profile: profiles[0], thickness: .05 }
/* ----------------- 稳定 ID ----------------- */
describe('editor/id', () => {
  it('uid 返回带前缀的字符串', () => {
    const id = uid('piece');
    expect(id.startsWith('piece-')).toBe(true);
    expect(id.length).toBeGreaterThan('piece-'.length + 8);
  });

  it('uniqueId 在已知集合中保证不冲突', () => {
    const existing = new Set<string>(['piece-1', 'piece-2']);
    const id = uniqueId('piece', existing);
    expect(existing.has(id)).toBe(false);
    expect(id.startsWith('piece-')).toBe(true);
  });

  it('uid 多次调用不重复', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(uid('p'));
    expect(ids.size).toBe(100);
  });
});

/* ----------------- 撤销 / 重做 ----------------- */
describe('editor/state undo/redo', () => {
  it('初始状态不能 undo / redo', () => {
    const h = createInitialHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('addPiece 后能 undo,undo 后能 redo', () => {
    let h = createInitialHistory();
    h = addPieceAction(h, snapshot, '#f5b942').history;
    expect(h.current.pieces).toHaveLength(1);
    expect(canUndo(h)).toBe(true);

    h = undo(h);
    expect(h.current.pieces).toHaveLength(0);
    expect(canRedo(h)).toBe(true);

    h = redo(h);
    expect(h.current.pieces).toHaveLength(1);
  });

  it('新操作清空 future 栈', () => {
    let h = createInitialHistory();
    h = addPieceAction(h, snapshot, '#f5b942').history;
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    // 重新做一次新操作
    h = addPieceAction(h, snapshot, '#7e9bda').history;
    expect(canRedo(h)).toBe(false);
  });

  it('历史栈上限 100', () => {
    let h = createInitialHistory();
    for (let i = 0; i < 150; i++) {
      h = addPieceAction(h, snapshot, '#f5b942').history;
    }
    expect(h.past.length).toBeLessThanOrEqual(100);
    expect(h.current.pieces.length).toBe(150);
  });
});


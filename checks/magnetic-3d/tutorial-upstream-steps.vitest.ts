// Five upstream editor.test.ts step cases; fixture boundary and stable-ID regression adapted.
import {describe,it,expect} from 'vitest'
import {createInitialHistory,addStepAction,deleteStepAction,moveStepAction,updateStepAction,addPieceToStepAction} from '../../src/magnetic-tiles/three-d/vendor/editor/tutorial-state.ts'
import {createTutorial3D} from '../../src/magnetic-tiles/three-d/tutorial.ts'
import {parseAssembly3D} from '../../src/magnetic-tiles/three-d/assembly.ts'
import right from '../../src/magnetic-tiles/three-d/examples/right-angle.json' with {type:'json'}
describe('editor/state 步骤操作', () => {
  it('addStep 默认标题非空', () => {
    let h = createInitialHistory(createTutorial3D(parseAssembly3D(JSON.stringify(right))));
    const r = addStepAction(h);
    h = r.history;
    expect(h.current.steps).toHaveLength(1);
    expect(h.current.steps[0].title).not.toBe('');
  });

  it('deleteStep 删除指定步骤', () => {
    let h = createInitialHistory(createTutorial3D(parseAssembly3D(JSON.stringify(right))));
    const r1 = addStepAction(h);
    h = r1.history;
    const r2 = addStepAction(h);
    h = r2.history;
    expect(h.current.steps).toHaveLength(2);
    h = deleteStepAction(h, r1.stepId);
    expect(h.current.steps).toHaveLength(1);
    expect(h.current.steps.find((s) => s.id === r1.stepId)).toBeUndefined();
  });

  it('moveStep 重排序并保留稳定 ID（本地修复）', () => {
    let h = createInitialHistory(createTutorial3D(parseAssembly3D(JSON.stringify(right))));
    const r1 = addStepAction(h); h = r1.history;
    const r2 = addStepAction(h); h = r2.history;
    const r3 = addStepAction(h); h = r3.history;
    expect(h.current.steps.map((s) => s.id)).toEqual([1, 2, 3]);
    h = moveStepAction(h, 0, 2);
    expect(h.current.steps.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('updateStep 修改标题/说明', () => {
    let h = createInitialHistory(createTutorial3D(parseAssembly3D(JSON.stringify(right))));
    const r = addStepAction(h); h = r.history;
    h = updateStepAction(h, r.stepId, { title: '搭底座', description: '先放一片正方形' });
    expect(h.current.steps[0].title).toBe('搭底座');
    expect(h.current.steps[0].description).toBe('先放一片正方形');
  });

  it('addPieceToStep 去重', () => {
    let h = createInitialHistory(createTutorial3D(parseAssembly3D(JSON.stringify(right))));
    const p = {history:h, pieceId:h.current.assembly.pieces[0].id};
    h = p.history;
    const s = addStepAction(h);
    h = s.history;
    h = addPieceToStepAction(h, s.stepId, p.pieceId);
    h = addPieceToStepAction(h, s.stepId, p.pieceId);
    expect(h.current.steps[0].addedPieceIds).toEqual([p.pieceId]);
  });
});


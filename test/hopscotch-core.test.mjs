import test from 'node:test'
import assert from 'node:assert/strict'
import { CLASSIC_BOARD, DEFAULT_CONFIG, createHopscotch, getLegalTargets } from '../src/hopscotch-core.ts'

const legal = (id, maxJumpSteps = 1, allowBackward = true) => getLegalTargets(CLASSIC_BOARD, id, { maxJumpSteps, allowBackward })
test('classic board levels and lanes describe the 1–10 layout', () => {
  assert.equal(CLASSIC_BOARD.initialCell, '1')
  assert.deepEqual(CLASSIC_BOARD.cells.map(c => c.level), [0, 1, 1, 2, 3, 3, 4, 5, 5, 6])
  assert.deepEqual(CLASSIC_BOARD.cells.map(c => c.lane), ['center', 'left', 'right', 'center', 'left', 'right', 'center', 'left', 'right', 'center'])
})
test('one/two steps use levels, never numeric labels; same-level cells excluded', () => {
  assert.deepEqual(legal('1'), ['2', '3'])
  assert.deepEqual(legal('1', 2), ['2', '3', '4'])
  assert.deepEqual(legal('4'), ['2', '3', '5', '6'])
  assert.deepEqual(legal('4', 1, false), ['5', '6'])
  assert.deepEqual(legal('2'), ['1', '4'])
  for (const cell of CLASSIC_BOARD.cells) assert.ok(!legal(cell.id, 2).includes(cell.id))
})
test('Done moves to target, then issues a legal task; Repeat changes nothing', () => {
  const game = createHopscotch({ random: () => 0 })
  const before = game.read()
  assert.equal(before.currentCell, '1')
  assert.equal(before.targetCell, '2')
  assert.equal(before.task.text, '跳到 2')
  assert.deepEqual(game.repeat(), before)
  assert.deepEqual(game.read(), before)
  const after = game.done()
  assert.equal(after.currentCell, '2')
  assert.ok(after.legalTargets.includes(after.targetCell))
  assert.equal(after.completedCount, 1)
  assert.deepEqual(after.history, [{ from: '1', target: '2', outcome: 'DONE' }])
})
test('Skip leaves position unchanged and avoids the previous target when possible', () => {
  const game = createHopscotch({ random: () => 0 })
  const after = game.skip()
  assert.equal(after.currentCell, '1')
  assert.equal(after.targetCell, '3')
  assert.equal(after.completedCount, 0)
  assert.equal(after.skippedCount, 1)
  assert.deepEqual(after.history, [{ from: '1', target: '2', outcome: 'SKIP' }])
})
test('single target can repeat; no-target state is explicit and recoverable', () => {
  const game = createHopscotch({ config: { maxJumpSteps: 1, allowBackward: false }, random: () => 0 })
  game.done() // 2 -> only 4
  assert.equal(game.read().targetCell, '4')
  assert.equal(game.skip().targetCell, '4')
  for (let i = 0; i < 5; i++) game.done()
  const end = game.read()
  assert.equal(end.currentCell, '10')
  assert.equal(end.targetCell, null)
  assert.equal(end.task, null)
  assert.deepEqual(end.legalTargets, [])
  assert.deepEqual(game.done(), end)
  assert.deepEqual(game.skip(), end)
  assert.deepEqual(game.repeat(), end)
  assert.ok(['8', '9'].includes(game.setConfig(DEFAULT_CONFIG).targetCell))
})
test('config immediately recomputes legality, preserves valid targets, replaces invalid ones', () => {
  const game = createHopscotch({ random: () => 0.99 })
  const target = game.read().targetCell
  assert.equal(game.setConfig({ maxJumpSteps: 2, allowBackward: true }).targetCell, target)
  assert.deepEqual(game.read().legalTargets, ['2', '3', '4'])
  game.skip() // picks 4
  assert.equal(game.read().targetCell, '4')
  const after = game.setConfig(DEFAULT_CONFIG)
  assert.ok(['2', '3'].includes(after.targetCell))
  assert.equal(after.currentCell, '1')
  const backwards = createHopscotch({ random: () => 0 })
  backwards.done() // 2 -> 1
  assert.equal(backwards.read().targetCell, '1')
  assert.equal(backwards.setConfig({ maxJumpSteps: 1, allowBackward: false }).targetCell, '4')
})
test('Reset clears history/counts and restarts at 1 with the selected config', () => {
  const game = createHopscotch({ random: () => 0 })
  game.done(); game.skip(); game.setConfig({ maxJumpSteps: 2, allowBackward: false })
  const reset = game.reset()
  assert.equal(reset.currentCell, '1')
  assert.deepEqual(reset.history, [])
  assert.equal(reset.completedCount, 0)
  assert.equal(reset.skippedCount, 0)
  assert.deepEqual(reset.config, { maxJumpSteps: 2, allowBackward: false })
  assert.ok(reset.legalTargets.includes(reset.targetCell))
})
test('custom nonnumeric board labels and isolated state work without browser dependencies', () => {
  const board = { initialCell: 'green', cells: [
    { id: 'green', label: '绿色', level: 0, lane: 'center' },
    { id: 'blue', label: '蓝色', level: 1, lane: 'left' },
  ] }
  const game = createHopscotch({ board })
  board.cells[1].level = 100
  assert.equal(game.read().task.text, '跳到 蓝色')
  const read = game.done(); read.history[0].from = 'corrupted'; read.config.allowBackward = false
  assert.equal(game.read().history[0].from, 'green')
  assert.equal(game.read().config.allowBackward, true)
  assert.throws(() => game.setConfig({ maxJumpSteps: 0, allowBackward: true }), /config/)
  assert.throws(() => createHopscotch({ board: { ...board, initialCell: 'missing' } }), /board/)
})
test('hundreds of mixed moves and config changes always keep targets legal', () => {
  let seed = 17
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const game = createHopscotch({ random })
  for (let i = 0; i < 500; i++) {
    if (i % 13 === 0) game.setConfig({ maxJumpSteps: i % 2 ? 1 : 2, allowBackward: i % 3 !== 0 })
    const state = game.read()
    if (state.targetCell === null) { assert.equal(state.legalTargets.length, 0); game.reset(); continue }
    assert.ok(state.legalTargets.includes(state.targetCell))
    const current = CLASSIC_BOARD.cells.find(c => c.id === state.currentCell)
    const target = CLASSIC_BOARD.cells.find(c => c.id === state.targetCell)
    const delta = target.level - current.level
    assert.ok(Math.abs(delta) >= 1 && Math.abs(delta) <= state.config.maxJumpSteps)
    assert.ok(state.config.allowBackward || delta > 0)
    if (i % 4 === 0) assert.equal(game.skip().currentCell, state.currentCell)
    else assert.equal(game.done().currentCell, state.targetCell)
  }
})

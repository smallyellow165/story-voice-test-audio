import test from 'node:test'
import assert from 'node:assert/strict'
import { CLASSIC_BOARD, createHopscotch, formatHopscotchTask, presentHopscotchTask } from '../src/hopscotch-core.ts'
import { HOPSCOTCH_SCRIPTS } from '../src/hopscotch-scripts.ts'

const definition = { id: 'color-test', title: 'Test', tasks: [
  { id: 'a', type: 'jump_to', target: '2' },
  { id: 'b', type: 'jump_to_and_clap', target: '4' },
  { id: 'c', type: 'jump_to_and_turn', target: '6' },
] }
const make = (options = {}) => createHopscotch({ mode: 'script', script: definition, random: () => 0, ...options })
const gameplay = state => ({ current: state.currentCell, target: state.targetCell, index: state.scriptTaskIndex,
  task: state.resolvedTask, legal: state.legalTargets, history: state.history })

test('classic cell colors are board attributes in park order', () => {
  assert.deepEqual(CLASSIC_BOARD.cells.map(c => c.color), ['green', 'blue', 'orange', 'yellow', 'red', 'green', 'blue', 'orange', 'yellow', 'red'])
})
test('number and color formatter preserve all three primitive suffixes', () => {
  for (const [type, suffix] of [['jump_to', ''], ['jump_to_and_clap', '，然后拍拍手'], ['jump_to_and_turn', '，然后转一圈']]) {
    const task = { id: 't', type, target: '6' }
    assert.equal(formatHopscotchTask(task, CLASSIC_BOARD), `跳到 6${suffix}`)
    assert.equal(formatHopscotchTask(task, CLASSIC_BOARD, 'color'), `跳到绿色${suffix}`)
  }
})
test('unique legal color uses color; ambiguous or missing color falls back to number', () => {
  const task = { id: 't', type: 'jump_to', target: '6' }
  assert.equal(presentHopscotchTask(task, CLASSIC_BOARD, ['2', '3', '5', '6'], 'color').displayText, '跳到绿色')
  assert.deepEqual(presentHopscotchTask(task, CLASSIC_BOARD, ['1', '6'], 'color'), {
    targetColor: 'green', presentationKind: 'number', presentationFallbackReason: 'ambiguous_color', displayText: '跳到 6',
  })
  const board = { initialCell: '1', cells: CLASSIC_BOARD.cells.map(({ color, ...cell }) => cell) }
  const game = make({ board, instructionMode: 'color' })
  assert.equal(game.read().presentationFallbackReason, 'missing_color')
  assert.equal(game.read().displayText, '跳到 2')
})
test('script fallback reads resolved cell color and leaves definitions untouched', () => {
  const before = structuredClone(definition)
  const game = make({ instructionMode: 'color' })
  const state = game.skip() // still at 1; planned 4 is invalid, avoid skipped 2 => 3
  assert.equal(state.originalTask.target, '4')
  assert.equal(state.resolvedTask.target, '3')
  assert.equal(state.targetColor, 'orange')
  assert.equal(state.displayText, '跳到橙色，然后拍拍手')
  assert.deepEqual(definition, before)
})
test('Mixed choice is made once per task; reads/Repeat do not consume randomness', () => {
  let calls = 0
  const game = make({ instructionMode: 'mixed', presentationRandom: () => (++calls % 2 ? 0.9 : 0.1) })
  const first = game.read()
  assert.equal(first.displayText, '跳到蓝色')
  for (let i = 0; i < 10; i++) { assert.deepEqual(game.read(), first); assert.deepEqual(game.repeat(), first) }
  assert.equal(calls, 1)
  assert.equal(game.done().presentationKind, 'number')
  assert.equal(calls, 2)
  assert.equal(game.skip().presentationKind, 'color')
  assert.equal(calls, 3)
  assert.equal(game.reset().presentationKind, 'number')
  assert.equal(calls, 4)
})
test('instruction switches only alter presentation, update immediately and retain choice', () => {
  const game = make({ presentationRandom: () => 0.9 })
  game.done() // 2 -> 4, clap
  const before = gameplay(game.read())
  assert.equal(game.read().displayText, '跳到 4，然后拍拍手')
  assert.equal(game.setInstructionMode('color').displayText, '跳到黄色，然后拍拍手')
  assert.deepEqual(gameplay(game.read()), before)
  assert.equal(game.setInstructionMode('mixed').presentationKind, 'color')
  assert.deepEqual(gameplay(game.read()), before)
  assert.deepEqual(game.repeat(), game.read())
  assert.equal(game.setInstructionMode('number').displayText, '跳到 4，然后拍拍手')
  assert.deepEqual(gameplay(game.read()), before)
})
test('expanded legal set triggers ambiguity even when active target remains legal; Mixed never rerolls', () => {
  for (const mode of ['color', 'mixed']) {
    let calls = 0
    const game = make({ instructionMode: mode, presentationRandom: () => { calls++; return 0.9 } })
    game.done() // at 2, target 4 (yellow), step=1: [1,4]
    game.done() // at 4, target 6 (green), step=1: [2,3,5,6]
    assert.equal(game.read().displayText, '跳到绿色，然后转一圈')
    const count = calls
    const state = game.setConfig({ maxJumpSteps: 2, allowBackward: true }) // adds 1, also green
    assert.equal(state.targetCell, '6')
    assert.equal(state.presentationFallbackReason, 'ambiguous_color')
    assert.equal(state.displayText, '跳到 6，然后转一圈')
    assert.equal(calls, count)
    assert.deepEqual(game.repeat(), state)
    assert.equal(game.setConfig({ maxJumpSteps: 2, allowBackward: false }).displayText, '跳到绿色，然后转一圈')
    assert.equal(calls, count)
  }
})
test('finished and blocked have no presentation; switches do not revive tasks', () => {
  const game = make({ instructionMode: 'mixed' })
  for (let i = 0; i < 3; i++) game.done()
  for (const mode of ['color', 'number', 'mixed']) {
    const state = game.setInstructionMode(mode)
    assert.equal(state.status, 'finished'); assert.equal(state.displayText, null); assert.equal(state.targetColor, null)
  }
  const blocked = make({ board: { initialCell: '1', cells: [CLASSIC_BOARD.cells[0]] } })
  assert.equal(blocked.setInstructionMode('color').status, 'blocked')
  assert.equal(blocked.read().displayText, null)
})
test('all modes keep scripts intact; color instructions are unique across legal targets', () => {
  const before = structuredClone(HOPSCOTCH_SCRIPTS)
  for (const script of HOPSCOTCH_SCRIPTS) for (const mode of ['number', 'color', 'mixed']) {
    const game = make({ script, instructionMode: mode, presentationRandom: () => 0.9 })
    for (let i = 0; i < 12; i++) {
      game.setConfig({ maxJumpSteps: i % 2 ? 2 : 1, allowBackward: true })
      const state = game.read()
      if (state.presentationKind === 'color') {
        assert.equal(CLASSIC_BOARD.cells.filter(c => state.legalTargets.includes(c.id) && c.color === state.targetColor).length, 1)
      }
      assert.ok(state.legalTargets.includes(state.targetCell))
      if (i % 3) game.done(); else game.skip()
    }
    assert.equal(game.read().status, 'finished')
  }
  assert.deepEqual(HOPSCOTCH_SCRIPTS, before)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { CLASSIC_BOARD, DEFAULT_CONFIG, createHopscotch, formatHopscotchTask } from '../src/hopscotch-core.ts'
import { HOPSCOTCH_SCRIPTS } from '../src/hopscotch-scripts.ts'

const script = (targets, types = []) => ({ id: 'test', title: 'Test', tasks: targets.map((target, i) => ({
  id: `task-${i}`, type: types[i] ?? 'jump_to', target,
})) })
const gameFor = (definition, options = {}) => createHopscotch({ mode: 'script', script: definition, random: () => 0, ...options })

test('formatter covers exactly the three primitive actions', () => {
  for (const [type, text] of [['jump_to', '跳到 7'], ['jump_to_and_clap', '跳到 7，然后拍拍手'], ['jump_to_and_turn', '跳到 7，然后转一圈']]) {
    assert.equal(formatHopscotchTask({ id: 't', type, target: '7' }, CLASSIC_BOARD), text)
  }
})
test('script starts at zero; Done moves once and advances; Repeat is a pure read', () => {
  let calls = 0
  const game = gameFor(script(['2', '4', '6'], ['jump_to', 'jump_to_and_clap', 'jump_to_and_turn']), { random: () => { calls++; return 0 } })
  assert.equal(game.read().scriptTaskIndex, 0)
  assert.equal(game.read().scriptId, 'test')
  assert.equal(game.read().targetCell, '2')
  assert.equal(game.done().targetCell, '4')
  const state = game.done()
  assert.equal(state.currentCell, '4')
  assert.equal(state.scriptTaskIndex, 2)
  assert.equal(state.completedScriptTaskCount, 2)
  assert.equal(state.resolvedTask.type, 'jump_to_and_turn')
  assert.deepEqual(game.repeat(), state)
  assert.deepEqual(game.read(), state)
  assert.equal(calls, 0)
  assert.equal(game.done().currentCell, '6')
})
test('Skip advances without moving; fallback avoids skipped target and preserves type/id/source', () => {
  const source = script(['2', '7'], ['jump_to', 'jump_to_and_clap'])
  const copy = structuredClone(source)
  const game = gameFor(source)
  const state = game.skip()
  assert.equal(state.currentCell, '1')
  assert.equal(state.scriptTaskIndex, 1)
  assert.equal(state.skippedCount, 1)
  assert.equal(state.completedCount, 0)
  assert.deepEqual(state.originalTask, source.tasks[1])
  assert.deepEqual(state.resolvedTask, { id: 'task-1', type: 'jump_to_and_clap', target: '3' })
  assert.ok(state.legalTargets.includes(state.targetCell))
  assert.deepEqual(game.repeat(), state)
  const end = game.done()
  assert.deepEqual(end.history[1], { from: '1', target: '3', outcome: 'DONE', taskId: 'task-1', type: 'jump_to_and_clap', plannedTarget: '7' })
  assert.deepEqual(source, copy)
})
test('config changes retain legal active targets and re-resolve invalid targets without advancing', () => {
  const game = gameFor(script(['4'], ['jump_to_and_turn']), { config: { maxJumpSteps: 2, allowBackward: true } })
  assert.equal(game.read().targetCell, '4')
  const state = game.setConfig(DEFAULT_CONFIG)
  assert.equal(state.scriptTaskIndex, 0)
  assert.equal(state.currentCell, '1')
  assert.equal(state.resolvedTask.type, 'jump_to_and_turn')
  assert.ok(['2', '3'].includes(state.targetCell))
  assert.deepEqual(state.history, [])
  assert.equal(game.setConfig({ maxJumpSteps: 2, allowBackward: true }).targetCell, state.targetCell)
  const backwards = gameFor(script(['2', '1'], ['jump_to', 'jump_to_and_clap']))
  backwards.done()
  const forward = backwards.setConfig({ maxJumpSteps: 1, allowBackward: false })
  assert.equal(forward.currentCell, '2')
  assert.equal(forward.scriptTaskIndex, 1)
  assert.equal(forward.targetCell, '4')
  assert.equal(forward.resolvedTask.type, 'jump_to_and_clap')
})
test('finished is terminal after last Done or Skip, including config changes; Reset replays', () => {
  for (const action of ['done', 'skip']) {
    const game = gameFor(script(['2']))
    const end = game[action]()
    assert.equal(end.status, 'finished')
    assert.equal(end.scriptTaskIndex, 1)
    assert.equal(end.task, null)
    assert.equal(end.resolvedTask, null)
    assert.equal(end.targetCell, null)
    assert.deepEqual(game.done(), end)
    assert.deepEqual(game.skip(), end)
    assert.deepEqual(game.repeat(), end)
    assert.equal(game.setConfig({ maxJumpSteps: 2, allowBackward: false }).status, 'finished')
    const replay = game.reset()
    assert.equal(replay.status, 'active')
    assert.equal(replay.scriptId, 'test')
    assert.equal(replay.scriptTaskIndex, 0)
    assert.equal(replay.currentCell, '1')
    assert.equal(replay.completedCount, 0)
    assert.equal(replay.skippedCount, 0)
    assert.deepEqual(replay.history, [])
    assert.deepEqual(replay.config, { maxJumpSteps: 2, allowBackward: false })
  }
})
test('no-target blocked state preserves pending script index and recovers with config', () => {
  const game = gameFor(script(['2', '4', '5', '7', '8', '10', '9']), { config: { maxJumpSteps: 1, allowBackward: false } })
  for (let i = 0; i < 6; i++) game.done()
  const blocked = game.read()
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.currentCell, '10')
  assert.equal(blocked.scriptTaskIndex, 6)
  assert.equal(blocked.originalTask.target, '9')
  assert.equal(blocked.targetCell, null)
  assert.deepEqual(game.done(), blocked)
  assert.deepEqual(game.skip(), blocked)
  const resumed = game.setConfig(DEFAULT_CONFIG)
  assert.equal(resumed.targetCell, '9')
  assert.equal(resumed.scriptTaskIndex, 6)
  assert.equal(game.done().status, 'finished')
})
test('mode/script switches reset rounds but retain config and selected script', () => {
  const game = createHopscotch({ script: HOPSCOTCH_SCRIPTS[0] })
  assert.equal(game.read().mode, 'random')
  game.done()
  assert.equal(game.setMode('script').currentCell, '1')
  game.done()
  const mixed = game.setScript(HOPSCOTCH_SCRIPTS[1])
  assert.equal(mixed.scriptId, 'mixed')
  assert.equal(mixed.scriptTaskIndex, 0)
  assert.deepEqual(mixed.history, [])
  assert.equal(game.setMode('random').scriptTaskIndex, null)
  assert.equal(game.setMode('script').scriptId, 'mixed')
})
test('default hand-authored scripts are 12 legal tasks, no fallback under defaults', () => {
  for (const definition of HOPSCOTCH_SCRIPTS) {
    const game = gameFor(definition)
    assert.equal(definition.tasks.length, 12)
    for (const task of definition.tasks) {
      const state = game.read()
      assert.deepEqual(state.resolvedTask, task)
      assert.ok(state.legalTargets.includes(task.target))
      game.done()
    }
    assert.equal(game.read().status, 'finished')
    assert.equal(game.read().completedScriptTaskCount, 12)
    assert.equal(game.read().currentCell, '1')
  }
})
test('script source and returned snapshots cannot mutate runtime; malformed scripts are rejected', () => {
  const source = script(['2', '4'])
  const game = gameFor(source)
  source.tasks[1].target = '10'
  const state = game.read(); state.originalTask.target = '10'; state.resolvedTask.target = '10'
  assert.equal(game.read().targetCell, '2')
  assert.equal(game.done().targetCell, '4')
  assert.throws(() => game.setScript(script(['2'], ['sequence'])), /Invalid script/)
  assert.equal(game.read().targetCell, '4')
})
test('fallbacks remain legal across mixed Done/Skip/config runs and preserve primitive type', () => {
  for (let run = 0; run < 40; run++) {
    const source = HOPSCOTCH_SCRIPTS[run % 2]
    const before = structuredClone(source)
    const game = gameFor(source, { random: () => (run % 10) / 10 })
    for (let i = 0; i < 12; i++) {
      game.setConfig({ maxJumpSteps: i % 2 ? 1 : 2, allowBackward: i % 3 !== 0 })
      if (game.read().status === 'blocked') game.setConfig(DEFAULT_CONFIG)
      const state = game.read()
      assert.ok(state.legalTargets.includes(state.targetCell))
      assert.equal(state.resolvedTask.type, source.tasks[i].type)
      assert.equal(state.scriptTaskIndex, i)
      const next = (i + run) % 3 ? game.done() : game.skip()
      assert.equal(next.currentCell, (i + run) % 3 ? state.targetCell : state.currentCell)
    }
    assert.equal(game.read().status, 'finished')
    assert.deepEqual(source, before)
  }
})

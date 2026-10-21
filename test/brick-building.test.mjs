import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrickBuilding, BRICK_DESIGN } from '../src/brick-building-core.ts'
import { validateAssembly } from '../src/brick-test/assembly.ts'

// The existing bridge uses browser globals; no DOM, GPU, model or LLM needed.
globalThis.location = { search: '' }
globalThis.window = { removeEventListener() {} }

function fixture(instanceId = 'brick-instance') {
  const messages = []
  const game = createBrickBuilding({ instanceId, onMessage: message => messages.push(message) })
  game.setModelError(''); game.start()
  const command = (name = 'confirm_task', state = game.snapshot(), id = crypto.randomUUID()) => ({
    v: 1, instanceId, id, kind: 'command', name, sessionEpoch: 'session',
    payload: { expectedRunId: state.runId, expectedTaskAttemptId: state.taskAttemptId, baseRevision: state.revision },
  })
  return { game, messages, command, send: (name) => game.receive(command(name)) }
}

test('fixed design uses real parts and V2 validates each construction prefix', () => {
  assert.deepEqual(BRICK_DESIGN.bricks.map(b => [b.part, b.color, b.layer]), [['3437', '4', 0], ['3437', '1', 1]])
  for (let n = 1; n <= 2; n++) assert.equal(validateAssembly(BRICK_DESIGN.bricks.slice(0, n)).valid, true)
  assert.equal(validateAssembly(BRICK_DESIGN.bricks).connections[0].points.length, 4)
})

test('four explicit confirmations finish once; no timers or automatic advance', () => {
  const { game, messages, send } = fixture()
  for (const [index, taskId] of ['find-red', 'place-red', 'find-blue', 'stack-blue'].entries()) {
    assert.equal(game.snapshot().taskId, taskId)
    assert.equal(game.snapshot().progress.completed, index)
    send('confirm_task')
    assert.equal(messages.at(-1).payload.status, 'applied')
  }
  const final = game.snapshot()
  assert.equal(final.lifecycle, 'finished')
  assert.equal(final.progress.completed, 4)
  send('confirm_task')
  assert.deepEqual(game.snapshot(), final)
  assert.equal(messages.filter(m => m.name === 'game_finished').length, 1)
})

test('voice/button racing the same step, duplicate IDs and late IDs advance only once', () => {
  const { game, command, messages } = fixture()
  const button = command(), voice = command()
  game.receive(button)
  const committed = game.snapshot()
  game.receive(voice)
  assert.equal(messages.at(-1).payload.status, 'rejected')
  game.receive(button)
  assert.equal(messages.at(-1).payload.status, 'applied', 'cached receipt, no re-execution')
  game.receive({ ...voice, id: 'late-other-id' })
  assert.equal(messages.at(-1).payload.status, 'rejected')
  assert.deepEqual(game.snapshot(), committed)
  assert.equal(committed.progress.completed, 1)
  game.receive({ ...command(), payload: {} })
  assert.equal(messages.at(-1).payload.error, 'missing_task_reference')
  assert.deepEqual(game.snapshot(), committed)
})

test('repeat, help, waiting, unsupported actions and load failure never advance', () => {
  const { game, send, messages } = fixture()
  const before = game.snapshot()
  for (const name of ['repeat_task', 'help', 'wait', 'skip_task', 'next_task']) send(name)
  assert.deepEqual(game.snapshot(), before)
  assert.equal(messages.filter(m => m.name === 'task_repeated').length, 1)
  game.setModelError('3437.dat 加载失败：HTTP 503')
  send('confirm_task')
  assert.equal(messages.at(-1).payload.status, 'rejected')
  assert.match(messages.at(-1).payload.error, /3437.dat.*503/)
  assert.deepEqual(game.snapshot(), before)
  game.setModelError(''); send('confirm_task')
  assert.equal(game.snapshot().progress.completed, 1)
})

test('reset invalidates old run; exit/disposal and new instance reject old commands', () => {
  const { game, command, messages, send } = fixture()
  const old = command()
  send('confirm_task'); send('reset')
  const reset = game.snapshot()
  assert.notEqual(reset.runId, old.payload.expectedRunId)
  assert.equal(reset.progress.completed, 0)
  game.receive(old)
  assert.equal(messages.at(-1).payload.status, 'rejected')
  assert.deepEqual(game.snapshot(), reset)
  send('exit')
  assert.equal(messages.at(-1).name, 'activity_closed')
  const closed = game.snapshot(), count = messages.length
  game.receive(command()); game.dispose(); game.receive(old)
  assert.deepEqual(game.snapshot(), closed)
  assert.equal(messages.length, count)
  const next = fixture('new-instance')
  next.game.receive(old)
  assert.equal(next.game.snapshot().progress.completed, 0)
})

test('checkpoint restoration is exact, silent and cannot advance a disabled owner', () => {
  const source = fixture(), target = fixture()
  source.send('confirm_task'); source.send('confirm_task')
  const saved = source.game.snapshot()
  target.game.setEnabled(false)
  target.messages.length = 0
  target.game.restore(saved)
  assert.deepEqual(target.game.snapshot(), saved)
  assert.deepEqual(target.messages, [])
  target.send('confirm_task')
  assert.deepEqual(target.game.snapshot(), saved)
  target.game.setEnabled(true); target.send('confirm_task')
  assert.equal(target.game.snapshot().progress.completed, 3)
  assert.throws(() => target.game.restore({ ...saved, index: 3 }), /snapshot_mismatch/)
  assert.throws(() => target.game.restore({ ...saved, succeededTaskIds: ['find-blue', 'stack-blue'] }), /snapshot_mismatch/)
})

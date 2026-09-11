import test from 'node:test'
import assert from 'node:assert/strict'
import { createSimonRound, simonRoundFromIds, SIMON_ACTIONS } from '../src/games/simon-says.ts'
import { createGameRuntime, evaluate } from '../src/games/game-runtime.ts'

test('a round selects exactly three distinct actions from the six-action catalogue', () => {
  assert.equal(SIMON_ACTIONS.length, 6)
  for (const random of [() => 0, () => .99999, Math.random]) {
    for (let i = 0; i < 50; i++) {
      const round = createSimonRound(random)
      assert.equal(round.tasks.length, 3)
      assert.equal(new Set(round.tasks.map(t => t.id)).size, 3)
      assert.ok(round.tasks.every(t => SIMON_ACTIONS.some(a => a.id === t.id)))
    }
  }
})

test('manual confirmation uses the existing runtime; next and reset clear completion', () => {
  const definition = simonRoundFromIds(['clap', 'jump', 'spin'])
  const game = createGameRuntime(definition)
  for (let index = 0; index < 3; index++) {
    assert.equal(game.read().index, index)
    assert.equal(game.read().task.id, definition.tasks[index].id)
    assert.equal(game.read().result, 'NOT_YET')
    game.confirm(); assert.equal(game.read().result, 'SUCCESS')
    game.next()
  }
  game.reset(); assert.equal(game.read().index, 0); assert.equal(game.read().result, 'NOT_YET')
  assert.equal(evaluate({type:'manual'}, {confirmed:false}, {}), 'NOT_YET')
})

test('mirror restores the exact round sequence, never samples a replacement on handoff', () => {
  const definition = simonRoundFromIds(['hands_up', 'stomp', 'touch_head'])
  const game = createGameRuntime(simonRoundFromIds(definition.tasks.map(t => t.id)))
  game.restore(1)
  assert.equal(game.read().task.id, 'stomp')
  game.confirm(); game.next(); assert.equal(game.read().task.id, 'touch_head')
  for (const sequence of [[], ['clap','clap','spin'], ['clap','spin','unknown']]) assert.throws(() => simonRoundFromIds(sequence))
})

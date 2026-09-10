import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseGame, createGameRuntime, evaluate } from '../src/games/game-runtime.ts'
const definition = parseGame(JSON.parse(await readFile(new URL('../src/games/touch-color.json', import.meta.url), 'utf8')))
test('all five tasks, wrong input, ordered input and reset share the existing runtime', () => {
  const game = createGameRuntime(definition)
  for (const [index, task] of definition.tasks.entries()) {
    assert.equal(game.read().index, index)
    assert.equal(game.read().result, 'NOT_YET')
    const targets = task.condition.targets
    const wrong = ['red','blue','yellow'].find(color => color !== targets[0])
    game.select(wrong); assert.equal(game.read().result, 'NOT_YET')
    for (let i = 0; i < targets.length; i++) {
      game.select(targets[i])
      assert.equal(game.read().result, i === targets.length - 1 ? 'SUCCESS' : 'NOT_YET')
    }
    game.next()
  }
  game.reset(); assert.equal(game.read().index, 0); assert.equal(game.read().result, 'NOT_YET')
})
test('a wrong sequence cannot succeed with only its remaining suffix; retry works', () => {
  const game = createGameRuntime(definition); game.next();game.next();game.next()
  game.select('red'); game.select('yellow'); game.select('blue')
  assert.equal(game.read().result, 'NOT_YET')
  game.select('red'); game.select('red'); game.select('blue')
  assert.equal(game.read().result, 'SUCCESS')
  game.reset(); assert.deepEqual(game.read().selectedTargets, [])
})
test('selectSequence validates targets and evaluates exact ordered facts', () => {
  const condition = { type: 'selectSequence', targets: ['red','blue'] }
  assert.equal(evaluate(condition, { selectedTargets: ['blue','red'] }, {}), 'NOT_YET')
  assert.equal(evaluate(condition, { selectedTargets: ['red','blue'] }, {}), 'SUCCESS')
  for (const targets of [[], ['green'], null]) assert.throws(() => parseGame({ ...definition, tasks: [{id:'x',description:'x',condition:{type:'selectSequence',targets}}] }))
})

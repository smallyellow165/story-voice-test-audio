import assert from 'node:assert/strict'
import test from 'node:test'
import { createDinoJumpStrategy } from '../src/jump-dino-strategy.ts'

// Synthesize shoulder trajectories for known EMA outputs (alpha=.5), so
// threshold chatter, rebounds and the re-arm timing are directly controlled.
function harness(dt = 40) {
  const strategy = createDinoJumpStrategy()
  let y = 0.6, previousVelocity = 0, t = 0
  const events = []
  function input(visibility = 1) {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.4, y, visibility }))
    landmarks[12].x = 0.6
    return { timestampMs: t, landmarks }
  }
  strategy.update(input())
  const send = v => {
    t += dt
    y -= (2 * v - previousVelocity) * 0.2 * dt / 1000
    previousVelocity = v
    const result = strategy.update(input())
    if (result.event) events.push(result.event)
    return result
  }
  const quiet = ms => { for (let elapsed = 0; elapsed < ms; elapsed += dt) send(0) }
  return { send, quiet, events, strategy, input }
}

test('one jump with multiple threshold crossings, descent and rebound emits once', () => {
  const h = harness()
  for (const v of [3, 3, 2, 3, 3, -3, -3, 0, 3, 3, -1, 0]) h.send(v)
  h.quiet(600)
  assert.equal(h.events.length, 1)
})

test('three distinct jumps with quiet recovery emit three events at different frame rates', () => {
  for (const dt of [20, 40, 50]) {
    const h = harness(dt)
    for (let jump = 0; jump < 3; jump++) {
      for (const v of [3.2, 3.2, 3.2, 2.3, 3.2, -3, -3, 0]) h.send(v)
      h.quiet(550)
    }
    assert.equal(h.events.length, 3, `dt=${dt}`)
  }
})

test('ordinary slow motion and isolated velocity spikes do not emit', () => {
  const h = harness()
  for (const v of [0, 0.3, -0.4, 0.7, -1, 1.2, 0, 3.5, 0, 0, 0]) h.send(v)
  assert.equal(h.events.length, 0)
})

test('cooldown alone cannot re-arm during continuing motion', () => {
  const h = harness()
  h.send(3); h.send(3)
  for (let i = 0; i < 30; i++) h.send(i % 3 === 0 ? 2 : 3)
  assert.equal(h.events.length, 1)
  h.quiet(200)
  h.send(3); h.send(3)
  assert.equal(h.events.length, 2)
})

test('missing shoulders and low visibility do not produce an event or immediately re-arm', () => {
  const h = harness()
  h.send(3); h.send(3)
  assert.equal(h.strategy.update({ timestampMs: 100, landmarks: [] }).state, 'UNKNOWN')
  const invalid = h.input(0.2)
  invalid.timestampMs = 120
  assert.equal(h.strategy.update(invalid).event, null)
  const restored = h.input()
  restored.timestampMs = 160
  assert.equal(h.strategy.update(restored).debug.armed, 'NO')
})

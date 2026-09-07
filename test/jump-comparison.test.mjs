import assert from 'node:assert/strict'
import test from 'node:test'
import { createDinoJumpStrategy } from '../src/jump-dino-strategy.ts'
import { createJumpCountStrategy } from '../src/jump-count-strategy.ts'
import { JUMP_STRATEGIES, jumpResult } from '../src/jump-strategies.ts'

function pose(y) {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.4, y, visibility: 1 }))
  landmarks[12].x = 0.6
  landmarks[23].y += 0.2
  landmarks[24].y += 0.2
  return landmarks
}
test('Dino preserves normalized velocity/EMA and requires confirmation and re-arm', () => {
  const strategy = createDinoJumpStrategy()
  const update = (timestampMs, y) => strategy.update({ timestampMs, landmarks: pose(y) })
  assert.equal(update(0, 0.6).state, 'IDLE')
  const first = update(40, 0.55)
  assert.ok(Math.abs(first.debug.smoothedVelocity - 3.125) < 1e-8)
  assert.equal(first.event, null)
  assert.equal(update(80, 0.5).event.type, 'detected')
  for (let t = 120; t <= 640; t += 40) update(t, 0.5)
  assert.equal(update(680, 0.45).event, null)
  assert.equal(update(720, 0.4).event.type, 'detected')
  strategy.reset()
  assert.equal(update(400, 0.2).event, null)
  assert.equal(strategy.update({ timestampMs: 440, landmarks: [] }).state, 'UNKNOWN')
})
test('Jump Count emits only positive to negative transitions, without baseline or landing phases', () => {
  const strategy = createJumpCountStrategy()
  let time = 0
  const update = y => strategy.update({ timestampMs: time += 40, landmarks: pose(y) })
  for (let i = 0; i < 30; i++) update(0.4)
  const down = update(0.45)
  assert.equal(down.debug.peakSignal, 0.3)
  const up = update(0.35)
  assert.equal(up.debug.peakSignal, -0.3)
  assert.equal(up.event.type, 'detected')
  assert.equal(update(0.34).event, null)
  strategy.reset()
  assert.equal(update(0.35).event, null)
  const hidden = pose(0.3)
  hidden[11].visibility = hidden[12].visibility = 0
  const result = strategy.update({ timestampMs: time += 40, landmarks: hidden })
  assert.equal(result.state, 'UNKNOWN')
  assert.equal(result.event, null)
})
test('all four factories reset independently; shared event interpretation retains baseline semantics', () => {
  assert.equal(JUMP_STRATEGIES.length, 4)
  for (const entry of JUMP_STRATEGIES) {
    const strategy = entry.create()
    assert.equal(strategy.reset().state, 'UNKNOWN')
    assert.equal(jumpResult(strategy.reset()).event, false)
  }
  const base = { state: 'GROUND', event: null, reason: '', debug: {} }
  assert.equal(jumpResult({ ...base, event: { type: 'completed', timestampMs: 0 } }).event, true)
  assert.equal(jumpResult({ ...base, event: { type: 'takeoff', timestampMs: 0 } }).event, false)
})

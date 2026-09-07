import assert from 'node:assert/strict'
import test from 'node:test'
import { createJumpIntoRing } from '../src/jump-into-ring.ts'

const frame = (timestampMs, extras = {}) => ({ timestampMs, jumpEvent: false, ringReady: true,
  left: [0.3, 0.5], right: [0.5, 0.5], leftIn: true, rightIn: true, ...extras })

test('no result before delay + stable window; both feet IN gives YES and latches once', () => {
  const check = createJumpIntoRing()
  assert.equal(check.update(frame(0)).state, 'WAITING')
  check.update(frame(40, { jumpEvent: true }))
  for (let t = 80; t < 960; t += 40) assert.equal(check.update(frame(t)).state, 'WAITING')
  assert.equal(check.update(frame(960)).state, 'YES')
  assert.equal(check.update(frame(1000, { leftIn: false, rightIn: false })).state, 'YES')
  assert.equal(check.update(frame(1040, { jumpEvent: true })).state, 'WAITING')
})

test('one or both feet OUT gives NO regardless of the starting position', () => {
  for (const inside of [true, false]) {
    const check = createJumpIntoRing()
    check.update(frame(0, { jumpEvent: true }))
    let result
    for (let t = 40; t <= 1000; t += 40) result = check.update(frame(t, { leftIn: inside, rightIn: false }))
    assert.equal(result.state, 'NO')
  }
})

test('motion, missing feet, boundary flicker and frame gaps restart stability', () => {
  const check = createJumpIntoRing()
  check.update(frame(0, { jumpEvent: true }))
  for (let t = 40; t < 1200; t += 40) {
    assert.equal(check.update(frame(t, { left: [0.3 + t / 10000, 0.5] })).state, 'WAITING')
  }
  check.update(frame(1200, { left: null, leftIn: null }))
  for (let t = 1240; t < 1800; t += 40) {
    assert.equal(check.update(frame(t, { leftIn: t % 80 === 0 })).state, 'WAITING')
  }
  assert.equal(check.update(frame(2400)).state, 'WAITING')
  for (let t = 2440; t <= 2720; t += 40) check.update(frame(t))
  assert.equal(check.update(frame(2760)).state, 'YES')
})

test('timeout does not invent NO or score a later walk into the ring; reset cancels', () => {
  const check = createJumpIntoRing()
  check.update(frame(0, { jumpEvent: true, ringReady: false }))
  for (let t = 40; t < 6000; t += 40) check.update(frame(t, { ringReady: false }))
  for (let t = 6000; t < 7000; t += 40) assert.equal(check.update(frame(t)).state, 'WAITING')
  check.update(frame(7000, { jumpEvent: true }))
  check.reset()
  for (let t = 7040; t < 8200; t += 40) assert.equal(check.update(frame(t)).state, 'WAITING')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createBaselineJumpStrategy } from '../src/jump-baseline-strategy.ts'

// Deterministic pose trajectories exercise the temporal contract, not a camera.
function pose(leftLift = 0, rightLift = leftLift) {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }))
  points[11].y = points[12].y = 0.3
  points[23].y = points[24].y = 0.55
  points[29].y = points[31].y = 0.85 - leftLift * 0.25
  points[30].y = points[32].y = 0.85 - rightLift * 0.25
  return points
}
function harness(step = 20) {
  const strategy = createBaselineJumpStrategy()
  let t = 0
  const results = []
  const send = landmarks => {
    const result = strategy.update({ timestampMs: t, landmarks })
    t += step
    results.push(result)
    return result
  }
  for (let i = 0; i < Math.ceil(1000 / step); i++) send(pose())
  assert.equal(results.at(-1).state, 'GROUND')
  return { strategy, send, results, time: () => t }
}
function trajectory(h, map = p => p, step = 20) {
  for (let elapsed = 0; elapsed <= 1400; elapsed += step) {
    const lift = elapsed < 240 ? 0.20 * elapsed / 240
      : elapsed < 400 ? 0.20 : Math.max(0, 0.20 * (640 - elapsed) / 240)
    h.send(map(pose(lift)))
  }
}

test('full jump emits ordered phases and exactly one completion at several frame rates', () => {
  for (const step of [20, 33, 50]) {
    const h = harness(step)
    trajectory(h, undefined, step)
    for (let i = 0; i < 50; i++) h.send(pose())
    assert.deepEqual(h.results.flatMap(r => r.event ? [r.event.type] : []),
      ['takeoff', 'airborne', 'landing', 'completed'])
    assert.equal(h.results.at(-1).state, 'GROUND')
    trajectory(h, undefined, step)
    assert.equal(h.results.filter(r => r.event?.type === 'completed').length, 2)
  }
})

test('crouch, one-foot lift, heel-only rise and one-frame spike do not complete a jump', () => {
  for (const variant of ['crouch', 'one-foot', 'heel']) {
    const h = harness()
    trajectory(h, points => {
      if (variant === 'crouch') {
        points[29].y = points[30].y = points[31].y = points[32].y = 0.85
        points[11].y += 0.1; points[12].y += 0.1
        points[23].y += 0.1; points[24].y += 0.1
      } else if (variant === 'one-foot') points[30].y = points[32].y = 0.85
      else points[31].y = points[32].y = 0.85
      return points
    })
    assert.equal(h.results.some(r => r.event?.type === 'completed'), false)
  }
  const h = harness()
  h.send(pose(0.3))
  for (let i = 0; i < 50; i++) h.send(pose())
  assert.equal(h.results.some(r => r.event?.type === 'completed'), false)
})

test('visibility loss during flight cancels, then requires fresh calibration', () => {
  const h = harness()
  for (let i = 0; i < 20; i++) h.send(pose(i / 100))
  assert.equal(h.results.at(-1).state, 'AIRBORNE')
  const hidden = pose(0.2)
  hidden[29].visibility = 0.1
  const lost = h.send(hidden)
  assert.equal(lost.state, 'UNKNOWN')
  assert.equal(lost.event.type, 'cancelled')
  assert.equal(h.send(pose()).state, 'CALIBRATING')
  for (let i = 0; i < 50; i++) h.send(pose())
  assert.equal(h.results.at(-1).state, 'GROUND')
  assert.equal(h.results.some(r => r.event?.type === 'completed'), false)
})

test('sampling gaps, invalid timestamps, reset and timeout never imply a landing', () => {
  const h = harness()
  assert.equal(h.strategy.update({ timestampMs: h.time() + 1000, landmarks: pose() }).state, 'UNKNOWN')
  assert.equal(h.strategy.update({ timestampMs: NaN, landmarks: pose() }).state, 'UNKNOWN')
  assert.equal(h.strategy.reset().state, 'UNKNOWN')
  const flight = harness()
  for (let i = 0; i < 20; i++) flight.send(pose(i / 100))
  for (let i = 0; i < 150; i++) flight.send(pose(0.2))
  assert.equal(flight.results.some(r => r.event?.type === 'cancelled'), true)
  assert.equal(flight.results.some(r => r.event?.type === 'completed'), false)
})

test('unstable calibration does not arm the strategy; invalid parameters fail early', () => {
  const strategy = createBaselineJumpStrategy()
  let result
  for (let t = 0; t < 2000; t += 20) result = strategy.update({ timestampMs: t, landmarks: pose(t % 40 ? 0.1 : 0) })
  assert.equal(result.state, 'CALIBRATING')
  assert.throws(() => createBaselineJumpStrategy({ groundBand: 0.5 }), /Invalid/)
})

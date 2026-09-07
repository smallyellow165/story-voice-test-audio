import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { createJumpCountOriginalStrategy, OriginalJumpCountDetector } from '../src/jump-count-original-strategy.ts'

const referencePath = new URL('../../work/jumpcount-main/main.js', import.meta.url)
test('Original detector and full signal/event sequence match actual reference source',
  { skip: !existsSync(referencePath) && 'Local upstream reference not installed' }, () => {
    const source = readFileSync(referencePath, 'utf8')
    const start = source.indexOf('    var sig = 0;', source.indexOf('function onResults'))
    const end = source.indexOf('    var ret = {};', start)
    const context = vm.createContext({
      Plotly: { extendTraces() {}, relayout() {} },
      document: { getElementById: () => ({ innerHTML: '' }) },
    })
    vm.runInContext(source.slice(0, source.indexOf('const videoElement'))
      + source.slice(source.indexOf('var rollings ='), source.indexOf('function clearJumps'))
      + '\nvar npoints = 0; var direct = new Detector(30, 1.0);'
      + '\nfunction reference(landmarks) { var ts = 0; var before = njump;'
      + source.slice(start, end) + '\nreturn { sig, jump: njump > before }; }', context)
    const direct = new OriginalJumpCountDetector(30, 1.0)
    const strategy = createJumpCountOriginalStrategy()
    for (let i = 0; i < 1000; i++) {
      const value = i < 30 ? 0 : Math.sin(i / 11) * 0.08
      assert.equal(direct.update(value), context.direct.update(value))
      const landmarks = i % 29 === 0 ? [] : Array.from({ length: 33 }, (_, j) => ({
        x: 0.5, y: 0.4 + value + j * 0.002, visibility: i % 19 === 0 ? 0.4 : 0.9,
      }))
      const expected = context.reference(landmarks)
      const actual = strategy.update({ timestampMs: i * 1000, landmarks }) // No gap reset.
      assert.equal(actual.debug.peakSignal, expected.sig, `signal at ${i}`)
      assert.equal(actual.event?.type === 'detected', expected.jump, `event at ${i}`)
    }
    for (const key of ['y', 'signals', 'filteredY', 'avgFilter', 'stdFilter']) {
      assert.deepEqual(direct[key], Array.from(context.direct[key]), key)
    }
  })

test('empty frames preserve the positive signal; explicit reset creates a new session', () => {
  const strategy = createJumpCountOriginalStrategy()
  const pose = y => Array.from({ length: 33 }, () => ({ x: 0.5, y, visibility: 1 }))
  strategy.update({ timestampMs: 0, landmarks: pose(0.4) })
  assert.equal(strategy.update({ timestampMs: 40, landmarks: pose(0.5) }).debug.peakSignal, 0.3)
  strategy.update({ timestampMs: 80, landmarks: [] })
  assert.equal(strategy.update({ timestampMs: 5000, landmarks: pose(0.3) }).event.type, 'detected')
  strategy.reset()
  assert.equal(strategy.update({ timestampMs: 6000, landmarks: pose(0.3) }).event, null)
})

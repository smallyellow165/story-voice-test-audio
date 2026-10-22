import test from 'node:test'
import assert from 'node:assert/strict'
import { bboxStyle, observationDescription } from '../src/brick-vision/observation-view.mjs'

test('normalized BBox uses the full image without changing original coordinates', () => {
  const bbox = [0.25, 0.125, 0.75, 0.625]
  assert.deepEqual(bboxStyle(bbox), { left: '25%', top: '12.5%', width: '50%', height: '50%' })
  assert.deepEqual(bbox, [0.25, 0.125, 0.75, 0.625])
  assert.deepEqual(bboxStyle([0, 0, 1, 1]), { left: '0%', top: '0%', width: '100%', height: '100%' })
})

test('missing, inverted, out-of-range or nonnumeric boxes are not drawn', () => {
  for (const bbox of [null, undefined, [], [0, 0, 1], [0, 0, 0, 1], [0.8, 0, 0.1, 1],
    [-0.1, 0, 1, 1], [0, 0, 1.1, 1], ['0', 0, 1, 1], [NaN, 0, 1, 1], [0, Infinity, 1, 1]]) {
    assert.equal(bboxStyle(bbox), null)
  }
})

test('short description only quotes explicit unambiguous model evidence', () => {
  assert.equal(observationDescription('可见一个2x2蓝色积木。'), '2×2 · 蓝色')
  assert.equal(observationDescription('A 2×4 red brick.'), '2×4 · red')
  assert.equal(observationDescription('绿色积木'), '— · 绿色')
  for (const text of ['', '普通积木', '可能是2x2蓝色积木', '不是蓝色', '2x2或2x4蓝色积木', '红色或蓝色']) {
    assert.equal(observationDescription(text), '—')
  }
  assert.equal(observationDescription(null), '—')
})

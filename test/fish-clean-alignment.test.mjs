import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanAlignment, selectedAlignment } from '../src/fish-clean-alignment.mjs'
const result = { text: '狸猫叔叔。', speed: .7, model: 'test', events: [{ content: 'duplicate' }],
  timeline: ['狸','猫','叔','叔'].map((text, i) => ({ text, global_start: 2.72 + i * .2, global_end: 2.92 + i * .2 })) }
const clean = cleanAlignment(result, 'full.mp3', 4.23)
test('canonical contains only final global segments and minimal metadata', () => {
  assert.deepEqual(Object.keys(clean), ['text','speed','model','audio','segments','duration'])
  assert.equal(clean.segments.length, 4)
  clean.segments.forEach((s,i) => {
    assert.equal(s.index, i)
    assert.equal(s.start, result.timeline[i].global_start)
    assert.equal(s.end, result.timeline[i].global_end)
  })
  assert.ok(!JSON.stringify(clean).includes('content'))
})
test('continuous selection rebases, retains duplicate chars and renumbers', () => {
  const { alignment, start, end } = selectedAlignment(clean, 1, 3, 'clip.mp3')
  assert.equal(alignment.text, '猫叔叔')
  assert.equal(start, clean.segments[1].start)
  assert.equal(end, clean.segments[3].end)
  assert.deepEqual(alignment.segments.map(s => s.index), [0,1,2])
  assert.deepEqual(alignment.segments.map(s => [s.start,s.end]), [[0,.2],[.2,.4],[.4,.6]])
  assert.equal(alignment.duration, .6)
  assert.equal(selectedAlignment(clean, 2, 2, 'one.mp3').alignment.text, '叔')
})
test('reversed, out-of-range and invalid timing rejected', () => {
  for(const range of [[2,1],[-1,2],[0,4],[0,1.5]]) assert.throws(() => selectedAlignment(clean,...range,'clip.mp3'))
  assert.throws(() => cleanAlignment(result,'full.mp3',1))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { sseMessages, collectTimestampAudio, generateFishTimestamp } from '../server/fish-timestamp-debug.mjs'

async function* bytes(text) {
  // Deliberately split CRLF, JSON and Chinese UTF-8 across reads.
  for (const byte of Buffer.from(text)) yield Buffer.from([byte])
}
const event = (seq, offset, alignment, audio = 'a') => ({
  audio_base64: Buffer.from(audio).toString('base64'), chunk_seq: seq,
  chunk_audio_offset_sec: offset, content: '狸猫', alignment,
})
const alignment = (text, end) => ({ audio_duration: end, segments: [{ text, start: 0, end }] })

test('SSE supports comments, CRLF, multi-line data, UTF8 and split reads', async () => {
  const result = []
  for await (const value of sseMessages(bytes(': ping\r\nevent: message\r\ndata: {"text":\r\ndata: "狸猫"}\r\n\r\n'))) result.push(value)
  assert.deepEqual(JSON.parse(result[0].data), { text: '狸猫' })
  assert.equal(result.length, 1)
})
test('audio appends every event, latest alignment replaces and offsets apply exactly once', async () => {
  const values = [event(0, 0, null), event(0, 0, alignment('狸', .2)),
    event(0, 0, alignment('狸猫', .5)), event(0, 0, null),
    event(1, .5, alignment('叔叔', .6)), event(1, .5, alignment('叔叔', .7), '')]
  const result = await collectTimestampAudio(bytes(values.map(v => `data: ${JSON.stringify(v)}\n\n`).join('')))
  assert.equal(result.audioContent.toString(), 'aaaaa')
  assert.equal(result.events.length, 6)
  assert.equal(result.timeline.length, 2)
  assert.equal(result.timeline[0].text, '狸猫')
  assert.equal(result.timeline[1].local_end, .7)
  assert.equal(result.timeline[1].global_start, .5)
  assert.equal(result.timeline[1].global_end, 1.2)
})
test('null alignment returns playable audio with empty timeline', async () => {
  const result = await collectTimestampAudio(bytes(`data: ${JSON.stringify(event(0, 0, null))}\n\n`))
  assert.deepEqual(result.timeline, [])
})
test('truncated SSE, malformed JSON, provider error and invalid timing fail', async () => {
  for (const input of ['data: {}', 'data: nope\n\n', 'event: error\ndata: {}\n\n',
    `data: ${JSON.stringify(event(0, 0, alignment('狸', -1)))}\n\n`]) {
    await assert.rejects(collectTimestampAudio(bytes(input)))
  }
})
test('empty and oversize input rejected before provider call', async () => {
  await assert.rejects(generateFishTimestamp(' '), { statusCode: 400 })
  await assert.rejects(generateFishTimestamp('猫'.repeat(3000)), { statusCode: 400 })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTimestampHistory, historyKey } from '../server/fish-timestamp-history.mjs'

test('disk reuse, separate speed/voice, force, concurrency, corruption and failed refresh', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fish-history-test-'))
  const voice = process.env.FISH_AUDIO_MODEL_ID
  process.env.FISH_AUDIO_MODEL_ID = 'test-voice'
  t.after(async () => { await rm(dir, { recursive: true, force: true }); if (voice === undefined) delete process.env.FISH_AUDIO_MODEL_ID; else process.env.FISH_AUDIO_MODEL_ID = voice })
  let calls = 0, fail = false
  const generate = async (text, speed, config) => {
    calls++
    if (fail) throw new Error('fake provider failure')
    return { text, speed, model: config.model, format: 'audio/mpeg', audio_base64: Buffer.from(`audio-${calls}`).toString('base64'), events: [], chunks: [],
      timeline: [{ text: '猫', global_start: .1, global_end: .5 }] }
  }
  const options = { generate, probe: async () => 1 }
  let store = createTimestampHistory(dir, options)
  const a = await store.generate('猫', .7)
  assert.equal(calls, 1); assert.equal(a.history.source, 'generated')
  const key = a.history.cache_key
  const metadata = JSON.parse(await readFile(path.join(dir,key,'metadata.json')))
  assert.ok(metadata.checksums['audio.mp3']); assert.ok(!('request' in a.history))
  assert.equal(JSON.parse(await readFile(path.join(dir,key,'alignment.json'))).segments[0].start,.1)
  // New store instance simulates restart: no in-memory cached result.
  store = createTimestampHistory(dir, options)
  const b = await store.generate('猫', .7)
  assert.equal(b.audio_base64,a.audio_base64); assert.equal(calls,1); assert.equal(b.history.source,'history')
  const c = await store.generate('猫', .8)
  assert.notEqual(c.history.cache_key,key); assert.equal(calls,2)
  const regenerated = await store.regenerate(key)
  assert.equal(calls,3); assert.notEqual(regenerated.audio_base64,a.audio_base64)
  assert.equal((await store.load(key)).audio_base64,regenerated.audio_base64); assert.equal(calls,3)
  fail = true
  await assert.rejects(store.regenerate(key)); fail = false
  assert.equal((await store.load(key)).audio_base64,regenerated.audio_base64)
  const count = calls
  const [x,y] = await Promise.all([store.generate('猫',.9),store.generate('猫',.9)])
  assert.equal(calls,count+1);assert.equal(x.audio_base64,y.audio_base64)
  await writeFile(path.join(dir,key,'audio.mp3'),'corrupt')
  await assert.rejects(store.load(key),{statusCode:404})
  assert.ok(!(await store.list()).some(e=>e.cache_key===key))
  const recovered = await store.generate('猫',.7)
  assert.equal(recovered.history.source,'generated')
  await rm(path.join(dir,key,'alignment.json'))
  await assert.rejects(store.load(key),{statusCode:404})
  process.env.FISH_AUDIO_MODEL_ID='another-voice'
  const d=await store.generate('猫',.8)
  assert.notEqual(d.history.cache_key,c.history.cache_key)
  assert.notEqual(historyKey({...metadata.request,model:'different-model'}),key)
  await assert.rejects(store.load('../escape'),{statusCode:404})
})

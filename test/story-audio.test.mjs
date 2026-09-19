import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { storyAudioItems } from '../src/story-audio.mjs'
import { createStoryAudioStore, storyAudioPath } from '../server/story-audio.mjs'

const story = {
  id: 'index-gap-demo', title: '森林里的声音', content: '完整故事',
  sections: [{ id: 'section-1', items: [
    { type: 'narration', text: '森林里传来一个声音。' },
    { type: 'sound', sound_id: 'cat', text: 'This must not become TTS.' },
    { type: 'narration', text: '原来是一只小猫！' },
  ] }],
}

test('original item positions survive skipped sound items and Story is not mutated', () => {
  const original = structuredClone(story)
  const items = storyAudioItems(story)
  assert.deepEqual(items.map(item => item.item_index), [1, 3])
  assert.deepEqual(items.map(item => item.filename), ['index-gap-demo__section-1__item-1.mp3', 'index-gap-demo__section-1__item-3.mp3'])
  assert.deepEqual(story, original)
})

test('reject unsafe IDs, duplicate sections, and empty narration', () => {
  assert.throws(() => storyAudioItems({ ...story, id: '../escape' }))
  assert.throws(() => storyAudioItems({ ...story, sections: [story.sections[0], story.sections[0]] }))
  assert.throws(() => storyAudioItems({ ...story, sections: [{ id: 's', items: [{ type: 'narration', text: '' }] }] }))
})

test('story directory holds manifest and original-index filenames; regeneration replaces metadata', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'story-audio-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  // Storage-only test; real provider/MP3 checks are run separately.
  const store = createStoryAudioStore(root, async (filename, data) => { await writeFile(filename, data); return 1 })
  const items = storyAudioItems(story)
  const audio = { audioContent: Buffer.from('storage fixture'), provider: 'gemini', voice: 'Achernar', model: 'test-model' }
  const results = await Promise.all(items.map(item => store.save(item, audio)))
  const directory = path.join(root, story.id)
  assert.deepEqual((await readdir(directory)).sort(), ['index-gap-demo__section-1__item-1.mp3', 'index-gap-demo__section-1__item-3.mp3', 'manifest.json'])
  await store.save(items[0], { ...audio, provider: 'fish', voice: 'fish-test' })
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.story_id, story.id)
  assert.equal(manifest.assets.length, 2)
  assert.equal(manifest.assets.find(item => item.item_index === 1).provider, 'fish')
  assert.deepEqual(manifest.assets.map(item => item.item_index).sort(), [1, 3])
  assert.equal(storyAudioPath(root, results[0].url), path.join(directory, items[0].filename))
  assert.equal(storyAudioPath(root, '/generated/story-audio/../secret.mp3'), null)
  assert.equal(storyAudioPath(root, '/generated/story-audio/a/../../secret.mp3'), null)
})

test('failed audio save does not add a manifest asset', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'story-audio-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createStoryAudioStore(root, async () => { throw new Error('save failed') })
  await assert.rejects(store.save(storyAudioItems(story)[0], {}), /save failed/)
  await assert.rejects(readFile(path.join(root, story.id, 'manifest.json')), { code: 'ENOENT' })
})

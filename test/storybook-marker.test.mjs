import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createMarkerNavigation, loadMarkerMapping } from '../src/storybook-navigation.ts'
import { loadStory, createStorySelection, sectionNarration } from '../src/story-content.ts'
const json = name => JSON.parse(readFileSync(new URL(`../../story-voice-pipecat-poc-v4/server/data/stories/${name}.json`, import.meta.url), 'utf8'))
const demo = json('story').find(story => story.id === 'storybook-demo'), mapping = loadMarkerMapping(json('storybook-markers'))
const nav = () => createMarkerNavigation(mapping)
const confirmed = () => { const n = nav(); n.update([101], 0); n.update([101], 300); return n }
test('all six data-driven markers select their corresponding section content', () => {
  const story = loadStory(demo), selection = createStorySelection(story)
  assert.equal(story.sections.length, 6)
  for (const [id, ref] of Object.entries(mapping)) {
    const n = nav(); n.update([Number(id)], 0); const state = n.update([Number(id)], 300)
    assert.deepEqual(state.transition, ref); assert.equal(ref.storyId, story.id)
    selection.setCurrentSection(state.transition.sectionId)
    assert.equal(selection.read().content, demo.sections[ref.pageNumber - 1].content)
    const expectedItems = demo.sections[ref.pageNumber - 1].items
    assert.deepEqual(selection.read().items, expectedItems)
    assert.equal(sectionNarration(selection.read()), expectedItems.filter(item => item.type === 'narration').map(item => item.text).join('\n'))
    assert.deepEqual(Object.keys(state.transition).sort(), ['pageNumber', 'sectionId', 'storyId'])
  }
})
test('unknown marker is harmless and clears candidate', () => { const n = nav(); n.update([101],0); assert.equal(n.update([999],500).currentPage,null); assert.equal(n.read().candidatePage,null) })
test('requires full confirmation threshold', () => { const n = nav(); assert.equal(n.update([101],0).transition,null); assert.equal(n.update([101],299).currentPage,null); assert.equal(n.update([101],300).currentSection,'section-1') })
test('same marker never repeats transition', () => { const n = confirmed(); for (const t of [301,500,2000]) assert.equal(n.update([101],t).transition,null); assert.equal(n.read().pageChangeCount,1) })
test('A to B commits once after stable duration', () => { const n = confirmed(); n.update([102],400); assert.equal(n.update([102],699).currentSection,'section-1'); assert.equal(n.update([102],700).currentSection,'section-2'); assert.equal(n.update([102],900).transition,null); assert.equal(n.read().pageChangeCount,2) })
test('A B A jitter does not switch to unconfirmed B', () => { const n = confirmed(); n.update([102],400); n.update([101],500); n.update([102],600); assert.equal(n.update([102],800).currentSection,'section-1'); n.update([101],850); assert.equal(n.read().pageChangeCount,1) })
test('short loss retains page and detection', () => { const n = confirmed(); const state = n.update([],1099); assert.equal(state.currentSection,'section-1'); assert.equal(state.stableDetection,true) })
test('long loss marks detection absent but retains selected content', () => { const n = confirmed(); const state = n.update([],1100); assert.equal(state.currentSection,'section-1'); assert.equal(state.stableDetection,false) })
test('same-page recovery after short or long loss is not a new transition', () => { for (const t of [500,1500]) { const n = confirmed(); n.update([],t); const state = n.update([101],t+1); assert.equal(state.stableDetection,true); assert.equal(state.transition,null); assert.equal(state.pageChangeCount,1) } })
test('loss cancels an unconfirmed candidate', () => { const n = nav(); n.update([101],0); n.update([],200); assert.equal(n.update([101],400).transition,null); assert.equal(n.update([101],700).currentSection,'section-1') })
test('rapid candidates do not accumulate stability time', () => { const n = nav(); n.update([101],0); n.update([102],200); n.update([101],400); assert.equal(n.update([101],699).transition,null) })
test('reset clears complete navigation state and permits a new clock origin', () => { const n = confirmed(); n.update([102],500); n.reset(); assert.deepEqual(n.read(),nav().read()); assert.equal(n.update([102],0).currentPage,null) })
test('timings are configurable, including immediate confirmation', () => { const n = createMarkerNavigation(mapping,{confirmAfterMs:50,lostAfterMs:100}); n.update([101],0); assert.equal(n.update([101],50).pageChangeCount,1); assert.equal(n.update([],149).stableDetection,true); assert.equal(n.update([],150).stableDetection,false); assert.equal(createMarkerNavigation(mapping,{confirmAfterMs:0,lostAfterMs:0}).update([101],0).pageChangeCount,1) })
test('multiple distinct markers are ambiguous; duplicate IDs are one marker', () => { const n = nav(); n.update([101,102],0); assert.equal(n.update([101,102],400).currentPage,null); n.update([101,101],500); assert.equal(n.update([101],800).currentSection,'section-1') })
test('runtime is executable in Node without DOM, camera or playback services', () => { assert.equal(typeof globalThis.document,'undefined'); assert.equal(nav().update([],0).pageChangeCount,0) })
test('invalid timestamps, IDs, timing and mapping are rejected', () => { const n = nav(); n.update([],10); assert.throws(()=>n.update([],9)); assert.throws(()=>n.update([],NaN)); assert.throws(()=>n.update([-1],10)); assert.throws(()=>createMarkerNavigation(mapping,{confirmAfterMs:-1,lostAfterMs:800})); assert.throws(()=>loadMarkerMapping({'101':{sectionId:'x'}})) })
test('caller cannot mutate navigation mapping or state', () => { const data = structuredClone(mapping), n = createMarkerNavigation(data); data['101'].sectionId='broken'; n.update([101],0); const state = n.update([101],300); state.currentPage.sectionId='broken'; assert.equal(n.read().currentSection,'section-1') })
const shortStory = {id:'short',title:'短故事',age:'3-4',summary:'简介',characters:['瑞瑞'],tags:[],content:'正文'}
test('existing short Story normalizes to one implicit section without migration', () => { const story = loadStory(shortStory); assert.equal(story.sections[0].id,'short:whole'); assert.equal(sectionNarration(story.sections[0]),shortStory.content) })
test('existing narration/audio/sound pattern preserves item order and media metadata', () => { const items = [{type:'narration',text:'A',audio:{asset_id:'a'}},{type:'sound',sound_id:'cat'},{type:'narration',text:'B'}]; const story = loadStory({...shortStory,items,media:{image:'opaque'}}); assert.deepEqual(story.sections[0].items,items); assert.equal(sectionNarration(story.sections[0]),'A\nB'); assert.deepEqual(story.sections[0].media,{image:'opaque'}) })
test('content loader rejects malformed fields, sections and items', () => { for (const patch of [{title:''},{characters:'x'},{sections:[]},{sections:[{id:'a',content:'x'},{id:'a',content:'y'}]},{items:[]},{items:[{type:'other'}]},{items:[{type:'narration',text:'x',audio:{}}]},{sections:[{id:'a'}]}]) assert.throws(()=>loadStory({...shortStory,...patch})) })
test('section selection is independent, idempotent, isolated and resettable', () => { const story = loadStory(demo), s = createStorySelection(story); assert.equal(s.read(),null); assert.equal(s.setCurrentSection('section-3'),true); assert.equal(s.setCurrentSection('section-3'),false); const expected=s.read().content; story.sections[2].content='mutated'; const result=s.read(); result.content='mutated'; assert.equal(s.read().content,expected); assert.throws(()=>s.setCurrentSection('missing')); s.reset(); assert.equal(s.read(),null) })

test('demo sections cover single narration, multiple narration and narration/sound/narration', () => {
  const story = loadStory(demo)
  assert.deepEqual(story.sections.map(section => section.items.map(item => item.type)), [
    ['narration'], ['narration', 'narration'], ['narration', 'sound', 'narration'],
    ['narration', 'narration'], ['narration'], ['narration'],
  ])
  assert.equal(story.sections[2].items[1].sound_id, 'cat')
})
test('marker section switches retain complete ordered item sequences, including on return', () => {
  const story = loadStory(demo), selection = createStorySelection(story), n = nav()
  for (const [index, marker] of [103, 102, 104, 101, 103].entries()) {
    const start = index * 1000
    n.update([marker], start)
    const state = n.update([marker], start + 300)
    assert.equal(state.transition.sectionId, mapping[marker].sectionId)
    selection.setCurrentSection(state.transition.sectionId)
    assert.deepEqual(selection.read().items, demo.sections.find(section => section.id === state.currentSection).items)
    assert.equal(state.pageChangeCount, index + 1)
    assert.equal(n.update([marker], start + 500).transition, null)
  }
})
test('section content need not equal concatenated narration text', () => {
  const content = '小猫叫了一声，瑞瑞向它问好。'
  const items = [{type:'sound',sound_id:'cat'}, {type:'narration',text:'瑞瑞向小猫问好。'}]
  const story = loadStory({...shortStory,sections:[{id:'greeting',content,items}]})
  const selection = createStorySelection(story)
  selection.setCurrentSection('greeting')
  assert.equal(selection.read().content, content)
  assert.deepEqual(selection.read().items, items)
  assert.notEqual(sectionNarration(selection.read()), content)
})

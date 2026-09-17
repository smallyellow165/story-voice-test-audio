import demo from './data/storybook-demo.json'
import markerData from './data/storybook-markers.json'
import { loadStory, createStorySelection, sectionNarration } from './story-content'
import { createMarkerNavigation, loadMarkerMapping } from './storybook-navigation'
import './storybook-marker.css'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `<header><h1>Storybook · Marker Simulator</h1><p>一个 Story，六个 section。模拟 marker 只选择内容；本页不播放声音。</p></header>
<main><section><h2>Marker Simulator</h2><div id="markers" class="markers"></div><p>点击后保持该输入，每 50 ms 采样一次。</p>
<label>确认时间（ms）<input id="confirm" type="number" min="0" value="300"></label>
<label>丢失时间（ms）<input id="lost" type="number" min="0" value="800"></label>
<button id="apply">应用时间并重置</button><button id="reset">Reset</button><p id="error" role="alert"></p></section>
<section aria-live="polite"><h2 id="title"></h2><p id="page"></p><h3>Text · content</h3><p id="text"></p><h3>Narration · items</h3><p id="narration"></p><h3 id="items-title">Items · section 内的有序序列</h3><ol id="items"></ol><h3>Image / media metadata</h3><pre id="media"></pre></section>
<section><h2>Navigation debug</h2><pre id="debug"></pre><h3>事件日志（最近 30 条）</h3><ol id="events"></ol></section></main>`
const element = (id: string) => document.getElementById(id)!
const story = loadStory(demo), mapping = loadMarkerMapping(markerData)
for (const ref of Object.values(mapping)) {
  if (ref.storyId !== story.id || !story.sections.some(section => section.id === ref.sectionId)) throw new Error('Marker references unknown Story section')
}
const selection = createStorySelection(story)
let navigation = createMarkerNavigation(mapping), input: number[] = [], previous = ''
const events: string[] = []
function log(message: string) {
  events.unshift(`${new Date().toLocaleTimeString()} ${message}`); events.splice(30)
  element('events').replaceChildren(...events.map(message => { const li = document.createElement('li'); li.textContent = message; return li }))
}
function render() {
  const state = navigation.read(), section = selection.read()
  element('title').textContent = story.title
  element('page').textContent = section ? `Page ${state.currentPage?.pageNumber} · ${section.id}` : '等待稳定的 marker…'
  element('text').textContent = section?.content ?? '—'
  element('narration').textContent = section ? sectionNarration(section) || '（本 section 没有 narration）' : '—'
  element('items-title').textContent = `Items · section 内的有序序列（${section?.items?.length ?? 0}）`
  element('items').replaceChildren(...(section?.items ?? []).map(item => {
    const li = document.createElement('li')
    const kind = document.createElement('strong')
    kind.textContent = item.type
    const detail = document.createElement('p')
    detail.textContent = item.type === 'narration' ? item.text : `sound_id: ${item.sound_id}`
    li.append(kind, detail)
    return li
  }))
  element('media').textContent = JSON.stringify(section?.media ?? {}, null, 2)
  element('debug').textContent = JSON.stringify(state, null, 2)
  for (const button of element('markers').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.marker === (input[0]?.toString() ?? 'none')))
}
for (const id of [...Object.keys(mapping), '999', 'none']) {
  const button = document.createElement('button'); button.dataset.marker = id
  button.textContent = id === 'none' ? 'No Marker' : id === '999' ? '999 · Unknown' : `Marker ${id}`
  button.onclick = () => { input = id === 'none' ? [] : [Number(id)]; log(`输入：${button.textContent}`); tick() }
  element('markers').append(button)
}
function tick() {
  const state = navigation.update(input, performance.now())
  if (state.transition) {
    selection.setCurrentSection(state.transition.sectionId)
    log(`page changed → ${state.transition.pageNumber} / ${state.transition.sectionId}`)
  }
  const signature = JSON.stringify(navigation.read())
  if (signature !== previous) {
    if (previous && JSON.parse(previous).stableDetection !== state.stableDetection) log(`stable detection → ${state.stableDetection}`)
    previous = signature; render()
  }
}
function reset() {
  input = []; navigation.reset(); selection.reset(); previous = ''; events.length = 0
  log('Reset：清空选择与导航状态'); render()
}
element('reset').onclick = reset
element('apply').onclick = () => {
  try {
    const timing = (id: string) => { const value = (element(id) as HTMLInputElement).value; return value.trim() ? Number(value) : NaN }
    navigation = createMarkerNavigation(mapping, { confirmAfterMs: timing('confirm'), lostAfterMs: timing('lost') })
    element('error').textContent = ''; reset()
  } catch (error) { element('error').textContent = String(error) }
}
render()
const interval = window.setInterval(tick, 50)
window.addEventListener('pagehide', () => window.clearInterval(interval), { once: true })

type SourceWord = {
  segmentIndex: number
  wordIndex: number
  text: string
  probability: number | null
  interval: { startSec: number | null; endSec: number | null }
}

type TimedCharacter = {
  index: number
  char: string
  startSec: number | null
  endSec: number | null
  status: string
  needsReview: boolean
  sourceWord?: SourceWord
}

type TimedWork = {
  id: string
  title: string
  author: string | null
  text: string
  match: { status: string; similarity: number; startSec: number | null; endSec: number | null; reasons: string[] }
  characters: TimedCharacter[]
}

type AlignmentResult = { schemaVersion: number; works: TimedWork[] }

const defaultAudioUrl = '/api/debug/whisper-alignment/audio'
const defaultResultUrl = '/api/debug/whisper-alignment/result'
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const audio = get<HTMLAudioElement>('audio')
const poem = get<HTMLParagraphElement>('poem')
const workSelect = get<HTMLSelectElement>('work-select')
const status = get<HTMLParagraphElement>('status')

let result: AlignmentResult | null = null
let work: TimedWork | null = null
let characterNodes: HTMLElement[] = []
let localAudioUrl: string | null = null
let pendingSeek: number | null = null
let frame: number | null = null
let lastDetailIndex = -2

function formatTime(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(3)} s` : '—'
}

function showStatus(message: string, isError = false) {
  status.textContent = message
  status.classList.toggle('error', isError)
}

function isTimed(character: TimedCharacter) {
  return typeof character.startSec === 'number' && Number.isFinite(character.startSec) &&
    typeof character.endSec === 'number' && Number.isFinite(character.endSec) &&
    character.startSec >= 0 && character.endSec > character.startSec
}

function validateResult(value: unknown): AlignmentResult {
  if (!value || typeof value !== 'object') throw new Error('对齐 JSON 不是对象。')
  const data = value as AlignmentResult
  if (data.schemaVersion !== 1 || !Array.isArray(data.works) || !data.works.length)
    throw new Error('需要 schemaVersion=1 且包含 works[] 的对齐 JSON。')
  for (const entry of data.works) {
    if (typeof entry.id !== 'string' || typeof entry.title !== 'string' ||
        typeof entry.text !== 'string' || !Array.isArray(entry.characters) ||
        !entry.match || typeof entry.match.status !== 'string')
      throw new Error('作品缺少标题、正文、匹配状态或 characters。')
    const letters = Array.from(entry.text)
    if (letters.length !== entry.characters.length || letters.length > 10000 ||
        entry.characters.some((char, index) => !char || char.index !== index || char.char !== letters[index]))
      throw new Error(`作品 ${entry.id} 的正文与逐字数组不一致。`)
  }
  return data
}

function setAudioSource(url: string, isLocal: boolean) {
  audio.pause()
  if (localAudioUrl) URL.revokeObjectURL(localAudioUrl)
  localAudioUrl = isLocal ? url : null
  audio.src = url
  audio.load()
  pendingSeek = workStart()
}

function workStart() {
  if (!work) return null
  if (typeof work.match.startSec === 'number' && Number.isFinite(work.match.startSec))
    return work.match.startSec
  return work.characters.find(isTimed)?.startSec ?? null
}

function seekToWorkStart() {
  pendingSeek = workStart()
  applyPendingSeek()
}

function applyPendingSeek() {
  if (pendingSeek === null || audio.readyState < HTMLMediaElement.HAVE_METADATA) return
  audio.currentTime = Math.min(pendingSeek, Number.isFinite(audio.duration) ? audio.duration : pendingSeek)
  pendingSeek = null
  updatePlayback()
}

async function seekAndPlay(character: TimedCharacter) {
  if (!isTimed(character)) return
  audio.currentTime = character.startSec!
  updatePlayback()
  try { await audio.play() }
  catch { showStatus('已跳转，但浏览器无法开始播放；请检查音频格式或点击播放器。', true) }
}

function showDetails(index: number, active: boolean) {
  if (!work || index < 0) {
    get<HTMLElement>('detail-title').textContent = '当前字'
    for (const id of ['detail-char', 'detail-whisper', 'detail-time', 'detail-status', 'detail-review', 'detail-source'])
      get<HTMLElement>(id).textContent = '—'
    return
  }
  const char = work.characters[index]
  const source = char.sourceWord
  get<HTMLElement>('detail-title').textContent = active ? '当前高亮字' : '最近已读字'
  get<HTMLElement>('detail-char').textContent = `${char.char} · #${index}`
  get<HTMLElement>('detail-whisper').textContent = source?.text ?? '—'
  get<HTMLElement>('detail-time').textContent = `${formatTime(char.startSec)} / ${formatTime(char.endSec)}`
  get<HTMLElement>('detail-status').textContent = char.status
  get<HTMLElement>('detail-review').textContent = char.needsReview ? '是' : '否'
  get<HTMLElement>('detail-source').textContent = source
    ? `segment ${source.segmentIndex}, word ${source.wordIndex} · probability ${
      source.probability === null ? '—' : source.probability.toFixed(3)} · word interval ${
      formatTime(source.interval.startSec)} / ${formatTime(source.interval.endSec)}`
    : '—'
}

function updatePlayback() {
  const time = audio.currentTime
  get<HTMLElement>('playback').textContent = `音频位置：${formatTime(time)} / ${formatTime(audio.duration)}（完整音频时间轴）`
  if (!work) return
  let active = -1
  let latest = -1
  for (const [index, char] of work.characters.entries()) {
    if (!isTimed(char)) continue
    const state = time >= char.startSec! && time < char.endSec! ? 'current'
      : time >= char.endSec! ? 'read' : 'unread'
    characterNodes[index].classList.toggle('current', state === 'current')
    characterNodes[index].classList.toggle('read', state === 'read')
    if (state === 'current') active = index
    if (state === 'read') latest = index
  }
  const detailIndex = active >= 0 ? active : latest
  const detailKey = detailIndex * 2 + Number(active >= 0)
  if (detailKey !== lastDetailIndex) {
    lastDetailIndex = detailKey
    showDetails(detailIndex, active >= 0)
  }
}

function renderWork(index: number) {
  if (!result) return
  work = result.works[index]
  if (!work) return
  workSelect.value = String(index)
  get<HTMLElement>('work-title').textContent = `${work.title}${work.author ? ` · ${work.author}` : ''}`
  const timed = work.characters.filter(isTimed).length
  const spoken = work.characters.filter((char) => char.status !== 'non_speech').length
  const needsReview = work.characters.filter((char) => char.needsReview).length
  const corrected = work.characters.filter((char) => char.status === 'corrected').length
  const lowConfidence = work.characters.filter((char) => char.status === 'low_confidence').length
  get<HTMLElement>('match-summary').textContent =
    `作品 ${work.id} · match ${work.match.status} · similarity ${Number(work.match.similarity).toFixed(3)} · ` +
    `有时间 ${timed}/${spoken} 可读字 · 纠错 ${corrected} · 低置信 ${lowConfidence} · 待复核 ${needsReview} · 正文 ${
      formatTime(work.match.startSec)}–${formatTime(work.match.endSec)}${
      work.match.reasons?.length ? ` · ${work.match.reasons.join(', ')}` : ''}`
  poem.replaceChildren()
  characterNodes = []
  for (const char of work.characters) {
    if (char.char === '\n') {
      const newline = document.createTextNode('\n')
      poem.append(newline)
      characterNodes.push(poem)
      continue
    }
    const node = document.createElement(isTimed(char) ? 'button' : 'span')
    node.className = 'character'
    node.textContent = char.char
    if (isTimed(char)) {
      const button = node as HTMLButtonElement
      button.type = 'button'
      button.title = `${char.char} ${formatTime(char.startSec)}–${formatTime(char.endSec)} · ${char.status}`
      button.addEventListener('click', () => { void seekAndPlay(char) })
    } else {
      node.classList.add(char.status === 'non_speech' ? 'punctuation' : 'untimed')
      node.title = `${char.char} · ${char.status} · 无可靠逐字时间`
    }
    poem.append(node)
    characterNodes.push(node)
  }
  lastDetailIndex = -2
  seekToWorkStart()
  updatePlayback()
}

function showResult(value: unknown) {
  result = validateResult(value)
  workSelect.replaceChildren()
  for (const [index, entry] of result.works.entries()) {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = `${entry.title} (${entry.id})`
    workSelect.append(option)
  }
  workSelect.disabled = result.works.length < 2
  renderWork(0)
}

async function loadDefault() {
  showStatus('正在读取原始 M4A 与对齐 JSON…')
  setAudioSource(defaultAudioUrl, false)
  try {
    const response = await fetch(defaultResultUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`对齐 JSON HTTP ${response.status}`)
    showResult(await response.json())
    showStatus('已加载真实测试数据。点击播放，或点击有时间戳的汉字试听。')
  } catch (error) {
    showStatus(`加载失败：${error instanceof Error ? error.message : String(error)}`, true)
  }
}

get<HTMLButtonElement>('load-default').addEventListener('click', () => { void loadDefault() })
get<HTMLInputElement>('audio-file').addEventListener('change', (event) => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0]
  if (!file) return
  setAudioSource(URL.createObjectURL(file), true)
  showStatus(`已选择本地音频：${file.name}`)
})
get<HTMLInputElement>('json-file').addEventListener('change', async (event) => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    showResult(JSON.parse(await file.text()) as unknown)
    showStatus(`已选择本地对齐 JSON：${file.name}`)
  } catch (error) {
    showStatus(`JSON 加载失败：${error instanceof Error ? error.message : String(error)}`, true)
  }
})
workSelect.addEventListener('change', () => renderWork(Number(workSelect.value)))
audio.addEventListener('loadedmetadata', () => { applyPendingSeek(); updatePlayback() })
audio.addEventListener('timeupdate', updatePlayback)
audio.addEventListener('seeked', updatePlayback)
audio.addEventListener('error', () => showStatus('音频读取或解码失败；请确认文件可访问且浏览器支持 M4A。', true))
audio.addEventListener('play', () => {
  if (frame !== null) return
  const tick = () => {
    updatePlayback()
    frame = audio.paused ? null : requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
})
audio.addEventListener('pause', () => {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  updatePlayback()
})
window.addEventListener('pagehide', () => { if (localAudioUrl) URL.revokeObjectURL(localAudioUrl) })
void loadDefault()

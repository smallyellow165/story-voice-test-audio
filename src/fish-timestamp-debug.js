import { cleanAlignment, selectedAlignment } from './fish-clean-alignment.mjs'
const $ = id => document.getElementById(id)
const audio = $('audio')
let audioUrl, jsonUrl
let currentResult, currentClean, clipBusy = false, generationBusy = false
const exportUrls = []
function downloadLink(id, blob, name) {
  const url = URL.createObjectURL(blob)
  exportUrls.push(url)
  $(id).href = url
  $(id).download = name
  return url
}
const jsonBlob = value => new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
function clearClip() {
  $('clip-audio').pause()
  $('clip-audio').removeAttribute('src')
  $('clip-audio').load()
  $('clip-result').hidden = true
  $('clip-status').textContent = ''
}
function updateRange() {
  clearClip()
  try {
    const selection = selectedAlignment(currentClean, Number($('range-start').value), Number($('range-end').value), 'fish-selected-clip.mp3')
    $('selected-range').textContent = `Selected range: ${selection.alignment.text} (${selection.start.toFixed(3)}–${selection.end.toFixed(3)} s)`
    $('export-clip').disabled = false
  } catch (error) {
    $('selected-range').textContent = error.message
    $('export-clip').disabled = true
  }
}
$('range-start').addEventListener('change', updateRange)
$('range-end').addEventListener('change', updateRange)
$('export-clip').addEventListener('click', async () => {
  if (clipBusy || generationBusy || !currentClean) return
  clipBusy = true
  for (const id of ['generate', 'regenerate', 'export-clip', 'range-start', 'range-end']) $(id).disabled = true
  clearClip()
  $('clip-status').textContent = '正在截取并导出…'
  try {
    const response = await fetch('/api/debug/fish-timestamp/clip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: currentResult.audio_base64, alignment: currentClean,
        first: Number($('range-start').value), last: Number($('range-end').value) }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`)
    const bytes = Uint8Array.from(atob(result.audio_base64), c => c.charCodeAt(0))
    $('clip-audio').src = downloadLink('clip-audio-download', new Blob([bytes], { type: result.format }), result.alignment.audio)
    downloadLink('clip-json-download', jsonBlob(result.alignment), 'fish-selected-clip.json')
    $('clip-result').hidden = false
    $('clip-status').textContent = `导出完成：${result.alignment.text}，截取时长 ${result.alignment.duration.toFixed(3)} s；MP3 容器时长 ${result.encoded_duration.toFixed(3)} s（可含编码延迟）。点击下方链接分别下载。`
  } catch (error) { $('clip-status').textContent = error.message }
  finally {
    clipBusy = false
    for (const id of ['generate', 'regenerate', 'export-clip', 'range-start', 'range-end']) $(id).disabled = false
  }
})
function reset() {
  clearClip()
  exportUrls.splice(0).forEach(url => URL.revokeObjectURL(url))
  currentResult = currentClean = null
  $('exports').hidden = true
  $('range-start').replaceChildren()
  $('range-end').replaceChildren()
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  if (audioUrl) URL.revokeObjectURL(audioUrl)
  if (jsonUrl) URL.revokeObjectURL(jsonUrl)
  $('timeline').replaceChildren()
  $('download').hidden = true
  $('download').removeAttribute('href')
  $('summary').textContent = ''
  $('raw').textContent = '—'
  $('playback').textContent = '播放时间：—'
}
function status(text, error = false) {
  $('status').textContent = text
  $('status').classList.toggle('error', error)
}
audio.addEventListener('timeupdate', () => {
  $('playback').textContent = `播放时间：${audio.currentTime.toFixed(3)} / ${Number.isFinite(audio.duration) ? audio.duration.toFixed(3) : '—'} s`
})
audio.addEventListener('error', () => status('音频无法播放，请检查返回的音频格式。', true))
async function showResult(result) {
    $('text').value = result.text
    if (![...$('speed').options].some(option => Number(option.value) === result.speed)) {
      const option = document.createElement('option'); option.value = String(result.speed); option.textContent = String(result.speed); $('speed').append(option)
    }
    $('speed').value = [...$('speed').options].find(option => Number(option.value) === result.speed).value
    const { audio_base64, clean_alignment, history, ...report } = result
    const bytes = Uint8Array.from(atob(audio_base64), char => char.charCodeAt(0))
    audioUrl = URL.createObjectURL(new Blob([bytes], { type: result.format }))
    const ready = new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        audio.removeEventListener('loadedmetadata', loaded)
        audio.removeEventListener('error', failed)
      }
      const loaded = () => { cleanup(); resolve() }
      const failed = () => { cleanup(); reject(new Error('音频 metadata 加载失败。')) }
      const timer = setTimeout(failed, 10000)
      audio.addEventListener('loadedmetadata', loaded)
      audio.addEventListener('error', failed)
    })
    audio.src = audioUrl
    audio.load()
    await ready
    const rows = []
    for (const segment of result.timeline) {
      const tr = document.createElement('tr')
      tr.tabIndex = 0
      tr.title = `从 ${segment.global_start.toFixed(3)} 秒播放`
      const values = [segment.text, [...segment.text].length, segment.local_start.toFixed(3),
        segment.local_end.toFixed(3), segment.chunk_seq, segment.chunk_offset.toFixed(3),
        segment.global_start.toFixed(3), segment.global_end.toFixed(3)]
      for (const value of values) {
        const td = document.createElement('td'); td.textContent = String(value); tr.append(td)
      }
      const seek = async () => {
        rows.forEach(row => row.classList.remove('active'))
        tr.classList.add('active')
        audio.currentTime = segment.global_start
        try { await audio.play() } catch (error) { status(`已跳转；播放失败：${error.message}`, true) }
      }
      tr.addEventListener('click', seek)
      tr.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); seek() }
      })
      rows.push(tr)
    }
    $('timeline').append(...rows)
    const lengths = [...new Set(result.timeline.map(segment => [...segment.text].length))].sort((a, b) => a - b)
    $('summary').textContent = `本次生成 Speed ${result.speed.toFixed(1)} · ${result.events.length} SSE events · ${result.chunks.length} text chunks · ${rows.length} segments · segment 字符数：${lengths.join(', ') || '无'} · 音频 ${audio.duration.toFixed(3)} s`
    const filename = `fish-timestamp-${Date.now()}.mp3`
    currentClean = clean_alignment ? { ...clean_alignment, audio: filename } : cleanAlignment(result, filename, audio.duration)
    currentResult = result
    downloadLink('clean-download', jsonBlob(currentClean), filename.replace('.mp3', '.json'))
    $('full-audio-download').href = audioUrl
    $('full-audio-download').download = filename
    for (const segment of currentClean.segments) {
      for (const id of ['range-start', 'range-end']) {
        const option = document.createElement('option')
        option.value = String(segment.index)
        option.textContent = `${segment.index}: ${segment.text} (${segment.start.toFixed(3)}–${segment.end.toFixed(3)})`
        $(id).append(option)
      }
    }
    $('range-end').value = String(currentClean.segments.length - 1)
    $('exports').hidden = false
    updateRange()
    report.browser_audio_duration = audio.duration
    $('raw').textContent = JSON.stringify(report, null, 2)
    jsonUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    $('download').href = jsonUrl
    $('download').hidden = false
    status(`${history?.source === 'history' ? 'Loaded from history' : 'Generated from Fish Audio'} · ${rows.length ? '点击行试听对应时间。' : '本次无可用 alignment。'}`)
}
async function requestResult(url, options) {
  if (generationBusy || clipBusy) return
  generationBusy = true
  reset()
  for (const id of ['generate', 'regenerate', 'speed']) $(id).disabled = true
  status('正在读取历史或生成音频…')
  try {
    const response = await fetch(url, options)
    const result = await response.json()
    if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`)
    await showResult(result)
  } catch (error) {
    reset(); status(error.message, true)
  } finally {
    generationBusy = false
    for (const id of ['generate', 'regenerate', 'speed']) $(id).disabled = false
    await refreshHistory()
  }
}
function generate(regenerate = false) {
  return requestResult('/api/debug/fish-timestamp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: $('text').value, speed: Number($('speed').value), regenerate }),
  })
}
$('generate-form').addEventListener('submit', event => { event.preventDefault(); void generate() })
$('regenerate').addEventListener('click', () => { void generate(true) })
async function refreshHistory() {
  try {
    const response = await fetch('/api/debug/fish-timestamp/history')
    if (!response.ok) throw new Error('无法读取服务器历史。')
    const { entries } = await response.json()
    $('history-list').replaceChildren()
    $('history-status').textContent = entries.length ? '最近 30 条有效历史；Load 不调用 Fish。' : '暂无有效历史。'
    for (const entry of entries) {
      const item = document.createElement('li')
      const label = document.createElement('p')
      label.textContent = `${entry.text.slice(0, 90)}${entry.text.length > 90 ? '…' : ''} — speed ${entry.speed} · ${entry.model} · ${entry.voice} · ${new Date(entry.created_at).toLocaleString()}`
      item.append(label)
      for (const [title, regenerate] of [['Load', false], ['Regenerate', true]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = title
        button.addEventListener('click', () => {
          void requestResult(`/api/debug/fish-timestamp/history/${entry.cache_key}${regenerate ? '/regenerate' : ''}`, { method: regenerate ? 'POST' : 'GET' })
        })
        item.append(button)
      }
      $('history-list').append(item)
    }
  } catch (error) { $('history-status').textContent = error.message }
}
$('refresh-history').addEventListener('click', refreshHistory)
void refreshHistory()

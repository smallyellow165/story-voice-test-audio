const $ = id => document.getElementById(id)
const audio = $('audio')
let audioUrl, jsonUrl
function reset() {
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
$('generate-form').addEventListener('submit', async event => {
  event.preventDefault()
  if ($('generate').disabled) return
  reset()
  $('generate').disabled = true
  const speed = Number($('speed').value)
  $('speed').disabled = true
  status(`生成中，Speed ${speed.toFixed(1)}，等待完整音频和 alignment…`)
  try {
    const response = await fetch('/api/debug/fish-timestamp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: $('text').value, speed }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`)
    const { audio_base64, ...report } = result
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
    report.browser_audio_duration = audio.duration
    $('raw').textContent = JSON.stringify(report, null, 2)
    jsonUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    $('download').href = jsonUrl
    $('download').hidden = false
    status(rows.length ? '生成完成。点击行试听对应时间。' : '音频已生成，但本次没有可用 alignment；不推测时间。')
  } catch (error) {
    reset()
    status(error.message, true)
  } finally {
    $('generate').disabled = false
    $('speed').disabled = false
  }
})

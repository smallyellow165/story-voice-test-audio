import './style.css'
import geminiVoices from './data/gemini-voices.json'
import testScripts from './data/test-scripts.json'

type AudioRecord = {
  id: string
  voice: string
  script: string
  audioFile: string
  createdAt: string
}

const app = document.querySelector<HTMLDivElement>('#app')!
let records: AudioRecord[] = []
let activeAudio: HTMLAudioElement | null = null
let activeButton: HTMLButtonElement | null = null

const voiceOptionLabel = (voice: typeof geminiVoices[number]) => {
  const shortNotes = voice.notes.split('，').slice(0, 2).join('，')
  return `${voice.name} — ${voice.gender} — ${shortNotes}`
}

const escapeHtml = (value: string) => {
  const element = document.createElement('span')
  element.textContent = value
  return element.innerHTML
}

const audioUrl = (audioFile: string) => `/generated/test-audio/${encodeURIComponent(audioFile)}`

const formatCreatedAt = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

const stopPlayback = () => {
  activeAudio?.pause()
  if (activeButton) activeButton.textContent = 'Play'
  activeAudio = null
  activeButton = null
}

const playRecord = async (record: AudioRecord, button: HTMLButtonElement) => {
  if (activeButton === button && activeAudio) {
    if (activeAudio.paused) {
      await activeAudio.play()
      button.textContent = 'Pause'
    } else {
      activeAudio.pause()
      button.textContent = 'Play'
    }
    return
  }

  stopPlayback()
  activeAudio = new Audio(audioUrl(record.audioFile))
  activeButton = button
  activeAudio.addEventListener('ended', stopPlayback, { once: true })
  try {
    await activeAudio.play()
    button.textContent = 'Pause'
  } catch {
    stopPlayback()
    button.textContent = 'Unavailable'
  }
}

const layout = (content: string) => {
  app.innerHTML = `
    <header class="site-header">
      <nav class="site-nav" aria-label="Primary navigation">
        <a href="#/">Library</a>
        <a href="#/generate">Generate Audio</a>
      </nav>
    </header>
    <main>${content}</main>
  `
}

const renderLibraryRows = () => {
  const body = document.querySelector<HTMLTableSectionElement>('#library-table-body')!
  const count = document.querySelector<HTMLParagraphElement>('#result-count')!
  const search = document.querySelector<HTMLInputElement>('#search')!.value.trim().toLocaleLowerCase()
  const voice = document.querySelector<HTMLSelectElement>('#voice-filter')!.value
  const filtered = records.filter((record) =>
    (!search || `${record.script} ${record.audioFile}`.toLocaleLowerCase().includes(search)) &&
    (voice === 'all' || record.voice === voice),
  )

  count.textContent = `${filtered.length} ${filtered.length === 1 ? 'clip' : 'clips'}`
  if (!filtered.length) {
    body.innerHTML = '<tr><td class="empty-cell" colspan="5">No generated audio matches these filters.</td></tr>'
    return
  }

  body.innerHTML = filtered.map((record) => `
    <tr>
      <td><button class="table-play" type="button" data-record-id="${escapeHtml(record.id)}">Play</button></td>
      <td class="voice-cell">${escapeHtml(record.voice)}</td>
      <td class="script-cell" title="${escapeHtml(record.script)}">${escapeHtml(record.script)}</td>
      <td class="file-cell" title="${escapeHtml(record.audioFile)}">${escapeHtml(record.audioFile)}</td>
      <td class="created-cell">${escapeHtml(formatCreatedAt(record.createdAt))}</td>
    </tr>
  `).join('')

  body.querySelectorAll<HTMLButtonElement>('.table-play').forEach((button) => {
    button.addEventListener('click', () => {
      const record = records.find((item) => item.id === button.dataset.recordId)
      if (record) void playRecord(record, button)
    })
  })
}

const renderLibrary = () => {
  stopPlayback()
  layout(`
    <section class="tool-page library-page" aria-labelledby="page-title">
      <div class="page-heading">
        <h1 id="page-title">TTS Test Audio</h1>
      </div>
      <div class="library-filters" aria-label="Library filters">
        <label class="search-field">
          <span class="sr-only">Search script or filename</span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
          <input id="search" type="search" placeholder="Search script or filename" autocomplete="off" />
        </label>
        <label class="filter-field"><span>Voice</span><select id="voice-filter"><option value="all">All voices</option></select></label>
        <p id="result-count" class="result-count" aria-live="polite">Loading…</p>
        <a class="primary-link" href="#/generate">Generate Audio</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Play</th><th>Voice</th><th>Script</th><th>File</th><th>Created</th></tr></thead>
          <tbody id="library-table-body"></tbody>
        </table>
      </div>
    </section>
  `)

  const voiceFilter = document.querySelector<HTMLSelectElement>('#voice-filter')!
  for (const voice of [...new Set(records.map((record) => record.voice))].sort()) {
    voiceFilter.add(new Option(voice, voice))
  }
  document.querySelector<HTMLInputElement>('#search')!.addEventListener('input', renderLibraryRows)
  voiceFilter.addEventListener('change', renderLibraryRows)
  renderLibraryRows()
}

const renderGenerate = () => {
  stopPlayback()
  layout(`
    <section class="tool-page generate-page" aria-labelledby="page-title">
      <div class="page-heading"><h1 id="page-title">Generate Audio</h1></div>
      <form id="generate-form" class="generate-form">
        <label><span>Voice</span><select id="voice" required>${geminiVoices.map((voice) => `<option value="${escapeHtml(voice.name)}"${voice.name === 'Achernar' ? ' selected' : ''}>${escapeHtml(voiceOptionLabel(voice))}</option>`).join('')}</select></label>
        <label><span>Test Script</span><select id="script-preset"><option value="">Custom script</option>${testScripts.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(`${preset.label} · ${preset.duration}`)}</option>`).join('')}</select></label>
        <label><span>Script</span><textarea id="script" rows="6" required>瑞瑞，你怎么又把玉米藏到被子里面啦？</textarea></label>
        <div class="generate-actions">
          <button id="generate-submit" type="submit">Generate Audio</button>
          <p id="generate-status" role="status" aria-live="polite"></p>
        </div>
      </form>
      <div id="generate-result" class="generate-result" hidden>
        <p>Audio generated and saved to library.</p>
        <audio id="generated-player" controls preload="metadata"></audio>
      </div>
    </section>
  `)

  const form = document.querySelector<HTMLFormElement>('#generate-form')!
  const voice = document.querySelector<HTMLSelectElement>('#voice')!
  const scriptPreset = document.querySelector<HTMLSelectElement>('#script-preset')!
  const script = document.querySelector<HTMLTextAreaElement>('#script')!
  const submit = document.querySelector<HTMLButtonElement>('#generate-submit')!
  const status = document.querySelector<HTMLParagraphElement>('#generate-status')!
  const result = document.querySelector<HTMLDivElement>('#generate-result')!
  const player = document.querySelector<HTMLAudioElement>('#generated-player')!

  scriptPreset.addEventListener('change', () => {
    const preset = testScripts.find((item) => item.id === scriptPreset.value)
    if (preset) script.value = preset.text
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    submit.disabled = true
    submit.textContent = 'Generating…'
    status.textContent = 'Requesting Google Cloud Gemini TTS…'
    result.hidden = true

    try {
      const response = await fetch('/api/test-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script.value, voice: voice.value }),
      })
      const payload = await response.json() as { url?: string; error?: { message: string } }
      if (!response.ok || !payload.url) throw new Error(payload.error?.message ?? 'The server returned an invalid TTS response.')

      player.src = payload.url
      player.load()
      result.hidden = false
      status.textContent = 'Audio generated and saved to library.'
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'The TTS request failed.'
    } finally {
      submit.disabled = false
      submit.textContent = 'Generate Audio'
    }
  })
}

const loadRecords = async () => {
  try {
    const response = await fetch('/api/test-audio')
    const payload = await response.json() as { records?: AudioRecord[]; error?: { message: string } }
    if (!response.ok || !payload.records) throw new Error(payload.error?.message ?? 'Could not load generated audio.')
    records = payload.records
  } catch (error) {
    records = []
    console.error(error)
  }
}

const renderRoute = async () => {
  await loadRecords()
  if (window.location.hash === '#/generate') renderGenerate()
  else renderLibrary()
}

window.addEventListener('hashchange', () => void renderRoute())
void renderRoute()

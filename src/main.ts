import './style.css'
import geminiVoices from './data/gemini-voices.json'
import testScripts from './data/test-scripts.json'

type AudioRecord = {
  id: string
  voice: string
  script: string
  audioFile: string
  durationSeconds?: number
  createdAt: string
}

type SortColumn = 'voice' | 'script' | 'audioFile' | 'durationSeconds' | 'createdAt'

type ClipHistoryRecord = {
  id: string
  start: number
  end: number
  duration: number
  createdAt: string
}

type VideoFileMetadata = {
  name: string
  size: number
  lastModified: number
}

type VideoRecord = {
  id: string
  file: VideoFileMetadata
  source?: {
    url: string
    site: 'youtube' | 'bilibili' | 'other'
  }
  clips: ClipHistoryRecord[]
  createdAt: string
  updatedAt: string
}

type VideoLibrary = {
  version: 1
  videos: VideoRecord[]
  migratedLegacyKeys: string[]
}

const clipHistoryStoragePrefix = 'story-voice.clip-history.v1:'
const videoLibraryStorageKey = 'story-voice.video-library.v1'

const app = document.querySelector<HTMLDivElement>('#app')!
let records: AudioRecord[] = []
let activeAudio: HTMLAudioElement | null = null
let activeButton: HTMLButtonElement | null = null
let sortColumn: SortColumn = 'createdAt'
let sortDirection: 'asc' | 'desc' = 'desc'
let activeVideoObjectUrl: string | null = null

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

const sortRecords = (items: AudioRecord[]) => [...items].sort((left, right) => {
  const leftValue = sortColumn === 'createdAt'
    ? new Date(left.createdAt).getTime()
    : sortColumn === 'durationSeconds' ? left.durationSeconds ?? Number.NEGATIVE_INFINITY : left[sortColumn]
  const rightValue = sortColumn === 'createdAt'
    ? new Date(right.createdAt).getTime()
    : sortColumn === 'durationSeconds' ? right.durationSeconds ?? Number.NEGATIVE_INFINITY : right[sortColumn]
  const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
    ? leftValue - rightValue
    : String(leftValue).localeCompare(String(rightValue))
  return sortDirection === 'asc' ? comparison : -comparison
})

const updateSortHeaders = () => {
  document.querySelectorAll<HTMLButtonElement>('.sort-header').forEach((header) => {
    const active = header.dataset.sortColumn === sortColumn
    header.querySelector('.sort-indicator')!.textContent = active ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''
    header.setAttribute('aria-pressed', String(active))
  })
}

const formatCreatedAt = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

const formatDuration = (durationSeconds: number | undefined) =>
  Number.isFinite(durationSeconds) ? `${durationSeconds!.toFixed(2)}s` : '—'

const stopPlayback = () => {
  activeAudio?.pause()
  if (activeButton) activeButton.textContent = 'Play'
  activeAudio = null
  activeButton = null
}

const cleanupVideoObjectUrl = () => {
  if (!activeVideoObjectUrl) return
  URL.revokeObjectURL(activeVideoObjectUrl)
  activeVideoObjectUrl = null
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

const layout = (content: string, activePage: 'audio' | 'video' = 'audio') => {
  app.innerHTML = `
    <header class="site-header">
      <nav class="site-nav" aria-label="Primary navigation">
        <a href="#/"${activePage === 'audio' && window.location.hash !== '#/generate' ? ' aria-current="page"' : ''}>Audio</a>
        <a href="#/generate"${window.location.hash === '#/generate' ? ' aria-current="page"' : ''}>Generate Audio</a>
        <a href="#/video"${activePage === 'video' ? ' aria-current="page"' : ''}>Video</a>
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
  const sorted = sortRecords(filtered)

  count.textContent = `${sorted.length} ${sorted.length === 1 ? 'clip' : 'clips'}`
  updateSortHeaders()
  if (!sorted.length) {
    body.innerHTML = '<tr><td class="empty-cell" colspan="6">No generated audio matches these filters.</td></tr>'
    return
  }

  body.innerHTML = sorted.map((record) => `
    <tr>
      <td><button class="table-play" type="button" data-record-id="${escapeHtml(record.id)}">Play</button></td>
      <td class="voice-cell">${escapeHtml(record.voice)}</td>
      <td class="script-cell" title="${escapeHtml(record.script)}">${escapeHtml(record.script)}</td>
      <td class="duration-cell">${escapeHtml(formatDuration(record.durationSeconds))}</td>
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
          <thead><tr>
            <th>Play</th>
            <th><button class="sort-header" type="button" data-sort-column="voice">Voice<span class="sort-indicator" aria-hidden="true"></span></button></th>
            <th><button class="sort-header" type="button" data-sort-column="script">Script<span class="sort-indicator" aria-hidden="true"></span></button></th>
            <th><button class="sort-header" type="button" data-sort-column="durationSeconds">Duration<span class="sort-indicator" aria-hidden="true"></span></button></th>
            <th><button class="sort-header" type="button" data-sort-column="audioFile">File<span class="sort-indicator" aria-hidden="true"></span></button></th>
            <th><button class="sort-header" type="button" data-sort-column="createdAt">Created<span class="sort-indicator" aria-hidden="true"></span></button></th>
          </tr></thead>
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
  document.querySelectorAll<HTMLButtonElement>('.sort-header').forEach((header) => {
    header.addEventListener('click', () => {
      const column = header.dataset.sortColumn as SortColumn
      if (column === sortColumn) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
      else {
        sortColumn = column
        sortDirection = 'asc'
      }
      renderLibraryRows()
    })
  })
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

const formatVideoTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00.000'
  const totalMilliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000)
  const milliseconds = totalMilliseconds % 1000
  return [hours, minutes, wholeSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':') + `.${String(milliseconds).padStart(3, '0')}`
}

const quoteShellArgument = (value: string) => `"${value.replace(/[\\"$`]/g, '\\$&')}"`

const clipOutputFilename = (filename: string) => {
  const extensionIndex = filename.lastIndexOf('.')
  if (extensionIndex <= 0) return `${filename}-clip.mp4`
  return `${filename.slice(0, extensionIndex)}-clip.mp4`
}

const videoIdentity = (file: VideoFileMetadata) => JSON.stringify([file.name, file.size, file.lastModified])

const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

const detectSourceSite = (sourceUrl: string): NonNullable<VideoRecord['source']>['site'] => {
  try {
    const hostname = new URL(sourceUrl).hostname.toLocaleLowerCase().replace(/^www\./, '')
    if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return 'youtube'
    if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) return 'bilibili'
  } catch {
    // yt-dlp accepts more than standard HTTP URLs, so unclassified values remain usable.
  }
  return 'other'
}

const normalizeClip = (value: unknown): ClipHistoryRecord | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ClipHistoryRecord>
  if (!Number.isFinite(candidate.start) || !Number.isFinite(candidate.end) ||
    candidate.start! < 0 || candidate.end! <= candidate.start! || typeof candidate.createdAt !== 'string') return null
  const start = Math.round(candidate.start! * 1000) / 1000
  const end = Math.round(candidate.end! * 1000) / 1000
  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId(),
    start,
    end,
    duration: end - start,
    createdAt: candidate.createdAt,
  }
}

const mergeClips = (existing: ClipHistoryRecord[], incoming: ClipHistoryRecord[]) => {
  const merged = new Map(existing.map((clip) => [`${clip.start}:${clip.end}`, clip]))
  for (const clip of incoming) {
    const key = `${clip.start}:${clip.end}`
    if (!merged.has(key)) merged.set(key, clip)
  }
  return [...merged.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

const normalizeVideoRecord = (value: unknown): VideoRecord | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<VideoRecord>
  const file = candidate.file
  if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size) || !Number.isFinite(file.lastModified) ||
    !Array.isArray(candidate.clips)) return null
  const now = new Date().toISOString()
  const sourceUrl = typeof candidate.source?.url === 'string' ? candidate.source.url.trim() : ''
  return {
    id: videoIdentity(file),
    file: { name: file.name, size: file.size, lastModified: file.lastModified },
    source: sourceUrl ? { url: sourceUrl, site: detectSourceSite(sourceUrl) } : undefined,
    clips: mergeClips([], candidate.clips.map(normalizeClip).filter((clip): clip is ClipHistoryRecord => Boolean(clip))),
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
  }
}

const loadVideoLibrary = (): VideoLibrary => {
  try {
    const value = JSON.parse(localStorage.getItem(videoLibraryStorageKey) ?? '{}') as Partial<VideoLibrary>
    return {
      version: 1,
      videos: Array.isArray(value.videos)
        ? value.videos.map(normalizeVideoRecord).filter((record): record is VideoRecord => Boolean(record))
        : [],
      migratedLegacyKeys: Array.isArray(value.migratedLegacyKeys)
        ? value.migratedLegacyKeys.filter((key): key is string => typeof key === 'string')
        : [],
    }
  } catch {
    return { version: 1, videos: [], migratedLegacyKeys: [] }
  }
}

const saveVideoLibrary = (library: VideoLibrary) => {
  try {
    localStorage.setItem(videoLibraryStorageKey, JSON.stringify(library))
    return true
  } catch {
    return false
  }
}

const mergeVideoRecord = (existing: VideoRecord | undefined, incoming: VideoRecord): VideoRecord => {
  if (!existing) return incoming
  const existingUpdated = Date.parse(existing.updatedAt) || 0
  const incomingUpdated = Date.parse(incoming.updatedAt) || 0
  return {
    ...existing,
    source: incoming.source ?? existing.source,
    clips: mergeClips(existing.clips, incoming.clips),
    createdAt: Date.parse(existing.createdAt) <= Date.parse(incoming.createdAt) ? existing.createdAt : incoming.createdAt,
    updatedAt: existingUpdated >= incomingUpdated ? existing.updatedAt : incoming.updatedAt,
  }
}

const migrateLegacyClipHistory = (library: VideoLibrary) => {
  let changed = false
  try {
    const legacyKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(clipHistoryStoragePrefix)))
    for (const storageKey of legacyKeys) {
      if (library.migratedLegacyKeys.includes(storageKey)) continue
      const identityValue = JSON.parse(storageKey.slice(clipHistoryStoragePrefix.length)) as unknown
      const rawClips = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
      if (!Array.isArray(identityValue) || identityValue.length !== 3 || !Array.isArray(rawClips)) continue
      const file = { name: identityValue[0], size: identityValue[1], lastModified: identityValue[2] }
      if (typeof file.name !== 'string' || !Number.isFinite(file.size) || !Number.isFinite(file.lastModified)) continue
      const clips = rawClips.map(normalizeClip).filter((clip): clip is ClipHistoryRecord => Boolean(clip))
      const timestamps = clips.map((clip) => clip.createdAt).sort()
      const now = new Date().toISOString()
      const incoming: VideoRecord = {
        id: videoIdentity(file),
        file,
        clips,
        createdAt: timestamps[0] ?? now,
        updatedAt: timestamps.at(-1) ?? now,
      }
      const existingIndex = library.videos.findIndex((record) => record.id === incoming.id)
      const existing = existingIndex >= 0 ? library.videos[existingIndex] : undefined
      const merged = mergeVideoRecord(existing, incoming)
      if (existingIndex >= 0) library.videos[existingIndex] = merged
      else library.videos.push(merged)
      library.migratedLegacyKeys.push(storageKey)
      changed = true
    }
  } catch {
    return false
  }
  return changed
}

const renderVideo = () => {
  stopPlayback()
  cleanupVideoObjectUrl()
  const videoLibrary = loadVideoLibrary()
  if (migrateLegacyClipHistory(videoLibrary)) saveVideoLibrary(videoLibrary)
  layout(`
    <section class="tool-page video-page" aria-labelledby="page-title">
      <div class="page-heading">
        <h1 id="page-title">Video Tools</h1>
        <p>Generate local commands and keep clip metadata without uploading video files.</p>
      </div>
      <div class="video-tool">
        <section class="video-tool-section download-command" aria-labelledby="download-command-title">
          <h2 id="download-command-title">Download Command</h2>
          <label><span>Source URL</span><input id="source-url" type="text" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off" /></label>
          <div class="tool-actions">
            <button id="generate-download-command" type="button">Generate Command</button>
            <button id="copy-download-command" type="button" disabled>Copy Command</button>
            <p id="download-command-status" role="status" aria-live="polite"></p>
          </div>
          <textarea id="download-command-output" rows="2" readonly spellcheck="false" aria-label="yt-dlp command"></textarea>
        </section>

        <section class="video-tool-section video-library" aria-labelledby="video-library-title">
          <div class="section-heading-row">
            <h2 id="video-library-title">Video Library</h2>
            <div class="library-actions">
              <button id="export-library" type="button">Export Library JSON</button>
              <label class="import-library-button">Import Library JSON<input id="import-library" type="file" accept="application/json,.json" /></label>
            </div>
          </div>
          <p id="library-status" class="section-status" role="status" aria-live="polite"></p>
          <div id="video-library-list"></div>
        </section>

        <section class="video-tool-section current-video" aria-labelledby="current-video-title">
          <h2 id="current-video-title">Current Video</h2>
        <label class="video-file-field">
          <span>Choose Video</span>
          <input id="video-file" type="file" accept="video/*" />
        </label>

        <div id="video-workspace" hidden>
          <dl class="video-metadata">
            <div><dt>File</dt><dd id="video-filename">—</dd></div>
            <div><dt>Duration</dt><dd id="video-duration">00:00:00.000</dd></div>
            <div><dt>Current</dt><dd id="video-current">00:00:00.000</dd></div>
          </dl>

          <video id="video-player" controls preload="metadata"></video>

          <div class="seek-controls" aria-label="Video seek controls">
            <button type="button" data-seek="-1">-1s</button>
            <button type="button" data-seek="-0.1">-0.1s</button>
            <button type="button" data-seek="0.1">+0.1s</button>
            <button type="button" data-seek="1">+1s</button>
          </div>

          <div class="clip-range">
            <label><span>Start (seconds)</span><input id="clip-start" type="number" min="0" step="0.001" value="0.000" inputmode="decimal" /></label>
            <button id="set-start" type="button">Set Start</button>
            <label><span>End (seconds)</span><input id="clip-end" type="number" min="0" step="0.001" value="0.000" inputmode="decimal" /></label>
            <button id="set-end" type="button">Set End</button>
          </div>

          <div class="clip-summary">
            <p>Clip Duration <strong id="clip-duration">00:00:00.000</strong></p>
            <p id="range-status" role="status" aria-live="polite"></p>
            <button id="add-history" type="button" disabled>Add to History</button>
          </div>

          <label class="command-field">
            <span>FFmpeg Command</span>
            <textarea id="ffmpeg-command" rows="4" readonly spellcheck="false" aria-describedby="command-note"></textarea>
          </label>
          <p id="command-note" class="command-note">The browser only exposes the filename. Run this command from the video's folder, or replace the input path.</p>
          <div class="copy-actions">
            <button id="copy-command" type="button" disabled>Copy Command</button>
            <p id="copy-status" role="status" aria-live="polite"></p>
          </div>

          <section class="clip-history" aria-labelledby="clip-history-title">
            <div class="clip-history-heading">
              <h2 id="clip-history-title">Clip History</h2>
              <p id="history-status" role="status" aria-live="polite"></p>
            </div>
            <div id="history-list"></div>
          </section>
        </div>
        </section>
      </div>
    </section>
  `, 'video')

  const sourceUrlInput = document.querySelector<HTMLInputElement>('#source-url')!
  const downloadCommandOutput = document.querySelector<HTMLTextAreaElement>('#download-command-output')!
  const generateDownloadButton = document.querySelector<HTMLButtonElement>('#generate-download-command')!
  const copyDownloadButton = document.querySelector<HTMLButtonElement>('#copy-download-command')!
  const downloadCommandStatus = document.querySelector<HTMLParagraphElement>('#download-command-status')!
  const videoLibraryList = document.querySelector<HTMLDivElement>('#video-library-list')!
  const libraryStatus = document.querySelector<HTMLParagraphElement>('#library-status')!
  const importLibraryInput = document.querySelector<HTMLInputElement>('#import-library')!
  const fileInput = document.querySelector<HTMLInputElement>('#video-file')!
  const workspace = document.querySelector<HTMLDivElement>('#video-workspace')!
  const video = document.querySelector<HTMLVideoElement>('#video-player')!
  const filename = document.querySelector<HTMLElement>('#video-filename')!
  const duration = document.querySelector<HTMLElement>('#video-duration')!
  const current = document.querySelector<HTMLElement>('#video-current')!
  const startInput = document.querySelector<HTMLInputElement>('#clip-start')!
  const endInput = document.querySelector<HTMLInputElement>('#clip-end')!
  const clipDuration = document.querySelector<HTMLElement>('#clip-duration')!
  const rangeStatus = document.querySelector<HTMLParagraphElement>('#range-status')!
  const addHistoryButton = document.querySelector<HTMLButtonElement>('#add-history')!
  const command = document.querySelector<HTMLTextAreaElement>('#ffmpeg-command')!
  const copyButton = document.querySelector<HTMLButtonElement>('#copy-command')!
  const copyStatus = document.querySelector<HTMLParagraphElement>('#copy-status')!
  const historyList = document.querySelector<HTMLDivElement>('#history-list')!
  const historyStatus = document.querySelector<HTMLParagraphElement>('#history-status')!
  let selectedFilename = ''
  let currentVideoRecord: VideoRecord | null = null
  let viewedVideoId = ''

  const getCurrentRange = () => {
    const start = startInput.valueAsNumber
    const end = endInput.valueAsNumber
    const videoDuration = video.duration
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start ||
      !Number.isFinite(videoDuration) || end > videoDuration) return null
    return { start, end, duration: end - start }
  }

  const renderVideoLibrary = () => {
    const sortedRecords = [...videoLibrary.videos].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    if (!sortedRecords.length) {
      videoLibraryList.innerHTML = '<p class="library-empty">No saved video metadata yet.</p>'
      return
    }

    videoLibraryList.innerHTML = sortedRecords.map((record) => {
      const viewed = record.id === viewedVideoId
      const source = record.source
      const details = viewed ? `
        <div class="video-library-detail">
          <dl>
            <div><dt>Size</dt><dd>${record.file.size.toLocaleString()} bytes</dd></div>
            <div><dt>Last Modified</dt><dd>${escapeHtml(formatCreatedAt(new Date(record.file.lastModified).toISOString()))}</dd></div>
            <div><dt>Created</dt><dd>${escapeHtml(formatCreatedAt(record.createdAt))}</dd></div>
          </dl>
          <div class="library-clip-list">
            ${record.clips.length ? record.clips.map((clip, index) => `
              <p>#${index + 1} ${formatVideoTime(clip.start)} → ${formatVideoTime(clip.end)} <span>(${formatVideoTime(clip.duration)})</span></p>
            `).join('') : '<p>No clips saved.</p>'}
          </div>
        </div>
      ` : ''
      return `
        <article class="video-library-item${currentVideoRecord?.id === record.id ? ' is-current' : ''}">
          <div class="video-library-summary">
            <div>
              <h3>${escapeHtml(record.file.name)}</h3>
              <p>Source: ${source ? escapeHtml(source.site) : '—'}</p>
              ${source ? `<p class="source-url" title="${escapeHtml(source.url)}">${escapeHtml(source.url)}</p>` : ''}
              <p>Clips: ${record.clips.length} · Updated: ${escapeHtml(formatCreatedAt(record.updatedAt))}</p>
            </div>
            <button type="button" data-library-action="view" data-video-id="${escapeHtml(record.id)}">${viewed ? 'Hide' : 'View'}</button>
          </div>
          ${details}
        </article>
      `
    }).join('')
  }

  const renderClipHistory = () => {
    const clipHistory = currentVideoRecord?.clips ?? []
    if (!clipHistory.length) {
      historyList.innerHTML = '<p class="history-empty">No saved ranges for this video.</p>'
      return
    }

    historyList.innerHTML = clipHistory.map((record, index) => `
      <article class="history-item">
        <p class="history-index">#${index + 1}</p>
        <p class="history-range">${formatVideoTime(record.start)} <span aria-hidden="true">→</span> ${formatVideoTime(record.end)}</p>
        <p class="history-duration">Duration: ${formatVideoTime(record.duration)}</p>
        <div class="history-actions">
          <button type="button" data-history-action="go-start" data-history-id="${escapeHtml(record.id)}">Go Start</button>
          <button type="button" data-history-action="go-end" data-history-id="${escapeHtml(record.id)}">Go End</button>
          <button type="button" data-history-action="use-range" data-history-id="${escapeHtml(record.id)}">Use Range</button>
          <button type="button" data-history-action="delete" data-history-id="${escapeHtml(record.id)}">Delete</button>
        </div>
      </article>
    `).join('')
  }

  const persistLibrary = (successMessage: string, failureMessage: string) => {
    const saved = saveVideoLibrary(videoLibrary)
    libraryStatus.textContent = saved ? successMessage : failureMessage
    renderVideoLibrary()
    return saved
  }

  const associateSourceWithRecord = (record: VideoRecord) => {
    const sourceUrl = sourceUrlInput.value.trim()
    if (!sourceUrl) return false
    const site = detectSourceSite(sourceUrl)
    if (record.source?.url === sourceUrl && record.source.site === site) return false
    record.source = { url: sourceUrl, site }
    record.updatedAt = new Date().toISOString()
    return true
  }

  const copyText = async (value: string, status: HTMLParagraphElement, fallbackTarget: HTMLTextAreaElement) => {
    if (!value) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(value)
      status.textContent = 'Command copied.'
    } catch {
      fallbackTarget.focus()
      fallbackTarget.select()
      status.textContent = 'Copy is unavailable here. The command is selected for manual copy.'
    }
  }

  generateDownloadButton.addEventListener('click', () => {
    const sourceUrl = sourceUrlInput.value.trim()
    downloadCommandStatus.textContent = ''
    if (!sourceUrl) {
      downloadCommandOutput.value = ''
      copyDownloadButton.disabled = true
      downloadCommandStatus.textContent = 'Enter a source URL first.'
      return
    }
    downloadCommandOutput.value = `yt-dlp ${quoteShellArgument(sourceUrl)}`
    copyDownloadButton.disabled = false
    if (currentVideoRecord && associateSourceWithRecord(currentVideoRecord)) {
      persistLibrary('Source URL associated with the current video.', 'Command generated, but the source URL could not be saved.')
    }
  })
  sourceUrlInput.addEventListener('input', () => {
    downloadCommandOutput.value = ''
    copyDownloadButton.disabled = true
    downloadCommandStatus.textContent = ''
  })
  copyDownloadButton.addEventListener('click', () => {
    void copyText(downloadCommandOutput.value, downloadCommandStatus, downloadCommandOutput)
  })

  videoLibraryList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-library-action="view"]')
    if (!button?.dataset.videoId) return
    viewedVideoId = viewedVideoId === button.dataset.videoId ? '' : button.dataset.videoId
    renderVideoLibrary()
  })

  document.querySelector<HTMLButtonElement>('#export-library')!.addEventListener('click', () => {
    const exportValue = {
      version: 1,
      exportedAt: new Date().toISOString(),
      videos: videoLibrary.videos,
    }
    const blobUrl = URL.createObjectURL(new Blob([`${JSON.stringify(exportValue, null, 2)}\n`], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `story-voice-video-library-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
    libraryStatus.textContent = `Exported ${videoLibrary.videos.length} video record${videoLibrary.videos.length === 1 ? '' : 's'}.`
  })

  importLibraryInput.addEventListener('change', async () => {
    const file = importLibraryInput.files?.[0]
    if (!file) return
    try {
      const value = JSON.parse(await file.text()) as { videos?: unknown }
      if (!value || !Array.isArray(value.videos)) throw new Error('The JSON must contain a videos array.')
      const importedRecords = value.videos.map(normalizeVideoRecord)
      if (importedRecords.some((record) => !record)) throw new Error('One or more video records have an invalid schema.')
      for (const incoming of importedRecords as VideoRecord[]) {
        const existingIndex = videoLibrary.videos.findIndex((record) => record.id === incoming.id)
        if (existingIndex >= 0) videoLibrary.videos[existingIndex] = mergeVideoRecord(videoLibrary.videos[existingIndex], incoming)
        else videoLibrary.videos.push(incoming)
      }
      if (currentVideoRecord) currentVideoRecord = videoLibrary.videos.find((record) => record.id === currentVideoRecord?.id) ?? null
      persistLibrary(
        `Imported ${importedRecords.length} video record${importedRecords.length === 1 ? '' : 's'}.`,
        'The library was merged in memory, but browser storage could not be updated.',
      )
      renderClipHistory()
    } catch (error) {
      libraryStatus.textContent = error instanceof Error ? `Import failed: ${error.message}` : 'Import failed: invalid JSON.'
    } finally {
      importLibraryInput.value = ''
    }
  })

  renderVideoLibrary()

  const updateCommand = () => {
    const start = startInput.valueAsNumber
    const end = endInput.valueAsNumber
    const selectedRange = getCurrentRange()

    copyStatus.textContent = ''
    addHistoryButton.disabled = !selectedRange
    if (!selectedRange) {
      clipDuration.textContent = '—'
      command.value = ''
      copyButton.disabled = true
      if (!Number.isFinite(start) || !Number.isFinite(end)) rangeStatus.textContent = 'Enter valid numeric Start and End values.'
      else if (start < 0) rangeStatus.textContent = 'Start must be 0 or later.'
      else if (end <= start) rangeStatus.textContent = 'Invalid range: End must be later than Start.'
      else rangeStatus.textContent = 'End cannot be later than the video duration.'
      return
    }

    clipDuration.textContent = formatVideoTime(selectedRange.duration)
    rangeStatus.textContent = ''
    command.value = `ffmpeg -ss ${formatVideoTime(selectedRange.start)} -i ${quoteShellArgument(selectedFilename)} -t ${formatVideoTime(selectedRange.duration)} -c:v libx264 -c:a aac ${quoteShellArgument(clipOutputFilename(selectedFilename))}`
    copyButton.disabled = false
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    cleanupVideoObjectUrl()
    command.value = ''
    copyButton.disabled = true
    addHistoryButton.disabled = true
    copyStatus.textContent = ''
    rangeStatus.textContent = ''
    historyStatus.textContent = ''
    if (!file) {
      workspace.hidden = true
      currentVideoRecord = null
      renderVideoLibrary()
      video.removeAttribute('src')
      video.load()
      return
    }

    selectedFilename = file.name
    const fileMetadata = { name: file.name, size: file.size, lastModified: file.lastModified }
    const identity = videoIdentity(fileMetadata)
    currentVideoRecord = videoLibrary.videos.find((record) => record.id === identity) ?? null
    if (!currentVideoRecord) {
      const now = new Date().toISOString()
      currentVideoRecord = {
        id: identity,
        file: fileMetadata,
        clips: [],
        createdAt: now,
        updatedAt: now,
      }
      videoLibrary.videos.unshift(currentVideoRecord)
    }
    associateSourceWithRecord(currentVideoRecord)
    persistLibrary('Video metadata saved.', 'Video selected, but its metadata could not be saved.')
    filename.textContent = file.name
    startInput.value = '0.000'
    endInput.value = '0.000'
    activeVideoObjectUrl = URL.createObjectURL(file)
    video.src = activeVideoObjectUrl
    workspace.hidden = false
    renderClipHistory()
    video.load()
  })

  video.addEventListener('loadedmetadata', () => {
    duration.textContent = formatVideoTime(video.duration)
    current.textContent = formatVideoTime(video.currentTime)
    endInput.max = String(video.duration)
    startInput.max = String(video.duration)
    endInput.value = (Math.floor(video.duration * 1000) / 1000).toFixed(3)
    updateCommand()
  })
  video.addEventListener('timeupdate', () => {
    current.textContent = formatVideoTime(video.currentTime)
  })

  document.querySelectorAll<HTMLButtonElement>('[data-seek]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!Number.isFinite(video.duration)) return
      video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + Number(button.dataset.seek)))
      current.textContent = formatVideoTime(video.currentTime)
    })
  })
  document.querySelector<HTMLButtonElement>('#set-start')!.addEventListener('click', () => {
    startInput.value = video.currentTime.toFixed(3)
    updateCommand()
  })
  document.querySelector<HTMLButtonElement>('#set-end')!.addEventListener('click', () => {
    endInput.value = video.currentTime.toFixed(3)
    updateCommand()
  })
  startInput.addEventListener('input', updateCommand)
  endInput.addEventListener('input', updateCommand)

  addHistoryButton.addEventListener('click', () => {
    const selectedRange = getCurrentRange()
    if (!selectedRange || !currentVideoRecord) return
    const normalizedStart = Math.round(selectedRange.start * 1000) / 1000
    const normalizedEnd = Math.round(selectedRange.end * 1000) / 1000
    const duplicate = currentVideoRecord.clips.some((record) => record.start === normalizedStart && record.end === normalizedEnd)
    if (duplicate) {
      historyStatus.textContent = 'This range is already in history.'
      return
    }

    currentVideoRecord.clips.unshift({
      id: createId(),
      start: normalizedStart,
      end: normalizedEnd,
      duration: normalizedEnd - normalizedStart,
      createdAt: new Date().toISOString(),
    })
    currentVideoRecord.updatedAt = new Date().toISOString()
    historyStatus.textContent = saveVideoLibrary(videoLibrary)
      ? 'Range added.'
      : 'Could not save history in this browser.'
    renderClipHistory()
    renderVideoLibrary()
  })

  historyList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-history-action]')
    if (!button) return
    const record = currentVideoRecord?.clips.find((item) => item.id === button.dataset.historyId)
    if (!record) return
    const action = button.dataset.historyAction

    if (action === 'go-start' || action === 'go-end') {
      if (!Number.isFinite(video.duration)) return
      const target = action === 'go-start' ? record.start : record.end
      video.currentTime = Math.min(video.duration, Math.max(0, target))
      current.textContent = formatVideoTime(video.currentTime)
      return
    }
    if (action === 'use-range') {
      startInput.value = record.start.toFixed(3)
      endInput.value = record.end.toFixed(3)
      updateCommand()
      historyStatus.textContent = 'Range restored.'
      return
    }
    if (action === 'delete') {
      if (!currentVideoRecord) return
      currentVideoRecord.clips = currentVideoRecord.clips.filter((item) => item.id !== record.id)
      currentVideoRecord.updatedAt = new Date().toISOString()
      historyStatus.textContent = saveVideoLibrary(videoLibrary)
        ? 'Range deleted.'
        : 'Range removed here, but browser storage could not be updated.'
      renderClipHistory()
      renderVideoLibrary()
    }
  })

  copyButton.addEventListener('click', async () => {
    await copyText(command.value, copyStatus, command)
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
  if (window.location.hash === '#/video') {
    renderVideo()
    return
  }
  cleanupVideoObjectUrl()
  await loadRecords()
  if (window.location.hash === '#/generate') renderGenerate()
  else renderLibrary()
}

window.addEventListener('hashchange', () => void renderRoute())
window.addEventListener('beforeunload', cleanupVideoObjectUrl)
void renderRoute()

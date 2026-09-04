import './style.css'
import geminiVoices from './data/gemini-voices.json'
import testScripts from './data/test-scripts.json'
import { mountVideoV2, unmountVideoV2 } from './video-v2-panels'
import { buildFfmpegClipCommand, formatFfmpegTime, quoteShellArgument } from './video-clip.mjs'
import { analyzePoseVideo } from './pose-video-analyzer'
import { createPoseReplay, loadPoseReplayData, type PoseReplaySession } from './pose-replay'
import {
  createVideoStorage,
  createId,
  detectSourceSite,
  mergeVideoRecord,
  normalizeVideoRecord,
  serverVideoIdentity,
  serverVideoUrl,
  videoIdentity,
  type VideoLibrary,
  type VideoRecord,
} from './video-library-storage'

type AudioRecord = {
  id: string
  voice: string
  script: string
  audioFile: string
  durationSeconds?: number
  createdAt: string
}

type SortColumn = 'voice' | 'script' | 'audioFile' | 'durationSeconds' | 'createdAt'

type ServerVideoAsset = {
  name: string
  relativePath: string
  url: string
  category: 'source' | 'clip'
  previewSupported: boolean
}

type ServerVideoLibrary = {
  source: ServerVideoAsset[]
  clips: ServerVideoAsset[]
}

const recentVideoSourceUrlKey = 'story-voice.video-source-url.v1'
const testVideoDirectory = '/home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio/public/test-videos'
const sourceVideoDirectory = `${testVideoDirectory}/source`
const clipVideoDirectory = `${testVideoDirectory}/clips`

const app = document.querySelector<HTMLDivElement>('#app')!
let records: AudioRecord[] = []
let activeAudio: HTMLAudioElement | null = null
let activeButton: HTMLButtonElement | null = null
let sortColumn: SortColumn = 'createdAt'
let sortDirection: 'asc' | 'desc' = 'desc'
let activeVideoObjectUrl: string | null = null
let activePoseAnalysisController: AbortController | null = null
let activePoseReplayCleanup: (() => void) | null = null

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

const layout = (content: string, activePage: 'audio' | 'video' | 'video-v2' = 'audio') => {
  app.innerHTML = `
    <header class="site-header">
      <nav class="site-nav" aria-label="Primary navigation">
        <a href="#/"${activePage === 'audio' && window.location.hash !== '#/generate' ? ' aria-current="page"' : ''}>Audio</a>
        <a href="#/generate"${window.location.hash === '#/generate' ? ' aria-current="page"' : ''}>Generate Audio</a>
        <a href="#/video"${activePage === 'video' ? ' aria-current="page"' : ''}>Video</a>
        <a href="#/video-v2"${activePage === 'video-v2' ? ' aria-current="page"' : ''}>Video V2</a>
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

const formatVideoTime = formatFfmpegTime

const clipOutputFilename = (filename: string) => {
  const extensionIndex = filename.lastIndexOf('.')
  if (extensionIndex <= 0) return `${filename}-clip.mp4`
  return `${filename.slice(0, extensionIndex)}-clip.mp4`
}

const moveVideoToolsIntoV2 = () => {
  const libraryHeading = document.querySelector<HTMLElement>('.library-panel > .workspace-panel-heading')!
  const libraryList = document.querySelector<HTMLElement>('#video-library-list')!
  const currentHeading = document.querySelector<HTMLElement>('.current-panel > .workspace-panel-heading')!
  const emptyState = document.querySelector<HTMLElement>('#video-empty-state')!
  const workspace = document.querySelector<HTMLElement>('#video-workspace')!
  const currentTitle = document.querySelector<HTMLElement>('.current-video-title-row')!
  const videoStage = document.querySelector<HTMLElement>('#video-player-stage')!
  const poseReplayControls = document.querySelector<HTMLElement>('#pose-replay-controls')!
  const videoInfo = document.querySelector<HTMLElement>('#video-info-title')!.closest<HTMLElement>('.current-section')!
  const clipRange = document.querySelector<HTMLElement>('#clip-range-title')!.closest<HTMLElement>('.current-section')!
  const ffmpegCommand = document.querySelector<HTMLElement>('#ffmpeg-command-title')!.closest<HTMLElement>('.current-section')!
  const clipHistory = document.querySelector<HTMLElement>('#clip-history-title')!.closest<HTMLElement>('.current-section')!
  const downloadCommand = document.querySelector<HTMLElement>('#download-command-title')!.closest<HTMLElement>('.action-group')!
  const libraryActions = document.querySelector<HTMLElement>('#library-actions-title')!.closest<HTMLElement>('.action-group')!
  const videoActions = document.querySelector<HTMLElement>('#video-actions-title')!.closest<HTMLElement>('.action-group')!
  const seekControls = document.querySelector<HTMLElement>('.seek-controls')!
  const setStart = document.querySelector<HTMLButtonElement>('#set-start')!
  const setEnd = document.querySelector<HTMLButtonElement>('#set-end')!
  const addHistory = document.querySelector<HTMLButtonElement>('#add-history')!
  const copyCommand = document.querySelector<HTMLButtonElement>('#copy-command')!
  const rangeFields = clipRange.querySelector<HTMLElement>('.clip-range')!
  const clipSummary = clipRange.querySelector<HTMLElement>('.clip-summary')!
  const rangeStatus = clipRange.querySelector<HTMLElement>('#range-status')!
  const durationValue = clipRange.querySelector<HTMLElement>('#clip-duration')!

  app.innerHTML = `
    <main class="video-v2-main">
      <section class="video-v2-page" aria-label="Video V2 tools">
        <div id="video-v2-root"></div>
      </section>
    </main>
  `
  mountVideoV2(document.querySelector<HTMLDivElement>('#video-v2-root')!)

  const leftSlot = document.querySelector<HTMLElement>('#video-v2-left-slot')!
  const centerSlot = document.querySelector<HTMLElement>('#video-v2-center-slot')!
  const rightSlot = document.querySelector<HTMLElement>('#video-v2-right-slot')!

  const playheadSection = document.createElement('section')
  playheadSection.className = 'current-section video-v2-playhead-section'
  playheadSection.append(seekControls)

  clipRange.classList.add('video-v2-clip-range-section')
  rangeFields.classList.add('video-v2-clip-range-fields')
  rangeFields.querySelectorAll<HTMLElement>('label > span').forEach((label, index) => {
    label.textContent = index === 0 ? 'Start' : 'End'
  })
  const compactDuration = document.createElement('p')
  compactDuration.className = 'video-v2-clip-duration'
  durationValue.textContent = '0.000s'
  compactDuration.append('Duration ', durationValue)
  rangeFields.append(compactDuration)
  clipSummary.remove()

  const rangeActions = document.createElement('div')
  rangeActions.className = 'video-v2-range-actions'
  rangeActions.append(setStart, setEnd, addHistory)
  clipRange.append(rangeActions, rangeStatus)

  ffmpegCommand.append(copyCommand)
  videoActions.querySelector('h2')!.textContent = 'Source / Local Video'
  videoActions.querySelector('.stacked-actions')?.remove()
  videoInfo.classList.add('video-v2-video-info')

  workspace.replaceChildren(currentTitle, videoStage, poseReplayControls, playheadSection, clipRange, clipHistory)
  leftSlot.append(libraryHeading, libraryList, libraryActions)
  centerSlot.append(currentHeading, emptyState, workspace)
  rightSlot.append(ffmpegCommand, downloadCommand, videoActions, videoInfo)
}

const renderVideo = async (layoutMode: 'video' | 'video-v2' = 'video') => {
  activePoseAnalysisController?.abort()
  activePoseAnalysisController = null
  activePoseReplayCleanup?.()
  activePoseReplayCleanup = null
  stopPlayback()
  cleanupVideoObjectUrl()
  const videoStorage = createVideoStorage(layoutMode === 'video-v2' ? 'server' : 'local')
  let videoLibrary: VideoLibrary
  let videoLibraryLoadError = ''
  try {
    videoLibrary = await videoStorage.loadLibrary()
  } catch (error) {
    videoLibrary = { version: 1 as const, videos: [] }
    videoLibraryLoadError = error instanceof Error ? error.message : 'Video library could not be loaded.'
  }
  layout(`
    <section class="tool-page video-page" aria-labelledby="page-title">
      <div class="page-heading">
        <h1 id="page-title">Video Tools</h1>
        <p>Generate local commands and keep clip metadata without uploading video files.</p>
      </div>
      <div class="video-workspace-grid">
        <aside class="workspace-panel library-panel" aria-labelledby="video-library-title">
          <div class="workspace-panel-heading">
            <h2 id="video-library-title">Video Library</h2>
            <p id="library-status" class="section-status" role="status" aria-live="polite"></p>
          </div>
          <div id="video-library-list"></div>
        </aside>

        <section class="workspace-panel current-panel" aria-labelledby="current-video-title">
          <div class="workspace-panel-heading">
            <h2 id="current-video-title">Current Video</h2>
          </div>
          <div id="video-empty-state" class="video-empty-state">
            <p>Select a server video from the library or choose a local file.</p>
          </div>
          <div id="video-workspace" hidden>
            <div class="current-video-title-row">
              <div>
                <h3 id="current-video-name">—</h3>
                <p id="current-video-kind">—</p>
              </div>
            </div>
            <div id="video-player-stage" class="video-player-stage">
              <video id="video-player" controls preload="metadata"></video>
              <canvas id="pose-replay-canvas" class="pose-replay-canvas" aria-hidden="true" hidden></canvas>
            </div>
            <div id="pose-replay-controls" class="pose-replay-controls" hidden>
              <span>Pose Replay</span>
              <button id="exit-pose-replay" type="button">Exit Pose Replay</button>
            </div>

            <section class="current-section" aria-labelledby="video-info-title">
              <h3 id="video-info-title">Video Info</h3>
              <dl class="video-metadata">
                <div><dt>File</dt><dd id="video-filename">—</dd></div>
                <div><dt>Type</dt><dd id="video-type">—</dd></div>
                <div><dt>Duration</dt><dd id="video-duration">00:00:00.000</dd></div>
                <div><dt>Current</dt><dd id="video-current">00:00:00.000</dd></div>
                <div><dt>Source Site</dt><dd id="video-source-site">—</dd></div>
                <div class="wide"><dt>Source URL</dt><dd id="video-source-url">—</dd></div>
              </dl>
            </section>

            <section class="current-section" aria-labelledby="clip-range-title">
              <h3 id="clip-range-title">Clip Range</h3>
              <div class="clip-range">
                <label><span>Start (seconds)</span><input id="clip-start" type="number" min="0" step="0.001" value="0.000" inputmode="decimal" disabled /></label>
                <label><span>End (seconds)</span><input id="clip-end" type="number" min="0" step="0.001" value="0.000" inputmode="decimal" disabled /></label>
              </div>
              <div class="clip-summary">
                <p>Clip Duration <strong id="clip-duration">00:00:00.000</strong></p>
                <p id="range-status" role="status" aria-live="polite"></p>
              </div>
            </section>

            <section class="current-section" aria-labelledby="ffmpeg-command-title">
              <h3 id="ffmpeg-command-title">FFmpeg Command</h3>
              <label class="command-field">
                <span class="sr-only">FFmpeg Command</span>
                <textarea id="ffmpeg-command" rows="4" readonly spellcheck="false" aria-describedby="command-note"></textarea>
              </label>
              <p id="command-note" class="command-note">The browser only exposes the filename. Run this command from the video's folder, or replace the input path.</p>
              <p id="clip-output-name" class="clip-output-name"></p>
              <p id="copy-status" class="section-status" role="status" aria-live="polite"></p>
            </section>

            <section class="clip-history current-section" aria-labelledby="clip-history-title">
              <div class="clip-history-heading">
                <h3 id="clip-history-title">Clip History</h3>
                <p id="history-status" role="status" aria-live="polite"></p>
              </div>
              <div id="history-list"></div>
            </section>
          </div>
        </section>

        <aside class="workspace-panel actions-panel" aria-label="Video actions">
          <section class="action-group download-command" aria-labelledby="download-command-title">
            <h2 id="download-command-title">Download Command</h2>
            <label><span>Source URL</span><input id="source-url" type="text" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off" /></label>
            <div class="stacked-actions">
              <button id="generate-download-command" type="button">Generate yt-dlp Command</button>
              <button id="copy-download-command" type="button" disabled>Copy Download Command</button>
            </div>
            <textarea id="download-command-output" rows="4" readonly spellcheck="false" aria-label="yt-dlp command"></textarea>
            <p id="download-command-status" class="section-status" role="status" aria-live="polite"></p>
          </section>

          <section class="action-group" aria-labelledby="library-actions-title">
            <h2 id="library-actions-title">Library Actions</h2>
            <div class="stacked-actions">
              <button id="refresh-video-library" type="button">Refresh Library</button>
              <button id="export-library" type="button">Export Library JSON</button>
              <label class="import-library-button">Import Library JSON<input id="import-library" type="file" accept="application/json,.json" /></label>
            </div>
          </section>

          <section class="action-group" aria-labelledby="video-actions-title">
            <h2 id="video-actions-title">Video Actions</h2>
            <button id="attach-source-url" type="button" disabled>Attach Current Source URL</button>
            <label class="video-file-field">
              <span>Choose Local Video</span>
              <input id="video-file" type="file" accept="video/*" />
            </label>
            <div class="seek-controls" aria-label="Video seek controls">
              <button type="button" data-video-action data-seek="-1" disabled>-1s</button>
              <button type="button" data-video-action data-seek="-0.1" disabled>-0.1s</button>
              <button type="button" data-video-action data-seek="0.1" disabled>+0.1s</button>
              <button type="button" data-video-action data-seek="1" disabled>+1s</button>
            </div>
            <div class="stacked-actions">
              <button id="set-start" type="button" data-video-action disabled>Set Start</button>
              <button id="set-end" type="button" data-video-action disabled>Set End</button>
              <button id="add-history" type="button" disabled>Add to History</button>
              <button id="copy-command" type="button" disabled>Copy FFmpeg Command</button>
            </div>
          </section>
        </aside>
      </div>
    </section>
  `, 'video')

  if (layoutMode === 'video-v2') moveVideoToolsIntoV2()

  const sourceUrlInput = document.querySelector<HTMLInputElement>('#source-url')!
  const downloadCommandOutput = document.querySelector<HTMLTextAreaElement>('#download-command-output')!
  const generateDownloadButton = document.querySelector<HTMLButtonElement>('#generate-download-command')!
  const copyDownloadButton = document.querySelector<HTMLButtonElement>('#copy-download-command')!
  const attachSourceButton = document.querySelector<HTMLButtonElement>('#attach-source-url')!
  const downloadCommandStatus = document.querySelector<HTMLParagraphElement>('#download-command-status')!
  const videoLibraryList = document.querySelector<HTMLDivElement>('#video-library-list')!
  const libraryStatus = document.querySelector<HTMLParagraphElement>('#library-status')!
  const refreshVideoLibraryButton = document.querySelector<HTMLButtonElement>('#refresh-video-library')!
  const importLibraryInput = document.querySelector<HTMLInputElement>('#import-library')!
  const fileInput = document.querySelector<HTMLInputElement>('#video-file')!
  const emptyState = document.querySelector<HTMLDivElement>('#video-empty-state')!
  const workspace = document.querySelector<HTMLDivElement>('#video-workspace')!
  const video = document.querySelector<HTMLVideoElement>('#video-player')!
  const poseReplayCanvas = document.querySelector<HTMLCanvasElement>('#pose-replay-canvas')!
  const poseReplayControls = document.querySelector<HTMLDivElement>('#pose-replay-controls')!
  const exitPoseReplayButton = document.querySelector<HTMLButtonElement>('#exit-pose-replay')!
  const currentVideoName = document.querySelector<HTMLElement>('#current-video-name')!
  const currentVideoKind = document.querySelector<HTMLElement>('#current-video-kind')!
  const filename = document.querySelector<HTMLElement>('#video-filename')!
  const videoType = document.querySelector<HTMLElement>('#video-type')!
  const duration = document.querySelector<HTMLElement>('#video-duration')!
  const current = document.querySelector<HTMLElement>('#video-current')!
  const videoSourceSite = document.querySelector<HTMLElement>('#video-source-site')!
  const videoSourceUrl = document.querySelector<HTMLElement>('#video-source-url')!
  const startInput = document.querySelector<HTMLInputElement>('#clip-start')!
  const endInput = document.querySelector<HTMLInputElement>('#clip-end')!
  const clipDuration = document.querySelector<HTMLElement>('#clip-duration')!
  const rangeStatus = document.querySelector<HTMLParagraphElement>('#range-status')!
  const addHistoryButton = document.querySelector<HTMLButtonElement>('#add-history')!
  const command = document.querySelector<HTMLTextAreaElement>('#ffmpeg-command')!
  const commandNote = document.querySelector<HTMLParagraphElement>('#command-note')!
  const clipOutputName = document.querySelector<HTMLParagraphElement>('#clip-output-name')!
  const copyButton = document.querySelector<HTMLButtonElement>('#copy-command')!
  const copyStatus = document.querySelector<HTMLParagraphElement>('#copy-status')!
  const historyList = document.querySelector<HTMLDivElement>('#history-list')!
  const historyStatus = document.querySelector<HTMLParagraphElement>('#history-status')!
  let selectedFilename = ''
  let currentVideoRecord: VideoRecord | null = null
  let currentServerAsset: ServerVideoAsset | null = null
  let viewedVideoId = ''
  let serverLibrary: ServerVideoLibrary = { source: [], clips: [] }
  const analyzingPoseClipIds = new Set<string>()
  const compressingPoseClipIds = new Set<string>()
  let poseReplaySession: PoseReplaySession | null = null
  let poseReplayController: AbortController | null = null
  let replayingClipId = ''

  const cleanupPoseReplay = () => {
    poseReplayController?.abort()
    poseReplayController = null
    poseReplaySession?.destroy()
    poseReplaySession = null
    replayingClipId = ''
    poseReplayCanvas.hidden = true
    poseReplayControls.hidden = true
  }
  activePoseReplayCleanup = cleanupPoseReplay
  if (layoutMode === 'video') {
    try {
      sourceUrlInput.value = localStorage.getItem(recentVideoSourceUrlKey) ?? ''
    } catch {
      sourceUrlInput.value = ''
    }
  }

  const getCurrentRange = () => {
    const start = startInput.valueAsNumber
    const end = endInput.valueAsNumber
    const videoDuration = video.duration
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start ||
      !Number.isFinite(videoDuration) || end > videoDuration) return null
    return { start, end, duration: end - start }
  }

  const setVideoActionsEnabled = (enabled: boolean) => {
    document.querySelectorAll<HTMLButtonElement>('[data-video-action]').forEach((button) => {
      button.disabled = !enabled
    })
    startInput.disabled = !enabled
    endInput.disabled = !enabled
    if (!enabled) {
      addHistoryButton.disabled = true
      copyButton.disabled = true
    }
  }

  const updateCurrentVideoDetails = () => {
    if (!currentVideoRecord) return
    const kind = currentServerAsset
      ? currentServerAsset.category === 'source' ? 'Server source' : 'Server clip'
      : 'Local upload'
    currentVideoName.textContent = currentVideoRecord.file.name
    currentVideoKind.textContent = kind
    filename.textContent = currentVideoRecord.file.name
    videoType.textContent = kind
    videoSourceSite.textContent = currentVideoRecord.source?.site ?? '—'
    videoSourceUrl.textContent = currentVideoRecord.source?.url ?? '—'
    videoSourceUrl.title = currentVideoRecord.source?.url ?? ''
  }

  const restoreCurrentServerVideo = () => {
    cleanupPoseReplay()
    if (!currentServerAsset) return
    selectedFilename = currentServerAsset.name
    video.src = currentServerAsset.url
    updateCurrentVideoDetails()
    video.load()
    renderClipHistory()
    historyStatus.textContent = 'Pose replay closed.'
  }

  const startPoseReplay = async (record: VideoRecord['clips'][number]) => {
    if (layoutMode !== 'video-v2' || !record.generatedClip?.poseResult) return
    cleanupPoseReplay()
    const controller = new AbortController()
    poseReplayController = controller
    replayingClipId = record.id
    video.pause()
    video.src = serverVideoUrl(record.generatedClip.relativePath)
    currentVideoName.textContent = record.generatedClip.filename
    currentVideoKind.textContent = 'Pose replay · Server clip'
    filename.textContent = record.generatedClip.filename
    videoType.textContent = 'Pose replay'
    poseReplayControls.hidden = false
    historyStatus.textContent = 'Loading saved Pose landmarks…'
    renderClipHistory()
    video.load()

    try {
      const replayData = await loadPoseReplayData(
        serverVideoUrl(record.generatedClip.poseResult.relativePath),
        controller.signal,
      )
      if (poseReplayController !== controller) return
      poseReplayCanvas.hidden = false
      poseReplaySession = createPoseReplay(video, poseReplayCanvas, replayData)
      historyStatus.textContent = `Pose replay ready: ${replayData.frames.length} saved frames.`
    } catch (error) {
      if (controller.signal.aborted) return
      cleanupPoseReplay()
      renderClipHistory()
      historyStatus.textContent = error instanceof Error
        ? `Could not load Pose replay. ${error.message}`
        : 'Could not load Pose replay.'
    }
  }

  exitPoseReplayButton.addEventListener('click', restoreCurrentServerVideo)

  const renderVideoLibrary = () => {
    const serverAssetIds = new Set([...serverLibrary.source, ...serverLibrary.clips].map((asset) => serverVideoIdentity(asset.relativePath)))
    const recordDetails = (record: VideoRecord | undefined) => {
      if (!record || record.id !== viewedVideoId) return ''
      return `
        <div class="video-library-detail">
          <dl>
            <div><dt>Type</dt><dd>${record.type}</dd></div>
            ${record.type === 'local' ? `
              <div><dt>Size</dt><dd>${record.file.size.toLocaleString()} bytes</dd></div>
              <div><dt>Last Modified</dt><dd>${escapeHtml(formatCreatedAt(new Date(record.file.lastModified).toISOString()))}</dd></div>
            ` : `<div><dt>Path</dt><dd>${escapeHtml(record.server?.relativePath ?? '')}</dd></div>`}
            <div><dt>Created</dt><dd>${escapeHtml(formatCreatedAt(record.createdAt))}</dd></div>
          </dl>
          <div class="library-clip-list">
            ${record.clips.length ? record.clips.map((clip, index) => `
              <p>#${index + 1} ${formatVideoTime(clip.start)} → ${formatVideoTime(clip.end)} <span>(${formatVideoTime(clip.duration)})</span></p>
            `).join('') : '<p>No clips saved.</p>'}
          </div>
        </div>
      `
    }
    const recordSummary = (record: VideoRecord | undefined) => {
      const source = record?.source
      return `
        <p>Source: ${source ? escapeHtml(source.site) : '—'}</p>
        ${source ? `<p class="source-url" title="${escapeHtml(source.url)}">${escapeHtml(source.url)}</p>` : ''}
        <p>Clips: ${record?.clips.length ?? 0}${record ? ` · Updated: ${escapeHtml(formatCreatedAt(record.updatedAt))}` : ''}</p>
      `
    }
    const renderServerAsset = (asset: ServerVideoAsset) => {
      const record = videoLibrary.videos.find((item) => item.id === serverVideoIdentity(asset.relativePath))
      const viewed = record?.id === viewedVideoId
      return `
        <article class="video-library-item${currentServerAsset?.relativePath === asset.relativePath ? ' is-current' : ''}">
          <div class="video-library-summary">
            <div>
              <h4 title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</h4>
              <p>${asset.category === 'clip' ? 'Generated clip' : 'Source video'}${asset.previewSupported ? '' : ' · Preview unsupported'}</p>
              ${recordSummary(record)}
            </div>
            <div class="video-library-item-actions">
              <button type="button" data-library-action="open" data-relative-path="${escapeHtml(asset.relativePath)}"${asset.previewSupported ? '' : ' disabled'}>Open</button>
              ${record ? `<button type="button" data-library-action="view" data-video-id="${escapeHtml(record.id)}">${viewed ? 'Hide' : 'View'}</button>` : ''}
            </div>
          </div>
          ${recordDetails(record)}
        </article>
      `
    }
    const metadataOnlyRecords = videoLibrary.videos
      .filter((record) => !serverAssetIds.has(record.id))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    const renderMetadataRecord = (record: VideoRecord) => {
      const viewed = record.id === viewedVideoId
      return `
        <article class="video-library-item${currentVideoRecord?.id === record.id ? ' is-current' : ''}">
          <div class="video-library-summary">
            <div>
              <h4 title="${escapeHtml(record.file.name)}">${escapeHtml(record.file.name)}</h4>
              <p>${record.type === 'local' ? 'Local file metadata' : 'Server video not currently listed'}</p>
              ${recordSummary(record)}
            </div>
            <button type="button" data-library-action="view" data-video-id="${escapeHtml(record.id)}">${viewed ? 'Hide' : 'View'}</button>
          </div>
          ${recordDetails(record)}
        </article>
      `
    }

    videoLibraryList.innerHTML = `
      <section class="video-library-group">
        <h3>Source Videos</h3>
        ${serverLibrary.source.length ? serverLibrary.source.map(renderServerAsset).join('') : '<p class="library-empty">No videos found in source/.</p>'}
      </section>
      <section class="video-library-group">
        <h3>Clips</h3>
        ${serverLibrary.clips.length ? serverLibrary.clips.map(renderServerAsset).join('') : '<p class="library-empty">No videos found in clips/.</p>'}
      </section>
      ${metadataOnlyRecords.length ? `
        <section class="video-library-group">
          <h3>Saved Metadata</h3>
          ${metadataOnlyRecords.map(renderMetadataRecord).join('')}
        </section>
      ` : ''}
    `
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
        ${record.generatedClip ? `
          <p class="history-generated">
            Generated:
            <a href="${escapeHtml(serverVideoUrl(record.generatedClip.relativePath))}" target="_blank" rel="noopener" title="${escapeHtml(record.generatedClip.filename)}">${escapeHtml(record.generatedClip.filename)}</a>
          </p>
        ` : ''}
        ${record.generatedClip?.poseResult ? `
          <div class="history-pose-result">
            <p>Pose: ${record.generatedClip.poseResult.frameCount.toLocaleString()} frames / ${record.generatedClip.poseResult.detectedPoseFrameCount.toLocaleString()} detected</p>
            <div class="history-pose-actions">
              <a href="${escapeHtml(serverVideoUrl(record.generatedClip.poseResult.relativePath))}" target="_blank" rel="noopener">Open Pose JSON</a>
              <button type="button" data-history-action="copy-pose-path" data-history-id="${escapeHtml(record.id)}">Copy Pose Path</button>
              ${layoutMode === 'video-v2' ? `<button type="button" data-history-action="replay-pose" data-history-id="${escapeHtml(record.id)}">${replayingClipId === record.id ? 'Replay Active' : 'Replay Pose'}</button>` : ''}
            </div>
            ${layoutMode === 'video-v2' ? `
              ${record.generatedClip.poseResult.llmResult ? `
                <p class="history-llm-pose-summary">LLM Pose: ${record.generatedClip.poseResult.llmResult.frameCount.toLocaleString()} frames | ${(record.generatedClip.poseResult.llmResult.sizeBytes / 1024).toFixed(1)} KB</p>
                <div class="history-pose-actions">
                  <a href="${escapeHtml(serverVideoUrl(record.generatedClip.poseResult.llmResult.relativePath))}" target="_blank" rel="noopener">Open LLM Pose JSON</a>
                  <button type="button" data-history-action="copy-llm-pose-path" data-history-id="${escapeHtml(record.id)}">Copy LLM Pose Path</button>
                </div>
              ` : ''}
              <div class="history-pose-actions">
                <button type="button" data-history-action="build-llm-pose" data-history-id="${escapeHtml(record.id)}"${compressingPoseClipIds.has(record.id) ? ' disabled' : ''}>${compressingPoseClipIds.has(record.id) ? 'Compressing Pose…' : record.generatedClip.poseResult.llmResult ? 'Rebuild LLM Pose' : 'Build LLM Pose'}</button>
              </div>
            ` : ''}
          </div>
        ` : ''}
        <div class="history-actions">
          <button type="button" data-history-action="go-start" data-history-id="${escapeHtml(record.id)}">Go Start</button>
          <button type="button" data-history-action="go-end" data-history-id="${escapeHtml(record.id)}">Go End</button>
          <button type="button" data-history-action="use-range" data-history-id="${escapeHtml(record.id)}">Use Range</button>
          ${layoutMode === 'video-v2' && record.generatedClip ? `
            <button type="button" data-history-action="copy-full-path" data-history-id="${escapeHtml(record.id)}">Copy Full Path</button>
            <button type="button" data-history-action="analyze-pose" data-history-id="${escapeHtml(record.id)}"${analyzingPoseClipIds.has(record.id) ? ' disabled' : ''}>${analyzingPoseClipIds.has(record.id) ? 'Analyzing Pose…' : record.generatedClip.poseResult ? 'Re-analyze Pose' : 'Analyze Pose'}</button>
          ` : ''}
          ${layoutMode === 'video-v2' && currentServerAsset?.category === 'source' ? `
            <button type="button" data-history-action="generate" data-history-id="${escapeHtml(record.id)}">${record.generatedClip ? 'Regenerate Clip' : 'Generate Clip'}</button>
          ` : ''}
          <button type="button" data-history-action="delete" data-history-id="${escapeHtml(record.id)}">Delete</button>
        </div>
      </article>
    `).join('')
  }

  const applyStoredLibrary = (storedLibrary: VideoLibrary) => {
    const currentVideoId = currentVideoRecord?.id
    videoLibrary = storedLibrary
    if (currentVideoId) {
      currentVideoRecord = videoLibrary.videos.find((record) => record.id === currentVideoId) ?? currentVideoRecord
    }
  }

  const restoreServerLibrary = async () => {
    if (videoStorage.kind !== 'server') return
    try {
      applyStoredLibrary(await videoStorage.loadLibrary())
    } catch {
      // Keep the original server error visible; there is no client-side fallback.
    }
  }

  const persistLibrary = async (
    successMessage: string,
    failureMessage: string,
    save: () => Promise<VideoLibrary> = () => videoStorage.saveLibrary(videoLibrary),
  ) => {
    try {
      applyStoredLibrary(await save())
      videoLibraryLoadError = ''
      libraryStatus.textContent = successMessage
      renderVideoLibrary()
      return true
    } catch (error) {
      await restoreServerLibrary()
      libraryStatus.textContent = error instanceof Error ? `${failureMessage} ${error.message}` : failureMessage
      renderVideoLibrary()
      return false
    }
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

  const requestGeneratedClipFullPath = async (clipRangeId: string) => {
    const response = await fetch(`/api/video-v2/clip/${encodeURIComponent(clipRangeId)}/path`, { cache: 'no-store' })
    const payload = await response.json() as { fullPath?: unknown; error?: { message?: string } }
    if (!response.ok || typeof payload.fullPath !== 'string' || !payload.fullPath) {
      throw new Error(payload.error?.message ?? 'The server could not resolve this generated clip path.')
    }
    return payload.fullPath
  }

  const requestPoseResultFullPath = async (clipRangeId: string) => {
    const response = await fetch(`/api/video-v2/clip/${encodeURIComponent(clipRangeId)}/pose/path`, { cache: 'no-store' })
    const payload = await response.json() as { fullPath?: unknown; error?: { message?: string } }
    if (!response.ok || typeof payload.fullPath !== 'string' || !payload.fullPath) {
      throw new Error(payload.error?.message ?? 'The server could not resolve this pose result path.')
    }
    return payload.fullPath
  }

  const requestLlmPoseResultFullPath = async (clipRangeId: string) => {
    const response = await fetch(`/api/video-v2/clip/${encodeURIComponent(clipRangeId)}/pose/llm/path`, { cache: 'no-store' })
    const payload = await response.json() as { fullPath?: unknown; error?: { message?: string } }
    if (!response.ok || typeof payload.fullPath !== 'string' || !payload.fullPath) {
      throw new Error(payload.error?.message ?? 'The server could not resolve this LLM Pose result path.')
    }
    return payload.fullPath
  }

  const updateAttachSourceButton = () => {
    attachSourceButton.disabled = !currentVideoRecord || !sourceUrlInput.value.trim()
  }

  const openServerAsset = async (asset: ServerVideoAsset) => {
    cleanupPoseReplay()
    cleanupVideoObjectUrl()
    const identity = serverVideoIdentity(asset.relativePath)
    currentVideoRecord = videoLibrary.videos.find((record) => record.id === identity) ?? null
    if (!currentVideoRecord) {
      const now = new Date().toISOString()
      currentVideoRecord = {
        id: identity,
        type: 'server',
        file: { name: asset.name, size: 0, lastModified: 0 },
        server: { relativePath: asset.relativePath, url: asset.url },
        clips: [],
        createdAt: now,
        updatedAt: now,
        nextClipNumber: 1,
      }
      videoLibrary.videos.unshift(currentVideoRecord)
    } else {
      currentVideoRecord.server = { relativePath: asset.relativePath, url: asset.url }
    }
    currentServerAsset = asset
    selectedFilename = asset.name
    fileInput.value = ''
    filename.textContent = asset.name
    startInput.value = '0.000'
    endInput.value = '0.000'
    command.value = ''
    commandNote.textContent = `Server input uses ${testVideoDirectory}. Clip output is written to clips/.`
    copyButton.disabled = true
    addHistoryButton.disabled = true
    copyStatus.textContent = ''
    rangeStatus.textContent = ''
    historyStatus.textContent = ''
    video.src = asset.url
    emptyState.hidden = true
    workspace.hidden = false
    setVideoActionsEnabled(true)
    updateCurrentVideoDetails()
    const recordToSave = currentVideoRecord
    await persistLibrary(
      'Server video opened.',
      'Video opened, but its metadata could not be saved.',
      () => videoStorage.saveVideo(videoLibrary, recordToSave),
    )
    renderClipHistory()
    updateAttachSourceButton()
    video.load()
  }

  const refreshServerLibrary = async () => {
    refreshVideoLibraryButton.disabled = true
    refreshVideoLibraryButton.textContent = 'Refreshing…'
    libraryStatus.textContent = 'Reading server video directories…'
    try {
      const response = await fetch('/api/test-videos', { cache: 'no-store' })
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Video list API returned HTML instead of JSON. Restart the app with npm run dev.')
      }
      const value = await response.json() as Partial<ServerVideoLibrary> & { error?: { message?: string } }
      if (!response.ok || !Array.isArray(value.source) || !Array.isArray(value.clips)) {
        throw new Error(value.error?.message ?? 'The server returned an invalid video list.')
      }
      serverLibrary = { source: value.source, clips: value.clips }
      let recordsChanged = false
      for (const asset of [...serverLibrary.source, ...serverLibrary.clips]) {
        const record = videoLibrary.videos.find((item) => item.id === serverVideoIdentity(asset.relativePath))
        if (record?.type === 'server' &&
          (record.server?.relativePath !== asset.relativePath || record.server.url !== asset.url)) {
          record.server = { relativePath: asset.relativePath, url: asset.url }
          recordsChanged = true
        }
      }
      if (recordsChanged) applyStoredLibrary(await videoStorage.saveLibrary(videoLibrary))
      if (currentServerAsset) {
        currentServerAsset = [...serverLibrary.source, ...serverLibrary.clips]
          .find((asset) => asset.relativePath === currentServerAsset?.relativePath) ?? currentServerAsset
      }
      libraryStatus.textContent = videoLibraryLoadError ||
        `Found ${serverLibrary.source.length} source video${serverLibrary.source.length === 1 ? '' : 's'} and ${serverLibrary.clips.length} clip${serverLibrary.clips.length === 1 ? '' : 's'}.`
      renderVideoLibrary()
    } catch (error) {
      libraryStatus.textContent = error instanceof Error ? error.message : 'Could not refresh the server video library.'
    } finally {
      refreshVideoLibraryButton.disabled = false
      refreshVideoLibraryButton.textContent = 'Refresh Library'
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
    if (layoutMode === 'video') {
      try {
        localStorage.setItem(recentVideoSourceUrlKey, sourceUrl)
      } catch {
        // Command generation still works when browser storage is unavailable.
      }
    }
    downloadCommandOutput.value = `yt-dlp -P ${quoteShellArgument(sourceVideoDirectory)} ${quoteShellArgument(sourceUrl)}`
    copyDownloadButton.disabled = false
  })
  sourceUrlInput.addEventListener('input', () => {
    downloadCommandOutput.value = ''
    copyDownloadButton.disabled = true
    downloadCommandStatus.textContent = ''
    updateAttachSourceButton()
  })
  copyDownloadButton.addEventListener('click', () => {
    void copyText(downloadCommandOutput.value, downloadCommandStatus, downloadCommandOutput)
  })

  attachSourceButton.addEventListener('click', async () => {
    if (!currentVideoRecord || !sourceUrlInput.value.trim()) return
    if (associateSourceWithRecord(currentVideoRecord)) {
      const recordToSave = currentVideoRecord
      await persistLibrary(
        'Source URL attached to the current video.',
        'The source URL could not be saved.',
        () => videoStorage.saveVideo(videoLibrary, recordToSave),
      )
      updateCurrentVideoDetails()
      downloadCommandStatus.textContent = 'Source URL attached.'
    } else {
      downloadCommandStatus.textContent = 'This source URL is already attached.'
    }
  })

  refreshVideoLibraryButton.addEventListener('click', () => void refreshServerLibrary())

  videoLibraryList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-library-action]')
    if (!button) return
    if (button.dataset.libraryAction === 'open' && button.dataset.relativePath) {
      const asset = [...serverLibrary.source, ...serverLibrary.clips]
        .find((item) => item.relativePath === button.dataset.relativePath)
      if (asset) void openServerAsset(asset)
      return
    }
    if (button.dataset.libraryAction === 'view' && button.dataset.videoId) {
      viewedVideoId = viewedVideoId === button.dataset.videoId ? '' : button.dataset.videoId
      renderVideoLibrary()
    }
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
      await persistLibrary(
        `Imported ${importedRecords.length} video record${importedRecords.length === 1 ? '' : 's'}.`,
        'The library was merged in memory, but persistent storage could not be updated.',
      )
      renderClipHistory()
      updateCurrentVideoDetails()
    } catch (error) {
      libraryStatus.textContent = error instanceof Error ? `Import failed: ${error.message}` : 'Import failed: invalid JSON.'
    } finally {
      importLibraryInput.value = ''
    }
  })

  renderVideoLibrary()
  updateAttachSourceButton()
  void refreshServerLibrary()

  const serverClipOutputFilename = (start: number, end: number) => {
    const normalizedStart = Math.round(start * 1000) / 1000
    const normalizedEnd = Math.round(end * 1000) / 1000
    const matchingClip = currentVideoRecord?.clips.find((clip) => clip.start === normalizedStart && clip.end === normalizedEnd)
    if (matchingClip?.outputFilename) return matchingClip.outputFilename
    const extensionIndex = selectedFilename.lastIndexOf('.')
    const baseName = extensionIndex > 0 ? selectedFilename.slice(0, extensionIndex) : selectedFilename
    const usedFilenames = new Set([
      ...serverLibrary.clips.map((clip) => clip.name),
      ...(currentVideoRecord?.clips.flatMap((clip) => clip.outputFilename ? [clip.outputFilename] : []) ?? []),
    ])
    let sequence = currentVideoRecord?.nextClipNumber ?? (currentVideoRecord?.clips.length ?? 0) + 1
    let filename = `${baseName}-clip-${String(sequence).padStart(2, '0')}.mp4`
    while (usedFilenames.has(filename)) {
      sequence += 1
      filename = `${baseName}-clip-${String(sequence).padStart(2, '0')}.mp4`
    }
    return filename
  }

  const updateCommand = () => {
    const start = startInput.valueAsNumber
    const end = endInput.valueAsNumber
    const selectedRange = getCurrentRange()

    copyStatus.textContent = ''
    addHistoryButton.disabled = !selectedRange
    if (!selectedRange) {
      clipDuration.textContent = '—'
      command.value = ''
      clipOutputName.textContent = ''
      copyButton.disabled = true
      if (!Number.isFinite(start) || !Number.isFinite(end)) rangeStatus.textContent = 'Enter valid numeric Start and End values.'
      else if (start < 0) rangeStatus.textContent = 'Start must be 0 or later.'
      else if (end <= start) rangeStatus.textContent = 'Invalid range: End must be later than Start.'
      else rangeStatus.textContent = 'End cannot be later than the video duration.'
      return
    }

    clipDuration.textContent = layoutMode === 'video-v2'
      ? `${selectedRange.duration.toFixed(3)}s`
      : formatVideoTime(selectedRange.duration)
    rangeStatus.textContent = ''
    const outputFilename = currentServerAsset
      ? serverClipOutputFilename(selectedRange.start, selectedRange.end)
      : clipOutputFilename(selectedFilename)
    const inputPath = currentServerAsset
      ? `${testVideoDirectory}/${currentServerAsset.relativePath}`
      : selectedFilename
    const outputPath = currentServerAsset ? `${clipVideoDirectory}/${outputFilename}` : outputFilename
    command.value = buildFfmpegClipCommand({
      start: selectedRange.start,
      duration: selectedRange.duration,
      inputPath,
      outputPath,
    })
    clipOutputName.textContent = `Output: ${outputFilename}`
    copyButton.disabled = false
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    cleanupPoseReplay()
    cleanupVideoObjectUrl()
    command.value = ''
    copyButton.disabled = true
    addHistoryButton.disabled = true
    copyStatus.textContent = ''
    rangeStatus.textContent = ''
    historyStatus.textContent = ''
    if (!file) {
      workspace.hidden = true
      emptyState.hidden = false
      currentVideoRecord = null
      currentServerAsset = null
      setVideoActionsEnabled(false)
      renderVideoLibrary()
      updateAttachSourceButton()
      video.removeAttribute('src')
      video.load()
      return
    }

    selectedFilename = file.name
    currentServerAsset = null
    commandNote.textContent = "The browser only exposes the filename. Run this command from the video's folder, or replace the input path."
    const fileMetadata = { name: file.name, size: file.size, lastModified: file.lastModified }
    const identity = videoIdentity(fileMetadata)
    currentVideoRecord = videoLibrary.videos.find((record) => record.id === identity) ?? null
    if (!currentVideoRecord) {
      const now = new Date().toISOString()
      currentVideoRecord = {
        id: identity,
        type: 'local',
        file: fileMetadata,
        clips: [],
        createdAt: now,
        updatedAt: now,
      }
      videoLibrary.videos.unshift(currentVideoRecord)
    }
    const recordToSave = currentVideoRecord
    await persistLibrary(
      'Video metadata saved.',
      'Video selected, but its metadata could not be saved.',
      () => videoStorage.saveVideo(videoLibrary, recordToSave),
    )
    filename.textContent = file.name
    startInput.value = '0.000'
    endInput.value = '0.000'
    activeVideoObjectUrl = URL.createObjectURL(file)
    video.src = activeVideoObjectUrl
    emptyState.hidden = true
    workspace.hidden = false
    setVideoActionsEnabled(true)
    updateCurrentVideoDetails()
    renderClipHistory()
    updateAttachSourceButton()
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

  addHistoryButton.addEventListener('click', async () => {
    const selectedRange = getCurrentRange()
    if (!selectedRange || !currentVideoRecord) return
    const normalizedStart = Math.round(selectedRange.start * 1000) / 1000
    const normalizedEnd = Math.round(selectedRange.end * 1000) / 1000
    const duplicate = currentVideoRecord.clips.some((record) => record.start === normalizedStart && record.end === normalizedEnd)
    if (duplicate) {
      historyStatus.textContent = 'This range is already in history.'
      return
    }

    const outputFilename = currentServerAsset ? serverClipOutputFilename(normalizedStart, normalizedEnd) : undefined
    const clipRecord = {
      id: createId(),
      start: normalizedStart,
      end: normalizedEnd,
      duration: normalizedEnd - normalizedStart,
      createdAt: new Date().toISOString(),
      outputFilename,
    }
    currentVideoRecord.clips.unshift(clipRecord)
    if (currentServerAsset && outputFilename) {
      const sequence = Number(outputFilename.match(/-clip-(\d+)\.mp4$/)?.[1])
      currentVideoRecord.nextClipNumber = Number.isFinite(sequence)
        ? Math.max(currentVideoRecord.nextClipNumber ?? 1, sequence + 1)
        : (currentVideoRecord.nextClipNumber ?? 1) + 1
    }
    currentVideoRecord.updatedAt = new Date().toISOString()
    const videoToSave = currentVideoRecord
    try {
      applyStoredLibrary(await videoStorage.addClip(videoLibrary, videoToSave, clipRecord))
      historyStatus.textContent = 'Range added.'
    } catch (error) {
      await restoreServerLibrary()
      historyStatus.textContent = error instanceof Error
        ? `Could not save history. ${error.message}`
        : 'Could not save history.'
    }
    renderClipHistory()
    renderVideoLibrary()
    updateCommand()
  })

  historyList.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-history-action]')
    if (!button) return
    const record = currentVideoRecord?.clips.find((item) => item.id === button.dataset.historyId)
    if (!record) return
    const action = button.dataset.historyAction

    if (action === 'copy-full-path') {
      const originalText = button.textContent
      button.disabled = true
      button.textContent = 'Copying…'
      try {
        const fullPath = await requestGeneratedClipFullPath(record.id)
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable in this browser.')
        await navigator.clipboard.writeText(fullPath)
        button.textContent = 'Copied'
        historyStatus.textContent = 'Full path copied.'
        window.setTimeout(() => {
          if (button.isConnected) {
            button.disabled = false
            button.textContent = originalText
          }
        }, 1_200)
      } catch (error) {
        button.disabled = false
        button.textContent = originalText
        historyStatus.textContent = error instanceof Error
          ? `Could not copy full path. ${error.message}`
          : 'Could not copy full path.'
      }
      return
    }

    if (action === 'copy-pose-path') {
      const originalText = button.textContent
      button.disabled = true
      button.textContent = 'Copying…'
      try {
        const fullPath = await requestPoseResultFullPath(record.id)
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable in this browser.')
        await navigator.clipboard.writeText(fullPath)
        button.textContent = 'Copied'
        historyStatus.textContent = 'Pose result path copied.'
        window.setTimeout(() => {
          if (button.isConnected) {
            button.disabled = false
            button.textContent = originalText
          }
        }, 1_200)
      } catch (error) {
        button.disabled = false
        button.textContent = originalText
        historyStatus.textContent = error instanceof Error
          ? `Could not copy pose path. ${error.message}`
          : 'Could not copy pose path.'
      }
      return
    }

    if (action === 'copy-llm-pose-path') {
      const originalText = button.textContent
      button.disabled = true
      button.textContent = 'Copying…'
      try {
        const fullPath = await requestLlmPoseResultFullPath(record.id)
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable in this browser.')
        await navigator.clipboard.writeText(fullPath)
        button.textContent = 'Copied'
        historyStatus.textContent = 'LLM Pose result path copied.'
        window.setTimeout(() => {
          if (button.isConnected) {
            button.disabled = false
            button.textContent = originalText
          }
        }, 1_200)
      } catch (error) {
        button.disabled = false
        button.textContent = originalText
        historyStatus.textContent = error instanceof Error
          ? `Could not copy LLM Pose path. ${error.message}`
          : 'Could not copy LLM Pose path.'
      }
      return
    }

    if (action === 'build-llm-pose') {
      if (!record.generatedClip?.poseResult || compressingPoseClipIds.has(record.id)) return
      compressingPoseClipIds.add(record.id)
      button.disabled = true
      button.textContent = 'Compressing Pose…'
      historyStatus.textContent = 'Building LLM-friendly Pose JSON…'
      try {
        applyStoredLibrary(await videoStorage.buildLlmPoseResult(record.id))
        const updatedRecord = currentVideoRecord?.clips.find((item) => item.id === record.id)
        const llmResult = updatedRecord?.generatedClip?.poseResult?.llmResult
        historyStatus.textContent = llmResult
          ? `LLM Pose ready: ${llmResult.frameCount} frames · ${(llmResult.sizeBytes / 1024).toFixed(1)} KB.`
          : 'LLM Pose compression complete.'
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof Error
          ? `LLM Pose compression failed. ${error.message}`
          : 'LLM Pose compression failed.'
      } finally {
        compressingPoseClipIds.delete(record.id)
        renderClipHistory()
        renderVideoLibrary()
      }
      return
    }

    if (action === 'replay-pose') {
      await startPoseReplay(record)
      return
    }

    if (action === 'analyze-pose') {
      if (!record.generatedClip || analyzingPoseClipIds.has(record.id)) return
      cleanupPoseReplay()
      analyzingPoseClipIds.add(record.id)
      const previousPoseResult = record.generatedClip.poseResult
      const controller = new AbortController()
      activePoseAnalysisController?.abort()
      activePoseAnalysisController = controller
      button.disabled = true
      button.textContent = 'Analyzing Pose…'
      historyStatus.textContent = 'Loading MediaPipe Pose Landmarker…'
      try {
        const poseData = await analyzePoseVideo(serverVideoUrl(record.generatedClip.relativePath), {
          signal: controller.signal,
          onProgress: (progress) => {
            historyStatus.textContent = `Analyzing pose: ${(progress.videoTimestampMs / 1000).toFixed(1)}s / ${(progress.durationMs / 1000).toFixed(1)}s · ${progress.frameCount} frames · ${progress.detectedPoseFrameCount} detected`
          },
        })
        historyStatus.textContent = 'Saving pose landmark JSON…'
        applyStoredLibrary(await videoStorage.savePoseResult(record.id, poseData))
        historyStatus.textContent = `Pose analysis complete: ${poseData.frameCount} frames / ${poseData.detectedPoseFrameCount} detected.`
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof DOMException && error.name === 'AbortError'
          ? 'Pose analysis cancelled.'
          : error instanceof Error
            ? `Pose analysis failed. ${error.message}`
            : 'Pose analysis failed.'
        if (previousPoseResult) historyStatus.textContent += ' The previous pose result was kept.'
      } finally {
        analyzingPoseClipIds.delete(record.id)
        if (activePoseAnalysisController === controller) activePoseAnalysisController = null
        renderClipHistory()
        renderVideoLibrary()
      }
      return
    }

    if (action === 'generate') {
      cleanupPoseReplay()
      button.disabled = true
      button.textContent = record.generatedClip ? 'Regenerating…' : 'Generating…'
      historyStatus.textContent = 'Generating clip with FFmpeg…'
      try {
        applyStoredLibrary(await videoStorage.generateClip(record.id))
        await refreshServerLibrary()
        historyStatus.textContent = 'Clip generated.'
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof Error
          ? `Clip generation failed. ${error.message}`
          : 'Clip generation failed.'
      }
      renderClipHistory()
      renderVideoLibrary()
      updateCommand()
      return
    }

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
      if (replayingClipId === record.id) cleanupPoseReplay()
      currentVideoRecord.clips = currentVideoRecord.clips.filter((item) => item.id !== record.id)
      currentVideoRecord.updatedAt = new Date().toISOString()
      const videoToSave = currentVideoRecord
      try {
        applyStoredLibrary(await videoStorage.deleteClip(videoLibrary, videoToSave, record.id))
        historyStatus.textContent = 'Range deleted.'
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof Error
          ? `Range removed here, but persistent storage could not be updated. ${error.message}`
          : 'Range removed here, but persistent storage could not be updated.'
      }
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
  activePoseAnalysisController?.abort()
  activePoseAnalysisController = null
  activePoseReplayCleanup?.()
  activePoseReplayCleanup = null
  unmountVideoV2()
  if (window.location.hash === '#/video-v2') {
    await renderVideo('video-v2')
    return
  }
  if (window.location.hash === '#/video') {
    await renderVideo()
    return
  }
  cleanupVideoObjectUrl()
  await loadRecords()
  if (window.location.hash === '#/generate') renderGenerate()
  else renderLibrary()
}

window.addEventListener('hashchange', () => void renderRoute())
window.addEventListener('beforeunload', () => {
  activePoseAnalysisController?.abort()
  activePoseReplayCleanup?.()
  cleanupVideoObjectUrl()
})
void renderRoute()

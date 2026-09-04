import './style.css'
import geminiVoices from './data/gemini-voices.json'
import testScripts from './data/test-scripts.json'
import { mountVideoV2, unmountVideoV2 } from './video-v2-panels'
import { buildFfmpegClipCommand, formatFfmpegTime } from './video-clip.mjs'
import {
  createBatchInputRow,
  findExistingSourceVideo,
  processBatchDatasetRows,
  validateBatchInputRows,
  type BatchInputRow,
  type BatchRowStatus,
} from './batch-dataset-input'
import { analyzePoseVideo } from './pose-video-analyzer'
import { createPoseReplay, loadPoseReplayData, type PoseReplaySession } from './pose-replay'
import {
  clipsForVideo,
  createVideoStorage,
  detectSourceSite,
  serverVideoUrl,
  type ClipRecord,
  type LlmPoseRun,
  type PoseRun,
  type VideoLibrary,
  type VideoRecord,
} from './video-library-storage'
import { getClipRuns } from './video-run-history.mjs'

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
  videoId: string
  clipId?: string
  name: string
  relativePath: string
  url: string
  category: 'source' | 'clip'
  previewSupported: boolean
}

type ClipUiRecord = ClipRecord & {
  id: string
  start: number
  end: number
  duration: number
  generatedClip?: {
    filename: string
    relativePath: string
    createdAt: string
    poseRunCount: number
  }
}

type VideoUiRecord = VideoRecord & {
  id: string
  type: 'server'
  file: { name: string; size: number; lastModified: number }
  server: { relativePath: string; url: string }
  source?: { url: string; site: 'youtube' | 'bilibili' | 'other' }
  clips: ClipUiRecord[]
}

type ServerVideoLibrary = {
  source: ServerVideoAsset[]
  clips: ServerVideoAsset[]
}

const recentVideoSourceUrlKey = 'story-voice.video-source-url.v1'
const testVideoDirectory = '/home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio/public/test-videos'

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

  const libraryTabs = document.createElement('div')
  libraryTabs.className = 'video-v2-library-tabs'
  libraryTabs.setAttribute('role', 'tablist')
  libraryTabs.innerHTML = `
    <button id="video-library-tab" type="button" role="tab" aria-selected="true" aria-controls="video-library-tab-panel">Video Library</button>
    <button id="batch-input-tab" type="button" role="tab" aria-selected="false" aria-controls="batch-input-tab-panel">Batch Input</button>
  `
  const libraryTabPanel = document.createElement('section')
  libraryTabPanel.id = 'video-library-tab-panel'
  libraryTabPanel.className = 'video-v2-library-tab-panel'
  libraryTabPanel.setAttribute('role', 'tabpanel')
  libraryTabPanel.setAttribute('aria-labelledby', 'video-library-tab')
  libraryTabPanel.append(libraryHeading, libraryList, libraryActions)
  const batchTabPanel = document.createElement('section')
  batchTabPanel.id = 'batch-input-tab-panel'
  batchTabPanel.className = 'video-v2-library-tab-panel batch-input-panel'
  batchTabPanel.setAttribute('role', 'tabpanel')
  batchTabPanel.setAttribute('aria-labelledby', 'batch-input-tab')
  batchTabPanel.hidden = true
  batchTabPanel.innerHTML = `
    <div class="batch-input-heading">
      <h2>Batch Dataset Input</h2>
      <p>Label confirmed clips, then run the existing Clip → Pose → LLM pipeline.</p>
    </div>
    <div class="batch-table-wrap">
      <table class="batch-input-table">
        <thead><tr><th>Label</th><th>Start</th><th>End</th><th>URL</th><th>Action</th></tr></thead>
        <tbody id="batch-input-rows"></tbody>
      </table>
    </div>
    <div class="batch-input-actions">
      <button id="batch-add-row" type="button">+ Add Row</button>
      <button id="batch-validate" type="button">Validate</button>
      <button id="batch-process" type="button">Import &amp; Process</button>
    </div>
    <p id="batch-summary" class="section-status" role="status" aria-live="polite"></p>
  `

  workspace.replaceChildren(currentTitle, videoStage, poseReplayControls, playheadSection, clipRange, clipHistory)
  leftSlot.append(libraryTabs, libraryTabPanel, batchTabPanel)
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
    const timestamp = new Date().toISOString()
    videoLibrary = {
      schemaVersion: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
      videos: [],
      clips: [],
      poseRuns: [],
      llmPoseRuns: [],
      nextIds: { video: 1, clips: {}, poseRuns: {}, llmPoseRuns: {} },
    }
    videoLibraryLoadError = error instanceof Error ? error.message : 'Video library could not be loaded.'
  }

  const toUiClip = (clip: ClipRecord): ClipUiRecord => {
    const { poseRuns } = getClipRuns(videoLibrary, clip.clipId)
    return {
      ...clip,
      id: clip.clipId,
      start: clip.startMs / 1000,
      end: clip.endMs / 1000,
      duration: clip.durationMs / 1000,
      generatedClip: clip.relativePath ? {
        filename: clip.clipId + '.mp4',
        relativePath: clip.relativePath,
        createdAt: clip.updatedAt,
        poseRunCount: poseRuns.length,
      } : undefined,
    }
  }

  const toUiVideo = (record: VideoRecord): VideoUiRecord => ({
    ...record,
    id: record.videoId,
    type: 'server',
    file: { name: record.filename, size: record.size, lastModified: record.lastModified },
    server: { relativePath: record.relativePath, url: serverVideoUrl(record.relativePath) },
    source: record.sourceUrl ? { url: record.sourceUrl, site: record.sourceSite ?? 'other' } : undefined,
    clips: clipsForVideo(videoLibrary, record.videoId).map(toUiClip),
  })
  layout(`
    <section class="tool-page video-page" aria-labelledby="page-title">
      <div class="page-heading">
        <h1 id="page-title">Video Tools</h1>
        <p>Add source videos and manage generated clip metadata.</p>
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

            <details class="current-section command-debug" aria-labelledby="ffmpeg-command-title">
              <summary id="ffmpeg-command-title">FFmpeg Command</summary>
              <div class="command-debug-content">
                <label class="command-field">
                  <span class="sr-only">FFmpeg Command</span>
                  <textarea id="ffmpeg-command" rows="4" readonly spellcheck="false" aria-describedby="command-note"></textarea>
                </label>
                <p id="command-note" class="command-note">The browser only exposes the filename. Run this command from the video's folder, or replace the input path.</p>
                <p id="clip-output-name" class="clip-output-name"></p>
                <p id="copy-status" class="section-status" role="status" aria-live="polite"></p>
              </div>
            </details>

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
            <h2 id="download-command-title">Add Video</h2>
            <label><span>Source URL</span><input id="source-url" type="url" inputmode="url" placeholder="https://www.bilibili.com/video/…" autocomplete="off" /></label>
            <button id="download-video" type="button">Download Video</button>
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
  const downloadVideoButton = document.querySelector<HTMLButtonElement>('#download-video')!
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
  const batchRowsBody = document.querySelector<HTMLTableSectionElement>('#batch-input-rows')
  const batchSummary = document.querySelector<HTMLParagraphElement>('#batch-summary')
  const batchAddRowButton = document.querySelector<HTMLButtonElement>('#batch-add-row')
  const batchValidateButton = document.querySelector<HTMLButtonElement>('#batch-validate')
  const batchProcessButton = document.querySelector<HTMLButtonElement>('#batch-process')
  let selectedFilename = ''
  let currentVideoRecord: VideoUiRecord | null = null
  let currentServerAsset: ServerVideoAsset | null = null
  let viewedVideoId = ''
  let serverLibrary: ServerVideoLibrary = { source: [], clips: [] }
  let sourceDownloadInProgress = false
  const analyzingPoseClipIds = new Set<string>()
  const compressingPoseRunIds = new Set<string>()
  let poseReplaySession: PoseReplaySession | null = null
  let poseReplayController: AbortController | null = null
  let replayingClipId = ''
  let nextBatchRowId = 1
  let batchProcessing = false
  const batchRows: BatchInputRow[] = layoutMode === 'video-v2'
    ? [createBatchInputRow(`batch-${String(nextBatchRowId++).padStart(3, '0')}`)]
    : []

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

  const renderBatchRows = () => {
    if (!batchRowsBody) return
    batchRowsBody.innerHTML = batchRows.map((row) => `
      <tr class="${row.error ? 'is-invalid' : ''}" data-batch-row-id="${escapeHtml(row.id)}">
        <td><input aria-label="Label" data-batch-field="label" value="${escapeHtml(row.label)}"${batchProcessing ? ' disabled' : ''}></td>
        <td><input aria-label="Start seconds" data-batch-field="start" inputmode="decimal" value="${escapeHtml(row.start)}"${batchProcessing ? ' disabled' : ''}></td>
        <td><input aria-label="End seconds" data-batch-field="end" inputmode="decimal" value="${escapeHtml(row.end)}"${batchProcessing ? ' disabled' : ''}></td>
        <td><input aria-label="Source URL" data-batch-field="url" value="${escapeHtml(row.url)}" title="${escapeHtml(row.url)}"${batchProcessing ? ' disabled' : ''}></td>
        <td><div class="batch-row-action"><span class="batch-row-status status-${row.status.toLowerCase()}">${escapeHtml(row.status)}</span><button type="button" data-batch-delete="${escapeHtml(row.id)}"${batchProcessing ? ' disabled' : ''}>Delete</button></div></td>
      </tr>
      ${row.error ? `<tr class="batch-row-error"><td colspan="5">${escapeHtml(row.error)}</td></tr>` : ''}
    `).join('')
    if (batchAddRowButton) batchAddRowButton.disabled = batchProcessing
    if (batchValidateButton) batchValidateButton.disabled = batchProcessing
    if (batchProcessButton) batchProcessButton.disabled = batchProcessing || !batchRows.length
  }

  const validateBatchRows = () => {
    const result = validateBatchInputRows(batchRows)
    batchRows.forEach((row) => {
      row.error = result.errorsByRowId.get(row.id) ?? ''
      if (row.status === 'Error') row.status = 'Pending'
    })
    if (batchSummary) {
      batchSummary.textContent = `${result.total} clip${result.total === 1 ? '' : 's'} · ${result.uniqueSourceCount} unique source video${result.uniqueSourceCount === 1 ? '' : 's'} · ${result.validCount} valid · ${result.invalidCount} invalid`
    }
    renderBatchRows()
    return result
  }

  if (layoutMode === 'video-v2' && batchRowsBody) {
    const libraryTab = document.querySelector<HTMLButtonElement>('#video-library-tab')!
    const batchTab = document.querySelector<HTMLButtonElement>('#batch-input-tab')!
    const libraryPanel = document.querySelector<HTMLElement>('#video-library-tab-panel')!
    const batchPanel = document.querySelector<HTMLElement>('#batch-input-tab-panel')!
    const activateTab = (showBatch: boolean) => {
      libraryTab.setAttribute('aria-selected', String(!showBatch))
      batchTab.setAttribute('aria-selected', String(showBatch))
      libraryPanel.hidden = showBatch
      batchPanel.hidden = !showBatch
    }
    libraryTab.addEventListener('click', () => activateTab(false))
    batchTab.addEventListener('click', () => activateTab(true))
    batchAddRowButton?.addEventListener('click', () => {
      batchRows.push(createBatchInputRow(`batch-${String(nextBatchRowId++).padStart(3, '0')}`, batchRows.at(-1)))
      renderBatchRows()
      batchRowsBody.querySelector<HTMLInputElement>('tr:last-of-type input[data-batch-field="start"]')?.focus()
    })
    batchRowsBody.addEventListener('input', (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-batch-field]')
      const tableRow = input?.closest<HTMLTableRowElement>('[data-batch-row-id]')
      const row = batchRows.find((item) => item.id === tableRow?.dataset.batchRowId)
      const field = input?.dataset.batchField as 'label' | 'start' | 'end' | 'url' | undefined
      if (!input || !row || !field || batchProcessing) return
      row[field] = input.value
      row.error = ''
      row.status = 'Pending'
      if (batchSummary) batchSummary.textContent = ''
      tableRow?.classList.remove('is-invalid')
      tableRow?.nextElementSibling?.classList.contains('batch-row-error') && tableRow.nextElementSibling.remove()
    })
    batchRowsBody.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-batch-delete]')
      if (!button || batchProcessing) return
      const index = batchRows.findIndex((row) => row.id === button.dataset.batchDelete)
      if (index >= 0) batchRows.splice(index, 1)
      renderBatchRows()
      if (batchSummary) batchSummary.textContent = ''
    })
    batchValidateButton?.addEventListener('click', validateBatchRows)
    renderBatchRows()
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

  const startPoseReplay = async (record: ClipUiRecord, poseRun: PoseRun) => {
    if (layoutMode !== 'video-v2' || !record.generatedClip) return
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
        serverVideoUrl(poseRun.relativePath),
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
    const recordDetails = (record: VideoUiRecord | undefined) => {
      if (!record || record.id !== viewedVideoId) return ''
      return `
        <div class="video-library-detail">
          <dl>
            <div><dt>ID</dt><dd>${escapeHtml(record.videoId)}</dd></div>
            <div><dt>Path</dt><dd>${escapeHtml(record.relativePath)}</dd></div>
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
    const recordSummary = (record: VideoUiRecord | undefined) => {
      const source = record?.source
      return `
        <p>Source: ${source ? escapeHtml(source.site) : '—'}</p>
        ${source ? `<p class="source-url" title="${escapeHtml(source.url)}">${escapeHtml(source.url)}</p>` : ''}
        <p>Clips: ${record?.clips.length ?? 0}${record ? ` · Updated: ${escapeHtml(formatCreatedAt(record.updatedAt))}` : ''}</p>
      `
    }
    const renderServerAsset = (asset: ServerVideoAsset) => {
      const storedRecord = videoLibrary.videos.find((item) => item.videoId === asset.videoId)
      const record = storedRecord ? toUiVideo(storedRecord) : undefined
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
    videoLibraryList.innerHTML = `
      <section class="video-library-group">
        <h3>Source Videos</h3>
        ${serverLibrary.source.length ? serverLibrary.source.map(renderServerAsset).join('') : '<p class="library-empty">No source videos in the library.</p>'}
      </section>
    `
  }

  const renderClipHistory = () => {
    const clipHistory = currentVideoRecord?.clips ?? []
    if (!clipHistory.length) {
      historyList.innerHTML = '<p class="history-empty">No saved ranges for this video.</p>'
      return
    }

    const compactRunId = (runId: string) => runId.split('_').at(-1) ?? runId
    const compactModelName = (modelName: string) => modelName
      .replace(/^Pose Landmarker\s*/i, '')
      .replace(/\s*\([^)]*\)$/, '') || modelName

    historyList.innerHTML = `
      <div class="history-table-wrap history-clip-table-wrap">
        <table class="history-table history-clip-table">
          <thead>
            <tr><th>Clip</th><th>Range</th><th>Duration</th><th>Label</th><th>Pose</th><th>LLM</th><th>Generated Clip</th></tr>
          </thead>
          <tbody>
    ${clipHistory.map((record, index) => {
      const runView = getClipRuns(videoLibrary, record.clipId)
      const clipLlmRunCount = runView.llmPoseRuns.length
      return `
        <tr data-clip-id="${escapeHtml(record.clipId)}">
          <td><strong>#${index + 1}</strong><code title="${escapeHtml(record.clipId)}">${escapeHtml(record.clipId)}</code></td>
          <td class="history-nowrap">${formatVideoTime(record.start)} → ${formatVideoTime(record.end)}</td>
          <td class="history-nowrap">${formatVideoTime(record.duration)}</td>
          <td>
            <div class="history-table-label">
              <input aria-label="Label for ${escapeHtml(record.clipId)}" data-clip-label-input value="${escapeHtml(record.label ?? '')}" placeholder="left_single_leg_hop" />
              <button type="button" data-history-action="save-label" data-history-id="${escapeHtml(record.id)}">Save</button>
            </div>
          </td>
          <td>${runView.poseRuns.length}</td>
          <td>${clipLlmRunCount}</td>
          <td class="history-file-cell">${record.generatedClip
            ? `<a href="${escapeHtml(serverVideoUrl(record.generatedClip.relativePath))}" target="_blank" rel="noopener" title="${escapeHtml(record.generatedClip.filename)}">${escapeHtml(record.generatedClip.filename)}</a>`
            : '<span class="history-muted">Not generated</span>'}</td>
        </tr>
        <tr class="history-detail-row"><td colspan="7">
          <article class="history-item" data-clip-id="${escapeHtml(record.clipId)}">

          <section class="history-run-section" aria-label="Pose Runs">
            <div class="history-table-heading">
              <h4>Pose Runs <span>(${runView.poseRuns.length})</span></h4>
              ${layoutMode === 'video-v2' && record.generatedClip ? `<button type="button" data-history-action="analyze-pose" data-history-id="${escapeHtml(record.id)}"${analyzingPoseClipIds.has(record.id) ? ' disabled' : ''}>${analyzingPoseClipIds.has(record.id) ? 'Analyzing…' : runView.poseRuns.length ? 'Analyze Again' : 'Analyze Pose'}</button>` : ''}
            </div>
            ${runView.poseRuns.length ? `
              <div class="history-table-wrap">
                <table class="history-table history-run-table history-pose-run-table">
                  <thead><tr><th>Pose Run</th><th>Model</th><th>FPS</th><th>Frames</th><th>Time</th><th>Actions</th></tr></thead>
                  <tbody>${runView.poseRuns.map((poseRun: PoseRun) => `
                    <tr>
                      <td><code title="${escapeHtml(poseRun.poseRunId)}">${escapeHtml(compactRunId(poseRun.poseRunId))}</code></td>
                      <td title="${escapeHtml(poseRun.model.name)}">${escapeHtml(compactModelName(poseRun.model.name))}</td>
                      <td>${poseRun.samplingFps}</td>
                      <td>${poseRun.frameCount}/${poseRun.detectedPoseFrameCount}</td>
                      <td>${(poseRun.processingDurationMs / 1000).toFixed(1)}s</td>
                      <td><div class="history-row-actions">
                        <a href="${escapeHtml(serverVideoUrl(poseRun.relativePath))}" target="_blank" rel="noopener">Open</a>
                        <button type="button" data-history-action="copy-pose-path" data-history-id="${escapeHtml(record.id)}" data-pose-run-id="${escapeHtml(poseRun.poseRunId)}">Copy</button>
                        ${layoutMode === 'video-v2' ? `<button type="button" data-history-action="replay-pose" data-history-id="${escapeHtml(record.id)}" data-pose-run-id="${escapeHtml(poseRun.poseRunId)}">Replay</button><button type="button" data-history-action="build-llm-pose" data-history-id="${escapeHtml(record.id)}" data-pose-run-id="${escapeHtml(poseRun.poseRunId)}"${compressingPoseRunIds.has(poseRun.poseRunId) ? ' disabled' : ''}>${compressingPoseRunIds.has(poseRun.poseRunId) ? 'Building…' : 'Build LLM'}</button><button type="button" class="danger-action" data-history-action="delete-pose" data-history-id="${escapeHtml(record.id)}" data-pose-run-id="${escapeHtml(poseRun.poseRunId)}">Delete</button>` : ''}
                      </div></td>
                    </tr>
                  `).join('')}</tbody>
                </table>
              </div>
            ` : '<p class="history-run-empty">No Pose Runs yet.</p>'}
          </section>

          ${layoutMode === 'video-v2' && runView.llmPoseRuns.length ? `
            <section class="history-run-section history-llm-section" aria-label="LLM Pose Runs">
              <div class="history-table-heading">
                <h4>LLM Pose Runs <span>(${runView.llmPoseRuns.length})</span></h4>
              </div>
              <div class="history-table-wrap">
                <table class="history-table history-run-table history-llm-run-table">
                  <thead><tr><th>LLM Run</th><th>Pose Run</th><th>Schema</th><th>FPS</th><th>Frames</th><th>Size</th><th>Actions</th></tr></thead>
                  <tbody>${runView.llmPoseRuns.map((llmRun: LlmPoseRun) => `
                    <tr>
                      <td><code title="${escapeHtml(llmRun.llmPoseRunId)}">${escapeHtml(compactRunId(llmRun.llmPoseRunId))}</code></td>
                      <td><code title="${escapeHtml(llmRun.poseRunId)}">${escapeHtml(compactRunId(llmRun.poseRunId))}</code></td>
                      <td>v${llmRun.schemaVersion}</td><td>${llmRun.targetFps}</td><td>${llmRun.frameCount}</td><td>${(llmRun.sizeBytes / 1024).toFixed(1)} KB</td>
                      <td><div class="history-row-actions">
                        <a href="${escapeHtml(serverVideoUrl(llmRun.relativePath))}" target="_blank" rel="noopener">Open</a>
                        <button type="button" data-history-action="copy-llm-pose-path" data-history-id="${escapeHtml(record.id)}" data-pose-run-id="${escapeHtml(llmRun.poseRunId)}" data-llm-pose-run-id="${escapeHtml(llmRun.llmPoseRunId)}">Copy</button>
                        <button type="button" class="danger-action" data-history-action="delete-llm-pose" data-history-id="${escapeHtml(record.id)}" data-pose-run-id="${escapeHtml(llmRun.poseRunId)}" data-llm-pose-run-id="${escapeHtml(llmRun.llmPoseRunId)}">Delete</button>
                      </div></td>
                    </tr>
                  `).join('')}</tbody>
                </table>
              </div>
            </section>
          ` : ''}

          <section class="history-clip-actions" aria-label="Clip Actions">
            <div class="history-actions">
              <button type="button" data-history-action="go-start" data-history-id="${escapeHtml(record.id)}">Go Start</button>
              <button type="button" data-history-action="go-end" data-history-id="${escapeHtml(record.id)}">Go End</button>
              <button type="button" data-history-action="use-range" data-history-id="${escapeHtml(record.id)}">Use Range</button>
              ${layoutMode === 'video-v2' && record.generatedClip ? `
                <button type="button" data-history-action="copy-full-path" data-history-id="${escapeHtml(record.id)}">Copy Full Path</button>
              ` : ''}
              ${layoutMode === 'video-v2' && currentServerAsset?.category === 'source' ? `
                <button type="button" data-history-action="generate" data-history-id="${escapeHtml(record.id)}">${record.generatedClip ? 'Regenerate Clip' : 'Generate Clip'}</button>
              ` : ''}
              <button type="button" class="danger-action" data-history-action="delete" data-history-id="${escapeHtml(record.id)}">Delete Clip</button>
            </div>
          </section>
          </article>
        </td></tr>
      `
    }).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  const rebuildCurrentVideoRecord = () => {
    const currentVideoId = currentVideoRecord?.videoId
    if (currentVideoId) {
      const storedRecord = videoLibrary.videos.find((record) => record.videoId === currentVideoId)
      currentVideoRecord = storedRecord ? toUiVideo(storedRecord) : null
    }
  }

  const applyStoredLibrary = (storedLibrary: VideoLibrary) => {
    videoLibrary = storedLibrary
    rebuildCurrentVideoRecord()
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
    if (record.sourceUrl === sourceUrl && record.sourceSite === site) return false
    record.sourceUrl = sourceUrl
    record.sourceSite = site
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

  const requestGeneratedClipFullPath = async (videoId: string, clipId: string) => {
    const response = await fetch(`/api/video-v2/videos/${encodeURIComponent(videoId)}/clips/${encodeURIComponent(clipId)}/path`, { cache: 'no-store' })
    const payload = await response.json() as { fullPath?: unknown; error?: { message?: string } }
    if (!response.ok || typeof payload.fullPath !== 'string' || !payload.fullPath) {
      throw new Error(payload.error?.message ?? 'The server could not resolve this generated clip path.')
    }
    return payload.fullPath
  }

  const requestPoseResultFullPath = async (videoId: string, clipId: string, poseRunId: string) => {
    const response = await fetch(`/api/video-v2/videos/${encodeURIComponent(videoId)}/clips/${encodeURIComponent(clipId)}/pose-runs/${encodeURIComponent(poseRunId)}/path`, { cache: 'no-store' })
    const payload = await response.json() as { fullPath?: unknown; error?: { message?: string } }
    if (!response.ok || typeof payload.fullPath !== 'string' || !payload.fullPath) {
      throw new Error(payload.error?.message ?? 'The server could not resolve this pose result path.')
    }
    return payload.fullPath
  }

  const requestLlmPoseResultFullPath = async (
    videoId: string,
    clipId: string,
    poseRunId: string,
    llmPoseRunId: string,
  ) => {
    const response = await fetch(`/api/video-v2/videos/${encodeURIComponent(videoId)}/clips/${encodeURIComponent(clipId)}/pose-runs/${encodeURIComponent(poseRunId)}/llm-runs/${encodeURIComponent(llmPoseRunId)}/path`, { cache: 'no-store' })
    const payload = await response.json() as { fullPath?: unknown; error?: { message?: string } }
    if (!response.ok || typeof payload.fullPath !== 'string' || !payload.fullPath) {
      throw new Error(payload.error?.message ?? 'The server could not resolve this LLM Pose result path.')
    }
    return payload.fullPath
  }

  const requestSourceDownload = async (sourceUrl: string) => {
    const response = await fetch('/api/video-v2/source/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl }),
    })
    const payload = await response.json() as {
      downloaded?: { sourceUrl?: string; filename?: string; relativePath?: string; alreadyExists?: boolean }
      library?: VideoLibrary
      error?: { message?: string }
    }
    if (!response.ok || !payload.downloaded?.relativePath || !payload.downloaded.filename || !payload.downloaded.sourceUrl) {
      throw new Error(payload.error?.message ?? 'The server returned an invalid download response.')
    }
    return {
      downloaded: {
        sourceUrl: payload.downloaded.sourceUrl,
        filename: payload.downloaded.filename,
        relativePath: payload.downloaded.relativePath,
        alreadyExists: payload.downloaded.alreadyExists === true,
      },
      library: payload.library ?? await videoStorage.loadLibrary(),
    }
  }

  const createClipRecord = async (
    videoId: string,
    input: Pick<ClipRecord, 'startMs' | 'endMs' | 'label'>,
  ) => {
    const beforeIds = new Set(videoLibrary.clips.map((clip) => clip.clipId))
    const library = await videoStorage.addClip(videoId, input)
    const clip = library.clips.find((item) => item.videoId === videoId && !beforeIds.has(item.clipId))
    if (!clip) throw new Error('The Clip was created, but its new identity was not returned.')
    applyStoredLibrary(library)
    return clip
  }

  const analyzeAndSavePose = async (
    videoId: string,
    clipId: string,
    clipRelativePath: string,
    onProgress?: (frameCount: number, videoTimestampMs: number, durationMs: number) => void,
    signal?: AbortSignal,
  ) => {
    const beforeIds = new Set(videoLibrary.poseRuns.map((run) => run.poseRunId))
    const poseData = await analyzePoseVideo(serverVideoUrl(clipRelativePath), {
      signal,
      onProgress: (progress) => onProgress?.(progress.frameCount, progress.videoTimestampMs, progress.durationMs),
    })
    const library = await videoStorage.savePoseResult(videoId, clipId, poseData)
    const poseRun = library.poseRuns.find((run) => run.clipId === clipId && !beforeIds.has(run.poseRunId))
    if (!poseRun) throw new Error('Pose analysis completed, but its new Pose Run was not returned.')
    applyStoredLibrary(library)
    return { poseData, poseRun }
  }

  const updateAttachSourceButton = () => {
    attachSourceButton.disabled = !currentVideoRecord || !sourceUrlInput.value.trim()
  }

  const openServerAsset = async (asset: ServerVideoAsset, downloadedSourceUrl?: string) => {
    cleanupPoseReplay()
    cleanupVideoObjectUrl()
    const storedRecord = videoLibrary.videos.find((record) => record.videoId === asset.videoId)
    if (!storedRecord) throw new Error('The selected source video is missing from Video Library metadata.')
    currentVideoRecord = toUiVideo(storedRecord)
    if (downloadedSourceUrl) {
      const patch = { sourceUrl: downloadedSourceUrl, sourceSite: detectSourceSite(downloadedSourceUrl) }
      applyStoredLibrary(await videoStorage.updateVideo(currentVideoRecord.videoId, patch))
    }
    currentServerAsset = asset
    selectedFilename = asset.name
    fileInput.value = ''
    filename.textContent = asset.name
    startInput.value = '0.000'
    endInput.value = '0.000'
    command.value = ''
    commandNote.textContent = `Server input uses ${testVideoDirectory}. Clip output is stored under ${asset.videoId}/clips/.`
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
    libraryStatus.textContent = 'Server video opened.'
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
      applyStoredLibrary(await videoStorage.loadLibrary())
      if (currentServerAsset) {
        currentServerAsset = serverLibrary.source
          .find((asset) => asset.relativePath === currentServerAsset?.relativePath) ?? null
      }
      libraryStatus.textContent = videoLibraryLoadError ||
        `Found ${serverLibrary.source.length} source video${serverLibrary.source.length === 1 ? '' : 's'}.`
      renderVideoLibrary()
      return true
    } catch (error) {
      libraryStatus.textContent = error instanceof Error ? error.message : 'Could not refresh the server video library.'
      return false
    } finally {
      refreshVideoLibraryButton.disabled = false
      refreshVideoLibraryButton.textContent = 'Refresh Library'
    }
  }

  batchProcessButton?.addEventListener('click', async () => {
    if (batchProcessing) return
    const validation = validateBatchRows()
    if (!validation.validRows.length || validation.invalidCount > 0) {
      if (batchSummary) batchSummary.textContent += ' · Fix invalid rows before processing.'
      return
    }

    batchRows.forEach((row) => {
      row.status = 'Pending'
      row.error = ''
    })
    batchProcessing = true
    renderBatchRows()
    const total = validation.validRows.length
    let settled = 0
    if (batchSummary) batchSummary.textContent = `Processing 0 / ${total}`

    try {
      const result = await processBatchDatasetRows<VideoRecord, ClipRecord, PoseRun>(validation.validRows, {
        resolveSource: async (sourceUrl) => {
          const existing = findExistingSourceVideo(videoLibrary.videos, sourceUrl)
          if (existing) return existing
          const downloaded = await requestSourceDownload(sourceUrl)
          applyStoredLibrary(downloaded.library)
          const source = videoLibrary.videos.find((videoRecord) =>
            videoRecord.sourceUrl === downloaded.downloaded.sourceUrl ||
            videoRecord.relativePath === downloaded.downloaded.relativePath)
          if (!source) throw new Error('The downloaded Source Video was not found in Video Library metadata.')
          return source
        },
        createClip: (source, row) => createClipRecord(source.videoId, {
          startMs: Math.round(row.startSeconds * 1000),
          endMs: Math.round(row.endSeconds * 1000),
          label: row.label,
        }),
        generateClip: async (source, clip) => {
          const library = await videoStorage.generateClip(source.videoId, clip.clipId)
          applyStoredLibrary(library)
          const generatedClip = videoLibrary.clips.find((item) => item.clipId === clip.clipId && item.videoId === source.videoId)
          if (!generatedClip?.relativePath) throw new Error('FFmpeg completed without a generated Clip artifact.')
          return generatedClip
        },
        analyzePose: async (source, clip) => {
          if (!clip.relativePath) throw new Error('Generated Clip path is missing.')
          return (await analyzeAndSavePose(source.videoId, clip.clipId, clip.relativePath)).poseRun
        },
        buildLlmPose: async (source, clip, poseRun) => {
          applyStoredLibrary(await videoStorage.buildLlmPoseResult(source.videoId, clip.clipId, poseRun.poseRunId))
        },
      }, (rowId, status: BatchRowStatus, error = '') => {
        const row = batchRows.find((item) => item.id === rowId)
        if (!row) return
        const wasSettled = row.status === 'Done' || row.status === 'Error'
        row.status = status
        row.error = error
        if (!wasSettled && (status === 'Done' || status === 'Error')) settled += 1
        if (batchSummary) batchSummary.textContent = `Processing ${settled} / ${total}`
        renderBatchRows()
      })
      if (batchSummary) batchSummary.textContent = `Complete · ${result.completed} done · ${result.failed} error${result.failed === 1 ? '' : 's'}`
    } catch (error) {
      if (batchSummary) batchSummary.textContent = error instanceof Error
        ? `Batch processing stopped unexpectedly. ${error.message}`
        : 'Batch processing stopped unexpectedly.'
    } finally {
      batchProcessing = false
      renderBatchRows()
      await refreshServerLibrary()
    }
  })

  downloadVideoButton.addEventListener('click', async () => {
    if (sourceDownloadInProgress) return
    const sourceUrl = sourceUrlInput.value.trim()
    downloadCommandStatus.textContent = ''
    if (!sourceUrl) {
      downloadCommandStatus.textContent = 'Enter a source URL first.'
      return
    }
    try {
      const parsed = new URL(sourceUrl)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error()
    } catch {
      downloadCommandStatus.textContent = 'Enter a valid HTTP or HTTPS source URL.'
      return
    }

    sourceDownloadInProgress = true
    downloadVideoButton.disabled = true
    downloadVideoButton.textContent = 'Downloading…'
    downloadCommandStatus.textContent = 'Downloading source video with yt-dlp…'
    try {
      const payload = await requestSourceDownload(sourceUrl)
      applyStoredLibrary(payload.library)
      if (!await refreshServerLibrary()) throw new Error('The video downloaded, but the Video Library could not be refreshed.')
      const asset = serverLibrary.source.find((item) => item.relativePath === payload.downloaded.relativePath)
      if (!asset) throw new Error('The video downloaded, but it was not found in the refreshed Video Library.')
      await openServerAsset(asset, payload.downloaded.sourceUrl)
      downloadCommandStatus.textContent = `Downloaded: ${payload.downloaded.filename}`
    } catch (error) {
      downloadCommandStatus.textContent = error instanceof Error ? error.message : 'The source video download failed.'
    } finally {
      sourceDownloadInProgress = false
      downloadVideoButton.disabled = false
      downloadVideoButton.textContent = 'Download Video'
    }
  })
  sourceUrlInput.addEventListener('input', () => {
    if (!sourceDownloadInProgress) downloadCommandStatus.textContent = ''
    updateAttachSourceButton()
  })

  attachSourceButton.addEventListener('click', async () => {
    if (!currentVideoRecord || !sourceUrlInput.value.trim()) return
    if (associateSourceWithRecord(currentVideoRecord)) {
      await persistLibrary(
        'Source URL attached to the current video.',
        'The source URL could not be saved.',
        () => videoStorage.updateVideo(currentVideoRecord!.videoId, {
          sourceUrl: currentVideoRecord!.sourceUrl,
          sourceSite: currentVideoRecord!.sourceSite,
        }),
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
      const asset = serverLibrary.source
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
    const blobUrl = URL.createObjectURL(new Blob([`${JSON.stringify(videoLibrary, null, 2)}\n`], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `story-voice-video-library-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
    libraryStatus.textContent = `Exported schema v3 with ${videoLibrary.videos.length} source video record${videoLibrary.videos.length === 1 ? '' : 's'}.`
  })

  importLibraryInput.addEventListener('change', async () => {
    const file = importLibraryInput.files?.[0]
    if (!file) return
    try {
      const value = JSON.parse(await file.text()) as VideoLibrary
      if (value?.schemaVersion !== 3 || !Array.isArray(value.videos) || !Array.isArray(value.clips) ||
        !Array.isArray(value.poseRuns) || !Array.isArray(value.llmPoseRuns)) {
        throw new Error('The JSON must use Video Library schemaVersion 3.')
      }
      await persistLibrary(
        `Imported ${value.videos.length} source video record${value.videos.length === 1 ? '' : 's'}.`,
        'The imported Video Library could not be saved.',
        () => videoStorage.saveLibrary(value),
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
    if (matchingClip) return `${matchingClip.clipId}.mp4`
    return `${currentVideoRecord?.videoId ?? 'video'}_clip-next.mp4`
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
    const outputPath = currentServerAsset
      ? `${testVideoDirectory}/${currentVideoRecord?.videoId ?? 'video'}/clips/${outputFilename}`
      : outputFilename
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
    const now = new Date().toISOString()
    currentVideoRecord = {
      videoId: 'local-session',
      id: 'local-session',
      filename: file.name,
      relativePath: file.name,
      type: 'server',
      file: { name: file.name, size: file.size, lastModified: file.lastModified },
      server: { relativePath: file.name, url: '' },
      size: file.size,
      lastModified: file.lastModified,
      clips: [],
      createdAt: now,
      updatedAt: now,
    }
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

    if (layoutMode === 'video-v2') {
      try {
        await createClipRecord(currentVideoRecord.videoId, {
          startMs: normalizedStart * 1000,
          endMs: normalizedEnd * 1000,
          label: null,
        })
        historyStatus.textContent = 'Range added.'
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof Error
          ? `Could not save history. ${error.message}`
          : 'Could not save history.'
      }
    } else {
      const createdAt = new Date().toISOString()
      currentVideoRecord.clips.unshift({
        clipId: `local-clip-${Date.now()}`,
        videoId: currentVideoRecord.videoId,
        id: `local-clip-${Date.now()}`,
        startMs: normalizedStart * 1000,
        endMs: normalizedEnd * 1000,
        durationMs: (normalizedEnd - normalizedStart) * 1000,
        start: normalizedStart,
        end: normalizedEnd,
        duration: normalizedEnd - normalizedStart,
        label: null,
        createdAt,
        updatedAt: createdAt,
      })
      historyStatus.textContent = 'Range added for this local session.'
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
    const clipRuns = () => getClipRuns(videoLibrary, record.clipId)

    if (action === 'save-label') {
      const input = button.closest<HTMLElement>('.history-item')?.querySelector<HTMLInputElement>('[data-clip-label-input]')
      if (!input) return
      const label = input.value.trim() || null
      button.disabled = true
      button.textContent = 'Saving…'
      try {
        if (layoutMode === 'video-v2') {
          applyStoredLibrary(await videoStorage.updateClipLabel(record.videoId, record.clipId, label))
        } else {
          record.label = label
        }
        historyStatus.textContent = label ? `Clip label saved: ${label}.` : 'Clip label cleared.'
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof Error ? `Could not save Clip label. ${error.message}` : 'Could not save Clip label.'
      }
      renderClipHistory()
      renderVideoLibrary()
      return
    }

    if (action === 'copy-full-path') {
      const originalText = button.textContent
      button.disabled = true
      button.textContent = 'Copying…'
      try {
        const fullPath = await requestGeneratedClipFullPath(record.videoId, record.clipId)
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
        const poseRunId = button.dataset.poseRunId
        const poseResult = poseRunId
          ? videoLibrary.poseRuns.find((run) => run.poseRunId === poseRunId && run.clipId === record.clipId)
          : undefined
        if (!poseResult) throw new Error('This clip has no Pose Run.')
        const fullPath = await requestPoseResultFullPath(record.videoId, record.clipId, poseResult.poseRunId)
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
        const poseResult = button.dataset.poseRunId
          ? videoLibrary.poseRuns.find((run) => run.poseRunId === button.dataset.poseRunId && run.clipId === record.clipId)
          : undefined
        const llmResult = button.dataset.llmPoseRunId
          ? videoLibrary.llmPoseRuns.find((run) => run.llmPoseRunId === button.dataset.llmPoseRunId && run.poseRunId === poseResult?.poseRunId)
          : undefined
        if (!poseResult || !llmResult) throw new Error('This Pose Run has no LLM Pose Run.')
        const fullPath = await requestLlmPoseResultFullPath(
          record.videoId,
          record.clipId,
          poseResult.poseRunId,
          llmResult.llmPoseRunId,
        )
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
      const poseRun = button.dataset.poseRunId
        ? videoLibrary.poseRuns.find((run) => run.poseRunId === button.dataset.poseRunId && run.clipId === record.clipId)
        : undefined
      if (!poseRun || compressingPoseRunIds.has(poseRun.poseRunId)) return
      compressingPoseRunIds.add(poseRun.poseRunId)
      button.disabled = true
      button.textContent = 'Building…'
      historyStatus.textContent = 'Building LLM-friendly Pose JSON…'
      try {
        const storedLibrary = await videoStorage.buildLlmPoseResult(record.videoId, record.clipId, poseRun.poseRunId)
        applyStoredLibrary(storedLibrary)
        historyStatus.textContent = `LLM Pose built for ${poseRun.poseRunId}.`
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof Error
          ? `LLM Pose compression failed. ${error.message}`
          : 'LLM Pose compression failed.'
      } finally {
        compressingPoseRunIds.delete(poseRun.poseRunId)
        renderClipHistory()
        renderVideoLibrary()
      }
      return
    }

    if (action === 'replay-pose') {
      const poseRun = button.dataset.poseRunId
        ? videoLibrary.poseRuns.find((run) => run.poseRunId === button.dataset.poseRunId && run.clipId === record.clipId)
        : undefined
      if (!poseRun) return
      rebuildCurrentVideoRecord()
      const updatedRecord = currentVideoRecord?.clips.find((item) => item.id === record.id)
      if (!updatedRecord) return
      await startPoseReplay(updatedRecord, poseRun)
      return
    }

    if (action === 'analyze-pose') {
      if (!record.generatedClip || analyzingPoseClipIds.has(record.id)) return
      cleanupPoseReplay()
      analyzingPoseClipIds.add(record.id)
      const hadExistingPoseRuns = clipRuns().poseRuns.length > 0
      const controller = new AbortController()
      activePoseAnalysisController?.abort()
      activePoseAnalysisController = controller
      button.disabled = true
      button.textContent = 'Analyzing Pose…'
      historyStatus.textContent = 'Loading MediaPipe Pose Landmarker…'
      try {
        const { poseData } = await analyzeAndSavePose(
          record.videoId,
          record.clipId,
          record.generatedClip.relativePath,
          (frameCount, videoTimestampMs, durationMs) => {
            historyStatus.textContent = `Analyzing pose: ${(videoTimestampMs / 1000).toFixed(1)}s / ${(durationMs / 1000).toFixed(1)}s · ${frameCount} frames`
          },
          controller.signal,
        )
        historyStatus.textContent = `Pose analysis complete: ${poseData.frameCount} frames / ${poseData.detectedPoseFrameCount} detected.`
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof DOMException && error.name === 'AbortError'
          ? 'Pose analysis cancelled.'
          : error instanceof Error
            ? `Pose analysis failed. ${error.message}`
            : 'Pose analysis failed.'
        if (hadExistingPoseRuns) historyStatus.textContent += ' Existing Pose Runs were kept.'
      } finally {
        analyzingPoseClipIds.delete(record.id)
        if (activePoseAnalysisController === controller) activePoseAnalysisController = null
        renderClipHistory()
        renderVideoLibrary()
      }
      return
    }

    if (action === 'delete-llm-pose') {
      const poseRun = button.dataset.poseRunId
        ? videoLibrary.poseRuns.find((run) => run.poseRunId === button.dataset.poseRunId && run.clipId === record.clipId)
        : undefined
      const llmRun = button.dataset.llmPoseRunId
        ? videoLibrary.llmPoseRuns.find((run) => run.llmPoseRunId === button.dataset.llmPoseRunId && run.poseRunId === poseRun?.poseRunId)
        : undefined
      if (!poseRun || !llmRun || !window.confirm(`Delete LLM Pose Run ${llmRun.llmPoseRunId}?\n\nThe parent Pose Run will be kept.`)) return
      button.disabled = true
      try {
        const storedLibrary = await videoStorage.deleteLlmPoseRun(
          record.videoId,
          record.clipId,
          poseRun.poseRunId,
          llmRun.llmPoseRunId,
        )
        applyStoredLibrary(storedLibrary)
        historyStatus.textContent = `Deleted LLM Pose Run ${llmRun.llmPoseRunId}.`
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof Error ? `Could not delete LLM Pose Run. ${error.message}` : 'Could not delete LLM Pose Run.'
      }
      renderClipHistory()
      renderVideoLibrary()
      return
    }

    if (action === 'delete-pose') {
      const poseRun = button.dataset.poseRunId
        ? videoLibrary.poseRuns.find((run) => run.poseRunId === button.dataset.poseRunId && run.clipId === record.clipId)
        : undefined
      if (!poseRun) return
      const childCount = videoLibrary.llmPoseRuns.filter((run) => run.poseRunId === poseRun.poseRunId).length
      if (!window.confirm(`Delete Pose Run ${poseRun.poseRunId} and its ${childCount} LLM Pose Run${childCount === 1 ? '' : 's'}?`)) return
      button.disabled = true
      cleanupPoseReplay()
      try {
        const storedLibrary = await videoStorage.deletePoseRun(record.videoId, record.clipId, poseRun.poseRunId)
        applyStoredLibrary(storedLibrary)
        historyStatus.textContent = `Deleted Pose Run ${poseRun.poseRunId}.`
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof Error ? `Could not delete Pose Run. ${error.message}` : 'Could not delete Pose Run.'
      }
      renderClipHistory()
      renderVideoLibrary()
      return
    }

    if (action === 'generate') {
      cleanupPoseReplay()
      const poseRunCount = clipRuns().poseRuns.length
      if (record.generatedClip && poseRunCount > 0 && !window.confirm(
        `Regenerate ${record.clipId}?\n\nThis replaces the Clip MP4 in place. ${poseRunCount} existing Pose Run${poseRunCount === 1 ? '' : 's'} will remain as historical results from the previous artifact.`,
      )) return
      button.disabled = true
      button.textContent = record.generatedClip ? 'Regenerating…' : 'Generating…'
      historyStatus.textContent = 'Generating clip with FFmpeg…'
      try {
        applyStoredLibrary(await videoStorage.generateClip(record.videoId, record.clipId))
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
      const runView = clipRuns()
      const llmRunCount = videoLibrary.llmPoseRuns.filter((run) => run.clipId === record.clipId).length
      if (layoutMode === 'video-v2' && !window.confirm(
        `Delete Clip ${record.clipId}, including ${runView.poseRuns.length} Pose Run${runView.poseRuns.length === 1 ? '' : 's'} and ${llmRunCount} descendant LLM Pose Run${llmRunCount === 1 ? '' : 's'}?`,
      )) return
      if (replayingClipId === record.id) cleanupPoseReplay()
      try {
        if (layoutMode === 'video-v2') {
          applyStoredLibrary(await videoStorage.deleteClip(record.videoId, record.clipId))
        } else {
          currentVideoRecord.clips = currentVideoRecord.clips.filter((item) => item.id !== record.id)
        }
        historyStatus.textContent = 'Range deleted.'
      } catch (error) {
        await restoreServerLibrary()
        historyStatus.textContent = error instanceof Error
          ? `Range could not be deleted. ${error.message}`
          : 'Range could not be deleted.'
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

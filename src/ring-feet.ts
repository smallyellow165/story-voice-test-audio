import { DrawingUtils, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { poseAnalysisConfig } from './pose-video-analyzer'
import { pointInPolygon, type Point } from './ring-feet-geometry'
import { JUMP_STRATEGIES, jumpResult } from './jump-strategies'
import type { JumpSnapshot, JumpState, JumpStrategy } from './jump-strategy'

let jumpStrategy: JumpStrategy = JUMP_STRATEGIES[0]!.create()
const jumpSelect = document.querySelector<HTMLSelectElement>('#jump-strategy')!
const jumpHelp = document.querySelector<HTMLElement>('#jump-help')!
const jumpCommon = document.querySelector<HTMLElement>('#jump-common')!
const jumpCount = document.querySelector<HTMLElement>('#jump-count')!
let jumpEvents = 0
JUMP_STRATEGIES.forEach((entry, i) => jumpSelect.add(new Option(entry.name, String(i))))
jumpHelp.textContent = JUMP_STRATEGIES[0]!.help
const jumpName = document.querySelector<HTMLElement>('#jump-name')!
const jumpState = document.querySelector<HTMLElement>('#jump-state')!
const jumpDebug = document.querySelector<HTMLElement>('#jump-debug')!
const jumpEvent = document.querySelector<HTMLElement>('#jump-event')!
const jumpTrace = document.querySelector<HTMLElement>('#jump-trace')!
let jumpHistory: JumpState[] = []
jumpName.textContent = jumpStrategy.name

function showJump(result: JumpSnapshot) {
  const common = jumpResult(result)
  if (common.event) jumpEvents++
  jumpCount.textContent = `JUMP COUNT: ${jumpEvents}`
  jumpCommon.textContent = `Detected: ${common.detected ? 'YES' : 'NO'} | Jump events: ${jumpEvents}`
  jumpState.textContent = `Jump: ${result.state}`
  if (jumpHistory.at(-1) !== result.state) {
    jumpHistory = [...jumpHistory, result.state].slice(-8)
    jumpTrace.textContent = jumpHistory.join(' → ')
  }
  jumpDebug.textContent = `${result.reason} | ` + Object.entries(result.debug)
    .map(([key, value]) => `${key}=${typeof value === 'number' ? value.toFixed(3) : value ?? '—'}`).join(' | ')
  if (result.event) {
    const event = result.event
    jumpEvent.textContent = `Last event: ${event.type} @ ${Math.round(event.timestampMs)} ms`
      + (event.durationMs === undefined ? '' : ` | cycle=${Math.round(event.durationMs)} ms`)
  }
}
function resetJump() {
  jumpEvents = 0
  jumpHistory = []
  jumpEvent.textContent = 'Last event: —'
  showJump(jumpStrategy.reset())
}
document.querySelector<HTMLButtonElement>('#jump-reset')!.onclick = resetJump
resetJump()
jumpSelect.onchange = () => {
  const selected = JUMP_STRATEGIES[Number(jumpSelect.value)]!
  jumpStrategy = selected.create()
  jumpName.textContent = jumpStrategy.name
  jumpHelp.textContent = selected.help
  resetJump() // Immediately update the large status; never touch ring/camera state.
}

type Ring = {
  detected: boolean
  width: number
  height: number
  polygon: Point[]
  color?: string
  candidate_count: number
}

const video = document.querySelector<HTMLVideoElement>('#video')!
const view = document.querySelector<HTMLCanvasElement>('#view')!
const context = view.getContext('2d')!
const drawing = new DrawingUtils(context)
const startButton = document.querySelector<HTMLButtonElement>('#start')!
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!
const detectButton = document.querySelector<HTMLButtonElement>('#detect')!
const status = document.querySelector<HTMLElement>('#status')!
const ringStatus = document.querySelector<HTMLElement>('#ring-status')!
const leftLabel = document.querySelector<HTMLElement>('#left')!
const rightLabel = document.querySelector<HTMLElement>('#right')!
const capture = document.createElement('canvas')
const captureContext = capture.getContext('2d')!
let worker: Worker | null = null
let stream: MediaStream | null = null
let ring: Ring | null = null
let busy = false
let running = false
let session = 0
let animation = 0
let lastVideoTime = -1
let requestId = 0
let watchdog: number | undefined
let upload: AbortController | null = null

function unknown() {
  leftLabel.textContent = 'LEFT: UNKNOWN'
  rightLabel.textContent = 'RIGHT: UNKNOWN'
  leftLabel.dataset.state = rightLabel.dataset.state = 'UNKNOWN'
}

function stop(message = '摄像头已停止。') {
  resetJump()
  session++
  running = false
  busy = false
  cancelAnimationFrame(animation)
  window.clearTimeout(watchdog)
  worker?.terminate()
  worker = null
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  video.srcObject = null
  upload?.abort()
  upload = null
  ring = null
  unknown()
  context.clearRect(0, 0, view.width, view.height)
  startButton.disabled = false
  stopButton.disabled = detectButton.disabled = true
  status.textContent = message
  ringStatus.textContent = '尚未检测圈。移动摄像头或圈后请重新检测。'
}

function footPoint(landmarks: NormalizedLandmark[], heel: number, toe: number): Point | null {
  const a = landmarks[heel]
  const b = landmarks[toe]
  if (!a || !b || [a, b].some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1
    || (p.visibility ?? 0) < 0.5)) return null
  return [(a.x + b.x) * view.width / 2, (a.y + b.y) * view.height / 2]
}

function showFoot(point: Point | null, side: 'LEFT' | 'RIGHT', label: HTMLElement) {
  const state = point && ring ? (pointInPolygon(point, ring.polygon) ? 'IN' : 'OUT') : 'UNKNOWN'
  label.textContent = `${side}: ${state}`
  label.dataset.state = state
  if (!point) return
  context.beginPath()
  context.arc(point[0], point[1], 6, 0, 2 * Math.PI)
  context.fillStyle = side === 'LEFT' ? '#ffca58' : '#df92ff'
  context.fill()
  context.strokeStyle = '#121820'
  context.lineWidth = 2
  context.stroke()
  context.font = 'bold 16px sans-serif'
  context.strokeText(side[0]!, point[0] + 9, point[1])
  context.fillText(side[0]!, point[0] + 9, point[1])
}

function render(landmarks: NormalizedLandmark[]) {
  // Draw the exact frame submitted to Pose, not a later video frame.
  context.drawImage(capture, 0, 0)
  if (landmarks.length) drawing.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS,
    { color: '#ffffff80', lineWidth: 1 })
  if (ring) {
    context.beginPath()
    ring.polygon.forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y))
    context.closePath()
    context.fillStyle = '#43e3e31a'
    context.fill()
    context.strokeStyle = '#43e3e3'
    context.lineWidth = 3
    context.stroke()
  }
  showFoot(footPoint(landmarks, 29, 31), 'LEFT', leftLabel)
  showFoot(footPoint(landmarks, 30, 32), 'RIGHT', rightLabel)
}

async function tick() {
  if (!running) return
  animation = requestAnimationFrame(() => { void tick() })
  if (busy || video.readyState < 2 || video.currentTime === lastVideoTime) return
  const currentSession = session
  // A dimension change invalidates the fixed ring instead of compensating later.
  const height = Math.round(video.videoHeight * 600 / video.videoWidth)
  if (height !== capture.height) {
    stop('摄像头画面比例改变，请重新启动并检测圈。')
    return
  }
  lastVideoTime = video.currentTime
  busy = true
  try {
    captureContext.drawImage(video, 0, 0, capture.width, capture.height)
    const bitmap = await createImageBitmap(capture)
    if (currentSession !== session || !worker) { bitmap.close(); return }
    watchdog = window.setTimeout(() => stop('Pose 推理超时，请重新启动。'), 5000)
    worker.postMessage({ type: 'DETECT', bitmap, requestId: ++requestId,
      videoTimestampMs: performance.now() }, [bitmap])
  } catch (error) {
    if (currentSession === session) stop(`Pose 错误：${String(error)}`)
  }
}

startButton.onclick = async () => {
  startButton.disabled = true
  stopButton.disabled = false
  status.textContent = '正在加载 Pose 模型并请求摄像头权限…'
  const currentSession = ++session
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
    if (currentSession !== session) { media.getTracks().forEach(t => t.stop()); return }
    stream = media
    media.getVideoTracks()[0]!.addEventListener('ended', () => {
      if (currentSession === session) stop('摄像头连接已断开。')
    })
    video.srcObject = media
    await video.play()
    if (currentSession !== session) return
    capture.width = view.width = 600
    capture.height = view.height = Math.max(1, Math.round(video.videoHeight * 600 / video.videoWidth))
    lastVideoTime = -1
    const poseWorker = new Worker(new URL('./pose-landmarker.worker.ts', import.meta.url), { type: 'module' })
    worker = poseWorker
    watchdog = window.setTimeout(() => stop('Pose 模型加载超时，请检查网络后重试。'), 60000)
    poseWorker.onerror = () => {
      if (currentSession === session) stop('Pose worker 加载失败，请检查网络后重试。')
    }
    poseWorker.onmessage = (event: MessageEvent) => {
      if (currentSession !== session) return
      const data = event.data
      window.clearTimeout(watchdog)
      if (data.type === 'READY') {
        running = true
        detectButton.disabled = false
        status.textContent = `Pose 已就绪 (${data.delegate})。让圈完整露出，然后点击 Detect Ring。`
        void tick()
      } else if (data.type === 'RESULT') {
        render(data.landmarks[0] ?? [])
        showJump(jumpStrategy.update({ timestampMs: data.videoTimestampMs,
          landmarks: data.landmarks[0] ?? [] }))
        busy = false
      } else if (data.type === 'ERROR') {
        stop(`Pose 错误：${data.message}`)
      }
    }
    poseWorker.postMessage({ type: 'INIT', config: {
      wasmRoot: poseAnalysisConfig.wasmRoot,
      modelAssetPath: poseAnalysisConfig.modelAssetPath,
      delegate: poseAnalysisConfig.delegate,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    } })
  } catch (error) {
    if (currentSession === session) stop(`启动失败：${String(error)}`)
  }
}

async function detectRing() {
  if (!running || upload) return
  const currentSession = session
  const controller = new AbortController()
  upload = controller
  detectButton.disabled = true
  ring = null // A failed re-detection must not silently retain an old polygon.
  unknown()
  ringStatus.textContent = '正在检测当前这一帧…'
  const timeout = window.setTimeout(() => controller.abort(), 15000)
  try {
    const snapshot = document.createElement('canvas')
    snapshot.width = capture.width
    snapshot.height = capture.height
    snapshot.getContext('2d')!.drawImage(video, 0, 0, snapshot.width, snapshot.height)
    const blob = await new Promise<Blob>((resolve, reject) => snapshot.toBlob(
      value => value ? resolve(value) : reject(new Error('截图失败')), 'image/png'))
    const response = await fetch(`${import.meta.env.BASE_URL}ring-api/detect-ring`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob, signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}；请确认 Python service 已启动`)
    const result: Ring = await response.json()
    if (currentSession !== session) return
    if (result.width !== capture.width || result.height !== capture.height) throw new Error('返回坐标尺寸不一致')
    if (result.detected) {
      if (!Array.isArray(result.polygon) || result.polygon.length < 3
        || result.polygon.some(p => !Array.isArray(p) || p.length !== 2
          || !p.every(Number.isFinite))) throw new Error('返回的 polygon 无效')
      ring = result
      ringStatus.textContent = `${result.color} ring 已保存；${result.candidate_count} 个合格候选中选择主孔洞最大的一个。请检查青色边界后走入圈中。`
    } else {
      ringStatus.textContent = '未检测到完整圈。让圈远离画面边缘、移开遮挡后重新点击。'
    }
  } catch (error) {
    if (currentSession === session) ringStatus.textContent = `检测失败：${String(error)}`
  } finally {
    window.clearTimeout(timeout)
    if (currentSession === session) { upload = null; detectButton.disabled = !running }
  }
}

detectButton.onclick = () => { void detectRing() }
stopButton.onclick = () => stop()

const screenStart = document.querySelector<HTMLButtonElement>('#screen-start')!
const screenStop = document.querySelector<HTMLButtonElement>('#screen-stop')!
const screenshotButton = document.querySelector<HTMLButtonElement>('#screenshot')!
const screenStatus = document.querySelector<HTMLElement>('#screen-status')!
const screenVideo = document.querySelector<HTMLVideoElement>('#screen-video')!
const screenSupported = !!navigator.mediaDevices?.getDisplayMedia
let screenStream: MediaStream | null = null
let screenSession = 0
let screenshotBusy = false
const screencastStart = document.querySelector<HTMLButtonElement>('#screencast-start')!
const screencastStop = document.querySelector<HTMLButtonElement>('#screencast-stop')!
const screencastStatus = document.querySelector<HTMLElement>('#screencast-status')!
const recorderSupported = typeof MediaRecorder !== 'undefined'
let screencast: MediaRecorder | null = null

function stopScreencast() {
  if (!screencast || screencast.state === 'inactive') return
  screencastStatus.textContent = 'Screencast: finishing…'
  screencastStop.disabled = true
  screencast.stop() // Final dataavailable arrives before onstop; keep the shared tracks alive.
}

function startScreencast() {
  if (!recorderSupported || screencast) return
  const tracks = screenStream?.getVideoTracks().filter(track => track.readyState === 'live') ?? []
  if (!tracks.length) {
    screencastStatus.textContent = 'Screen capture not started'
    return
  }
  try {
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      .find(type => MediaRecorder.isTypeSupported(type))
    // Reuse only the capture's video tracks, never webcam or microphone audio.
    const recorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    const started = new Date().toISOString().replace(/[:.]/g, '-')
    let failed = false
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onerror = () => {
      failed = true
      screencastStatus.textContent = 'Screencast: recording error; attempting partial download'
      if (recorder.state !== 'inactive') recorder.stop()
    }
    recorder.onstop = async () => {
      screencastStop.disabled = true
      try {
        if (!chunks.length) throw new Error('No video data recorded')
        const type = recorder.mimeType || chunks[0]!.type
        const blob = new Blob(chunks, { type })
        screencastStatus.textContent = 'Screencast: uploading / converting to seekable MP4…'
        const response = await fetch('/api/screencast/mp4', {
          method: 'POST', headers: { 'Content-Type': type }, body: blob,
        })
        if (!response.ok) {
          const detail = await response.json().catch(() => null)
          throw new Error(detail?.error ?? `MP4 conversion HTTP ${response.status}; restart the Web server`)
        }
        if (!response.headers.get('Content-Type')?.includes('video/mp4')) {
          throw new Error('MP4 endpoint unavailable; restart the Web server')
        }
        const mp4 = await response.blob()
        if (!mp4.size) throw new Error('Server returned an empty MP4')
        const filename = `ring-feet-screencast-${started}.mp4`
        const url = URL.createObjectURL(mp4)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.append(link)
        try {
          link.click()
          screencastStatus.textContent = `${failed ? 'Partial video' : 'Screencast'} download requested: ${filename}`
        } finally {
          link.remove()
          window.setTimeout(() => URL.revokeObjectURL(url), 10000)
        }
      } catch (error) {
        screencastStatus.textContent = `Screencast failed: ${String(error)}`
      } finally {
        chunks.length = 0
        screencast = null
        screencastStart.disabled = false
        screencastStop.disabled = true
      }
    }
    recorder.start(1000)
    screencast = recorder
    screencastStart.disabled = true
    screencastStop.disabled = false
    screencastStatus.textContent = 'Screencast: recording (video only)'
  } catch (error) {
    screencastStatus.textContent = `Screencast failed: ${String(error)}`
  }
}
screencastStart.onclick = startScreencast
screencastStop.onclick = stopScreencast
if (!recorderSupported) {
  screencastStart.disabled = true
  screencastStatus.textContent = 'MediaRecorder not supported'
}

function stopScreenCapture(message = 'Screen Capture: off') {
  stopScreencast()
  screenSession++
  screenStream?.getTracks().forEach(track => track.stop())
  screenStream = null
  screenVideo.pause()
  screenVideo.srcObject = null
  screenStart.disabled = !screenSupported
  screenStop.disabled = true
  screenStatus.textContent = message
}

screenStart.onclick = async () => {
  if (!screenSupported) return
  const generation = ++screenSession
  screenStart.disabled = true
  screenStop.disabled = false
  screenStatus.textContent = 'Screen Capture: choose this tab'
  try {
    // These are picker hints, not a way to bypass the user's source selection.
    const options: DisplayMediaStreamOptions & { preferCurrentTab: boolean; selfBrowserSurface: string } = {
      video: { displaySurface: 'browser' }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include',
    }
    const media = await navigator.mediaDevices.getDisplayMedia(options)
    if (generation !== screenSession) { media.getTracks().forEach(track => track.stop()); return }
    screenStream = media
    media.getVideoTracks()[0]!.addEventListener('ended', () => {
      if (generation === screenSession) stopScreenCapture()
    })
    screenVideo.srcObject = media
    await screenVideo.play()
    if (generation === screenSession) screenStatus.textContent = 'Screen Capture: ready'
  } catch (error) {
    if (generation === screenSession) stopScreenCapture(`Screen Capture: off (${String(error)})`)
  }
}

async function takeScreenshot() {
  if (!screenStream?.active) {
    screenStatus.textContent = 'Screen capture not started'
    return
  }
  if (screenshotBusy) return
  if (screenVideo.readyState < 2 || !screenVideo.videoWidth || !screenVideo.videoHeight) {
    screenStatus.textContent = 'Screen Capture: waiting for frame — try again'
    return
  }
  screenshotBusy = true
  const generation = screenSession
  try {
    const snapshot = document.createElement('canvas')
    // Native capture dimensions: independent of the width-600 webcam canvas.
    snapshot.width = screenVideo.videoWidth
    snapshot.height = screenVideo.videoHeight
    snapshot.getContext('2d')!.drawImage(screenVideo, 0, 0)
    const timestamp = new Date()
    const stamp = [timestamp.getFullYear(), timestamp.getMonth() + 1, timestamp.getDate(),
      timestamp.getHours(), timestamp.getMinutes(), timestamp.getSeconds()]
      .map(value => String(value).padStart(2, '0')).join('-')
    const filename = `ring-feet-${stamp}.png`
    const blob = await new Promise<Blob>((resolve, reject) => snapshot.toBlob(
      value => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'))
    if (generation !== screenSession) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.append(link)
    try {
      link.click()
      screenStatus.textContent = `Screenshot download requested: ${filename}`
    } finally {
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  } catch (error) {
    if (generation === screenSession) screenStatus.textContent = `Screenshot failed: ${String(error)}`
  } finally {
    screenshotBusy = false
  }
}

screenStop.onclick = () => stopScreenCapture()
screenshotButton.onclick = () => { void takeScreenshot() }
if (!screenSupported) {
  screenStart.disabled = true
  screenStatus.textContent = 'Screen Capture not supported'
}

// Minimal local types for browsers exposing the prefixed Web Speech API.
type VoiceResult = { isFinal: boolean; [index: number]: { transcript: string } }
type VoiceRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: { resultIndex: number; results: ArrayLike<VoiceResult> }) => void) | null
  start(): void
  abort(): void
}
type VoiceConstructor = new () => VoiceRecognition
const speechWindow = window as typeof window & {
  SpeechRecognition?: VoiceConstructor
  webkitSpeechRecognition?: VoiceConstructor
}
const SpeechRecognitionAPI = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
const voiceStart = document.querySelector<HTMLButtonElement>('#voice-start')!
const voiceStop = document.querySelector<HTMLButtonElement>('#voice-stop')!
const voiceStatus = document.querySelector<HTMLElement>('#voice-status')!
const voiceHeard = document.querySelector<HTMLElement>('#voice-heard')!
let voiceEnabled = false
let recognition: VoiceRecognition | null = null
let voiceRestart: number | undefined
let lastVoiceTrigger = -Infinity
let lastScreenshotTrigger = -Infinity
let lastScreencastStartTrigger = -Infinity
let lastScreencastStopTrigger = -Infinity

function stopVoice(message = 'Voice: off') {
  voiceEnabled = false
  window.clearTimeout(voiceRestart)
  const previous = recognition
  recognition = null // Ignore late results/end events from the stopped session.
  previous?.abort()
  voiceStart.disabled = !SpeechRecognitionAPI
  voiceStop.disabled = true
  voiceStatus.textContent = message
}

function listen() {
  if (!voiceEnabled || !SpeechRecognitionAPI) return
  try {
    const current = new SpeechRecognitionAPI()
    recognition = current
    current.lang = 'en-US' // Prefer reliable English; Chinese is best-effort.
    current.continuous = true
    current.interimResults = false
    const processed = new Set<number>()
    current.onstart = () => {
      if (voiceEnabled && recognition === current) voiceStatus.textContent = 'Voice: listening'
    }
    current.onresult = event => {
      if (!voiceEnabled || recognition !== current) return
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!
        if (!result.isFinal || processed.has(i)) continue
        processed.add(i)
        const transcript = result[0]!.transcript.trim()
        voiceHeard.textContent = `Heard: ${transcript}`
        const normalized = transcript.toLowerCase().replace(/\s+/g, ' ')
        const command = /\bdetect ring\b/.test(normalized)
          || normalized.includes('检测圈') || normalized.includes('识别圈')
        const now = performance.now()
        // Separate start/stop cooldowns allow stopping immediately after starting.
        if (/\bstart (?:screencast|recording)\b/.test(normalized) && now - lastScreencastStartTrigger >= 3000) {
          lastScreencastStartTrigger = now
          startScreencast()
        }
        if (/\bstop (?:screencast|recording)\b/.test(normalized) && now - lastScreencastStopTrigger >= 3000) {
          lastScreencastStopTrigger = now
          stopScreencast()
        }
        // Independent command and cooldown: "take screenshot" matches once,
        // and screenshots work even when the camera is stopped or detecting.
        if (/\bscreenshot\b/.test(normalized) && now - lastScreenshotTrigger >= 3000) {
          lastScreenshotTrigger = now
          void takeScreenshot()
        }
        if (!command || now - lastVoiceTrigger < 3000) continue
        if (!running || upload) {
          voiceHeard.textContent += running ? ' — detection busy' : ' — start camera first'
          continue
        }
        lastVoiceTrigger = now
        void detectRing() // Same function as the existing button; no queued retry.
      }
    }
    current.onerror = event => {
      if (!voiceEnabled || recognition !== current) return
      // Silence can end a session normally. Other failures need a manual retry.
      if (event.error !== 'no-speech') stopVoice(`Voice: off (${event.error})`)
    }
    current.onend = () => {
      if (!voiceEnabled || recognition !== current) return
      recognition = null
      voiceStatus.textContent = 'Voice: restarting'
      voiceRestart = window.setTimeout(listen, 500)
    }
    voiceStatus.textContent = 'Voice: starting'
    current.start() // Browser requests microphone permission on the user click.
  } catch (error) {
    stopVoice(`Voice: off (${String(error)})`)
  }
}

if (!SpeechRecognitionAPI) {
  voiceStart.disabled = true
  voiceStatus.textContent = 'SpeechRecognition not supported'
}
voiceStart.onclick = () => {
  if (voiceEnabled) return
  voiceEnabled = true
  voiceStart.disabled = true
  voiceStop.disabled = false
  listen()
}
voiceStop.onclick = () => stopVoice()
window.addEventListener('pagehide', () => { stopScreenCapture(); stopVoice(); stop() })

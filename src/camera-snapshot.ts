import './camera-snapshot.css'

const video = document.querySelector<HTMLVideoElement>('#preview')!
const cameraSelect = document.querySelector<HTMLSelectElement>('#camera')!
const resolutionSelect = document.querySelector<HTMLSelectElement>('#resolution')!
const startButton = document.querySelector<HTMLButtonElement>('#start-camera')!
const captureButton = document.querySelector<HTMLButtonElement>('#capture')!
const capturedImage = document.querySelector<HTMLImageElement>('#captured-image')!
const cameraStatus = document.querySelector<HTMLParagraphElement>('#camera-status')!
const resolutionStatus = document.querySelector<HTMLParagraphElement>('#resolution-status')!
const captureStatus = document.querySelector<HTMLParagraphElement>('#capture-status')!
const downloadJpgButton = document.querySelector<HTMLButtonElement>('#download-jpg')!
const downloadPngButton = document.querySelector<HTMLButtonElement>('#download-png')!

let stream: MediaStream | undefined
let capturedCanvas: HTMLCanvasElement | undefined

function requestedResolution() {
  const [width, height] = resolutionSelect.value.split('x').map(Number)
  return { width, height, label: `${width} × ${height}` }
}

function showResolution() {
  const requested = requestedResolution()
  const actual = video.videoWidth && video.videoHeight ? `${video.videoWidth} × ${video.videoHeight}` : '—'
  resolutionStatus.innerHTML = `Requested: ${requested.label}<br>Actual: ${actual}`
}

function stopCamera() {
  stream?.getTracks().forEach(track => track.stop())
  stream = undefined
  video.srcObject = null
}

async function populateCameras() {
  const selectedDeviceId = cameraSelect.value
  const devices = await navigator.mediaDevices.enumerateDevices()
  const cameras = devices.filter(device => device.kind === 'videoinput')
  cameraSelect.replaceChildren()
  cameras.forEach((camera, index) => {
    const option = document.createElement('option')
    option.value = camera.deviceId
    option.textContent = camera.label || `Camera ${index + 1}`
    cameraSelect.append(option)
  })
  if ([...cameraSelect.options].some(option => option.value === selectedDeviceId)) cameraSelect.value = selectedDeviceId
  cameraSelect.disabled = cameras.length < 2
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = 'This browser does not support camera access.'
    return
  }

  startButton.disabled = true
  captureButton.disabled = true
  cameraStatus.textContent = 'Requesting camera access…'
  showResolution()
  try {
    stopCamera()
    const deviceId = cameraSelect.value
    const requested = requestedResolution()
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        width: { ideal: requested.width },
        height: { ideal: requested.height },
        frameRate: { ideal: 30 },
      },
    })
    video.srcObject = stream
    await video.play()
    await populateCameras()
    showResolution()
    cameraStatus.textContent = 'Camera is live.'
    captureButton.disabled = false
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown camera error.'
    cameraStatus.textContent = `Could not start camera: ${message}`
  } finally {
    startButton.disabled = false
  }
}

function captureFrame() {
  if (!stream || !video.videoWidth || !video.videoHeight) return
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
  capturedCanvas = canvas
  capturedImage.src = canvas.toDataURL('image/png')
  capturedImage.hidden = false
  captureStatus.textContent = `Captured ${canvas.width} × ${canvas.height}.`
  downloadJpgButton.disabled = false
  downloadPngButton.disabled = false
}

function timestamp() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function download(type: 'image/jpeg' | 'image/png', extension: 'jpg' | 'png') {
  if (!capturedCanvas) return
  const link = document.createElement('a')
  link.href = capturedCanvas.toDataURL(type, type === 'image/jpeg' ? 0.95 : undefined)
  link.download = `storybook-snapshot-${timestamp()}.${extension}`
  link.click()
}

startButton.addEventListener('click', () => void startCamera())
captureButton.addEventListener('click', captureFrame)
cameraSelect.addEventListener('change', () => void startCamera())
resolutionSelect.addEventListener('change', () => void startCamera())
downloadJpgButton.addEventListener('click', () => download('image/jpeg', 'jpg'))
downloadPngButton.addEventListener('click', () => download('image/png', 'png'))
video.addEventListener('loadedmetadata', showResolution)
window.addEventListener('pagehide', stopCamera, { once: true })

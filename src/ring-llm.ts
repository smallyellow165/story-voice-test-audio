import './ring-llm.css'
import { toPixels, bboxPixels, fromClient, type Point } from './ring-llm-coordinates'
// The old Vertex page keeps its original endpoint; both pages share all rendering/mapping.
const apiBase = document.body.dataset.ringApi || '/api/ring-llm'
type Ring = { id: string; center: Point; bbox: { xMin: number; yMin: number; xMax: number; yMax: number }; polygon: Point[]; colorGuess: string; confidence: number; explanation: string }
const file = document.querySelector<HTMLInputElement>('#file')!
const button = document.querySelector<HTMLButtonElement>('#detect')!
const modelSelect = document.querySelector<HTMLSelectElement>('#model')!
let modelsReady = false
const toggle = document.querySelector<HTMLInputElement>('#overlay')!
const canvas = document.querySelector<HTMLCanvasElement>('#image')!
const ctx = canvas.getContext('2d')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const json = document.querySelector<HTMLPreElement>('#json')!
const diagnostics = document.querySelector<HTMLPreElement>('#coordinates')!
const grid = document.querySelector<HTMLInputElement>('#grid')!
let clicked: Point | null = null
const results = document.querySelector<HTMLDivElement>('#results')!
let picture: ImageBitmap | null = null
let imageBase64 = ''
let rings: Ring[] = []
let revision = 0
function updateDiagnostics() {
  const rect = canvas.getBoundingClientRect()
  diagnostics.textContent = JSON.stringify({
    originalOrientedBitmap: picture ? { width: picture.width, height: picture.height } : null,
    uploadedRasterAndCanvasBacking: { width: canvas.width, height: canvas.height },
    imageContentRectViewportCssPixels: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    cssScale: { x: rect.width / canvas.width, y: rect.height / canvas.height },
    devicePixelRatio: window.devicePixelRatio,
    mapping: 'x = normalized.x * canvas.width; y = normalized.y * canvas.height. Same canvas for image and geometry. No letterbox/crop/DPR multiplier.',
    clicked: clicked ? { normalized: clicked, rasterPixels: toPixels(clicked, canvas.width, canvas.height) } : null,
    rings: rings.map(r => ({ id: r.id, normalized: { bbox: r.bbox, center: r.center, polygon: r.polygon },
      rasterPixels: { bbox: bboxPixels(r.bbox, canvas.width, canvas.height), center: toPixels(r.center, canvas.width, canvas.height), polygon: r.polygon.map(p => toPixels(p, canvas.width, canvas.height)) },
      displayedLocalCssPixels: { bbox: bboxPixels(r.bbox, rect.width, rect.height), polygon: r.polygon.map(p => toPixels(p, rect.width, rect.height)) },
    })),
  }, null, 2)
}
new ResizeObserver(updateDiagnostics).observe(canvas)
document.querySelector('.work-panel')!.addEventListener('scroll', updateDiagnostics, { passive: true })
window.addEventListener('scroll', updateDiagnostics, { passive: true })
window.addEventListener('resize', updateDiagnostics)
canvas.onclick = event => {
  if (!picture) return
  clicked = fromClient({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect())
  console.info('Image coordinate probe', clicked, toPixels(clicked, canvas.width, canvas.height))
  draw()
}
function draw() {
  if (!picture) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(picture, 0, 0, canvas.width, canvas.height)
  updateDiagnostics()
  if (grid.checked) {
    ctx.strokeStyle = '#ffffff80'; ctx.lineWidth = 1; ctx.font = '16px sans-serif'; ctx.fillStyle = '#fff'
    for (const n of [0.25, 0.5, 0.75]) {
      const p = toPixels({ x: n, y: n }, canvas.width, canvas.height)
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, canvas.height)
      ctx.moveTo(0, p.y); ctx.lineTo(canvas.width, p.y); ctx.stroke()
      ctx.fillText(`x=${n}`, p.x + 4, 20); ctx.fillText(`y=${n}`, 4, p.y - 4)
    }
  }
  if (clicked) {
    const p = toPixels(clicked, canvas.width, canvas.height)
    ctx.strokeStyle = '#ff66ff'; ctx.lineWidth = 2; ctx.beginPath()
    ctx.moveTo(p.x - 10, p.y); ctx.lineTo(p.x + 10, p.y)
    ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x, p.y + 10); ctx.stroke()
  }
  if (!toggle.checked) return
  const w = canvas.width, h = canvas.height
  ctx.lineWidth = Math.max(2, w / 500)
  ctx.font = `bold ${Math.max(16, w / 65)}px sans-serif`
  rings.forEach((r, i) => {
    const b = r.bbox
    ctx.strokeStyle = '#ffe65c'
    const box = bboxPixels(b, w, h)
    ctx.strokeRect(box.x, box.y, box.width, box.height)
    if (r.polygon.length >= 3) {
      ctx.strokeStyle = '#00ffe5'; ctx.beginPath()
      r.polygon.forEach((p, j) => { const pixel = toPixels(p, w, h); if (j === 0) ctx.moveTo(pixel.x, pixel.y); else ctx.lineTo(pixel.x, pixel.y) })
      ctx.closePath(); ctx.stroke()
    }
    const center = toPixels(r.center, w, h)
    ctx.fillStyle = '#ffe65c'; ctx.beginPath(); ctx.arc(center.x, center.y, 4, 0, Math.PI * 2); ctx.fill()
    const text = `Ring #${i + 1} · ${r.colorGuess} · ${(r.confidence * 100).toFixed(0)}%`
    const x = Math.max(0, Math.min(b.xMin * w, w - ctx.measureText(text).width - 8)), y = Math.max(24, b.yMin * h - 7)
    ctx.strokeStyle = '#101820'; ctx.lineWidth = 4; ctx.strokeText(text, x, y); ctx.fillText(text, x, y); ctx.lineWidth = Math.max(2, w / 500)
  })
}
file.onchange = async () => {
  const current = ++revision
  clicked = null
  rings = []; imageBase64 = ''; button.disabled = true; json.textContent = '—'; results.textContent = ''
  picture?.close(); picture = null; ctx.clearRect(0, 0, canvas.width, canvas.height)
  const selected = file.files?.[0]
  if (!selected) return
  try {
    if (selected.size > 20 * 1024 * 1024) throw new Error('请选择小于 20 MB 的图片。')
    const loaded = await createImageBitmap(selected)
    if (revision !== current) { loaded.close(); return }
    picture = loaded
    const scale = Math.min(1, 2000 / Math.max(picture.width, picture.height))
    canvas.width = Math.round(picture.width * scale); canvas.height = Math.round(picture.height * scale)
    ctx.drawImage(picture, 0, 0, canvas.width, canvas.height)
    // Encode the same oriented, uncropped raster displayed by the canvas.
    imageBase64 = canvas.toDataURL('image/jpeg', 0.94).split(',')[1]!
    draw()
    status.textContent = `Ready · ${canvas.width} × ${canvas.height} · 点击按钮发送图片`
    button.disabled = !modelsReady
  } catch (error) { status.textContent = String(error) }
}
toggle.onchange = draw
grid.onchange = draw
button.onclick = async () => {
  if (!imageBase64 || !modelsReady) return
  const requestedModel = modelSelect.value
  modelSelect.disabled = true
  button.disabled = true; file.disabled = true; rings = []; draw(); results.textContent = ''; json.textContent = '—'
  status.textContent = `${requestedModel} 检测中…`
  const started = performance.now()
  try {
    const response = await fetch(`${apiBase}/detect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mimeType: 'image/jpeg', imageBase64, model: requestedModel, width: canvas.width, height: canvas.height }), signal: AbortSignal.timeout(110000) })
    const data = await response.json()
    json.textContent = data.rawJson || JSON.stringify(data, null, 2)
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
    rings = data.rings
    status.textContent = `${data.model} · ${rings.length} rings · ${((performance.now() - started) / 1000).toFixed(1)}s`
    results.textContent = rings.map((r, i) => `Ring #${i + 1} [${r.id}] · ${r.colorGuess} · ${r.confidence}: ${r.explanation}`).join('\n') || '未检测到游戏圈。'
    draw()
  } catch (error) { status.textContent = `检测失败：${error instanceof Error ? error.message : String(error)}` }
  finally { button.disabled = false; file.disabled = false; modelSelect.disabled = false }
}

async function loadModels() {
  try {
    const response = await fetch(`${apiBase}/models`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data: { apiKeyConfigured?: boolean; defaultModel: string; models: { id: string; label: string }[] } = await response.json()
    modelSelect.replaceChildren(...data.models.map(model => new Option(model.label, model.id)))
    modelSelect.value = data.defaultModel
    if (data.apiKeyConfigured === false) {
      status.textContent = '服务端缺少 GEMINI_API_KEY：请配置项目 .env，重启服务后刷新页面。'
      return
    }
    modelsReady = true
    modelSelect.disabled = false
    button.disabled = !imageBase64
  } catch (error) {
    modelSelect.replaceChildren(new Option('Model list unavailable', ''))
    status.textContent = `模型列表加载失败，请确认 server 已重启后刷新：${String(error)}`
  }
}
void loadModels()

import './ring-llm.css'
type Point = { x: number; y: number }
type Ring = { id: string; center: Point; bbox: { xMin: number; yMin: number; xMax: number; yMax: number }; polygon: Point[]; colorGuess: string; confidence: number; explanation: string }
const file = document.querySelector<HTMLInputElement>('#file')!
const button = document.querySelector<HTMLButtonElement>('#detect')!
const toggle = document.querySelector<HTMLInputElement>('#overlay')!
const canvas = document.querySelector<HTMLCanvasElement>('#image')!
const ctx = canvas.getContext('2d')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const json = document.querySelector<HTMLPreElement>('#json')!
const results = document.querySelector<HTMLDivElement>('#results')!
let picture: ImageBitmap | null = null
let imageBase64 = ''
let rings: Ring[] = []
let revision = 0
function draw() {
  if (!picture) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(picture, 0, 0, canvas.width, canvas.height)
  if (!toggle.checked) return
  const w = canvas.width, h = canvas.height
  ctx.lineWidth = Math.max(2, w / 500)
  ctx.font = `bold ${Math.max(16, w / 65)}px sans-serif`
  rings.forEach((r, i) => {
    const b = r.bbox
    ctx.strokeStyle = '#ffe65c'
    ctx.strokeRect(b.xMin * w, b.yMin * h, (b.xMax - b.xMin) * w, (b.yMax - b.yMin) * h)
    if (r.polygon.length >= 3) {
      ctx.strokeStyle = '#00ffe5'; ctx.beginPath()
      r.polygon.forEach((p, j) => { if (j === 0) ctx.moveTo(p.x * w, p.y * h); else ctx.lineTo(p.x * w, p.y * h) })
      ctx.closePath(); ctx.stroke()
    }
    ctx.fillStyle = '#ffe65c'; ctx.beginPath(); ctx.arc(r.center.x * w, r.center.y * h, 4, 0, Math.PI * 2); ctx.fill()
    const text = `Ring #${i + 1} · ${r.colorGuess} · ${(r.confidence * 100).toFixed(0)}%`
    const x = Math.max(0, Math.min(b.xMin * w, w - ctx.measureText(text).width - 8)), y = Math.max(24, b.yMin * h - 7)
    ctx.strokeStyle = '#101820'; ctx.lineWidth = 4; ctx.strokeText(text, x, y); ctx.fillText(text, x, y); ctx.lineWidth = Math.max(2, w / 500)
  })
}
file.onchange = async () => {
  const current = ++revision
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
    draw()
    // Encode the same oriented, uncropped raster displayed by the canvas.
    imageBase64 = canvas.toDataURL('image/jpeg', 0.94).split(',')[1]!
    status.textContent = `Ready · ${canvas.width} × ${canvas.height} · 点击按钮发送图片`
    button.disabled = false
  } catch (error) { status.textContent = String(error) }
}
toggle.onchange = draw
button.onclick = async () => {
  if (!imageBase64) return
  button.disabled = true; file.disabled = true; rings = []; draw(); results.textContent = ''; json.textContent = '—'
  status.textContent = 'Gemini 检测中…'
  const started = performance.now()
  try {
    const response = await fetch('/api/ring-llm/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mimeType: 'image/jpeg', imageBase64, width: canvas.width, height: canvas.height }), signal: AbortSignal.timeout(110000) })
    const data = await response.json()
    json.textContent = data.rawJson || JSON.stringify(data, null, 2)
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
    rings = data.rings
    status.textContent = `${data.model} · ${rings.length} rings · ${((performance.now() - started) / 1000).toFixed(1)}s`
    results.textContent = rings.map((r, i) => `Ring #${i + 1} [${r.id}] · ${r.colorGuess} · ${r.confidence}: ${r.explanation}`).join('\n') || '未检测到游戏圈。'
    draw()
  } catch (error) { status.textContent = `检测失败：${error instanceof Error ? error.message : String(error)}` }
  finally { button.disabled = false; file.disabled = false }
}

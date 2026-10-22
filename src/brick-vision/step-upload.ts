import { newSessionId } from '../brick-inventory/inventory'
import { readImage, recognizeImage, downloadVision } from './upload'
import { sameStep, canApplyVision } from './step-fence.mjs'
import type { StepReference, VisionResult } from './types'

export function mountStepImageConfirmation(host: HTMLElement, options: {
  capture(): StepReference | null; permitted(): boolean; confirm(reference: StepReference): void
}) {
  host.innerHTML = '<h3>Step Image Confirmation · 上传照片</h3><p>拍清目标积木及接合处。明确通过时会确认上传时的当前步骤；不确定时不推进。照片发送给 Gemini，完整诊断保存在 Test Audio 本机。</p><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择当前步骤照片" /><button class="recognize">识别并确认当前步骤</button><p class="vision-status" role="status"></p><img alt="步骤确认照片" style="max-width:100%;max-height:260px" hidden /><details><summary>图片确认原始结果与诊断</summary><pre style="max-height:320px;overflow:auto;white-space:pre-wrap"></pre><button class="download" disabled>下载完整诊断（含原图）</button></details>'
  const input = host.querySelector('input')!, button = host.querySelector<HTMLButtonElement>('.recognize')!
  const status = host.querySelector<HTMLElement>('.vision-status')!, preview = host.querySelector('img')!
  const download = host.querySelector<HTMLButtonElement>('.download')!, details = host.querySelector('pre')!
  let reference: StepReference | null = null, file: File | null = null, requestId = '', busy = false, disposed = false, consumed = false
  let result: VisionResult | null = null
  function refresh() {
    input.disabled = busy || !options.permitted()
    button.disabled = busy || consumed || !file || !options.permitted() || !sameStep(reference, options.capture())
    if (!busy && file && !sameStep(reference, options.capture())) status.textContent = '步骤已变化，这张图片的确认凭据已失效。请为当前步骤重新选择照片。'
  }
  input.onchange = () => {
    file = input.files?.[0] || null; reference = options.capture(); requestId = newSessionId(); consumed = false; result = null
    details.textContent = ''; status.textContent = reference ? `绑定步骤 ${reference.taskId} · revision ${reference.revision}` : '当前没有可确认步骤'
    preview.hidden = true; download.disabled = true; refresh()
  }
  button.onclick = async () => {
    if (busy || consumed || !file || !reference || !options.permitted() || !sameStep(reference, options.capture())) return
    const captured = { ...reference }, chosen = file
    busy = true; refresh(); status.textContent = '正在识别；不会自动重试。手动/语音确认仍可使用，迟到图片结果将被丢弃。'
    try {
      const image = await readImage(chosen)
      if (disposed) return
      if (!options.permitted() || !sameStep(captured, options.capture())) { status.textContent = '步骤或权限已变化，未发送模型请求。'; return }
      preview.src = `data:${image.mimeType};base64,${image.imageBase64}`; preview.hidden = false
      const response = await recognizeImage(image, requestId, captured)
      if (disposed) return
      result = response; download.disabled = false
      details.textContent = JSON.stringify({ ...response, request: '完整输入及原图请下载诊断' }, null, 2)
      status.textContent = response.error ? `${response.error.stage}：${response.error.message}` : `${response.evaluation?.verdict}：${response.evaluation?.reason}`
      if (canApplyVision(response, captured, options.capture(), options.permitted())) {
        consumed = true // Mark before submitting; never confirm this result twice.
        options.confirm(captured)
        status.textContent += ' · 已向现有 Activity 提交确认，实际进度以游戏状态为准。'
      } else if (!sameStep(captured, options.capture())) status.textContent += ' · 结果已过期，未提交确认。'
      else consumed = true // Retry/uncertain needs a deliberate new upload, not another model call.
    } catch (error) { if (!disposed) status.textContent = String(error) }
    finally { if (!disposed) { busy = false; refresh() } }
  }
  download.onclick = () => { if (result) downloadVision(result) }
  refresh()
  return { refresh, dispose() { disposed = true; host.replaceChildren() } }
}

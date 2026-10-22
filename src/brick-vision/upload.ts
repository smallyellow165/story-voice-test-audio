import { requestJson } from '../brick-inventory/api.mjs'
import type { StepReference, VisionResult } from './types'

export async function prepareInventoryImage(file: File) {
  const original = await readImage(file)
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 不可用')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('JPEG 编码失败')), 'image/jpeg', 0.8))
    if (blob.type !== 'image/jpeg') throw new Error('浏览器未生成 JPEG')
    const compressed = await readImage(new File([blob], 'vision.jpg', { type: blob.type }))
    return { ...compressed,
      originalImage: { ...original, name: file.name, width: bitmap.width, height: bitmap.height },
      compression: { original: { width: bitmap.width, height: bitmap.height, bytes: file.size },
        sent: { width: canvas.width, height: canvas.height, bytes: blob.size }, maxEdge: 1024, quality: 0.8 },
    }
  } catch (error) { throw new Error(`图片压缩失败，未发送原图：${String(error)}`) }
  finally { bitmap?.close() }
}

export async function readImage(file: File): Promise<{ mimeType: string; imageBase64: string }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 6 * 1024 * 1024) throw new Error('请选择不超过 6 MB 的 PNG、JPEG 或 WebP 图片。')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => resolve({ mimeType: file.type, imageBase64: String(reader.result).split(',')[1] })
    reader.readAsDataURL(file)
  })
}
export function recognizeImage(image: { mimeType: string; imageBase64: string }, requestId: string, reference?: StepReference, model?: string, provider?: 'gemini' | 'openai'): Promise<VisionResult> {
  return requestJson<VisionResult>('/api/brick-vision', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...image, requestId, mode: reference ? 'step' : 'inventory', reference, model, provider }) }, 'Brick Vision')
}
export function downloadVision(result: VisionResult) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = `brick-vision-${result.id}.json`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

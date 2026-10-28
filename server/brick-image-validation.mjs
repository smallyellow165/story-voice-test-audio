import { createHash } from 'node:crypto'
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }
export function validateImage(body) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(body?.mimeType) || typeof body.imageBase64 !== 'string'
    || body.imageBase64.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.imageBase64)) fail('请上传不超过 6 MB 的 JPEG、PNG 或 WebP 图片')
  const bytes = Buffer.from(body.imageBase64, 'base64')
  const signatures = { 'image/png': bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/jpeg': bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/webp': bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' }
  if (!bytes.length || bytes.length > 6 * 1024 * 1024 || !signatures[body.mimeType]) fail('图片类型与内容不匹配')
  return { mimeType: body.mimeType, imageBase64: body.imageBase64, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
}

import { requestJson } from './api.mjs'

// Only share concurrent metadata requests. Entries are discarded on settlement;
// MySQL and the existing image service remain the sole resource cache.
export function createInventoryImageReader(readJson = requestJson) {
  const pending = new Map()
  return function readImage(partNum, colorId = null) {
    const params = new URLSearchParams(colorId === null ? { part_nums: partNum }
      : { part_num: partNum, color_id: String(colorId) })
    const route = colorId === null ? 'images' : 'color-image'
    const url = '/api/brick-catalog/' + route + '?' + params
    if (pending.has(url)) return pending.get(url)
    const request = Promise.resolve().then(() => readJson(url, {
      signal: AbortSignal.timeout(15000),
    }, '积木图片')).then(body => {
      const media = colorId === null ? body.images?.[partNum] : body
      if (!media || typeof media.status !== 'string' || !(media.url === null || typeof media.url === 'string'))
        throw new Error('无效的图片状态')
      if (media.part_num != null && media.part_num !== partNum
        || media.color_id != null && media.color_id !== colorId) throw new Error('图片资源身份不一致')
      return { ...media, part_num: partNum, color_id: colorId }
    }).finally(() => pending.delete(url))
    pending.set(url, request)
    return request
  }
}
export const readInventoryImage = createInventoryImageReader()

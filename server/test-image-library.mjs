import { readdir, open, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.resolve(fileURLToPath(new URL('../public/test-images/', import.meta.url)))
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
const mime = name => types[path.extname(name).toLowerCase()]
const allowed = name => typeof name === 'string' && name.length <= 255 && !name.startsWith('.') && !/[\\/\x00-\x1f]/.test(name) && !!mime(name)
const missing = () => Object.assign(new Error('Test image not found.'), { statusCode: 404 })
async function checkDirectory() {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw missing()
}
async function listImages() {
  try { await checkDirectory() } catch (e) { if (e.code === 'ENOENT') return []; throw e }
  return (await readdir(directory, { withFileTypes: true }))
    .filter(e => e.isFile() && allowed(e.name))
    .map(e => ({ name: e.name, url: '/api/test-images/file?name=' + encodeURIComponent(e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
async function readImage(name) {
  if (!allowed(name)) throw missing()
  await checkDirectory()
  // No arbitrary paths, subdirectories or symbolic links; only explicit image filenames.
  const handle = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || !info.size || info.size > 6 * 1024 * 1024) throw missing()
    const bytes = await handle.readFile(), type = mime(name)
    const valid = type === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    if (!valid) throw missing()
    return { bytes, type }
  } finally { await handle.close() }
}
export async function testImageMiddleware(req, res, next) {
  const url = new URL(req.url || '/', 'http://localhost')
  let pathname
  try { pathname = decodeURIComponent(url.pathname) }
  catch { res.writeHead(400).end(); return }
  const route = pathname.replace(/^\/story-voice-test-audio(?=\/)/, '')
  const isStatic = route === '/test-images' || route.startsWith('/test-images/')
  if (!isStatic && route !== '/api/test-images' && !route.startsWith('/api/test-images/')) return next()
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
  if (req.method !== 'GET') return json(405, { error: 'Use GET.' })
  try {
    if (route === '/api/test-images') return json(200, { images: await listImages() })
    if (!isStatic && route !== '/api/test-images/file') throw missing()
    const name = isStatic ? route.slice('/test-images/'.length) : url.searchParams.get('name')
    const { bytes, type } = await readImage(name)
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
    res.end(bytes)
  } catch (e) { json(e.statusCode || (['ENOENT','ELOOP','ENOTDIR'].includes(e.code) ? 404 : 500), { error: '无法读取测试图片；仅支持目录内不超过 6 MB 的 JPG / PNG / WebP 普通文件。' }) }
}
export function testImageLibraryPlugin() {
  return { name: 'test-image-library',
    configureServer(server) { server.middlewares.use(testImageMiddleware) },
    configurePreviewServer(server) { server.middlewares.use(testImageMiddleware) },
  }
}

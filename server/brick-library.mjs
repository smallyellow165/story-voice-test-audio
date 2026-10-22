import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Matrix4, Vector3, Box3 } from 'three'

const defaultLibrary = '/home/umi/Documents/pg/gaming/lego-brick/complete/ldraw'

export const brickLibraryRoot = () => process.env.LDRAW_LIBRARY_PATH || defaultLibrary

export function validLibraryPath(relative) {
  return !!relative && !relative.split('/').some(s => !s || s === '.' || s === '..')
    && /^[a-z0-9_./ -]+\.(dat|ldr)$/i.test(relative)
}

// Shared by HTTP serving and Mapping dependency inspection.
export async function resolveLibraryFile(root, relative) {
  if (!validLibraryPath(relative)) return null
  const names = [relative]
  let bare = relative
  while (/^(parts|p|models)\//i.test(bare)) {
    bare = bare.slice(bare.indexOf('/') + 1)
    names.push(bare)
  }
  for (const candidate of new Set(names.flatMap(name => [name, `parts/${name}`, `p/${name}`, `models/${name}`]))) {
    try { const file = await resolveFile(root, candidate); if (file) return file }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
  }
  return null
}

// Follow type-1 references without changing candidate identity or resolving aliases
// to different Part IDs. Results are scoped to one Review, never cached globally.
export async function inspectBrickModel(part, library = brickLibraryRoot(), { extractGeometry = false } = {}) {
  const files = new Set(), active = new Set(), entryReferences = []
  const connectionMetadataFiles = [], sourceFiles = [], primitives = [], snapping = []
  const sources = new Map(), resolved = new Map(), bounds = new Box3()
  let instances = 0
  const extraction = () => extractGeometry ? {
    coordinateSystem: 'Original LDraw entry coordinates, LDU, +Y down; all type-1 transforms composed',
    meshBounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() },
    primitives, snapping, instances,
    status: 'needs-review',
    unknown: ['Body envelope is not the full mesh bounds', 'Primitive observations are not approved mating interfaces',
      'Bottom sockets, allowed placement, collision decomposition and physical stability need review'],
  } : undefined
  let entryAvailable = false, geometry = false
  try {
    if (typeof part !== 'string' || !/^[a-z0-9_-]+$/i.test(part)) throw new Error('候选型号不是有效的 LDraw 文件编号')
    const root = await realpath(library)
    async function visit(relative, transform = new Matrix4()) {
      if (!validLibraryPath(relative)) throw new Error(`非法模型引用：${relative}`)
      if (!resolved.has(relative)) resolved.set(relative, await resolveLibraryFile(root, relative))
      const file = resolved.get(relative)
      if (!file) throw new Error(`模型或依赖不存在：${relative}`)
      if (active.has(file)) throw new Error(`模型依赖循环：${relative}`)
      if (files.has(file) && !extractGeometry) return
      if (++instances > 100000 || active.size >= 128 || files.size >= 10000) throw new Error('模型依赖超过检查上限')
      let source
      try { source = sources.get(file) ?? await readFile(file, 'utf8'); sources.set(file, source) }
      catch { throw new Error(`模型或依赖不可读取：${relative}`) }
      const isEntry = !files.size
      if (isEntry) entryAvailable = true
      if (!files.has(file)) {
        sourceFiles.push({ path: path.relative(root, file).split(path.sep).join('/'), sha256: createHash('sha256').update(source).digest('hex') })
        if (/^0\s+!LDCAD\s+SNAP_/m.test(source)) connectionMetadataFiles.push(relative)
      }
      if (extractGeometry) {
        // Primitive names describe geometry, not an inventory Part Number whitelist.
        if (['stud7.dat', 'stud8.dat', 'stud8a.dat', 'box5.dat'].includes(path.basename(file).toLowerCase()))
          primitives.push({ file: path.relative(root, file).split(path.sep).join('/'),
            origin: new Vector3().applyMatrix4(transform).toArray(), matrix: transform.toArray() })
        for (const line of source.split(/\r?\n/)) if (/^0\s+!LDCAD\s+SNAP_/.test(line))
          snapping.push({ file: relative, raw: line, matrix: transform.toArray(), interpreted: false })
      }
      files.add(file); active.add(file)
      for (const line of source.split(/\r?\n/)) {
        const tokens = line.trim().split(/\s+/)
        if (tokens[0] === '1') {
          if (tokens.length < 15 || !tokens.slice(2, 14).every(v => Number.isFinite(Number(v)))) throw new Error(`无效的模型引用：${relative}`)
          if (isEntry) entryReferences.push({ file: tokens.slice(14).join(' ').replaceAll('\\', '/'), translation: tokens.slice(2, 5).map(Number), matrix: tokens.slice(5, 14).map(Number) })
          const n = tokens.slice(2, 14).map(Number)
          const local = new Matrix4().set(n[3], n[4], n[5], n[0], n[6], n[7], n[8], n[1], n[9], n[10], n[11], n[2], 0, 0, 0, 1)
          await visit(tokens.slice(14).join(' ').replaceAll('\\', '/'), transform.clone().multiply(local))
        } else if (tokens[0] === '3' || tokens[0] === '4') {
          if (tokens.length !== (tokens[0] === '3' ? 11 : 14) || !tokens.slice(2).every(v => Number.isFinite(Number(v)))) throw new Error(`无效的几何记录：${relative}`)
          geometry = true
          if (extractGeometry) for (let i = 2; i < tokens.length; i += 3)
            bounds.expandByPoint(new Vector3(...tokens.slice(i, i + 3).map(Number)).applyMatrix4(transform))
        }
      }
      active.delete(file)
    }
    await visit(`${part}.dat`)
    if (!geometry) throw new Error('模型及依赖没有可显示的面')
    return { available: true, entryAvailable, checkedFiles: files.size, entryReferences, sourceFiles, extraction: extraction(), connectionMetadata: { files: connectionMetadataFiles, interpreted: false }, errors: [] }
  } catch (error) {
    return { available: false, entryAvailable, checkedFiles: files.size, entryReferences, sourceFiles, extraction: extraction(), connectionMetadata: { files: connectionMetadataFiles, interpreted: false },
      errors: [error.code ? `本地 LDraw 库读取失败（${error.code}）` : error.message] }
  }
}

// Read-only, narrowly scoped access. Never expose the surrounding filesystem.
async function resolveFile(root, relative) {
  let current = root
  for (const segment of relative.split('/')) {
    const entries = await readdir(current)
    const name = entries.includes(segment) ? segment : entries.find((item) => item.toLowerCase() === segment.toLowerCase())
    if (!name) return null
    current = await realpath(path.join(current, name))
    if (!current.startsWith(root + path.sep)) return null
  }
  return (await stat(current)).isFile() ? current : null
}

export function brickLibraryPlugin() {
  let base = '/'
  let library = defaultLibrary
  const paths = new Map()

  const middleware = async (req, res, next) => {
    const pathname = (req.url || '/').split('?')[0]
    // These hooks run before Vite's base middleware, in dev and preview.
    if (['/brick-test', '/brick-test/', `${base}brick-test`, `${base}brick-test/`].includes(pathname)) {
      res.writeHead(302, { Location: `${base}brick-test.html` }).end()
      return
    }
    const prefix = `${base}brick-ldraw/`
    if (!pathname.startsWith(prefix)) return next()
    const send = (status, text) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : text)
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Use GET or HEAD.')
    let relative
    try { relative = decodeURIComponent(pathname.slice(prefix.length)).replaceAll('\\', '/') }
    catch { return send(400, 'Invalid LDraw filename encoding.') }
    if (!validLibraryPath(relative)) {
      return send(400, 'Invalid LDraw path; only .dat and .ldr files within the library are available.')
    }
    try {
      const root = await realpath(library)
      // LDrawLoader tries parts/, p/, models/ before the literal name. Resolve
      // those probes here, so a 404 denotes a genuinely missing dependency.
      const key = `${root}:${relative}`
      let filename = paths.get(key)
      if (filename) {
        // Recheck symlinks even for cached paths.
        filename = await realpath(filename)
        if (!filename.startsWith(root + path.sep)) return send(403, 'LDraw file is outside the configured library.')
      } else {
        filename = await resolveLibraryFile(root, relative)
      }
      if (!filename) return send(404, `LDraw file not found: ${relative}. Check LDRAW_LIBRARY_PATH and the complete official library.`)
      paths.set(key, filename)
      send(200, await readFile(filename))
    } catch (error) {
      paths.clear()
      send(503, `LDraw library unavailable (${error.code || 'READ_ERROR'}). Check LDRAW_LIBRARY_PATH: ${library}`)
    }
  }
  return {
    name: 'duplo-local-ldraw',
    configResolved(config) {
      base = config.base
      library = process.env.LDRAW_LIBRARY_PATH || defaultLibrary
    },
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}

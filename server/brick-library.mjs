import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const defaultLibrary = '/home/umi/Documents/pg/gaming/lego-brick/complete/ldraw'

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
    if (!relative || relative.split('/').some((s) => !s || s === '.' || s === '..') || !/^[a-z0-9_./ -]+\.(dat|ldr)$/i.test(relative)) {
      return send(400, 'Invalid LDraw path; only .dat and .ldr files within the library are available.')
    }
    try {
      const root = await realpath(library)
      // LDrawLoader tries parts/, p/, models/ before the literal name. Resolve
      // those probes here, so a 404 denotes a genuinely missing dependency.
      const names = [relative]
      let bare = relative
      while (/^(parts|p|models)\//i.test(bare)) {
        bare = bare.slice(bare.indexOf('/') + 1)
        names.push(bare)
      }
      const candidates = [...new Set(names.flatMap((name) => [name, `parts/${name}`, `p/${name}`, `models/${name}`]))]
      const key = `${root}:${relative}`
      let filename = paths.get(key)
      if (filename) {
        // Recheck symlinks even for cached paths.
        filename = await realpath(filename)
        if (!filename.startsWith(root + path.sep)) return send(403, 'LDraw file is outside the configured library.')
      } else {
        for (const candidate of candidates) {
          try { filename = await resolveFile(root, candidate) }
          catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
          if (filename) break
        }
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

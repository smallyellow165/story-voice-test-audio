import { mkdtemp, open, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { runFfmpeg } from './video-clip-generator.mjs'

export const screencastEndpoint = '/api/screencast/mp4'
const maxBytes = 512 * 1024 * 1024

export const transcodeScreencast = (input, output) => runFfmpeg([
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-fflags', '+genpts', '-i', input, '-map', '0:v:0', '-an',
  // Reset the origin, but preserve gaps/elapsed time in browser VFR recordings.
  // Pad odd dimensions by at most one pixel for H.264 yuv420p compatibility.
  '-vf', 'setpts=PTS-STARTPTS,pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=30',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
  '-movflags', '+faststart', output,
], { timeoutMs: 10 * 60 * 1000 })

// Shared by standalone Vite, Vite preview and the existing application server.
// Files live only in a request-specific temporary directory and are removed
// after the response finishes or fails. Nothing enters the video library.
export async function screencastMiddleware(request, response, next) {
  if (request.url?.split('?')[0] !== screencastEndpoint) return next()
  let directory
  try {
    if (request.method !== 'POST') throw Object.assign(new Error('Use POST'), { status: 405 })
    const type = (request.headers['content-type'] ?? '').split(';')[0]
    if (!['video/webm', 'video/mp4', 'video/x-matroska'].includes(type)) {
      throw Object.assign(new Error('Expected a WebM or MP4 recording'), { status: 415 })
    }
    if (Number(request.headers['content-length']) > maxBytes) {
      throw Object.assign(new Error('Recording exceeds 512 MiB upload limit'), { status: 413 })
    }
    directory = await mkdtemp(path.join(tmpdir(), 'ring-screencast-'))
    const input = path.join(directory, 'recording')
    const output = path.join(directory, 'screencast.mp4')
    const file = await open(input, 'w')
    let bytes = 0
    try {
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > maxBytes) throw Object.assign(new Error('Recording exceeds 512 MiB upload limit'), { status: 413 })
        await file.writeFile(chunk)
      }
    } finally { await file.close() }
    if (!bytes) throw Object.assign(new Error('Empty recording'), { status: 400 })
    await transcodeScreencast(input, output)
    const result = await stat(output)
    if (!result.size) throw new Error('FFmpeg produced an empty MP4')
    response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': result.size,
      'Content-Disposition': 'attachment; filename="screencast.mp4"', 'Cache-Control': 'no-store' })
    await pipeline(createReadStream(output), response)
  } catch (error) {
    if (!response.headersSent && !response.destroyed) {
      response.writeHead(error.status ?? 500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ error: `MP4 conversion failed: ${error.message}` }))
    }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}

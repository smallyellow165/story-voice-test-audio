import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

export const whisperAlignmentAudioUrl = '/api/debug/whisper-alignment/audio'
export const whisperAlignmentResultUrl = '/api/debug/whisper-alignment/result'

const files = new Map([
  [whisperAlignmentAudioUrl, {
    path: '/home/umi/Documents/pg/xiaozhi/My-Good-GYM/static/video-seeker/video/inbox/ximalaya-test-1.m4a',
    contentType: 'audio/mp4',
  }],
  [whisperAlignmentResultUrl, {
    path: '/home/umi/min-wrk/projects/agent-starter-react/authoring/timed-text/tangshi/ximalaya-test-1-dufu-jiaren-06b8c9888d90-f03699c28eb4.json',
    contentType: 'application/json; charset=utf-8',
  }],
])

const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function requestedRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return null
  let start, end
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || start >= size || end < start) return null
  return { start, end: Math.min(end, size - 1), partial: true }
}

/** Two fixed, loopback-only development fixtures. No caller-supplied filesystem path. */
export async function whisperAlignmentFixtureMiddleware(request, response, next) {
  const pathname = request.url?.split('?')[0]
  const file = files.get(pathname)
  if (!file) return next()
  if (!localAddresses.has(request.socket.remoteAddress)) {
    response.writeHead(403).end()
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  try {
    const info = await stat(file.path)
    if (!info.isFile() || !info.size) throw new Error('Fixture is unavailable')
    const range = requestedRange(request.headers.range, info.size)
    if (!range) {
      response.writeHead(416, { 'Content-Range': `bytes */${info.size}`, 'Cache-Control': 'no-store' }).end()
      return
    }
    response.writeHead(range.partial ? 206 : 200, {
      'Content-Type': file.contentType,
      'Content-Length': range.end - range.start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      ...(range.partial ? { 'Content-Range': `bytes ${range.start}-${range.end}/${info.size}` } : {}),
    })
    if (request.method === 'HEAD') response.end()
    else await pipeline(createReadStream(file.path, { start: range.start, end: range.end }), response)
  } catch {
    if (!response.headersSent) response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
    else response.destroy()
  }
}

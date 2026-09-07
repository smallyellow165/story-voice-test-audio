import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { screencastMiddleware } from '../server/screencast-transcode.mjs'

async function post(data) {
  const request = Readable.from([data])
  request.url = '/api/screencast/mp4'
  request.method = 'POST'
  request.headers = { 'content-type': 'video/webm', 'content-length': String(data.length) }
  const chunks = []
  const response = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } })
  response.writeHead = (status, headers) => { response.status = status; response.headers = headers }
  await screencastMiddleware(request, response, () => assert.fail('Route not handled'))
  return { status: response.status, headers: response.headers, body: Buffer.concat(chunks) }
}

test('streaming WebM becomes indexed, silent H.264 MP4 with frequent keyframes and accurate seek', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'screencast-test-'))
  const run = (command, args) => execFileSync(command, args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  try {
    const input = path.join(directory, 'live.webm')
    const output = path.join(directory, 'result.mp4')
    run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=30',
      '-t', '4', '-an', '-c:v', 'libvpx', '-live', '1', input])
    const response = await post(await readFile(input))
    assert.equal(response.status, 200)
    assert.equal(response.headers['Content-Type'], 'video/mp4')
    await writeFile(output, response.body)
    assert.ok(response.body.indexOf('moov') > 0)
    assert.ok(response.body.indexOf('moov') < response.body.indexOf('mdat'))
    const metadata = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]))
    assert.equal(metadata.streams.length, 1)
    assert.equal(metadata.streams[0].codec_name, 'h264')
    assert.equal(metadata.streams[0].pix_fmt, 'yuv420p')
    assert.ok(Math.abs(Number(metadata.format.duration) - 4) < 0.1)
    const frames = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_frames',
      '-show_entries', 'frame=key_frame,best_effort_timestamp_time', '-of', 'json', output])).frames
    const keys = frames.filter(f => f.key_frame).map(f => Number(f.best_effort_timestamp_time))
    assert.ok(keys.length >= 4)
    assert.ok(keys.slice(1).every((t, i) => t - keys[i] <= 1.01))
    // Compare random-access decoding to sequential decoding of the same frame.
    const seek = run('ffmpeg', ['-v', 'error', '-ss', '2.4', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    const sequential = run('ffmpeg', ['-v', 'error', '-i', output, '-vf', "select='eq(n,72)'",
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    assert.ok(seek.length > 0)
    assert.deepEqual(seek, sequential)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('invalid recording returns a clear conversion error', async () => {
  const response = await post(Buffer.from('not a video'))
  assert.equal(response.status, 500)
  assert.match(JSON.parse(response.body).error, /MP4 conversion failed/)
})

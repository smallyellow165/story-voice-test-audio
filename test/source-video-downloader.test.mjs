import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  SourceVideoDownloadError,
  buildYtDlpArgs,
  downloadSourceVideo,
  normalizeSourceVideoUrl,
} from '../server/source-video-downloader.mjs'

test('validates remote source URLs before invoking yt-dlp', () => {
  assert.equal(normalizeSourceVideoUrl(' https://www.bilibili.com/video/BV123 '), 'https://www.bilibili.com/video/BV123')
  for (const value of ['', 'not a url', 'file:///tmp/video.mp4', 'https://user:pass@example.com/video']) {
    assert.throws(
      () => normalizeSourceVideoUrl(value),
      (error) => error instanceof SourceVideoDownloadError && error.code === 'INVALID_SOURCE_URL',
    )
  }
})

test('passes URL as one argv value and keeps output configuration server-controlled', () => {
  const sourceUrl = 'https://example.com/video?id=1;touch /tmp/not-run'
  const args = buildYtDlpArgs(sourceUrl, '/project/public/test-videos/source')

  assert.equal(args.at(-1), sourceUrl)
  assert.equal(args.at(-2), '--')
  assert.ok(args.includes('/project/public/test-videos/source'))
  assert.ok(args.includes('%(title)s [%(id)s].%(ext)s'))
  assert.ok(args.includes('--no-overwrites'))
  assert.ok(args.includes('--no-playlist'))
})

test('returns the final source-relative identity and supports an existing stable output', async () => {
  const sourceVideoDirectory = await mkdtemp(path.join(os.tmpdir(), 'source-video-download-'))
  const filename = 'Downloaded Video [BV123].mp4'
  const fullPath = path.join(sourceVideoDirectory, filename)
  await writeFile(fullPath, 'video')
  let calls = 0
  const runYtDlp = async () => {
    calls += 1
    return { stdout: `__STORY_VOICE_SOURCE_FILE__${fullPath}\n`, stderr: '' }
  }

  const first = await downloadSourceVideo({
    sourceUrl: 'https://www.bilibili.com/video/BV123',
    sourceVideoDirectory,
    runYtDlp,
  })
  const repeated = await downloadSourceVideo({
    sourceUrl: 'https://www.bilibili.com/video/BV123',
    sourceVideoDirectory,
    runYtDlp,
  })

  assert.equal(calls, 2)
  assert.deepEqual(first, {
    sourceUrl: 'https://www.bilibili.com/video/BV123',
    filename,
    relativePath: `source/${filename}`,
  })
  assert.deepEqual(repeated, first)
})

test('rejects a reported output outside the source directory', async () => {
  const sourceVideoDirectory = await mkdtemp(path.join(os.tmpdir(), 'source-video-download-'))
  const outsidePath = path.join(path.dirname(sourceVideoDirectory), 'outside.mp4')
  await writeFile(outsidePath, 'video')

  await assert.rejects(
    downloadSourceVideo({
      sourceUrl: 'https://example.com/video',
      sourceVideoDirectory,
      runYtDlp: async () => ({ stdout: `__STORY_VOICE_SOURCE_FILE__${outsidePath}\n`, stderr: '' }),
    }),
    (error) => error instanceof SourceVideoDownloadError && error.code === 'INVALID_DOWNLOADED_VIDEO_PATH',
  )
})

import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

const outputMarker = '__STORY_VOICE_SOURCE_FILE__'
const supportedVideoExtensions = new Set(['.mp4', '.webm', '.mov', '.mkv'])

export class SourceVideoDownloadError extends Error {
  constructor(message, code = 'SOURCE_VIDEO_DOWNLOAD_FAILED') {
    super(message)
    this.name = 'SourceVideoDownloadError'
    this.code = code
  }
}

export const normalizeSourceVideoUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SourceVideoDownloadError('Enter a source URL.', 'INVALID_SOURCE_URL')
  }
  let parsed
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new SourceVideoDownloadError('Enter a valid HTTP or HTTPS source URL.', 'INVALID_SOURCE_URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new SourceVideoDownloadError('Enter a valid HTTP or HTTPS source URL.', 'INVALID_SOURCE_URL')
  }
  return parsed.href
}

export const buildYtDlpArgs = (sourceUrl, sourceVideoDirectory) => [
  '--no-playlist',
  '--no-overwrites',
  '--newline',
  '--paths', sourceVideoDirectory,
  '--output', '%(title)s [%(id)s].%(ext)s',
  '--print', `after_move:${outputMarker}%(filepath)s`,
  '--', sourceUrl,
]

const runYtDlpProcess = (args, executable = 'yt-dlp') => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { shell: false, windowsHide: true })
  let stdout = ''
  let stderr = ''
  const append = (current, chunk) => `${current}${chunk}`.slice(-256 * 1024)
  const timeout = setTimeout(() => {
    child.kill('SIGTERM')
    reject(new SourceVideoDownloadError('yt-dlp timed out.', 'YT_DLP_TIMEOUT'))
  }, 30 * 60 * 1000)

  child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
  child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
  child.on('error', (error) => {
    clearTimeout(timeout)
    if (error.code === 'ENOENT') {
      reject(new SourceVideoDownloadError('yt-dlp is not installed or is not available on the server PATH.', 'YT_DLP_NOT_FOUND'))
      return
    }
    reject(new SourceVideoDownloadError(`Could not start yt-dlp: ${error.message}`))
  })
  child.on('close', (code) => {
    clearTimeout(timeout)
    if (code !== 0) {
      const detail = stderr.trim().split('\n').at(-1) || stdout.trim().split('\n').at(-1)
      reject(new SourceVideoDownloadError(detail || `yt-dlp exited with code ${code}.`, 'YT_DLP_FAILED'))
      return
    }
    resolve({ stdout, stderr })
  })
})

export const downloadSourceVideo = async ({
  sourceUrl,
  sourceVideoDirectory,
  runYtDlp = runYtDlpProcess,
}) => {
  const normalizedUrl = normalizeSourceVideoUrl(sourceUrl)
  const args = buildYtDlpArgs(normalizedUrl, sourceVideoDirectory)
  const { stdout = '' } = await runYtDlp(args)
  const markedPaths = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(outputMarker))
    .map((line) => line.slice(outputMarker.length).trim())
    .filter(Boolean)
  const reportedPath = markedPaths.at(-1)
  if (!reportedPath) {
    throw new SourceVideoDownloadError('yt-dlp completed without reporting the downloaded video path.', 'YT_DLP_OUTPUT_NOT_FOUND')
  }

  const fullPath = path.resolve(reportedPath)
  const relativeToSource = path.relative(path.resolve(sourceVideoDirectory), fullPath)
  if (!relativeToSource || relativeToSource.startsWith('..') || path.isAbsolute(relativeToSource) || relativeToSource.includes(path.sep)) {
    throw new SourceVideoDownloadError('yt-dlp reported a file outside the source video directory.', 'INVALID_DOWNLOADED_VIDEO_PATH')
  }
  if (!supportedVideoExtensions.has(path.extname(relativeToSource).toLowerCase())) {
    throw new SourceVideoDownloadError('yt-dlp did not produce a supported video file.', 'UNSUPPORTED_DOWNLOADED_VIDEO')
  }
  try {
    await access(fullPath)
  } catch {
    throw new SourceVideoDownloadError('yt-dlp reported a video file that does not exist.', 'DOWNLOADED_VIDEO_NOT_FOUND')
  }

  return {
    sourceUrl: normalizedUrl,
    filename: relativeToSource,
    relativePath: `source/${relativeToSource}`,
  }
}

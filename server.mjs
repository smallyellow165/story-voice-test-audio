import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import textToSpeech from '@google-cloud/text-to-speech'
import { createServer as createViteServer } from 'vite'
import { probeAudioDuration } from './server/audio-duration.mjs'
import { generateClip, resolveGeneratedClipFullPath } from './server/video-clip-generator.mjs'
import { VideoLibraryStorageError, createVideoLibraryRepository } from './server/video-library-repository.mjs'
import { resolvePoseResultFullPath, savePoseResult } from './server/pose-result-store.mjs'
import { buildLlmPoseResult, resolveLlmPoseResultFullPath } from './server/pose-llm-compressor.mjs'
import { SourceVideoDownloadError, downloadSourceVideo, normalizeSourceVideoUrl } from './server/source-video-downloader.mjs'
import {
  deleteClipCascade,
  deleteLlmPoseRunArtifact,
  deletePoseRunCascade,
  deleteVideoCascade,
} from './server/video-library-artifacts.mjs'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const generatedDirectory = path.join(projectRoot, 'generated')
const generatedAudioDirectory = path.join(projectRoot, 'generated', 'test-audio')
const metadataFile = path.join(generatedDirectory, 'metadata.json')
const testVideoDirectory = path.join(projectRoot, 'public', 'test-videos')
const videoLibraryFile = path.join(testVideoDirectory, 'video-library.json')
const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 5173)
const maxRequestBytes = 32 * 1024
const maxVideoLibraryRequestBytes = 1024 * 1024
const maxPoseResultRequestBytes = 64 * 1024 * 1024
const maxInputBytes = 8_000

const videoLibraryRepository = createVideoLibraryRepository(videoLibraryFile)

class AudioDurationError extends Error {}

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
})

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

const previewExtensions = new Set(['.mp4', '.webm', '.mov'])

const readTestVideoLibrary = async () => {
  const library = await videoLibraryRepository.loadVideoLibrary()
  return {
    source: library.videos.map((video) => ({
      videoId: video.videoId,
      name: video.filename,
      relativePath: video.relativePath,
      url: `/test-videos/${video.relativePath.split('/').map(encodeURIComponent).join('/')}`,
      category: 'source',
      previewSupported: previewExtensions.has(path.extname(video.relativePath).toLowerCase()),
    })),
    clips: library.clips.filter((clip) => clip.relativePath).map((clip) => ({
      videoId: clip.videoId,
      clipId: clip.clipId,
      name: path.basename(clip.relativePath),
      relativePath: clip.relativePath,
      url: `/test-videos/${clip.relativePath.split('/').map(encodeURIComponent).join('/')}`,
      category: 'clip',
      previewSupported: true,
    })),
  }
}

const readMetadata = async () => {
  try {
    const contents = await readFile(metadataFile, 'utf8')
    const records = JSON.parse(contents)
    if (!Array.isArray(records)) throw new Error('Generated audio metadata must be a JSON array.')
    return records
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

const writeMetadata = async (records) => {
  await mkdir(generatedDirectory, { recursive: true })
  await writeFile(metadataFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

let metadataWriteQueue = Promise.resolve()
const appendMetadataRecord = (record) => {
  const write = metadataWriteQueue.then(async () => {
    const records = await readMetadata()
    records.unshift(record)
    await writeMetadata(records)
    return record
  })
  metadataWriteQueue = write.catch(() => undefined)
  return write
}

const localTimestamp = (date) => {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = (value) => String(Math.abs(value)).padStart(2, '0')
  const offsetHours = pad(Math.trunc(offset / 60))
  const offsetMinutes = pad(offset % 60)
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return {
    idPrefix: `${datePart}-${timePart}`,
    createdAt: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offsetHours}:${offsetMinutes}`,
  }
}

const readJsonBody = (request, maximumBytes = maxRequestBytes) => new Promise((resolve, reject) => {
  let size = 0
  const chunks = []

  request.on('data', (chunk) => {
    size += chunk.length
    if (size > maximumBytes) {
      reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => {
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }))
    }
  })
  request.on('error', reject)
})

const hasLocalApplicationDefaultCredentials = async () => {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true
  const gcloudConfigDirectory = process.env.CLOUDSDK_CONFIG ?? path.join(homedir(), '.config', 'gcloud')
  try {
    await access(path.join(gcloudConfigDirectory, 'application_default_credentials.json'), constants.R_OK)
    return true
  } catch {
    return false
  }
}

const toPublicError = (error) => {
  const message = String(error?.message ?? '')
  const details = String(error?.details ?? '')
  const context = `${message} ${details}`.toLowerCase()

  if (error instanceof AudioDurationError) {
    return {
      statusCode: 500,
      code: 'AUDIO_DURATION_PROBE_FAILED',
      message: error.message,
    }
  }

  if (error?.code === 16 || /could not load the default credentials|application default credentials|unauthenticated/.test(context)) {
    return {
      statusCode: 401,
      code: 'GOOGLE_AUTH_REQUIRED',
      message: 'Google Cloud authentication is unavailable. Configure Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS on the server.',
    }
  }
  if (error?.code === 8 || /quota|resource exhausted/.test(context)) {
    return {
      statusCode: 429,
      code: 'GOOGLE_QUOTA_EXCEEDED',
      message: 'Google Cloud Text-to-Speech quota was exceeded. Check the project quota and try again later.',
    }
  }
  if (error?.code === 7 && /billing|consumer|serviceusage/.test(context)) {
    return {
      statusCode: 403,
      code: 'GOOGLE_BILLING_OR_PROJECT_ACCESS',
      message: 'Google Cloud billing or project access is not configured for Cloud Text-to-Speech.',
    }
  }
  if (error?.code === 7 || /permission denied/.test(context)) {
    return {
      statusCode: 403,
      code: 'GOOGLE_PERMISSION_DENIED',
      message: 'The server credential does not have permission to use Cloud Text-to-Speech.',
    }
  }
  if (error?.code === 3 || /model.*not found|model.*unavailable|unsupported.*model/.test(context)) {
    return {
      statusCode: 422,
      code: 'GOOGLE_MODEL_UNAVAILABLE',
      message: 'The requested Gemini TTS model or voice is unavailable for this Google Cloud project or region.',
    }
  }
  if (error?.code === 14 || /unavailable|deadline exceeded/.test(context)) {
    return {
      statusCode: 503,
      code: 'GOOGLE_TTS_UNAVAILABLE',
      message: 'Cloud Text-to-Speech is temporarily unavailable. Please try again.',
    }
  }
  return {
    statusCode: 502,
    code: 'GOOGLE_TTS_REQUEST_FAILED',
    message: 'Cloud Text-to-Speech rejected the request. Check the server console for non-secret error context.',
  }
}

const handleTestTts = async (request, response) => {
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    sendJson(response, error.statusCode ?? 400, { error: { code: 'INVALID_REQUEST', message: error.message } })
    return
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : 'Achernar'
  const style = typeof body.style === 'string' ? body.style.trim() : ''

  if (!text) {
    sendJson(response, 400, { error: { code: 'TEXT_REQUIRED', message: 'Text is required.' } })
    return
  }
  if (Buffer.byteLength(text, 'utf8') + Buffer.byteLength(style, 'utf8') > maxInputBytes) {
    sendJson(response, 400, { error: { code: 'TEXT_TOO_LONG', message: 'Text and style instructions must total 8,000 bytes or fewer.' } })
    return
  }
  if (!/^[A-Za-z0-9-]+$/.test(voice)) {
    sendJson(response, 400, { error: { code: 'INVALID_VOICE', message: 'Voice must contain only letters, numbers, and hyphens.' } })
    return
  }
  if (!(await hasLocalApplicationDefaultCredentials())) {
    sendJson(response, 401, {
      error: {
        code: 'GOOGLE_AUTH_REQUIRED',
        message: 'Google Cloud authentication is unavailable. Run gcloud auth application-default login or set GOOGLE_APPLICATION_CREDENTIALS on the server.',
      },
    })
    return
  }

  const client = new textToSpeech.TextToSpeechClient({ fallback: true })
  try {
    const [result] = await client.synthesizeSpeech({
      input: { text, prompt: style || undefined },
      voice: {
        languageCode: 'cmn-CN',
        name: voice,
        modelName: 'gemini-3.1-flash-tts-preview',
      },
      audioConfig: { audioEncoding: 'MP3' },
    })
    if (!result.audioContent) throw new Error('Cloud Text-to-Speech returned an empty audio response.')

    await mkdir(generatedAudioDirectory, { recursive: true })
    const timestamp = localTimestamp(new Date())
    const id = `${timestamp.idPrefix}-${crypto.randomUUID().slice(0, 8)}`
    const filename = `${id}-${voice.toLowerCase()}.mp3`
    const audioPath = path.join(generatedAudioDirectory, filename)
    await writeFile(audioPath, result.audioContent)
    let durationSeconds
    try {
      durationSeconds = await probeAudioDuration(audioPath)
    } catch (error) {
      throw new AudioDurationError(error.message, { cause: error })
    }

    const record = await appendMetadataRecord({
      id,
      voice,
      script: text,
      audioFile: filename,
      durationSeconds,
      createdAt: timestamp.createdAt,
    })

    sendJson(response, 201, {
      url: `/generated/test-audio/${filename}`,
      format: 'audio/mpeg',
      model: 'gemini-3.1-flash-tts-preview',
      languageCode: 'cmn-CN',
      voice,
      bytes: result.audioContent.length,
      record,
    })
  } catch (error) {
    const publicError = toPublicError(error)
    console.error('Google Cloud TTS request failed', {
      code: error?.code,
      details: error?.details,
      message: error?.message,
    })
    sendJson(response, publicError.statusCode, { error: { code: publicError.code, message: publicError.message } })
  } finally {
    await client.close().catch(() => undefined)
  }
}

const serveGeneratedAudio = async (pathname, response) => {
  const filename = path.basename(pathname)
  if (!/^[a-z0-9-]+\.mp3$/i.test(filename)) {
    response.writeHead(404).end()
    return
  }
  try {
    const audio = await readFile(path.join(generatedAudioDirectory, filename))
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' })
    response.end(audio)
  } catch {
    response.writeHead(404).end()
  }
}

const sendVideoLibraryError = (response, error) => {
  const statusByCode = {
    INVALID_VIDEO_LIBRARY_SCHEMA: 400,
    UNSUPPORTED_VIDEO_LIBRARY_SCHEMA: 400,
    VIDEO_NOT_FOUND: 404,
    CLIP_NOT_FOUND: 404,
    CLIP_ARTIFACT_NOT_FOUND: 404,
    SOURCE_VIDEO_NOT_FOUND: 404,
    SOURCE_VIDEO_UNAVAILABLE: 400,
    INVALID_GENERATED_CLIP_PATH: 400,
    CLIP_GENERATION_IN_PROGRESS: 409,
    INVALID_POSE_RESULT: 400,
    INVALID_POSE_RESULT_PATH: 400,
    POSE_RESULT_NOT_FOUND: 404,
    POSE_RUN_NOT_FOUND: 404,
    POSE_RUN_ID_CONFLICT: 409,
    POSE_RESULT_FILE_NOT_FOUND: 404,
    POSE_RESULT_IN_PROGRESS: 409,
    INVALID_LLM_POSE_RESULT_PATH: 400,
    LLM_POSE_RESULT_NOT_FOUND: 404,
    LLM_POSE_RUN_NOT_FOUND: 404,
    LLM_POSE_RUN_ID_CONFLICT: 409,
    LLM_POSE_RESULT_FILE_NOT_FOUND: 404,
    LLM_POSE_RESULT_IN_PROGRESS: 409,
    FFMPEG_FAILED: 422,
    FFMPEG_UNAVAILABLE: 500,
    FFMPEG_OUTPUT_MISSING: 500,
    INVALID_SOURCE_URL: 400,
    YT_DLP_NOT_FOUND: 500,
    YT_DLP_FAILED: 422,
    YT_DLP_TIMEOUT: 504,
    YT_DLP_OUTPUT_NOT_FOUND: 500,
    INVALID_DOWNLOADED_VIDEO_PATH: 500,
    UNSUPPORTED_DOWNLOADED_VIDEO: 422,
    DOWNLOADED_VIDEO_NOT_FOUND: 500,
    DOWNLOADED_VIDEO_NOT_LISTED: 500,
  }
  const statusCode = error?.statusCode ?? statusByCode[error?.code] ?? 500
  const code = error instanceof VideoLibraryStorageError || error instanceof SourceVideoDownloadError
    ? error.code
    : error?.statusCode ? 'INVALID_REQUEST' : 'VIDEO_LIBRARY_STORAGE_ERROR'
  console.error('Video library request failed', { code, message: error?.message })
  sendJson(response, statusCode, { error: { code, message: error?.message ?? 'Video library storage failed.' } })
}

const readVideoLibraryRequest = async (request) => readJsonBody(request, maxVideoLibraryRequestBytes)

const sourceSiteFromUrl = (sourceUrl) => {
  const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '')
  if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return 'youtube'
  if (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) return 'bilibili'
  return 'other'
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (url.pathname === '/api/video-v2/source/download') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for source video downloads.' } })
      return
    }
    try {
      const body = await readVideoLibraryRequest(request)
      const sourceUrl = normalizeSourceVideoUrl(body?.sourceUrl)
      const storedLibrary = await videoLibraryRepository.loadVideoLibrary()
      const existingVideo = storedLibrary.videos.find((video) => video.sourceUrl === sourceUrl)
      if (existingVideo) {
        await access(path.join(testVideoDirectory, existingVideo.relativePath), constants.R_OK)
        const asset = (await readTestVideoLibrary()).source.find((item) => item.videoId === existingVideo.videoId)
        sendJson(response, 200, {
          downloaded: {
            sourceUrl,
            filename: existingVideo.filename,
            relativePath: existingVideo.relativePath,
            alreadyExists: true,
          },
          asset,
          library: storedLibrary,
        })
        return
      }

      await mkdir(testVideoDirectory, { recursive: true })
      const stagingDirectory = await mkdtemp(path.join(testVideoDirectory, '.download-'))
      let createdVideoId = ''
      try {
        const downloaded = await downloadSourceVideo({ sourceUrl, sourceVideoDirectory: stagingDirectory })
        const downloadedStat = await stat(downloaded.fullPath)
        const { library, result: createdVideo } = await videoLibraryRepository.createVideo({
          filename: downloaded.filename,
          sourceUrl,
          sourceSite: sourceSiteFromUrl(sourceUrl),
          size: downloadedStat.size,
          lastModified: downloadedStat.mtimeMs,
        })
        createdVideoId = createdVideo.videoId
        const finalPath = path.join(testVideoDirectory, createdVideo.relativePath)
        await mkdir(path.dirname(finalPath), { recursive: true })
        await rename(downloaded.fullPath, finalPath)
        const asset = {
          videoId: createdVideo.videoId,
          name: createdVideo.filename,
          relativePath: createdVideo.relativePath,
          url: `/test-videos/${createdVideo.relativePath.split('/').map(encodeURIComponent).join('/')}`,
          category: 'source',
          previewSupported: previewExtensions.has(path.extname(createdVideo.relativePath).toLowerCase()),
        }
        sendJson(response, 200, {
          downloaded: { sourceUrl, filename: createdVideo.filename, relativePath: createdVideo.relativePath },
          asset,
          library,
        })
      } catch (error) {
        if (createdVideoId) await videoLibraryRepository.deleteVideo(createdVideoId).catch(() => undefined)
        throw error
      } finally {
        await rm(stagingDirectory, { recursive: true, force: true })
      }
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  if (url.pathname === '/api/video-v2/library') {
    try {
      if (request.method === 'GET') {
        sendJson(response, 200, await videoLibraryRepository.loadVideoLibrary())
        return
      }
      if (request.method === 'PUT') {
        const body = await readVideoLibraryRequest(request)
        sendJson(response, 200, await videoLibraryRepository.replaceLibrary(body))
        return
      }
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or PUT for /api/video-v2/library.' } })
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  if (url.pathname === '/api/video-v2/video') {
    if (request.method !== 'PATCH' && request.method !== 'DELETE') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use PATCH or DELETE for /api/video-v2/video.' } })
      return
    }
    try {
      const body = await readVideoLibraryRequest(request)
      const library = request.method === 'PATCH'
        ? (await videoLibraryRepository.updateVideo(body?.videoId, body?.patch)).library
        : await deleteVideoCascade({
            videoId: body?.videoId,
            repository: videoLibraryRepository,
            testVideoDirectory,
          })
      sendJson(response, 200, library)
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  if (url.pathname === '/api/video-v2/clip/generate') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for /api/video-v2/clip/generate.' } })
      return
    }
    try {
      const body = await readVideoLibraryRequest(request)
      const result = await generateClip({
        videoId: body?.videoId,
        clipId: body?.clipId,
        repository: videoLibraryRepository,
        testVideoDirectory,
      })
      sendJson(response, 200, {
        ...result.library,
        generatedClip: result.clip,
        ffmpegArgs: result.ffmpegArgs,
      })
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  if (url.pathname === '/api/video-v2/clip/pose') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for /api/video-v2/clip/pose.' } })
      return
    }
    try {
      const body = await readJsonBody(request, maxPoseResultRequestBytes)
      const result = await savePoseResult({
        videoId: body?.videoId,
        clipId: body?.clipId,
        poseData: body?.poseData,
        repository: videoLibraryRepository,
        testVideoDirectory,
      })
      sendJson(response, 200, { ...result.library, poseRun: result.poseRun })
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  if (url.pathname === '/api/video-v2/clip/pose/compress') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for /api/video-v2/clip/pose/compress.' } })
      return
    }
    try {
      const body = await readVideoLibraryRequest(request)
      const result = await buildLlmPoseResult({
        videoId: body?.videoId,
        clipId: body?.clipId,
        poseRunId: body?.poseRunId,
        repository: videoLibraryRepository,
        testVideoDirectory,
      })
      sendJson(response, 200, { ...result.library, llmPoseRun: result.llmPoseRun })
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  if (url.pathname === '/api/video-v2/pose-run') {
    if (request.method !== 'DELETE') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use DELETE for /api/video-v2/pose-run.' } })
      return
    }
    try {
      const body = await readVideoLibraryRequest(request)
      sendJson(response, 200, await deletePoseRunCascade({
        videoId: body?.videoId,
        clipId: body?.clipId,
        poseRunId: body?.poseRunId,
        repository: videoLibraryRepository,
        testVideoDirectory,
      }))
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  if (url.pathname === '/api/video-v2/llm-pose-run') {
    if (request.method !== 'DELETE') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use DELETE for /api/video-v2/llm-pose-run.' } })
      return
    }
    try {
      const body = await readVideoLibraryRequest(request)
      sendJson(response, 200, await deleteLlmPoseRunArtifact({
        videoId: body?.videoId,
        clipId: body?.clipId,
        poseRunId: body?.poseRunId,
        llmPoseRunId: body?.llmPoseRunId,
        repository: videoLibraryRepository,
        testVideoDirectory,
      }))
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  const clipPathMatch = url.pathname.match(/^\/api\/video-v2\/videos\/([^/]+)\/clips\/([^/]+)\/path$/)
  if (clipPathMatch) {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for a generated clip path.' } })
      return
    }
    try {
      const fullPath = await resolveGeneratedClipFullPath({
        videoId: decodeURIComponent(clipPathMatch[1]),
        clipId: decodeURIComponent(clipPathMatch[2]),
        repository: videoLibraryRepository,
        testVideoDirectory,
      })
      sendJson(response, 200, { fullPath })
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  const posePathMatch = url.pathname.match(/^\/api\/video-v2\/videos\/([^/]+)\/clips\/([^/]+)\/pose-runs\/([^/]+)\/path$/)
  if (posePathMatch) {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for a pose result path.' } })
      return
    }
    try {
      const fullPath = await resolvePoseResultFullPath({
        videoId: decodeURIComponent(posePathMatch[1]),
        clipId: decodeURIComponent(posePathMatch[2]),
        poseRunId: decodeURIComponent(posePathMatch[3]),
        repository: videoLibraryRepository,
        testVideoDirectory,
      })
      sendJson(response, 200, { fullPath })
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  const llmPosePathMatch = url.pathname.match(/^\/api\/video-v2\/videos\/([^/]+)\/clips\/([^/]+)\/pose-runs\/([^/]+)\/llm-runs\/([^/]+)\/path$/)
  if (llmPosePathMatch) {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for an LLM Pose result path.' } })
      return
    }
    try {
      const fullPath = await resolveLlmPoseResultFullPath({
        videoId: decodeURIComponent(llmPosePathMatch[1]),
        clipId: decodeURIComponent(llmPosePathMatch[2]),
        poseRunId: decodeURIComponent(llmPosePathMatch[3]),
        llmPoseRunId: decodeURIComponent(llmPosePathMatch[4]),
        repository: videoLibraryRepository,
        testVideoDirectory,
      })
      sendJson(response, 200, { fullPath })
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  if (url.pathname === '/api/video-v2/clip') {
    if (request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST, PATCH, or DELETE for /api/video-v2/clip.' } })
      return
    }
    try {
      const body = await readVideoLibraryRequest(request)
      let library
      if (request.method === 'POST') {
        library = (await videoLibraryRepository.createClip(body?.videoId, {
            startMs: body?.startMs,
            endMs: body?.endMs,
            label: body?.label,
          })).library
      } else if (request.method === 'PATCH') {
        library = (await videoLibraryRepository.updateClipLabel(body?.videoId, body?.clipId, body?.label)).library
      } else {
        library = await deleteClipCascade({
          videoId: body?.videoId,
          clipId: body?.clipId,
          repository: videoLibraryRepository,
          testVideoDirectory,
        })
      }
      sendJson(response, 200, library)
    } catch (error) {
      sendVideoLibraryError(response, error)
    }
    return
  }

  if (url.pathname === '/api/test-videos') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for /api/test-videos.' } })
      return
    }
    try {
      sendJson(response, 200, await readTestVideoLibrary())
    } catch (error) {
      console.error('Test video directories could not be read', { code: error?.code, message: error?.message })
      sendJson(response, 500, { error: { code: 'VIDEO_LIBRARY_READ_FAILED', message: 'Test video directories could not be read.' } })
    }
    return
  }

  if (url.pathname === '/api/test-audio') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for /api/test-audio.' } })
      return
    }
    try {
      sendJson(response, 200, { records: await readMetadata() })
    } catch (error) {
      console.error('Generated audio metadata could not be read', { code: error?.code, message: error?.message })
      sendJson(response, 500, { error: { code: 'METADATA_READ_FAILED', message: 'Generated audio metadata could not be read.' } })
    }
    return
  }

  if (url.pathname === '/api/test-tts') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for /api/test-tts.' } })
      return
    }
    await handleTestTts(request, response)
    return
  }
  if (url.pathname.startsWith('/generated/test-audio/')) {
    await serveGeneratedAudio(url.pathname, response)
    return
  }
  vite.middlewares(request, response)
})

server.listen(port, host, () => {
  console.log(`Voice test server listening on http://localhost:${port}${vite.config.base}`)
})
